import type { EventInterpretation } from "../jev/interpretEvent";
import type { RequestInterpretation } from "../jev/interpretRequest";
import { BASELINE_PROFILE, profileFrom } from "./policy";
import {
  CAR_CAPACITY,
  CAR_SPEED,
  DOOR_DWELL,
  FAULT_DWELL,
  PRIORITY_WEIGHT,
  type Arrival,
  type Car,
  type Decision,
  type Mode,
  type Passenger,
  type Profile,
} from "./types";

export const CAR_COUNT = 4;
const CAR_LETTERS = "ABCD";
const EPS = 1e-6;
const MAX_LOG = 60;

export const carName = (id: number) => `Car ${CAR_LETTERS[id]}`;

export type RequestInterpreter = (a: Arrival) => Promise<RequestInterpretation>;

// One dispatcher running its own copy of the building. All columns receive the
// same arrivals and the same physical events; only what they understand differs.
export class Column {
  readonly mode: Mode;
  now = 0;
  cars: Car[];
  passengers = new Map<number, Passenger>();
  log: Decision[] = [];
  wastedTrips = 0;
  interpLatencies: number[] = [];
  inputTokens = 0;
  pendingInterps = 0;
  private interpret?: RequestInterpreter;

  constructor(mode: Mode, interpret?: RequestInterpreter) {
    this.mode = mode;
    this.interpret = interpret;
    this.cars = Array.from({ length: CAR_COUNT }, (_, id) => ({
      id,
      pos: [1, 1, 5, 9][id] ?? 1,
      dir: 0,
      doorTimer: 0,
      riders: [],
      assigned: [],
      faulty: false,
      avoided: false,
    }));
  }

  get smart() {
    return this.mode !== "baseline";
  }

  // --- Inputs ---------------------------------------------------------------

  addArrival(a: Arrival) {
    const p: Passenger = { ...a, status: "interpreting", wastedTrips: 0 };
    this.passengers.set(p.id, p);
    if (!this.interpret) {
      p.profile = BASELINE_PROFILE;
      p.status = "waiting";
      return;
    }
    this.pendingInterps++;
    this.interpret(a)
      .then((interp) => {
        p.interp = interp;
        p.profile = profileFrom(interp);
        this.interpLatencies.push(interp.latencyMs);
        this.inputTokens += interp.inputTokens;
      })
      .catch(() => {
        // Interpreter unavailable: dispatch on what the baseline knows.
        p.profile = { ...BASELINE_PROFILE, tags: ["Jev unavailable"] };
      })
      .finally(() => {
        this.pendingInterps--;
        if (p.status === "interpreting") p.status = "waiting";
      });
  }

  // Physical consequences happen in every column, understood or not.
  applyPhysicalEvent(e: EventInterpretation) {
    if (e.type === "car_fault" && e.car !== null) this.cars[e.car].faulty = true;
  }

  // Policy response: only dispatchers that can read the event react to it.
  applyPolicy(e: EventInterpretation, text: string) {
    if (!this.smart) return;
    if (e.type === "car_fault" && e.car !== null) {
      this.cars[e.car].avoided = true;
      this.push({ kind: "event", text: `"${text}" → ${carName(e.car)} limited to routine traffic` });
    } else if (e.type === "priority_transport") {
      const floor = e.floor ?? 1;
      const car = this.nearestFreeCar(floor);
      if (car) {
        car.reservedFloor = floor;
        this.push({ kind: "event", text: `"${text}" → hold ${carName(car.id)} empty at floor ${floor}` });
      }
    } else if (e.type === "surge") {
      const floor = e.floor ?? 1;
      const idle = this.cars
        .filter((c) => c.reservedFloor === undefined && this.occupants(c).length === 0)
        .sort((a, b) => Math.abs(a.pos - floor) - Math.abs(b.pos - floor))
        .slice(0, 2);
      for (const c of idle) c.parkAt = floor;
      if (idle.length) {
        this.push({
          kind: "event",
          text: `"${text}" → pre-position ${idle.map((c) => carName(c.id)).join(", ")} at floor ${floor}`,
        });
      }
    }
  }

  // --- Simulation -------------------------------------------------------------

  step(dt: number) {
    this.now += dt;
    this.dispatchWaiting();
    for (const car of this.cars) this.moveCar(car, dt);
  }

  private dispatchWaiting() {
    const waiting = [...this.passengers.values()].filter(
      (p) => p.status === "waiting" && p.car === undefined,
    );
    if (this.smart) {
      waiting.sort(
        (a, b) =>
          PRIORITY_WEIGHT[b.profile!.priority] - PRIORITY_WEIGHT[a.profile!.priority] || a.at - b.at,
      );
    } else {
      waiting.sort((a, b) => a.at - b.at);
    }
    for (const p of waiting) this.dispatch(p);
  }

  private dispatch(p: Passenger) {
    const prof = p.profile!;
    let best: { car: Car; cost: number; bump: number[] } | undefined;
    for (const car of this.cars) {
      if (car.id === p.blockedCar && this.now < (p.blockedUntil ?? 0)) continue;
      const plan = this.smart
        ? this.smartFeasible(car, p, prof)
        : { ok: this.loadUnits(car) + prof.units <= CAR_CAPACITY, bump: [] as number[] };
      if (!plan.ok) continue;
      const cost = this.cost(car, p, prof, plan.bump);
      if (!best || cost < best.cost) best = { car, cost, bump: plan.bump };
    }
    if (!best) return; // nothing suitable right now; retry next tick

    const { car, bump } = best;
    for (const id of bump) {
      const other = this.passengers.get(id)!;
      car.assigned = car.assigned.filter((x) => x !== id);
      other.car = undefined;
      this.push({ kind: "bump", text: `Re-routed "${other.note}" off ${carName(car.id)} to clear it for STAT` });
    }
    car.assigned.push(p.id);
    p.car = car.id;
    if (car.reservedFloor !== undefined && prof.priority === "stat") car.reservedFloor = undefined;
    if (this.smart && prof.exclusive) car.exclusiveFor = p.id;
    car.parkAt = undefined;
    this.push({
      kind: "assign",
      text: `${carName(car.id)} → floor ${p.from} for "${p.note}"`,
      tags: this.smart ? prof.tags : undefined,
      latencyMs: p.interp?.latencyMs,
    });
  }

  private smartFeasible(car: Car, p: Passenger, prof: Profile): { ok: boolean; bump: number[] } {
    const no = { ok: false, bump: [] };
    if (car.exclusiveFor !== undefined) return no;
    // A faulty car still carries routine traffic, but never critical patients.
    if (car.avoided && (prof.priority === "stat" || prof.priority === "urgent" || prof.exclusive)) return no;
    if (car.reservedFloor !== undefined && prof.priority !== "stat") return no;

    const occupants = this.occupants(car);
    if (prof.exclusive) {
      if (occupants.length === 0) return { ok: true, bump: [] };
      // STAT may take a car whose passengers haven't boarded yet; they get re-routed.
      if (prof.priority === "stat" && car.riders.length === 0) return { ok: true, bump: [...car.assigned] };
      return no;
    }

    if (this.loadUnits(car) + prof.units > CAR_CAPACITY) return no;
    return { ok: true, bump: [] };
  }

  // Estimated time for the car to reach the pickup, plus the delay the new stop
  // imposes on everyone already on the car. The smart dispatcher weighs that
  // delay by priority; the baseline counts every passenger the same.
  private cost(car: Car, p: Passenger, prof: Profile, bump: number[]) {
    const bumped = new Set(bump);
    const eta = this.eta(car, p.from, this.stops(car, bumped));
    let disruption = 0;
    for (const o of this.occupants(car)) {
      if (bumped.has(o.id)) continue;
      disruption += (this.smart ? PRIORITY_WEIGHT[o.profile!.priority] : 1) * DOOR_DWELL;
    }
    // A car held for an incoming emergency is the right one for that emergency.
    const reservedBonus = car.reservedFloor === p.from && prof.priority === "stat" ? 30 : 0;
    const faultPenalty = car.avoided ? FAULT_DWELL : 0;
    return eta + disruption + faultPenalty + bump.length * 5 - reservedBonus;
  }

  // Planning assumes normal door times: no dispatcher is told a car is slow,
  // the smart one just stops using a car it has read is faulty.
  private eta(car: Car, floor: number, stops: number[]) {
    const time = (dist: number, n: number) => dist / CAR_SPEED + n * DOOR_DWELL + car.doorTimer;
    const dir = car.dir;
    if (dir === 0 || stops.length === 0) return time(Math.abs(car.pos - floor), 0);
    const ahead = (f: number) => (dir > 0 ? f >= car.pos - EPS : f <= car.pos + EPS);
    if (ahead(floor)) {
      const between = stops.filter((f) => ahead(f) && Math.abs(f - car.pos) < Math.abs(floor - car.pos));
      return time(Math.abs(floor - car.pos), between.length);
    }
    const inDir = stops.filter(ahead);
    const far = inDir.length ? (dir > 0 ? Math.max(...inDir) : Math.min(...inDir)) : car.pos;
    const back = stops.filter((f) => !ahead(f) && Math.abs(f - far) < Math.abs(floor - far));
    return time(Math.abs(far - car.pos) + Math.abs(far - floor), inDir.length + back.length);
  }

  private moveCar(car: Car, dt: number) {
    if (car.doorTimer > 0) {
      car.doorTimer = Math.max(0, car.doorTimer - dt);
      return;
    }
    const target = this.nextTarget(car);
    if (target === undefined) {
      car.dir = 0;
      return;
    }
    if (Math.abs(target - car.pos) < EPS) {
      car.pos = target;
      this.arrive(car, target);
      return;
    }
    car.dir = target > car.pos ? 1 : -1;
    const next = car.pos + car.dir * CAR_SPEED * dt;
    if ((car.dir > 0 && next >= target) || (car.dir < 0 && next <= target)) {
      car.pos = target;
      this.arrive(car, target);
    } else {
      car.pos = next;
    }
  }

  private nextTarget(car: Car): number | undefined {
    const stops = this.stops(car);
    if (stops.length === 0) {
      const home = car.reservedFloor ?? car.parkAt;
      if (home === undefined || Math.abs(home - car.pos) < EPS) return undefined;
      return home;
    }
    const nearest = (fs: number[]) =>
      fs.reduce((a, b) => (Math.abs(b - car.pos) < Math.abs(a - car.pos) ? b : a));
    if (car.dir !== 0) {
      const ahead = stops.filter((f) => (car.dir > 0 ? f >= car.pos - EPS : f <= car.pos + EPS));
      if (ahead.length) return nearest(ahead);
    }
    return nearest(stops);
  }

  private arrive(car: Car, floor: number) {
    const atStop = this.stops(car).includes(floor);
    if (!atStop) {
      car.dir = 0;
      return;
    }
    // Drop off.
    for (const id of car.riders.filter((id) => this.passengers.get(id)!.to === floor)) {
      const p = this.passengers.get(id)!;
      p.status = "done";
      p.droppedAt = this.now;
      if (car.exclusiveFor === id) car.exclusiveFor = undefined;
    }
    car.riders = car.riders.filter((id) => this.passengers.get(id)!.status !== "done");

    // Pick up in the order the dispatcher believes matters most. Physics uses
    // the truth: a bed doesn't fit in a half-full car whatever was believed.
    const boarding = car.assigned
      .map((id) => this.passengers.get(id)!)
      .filter((p) => p.from === floor)
      .sort((a, b) => PRIORITY_WEIGHT[b.profile!.priority] - PRIORITY_WEIGHT[a.profile!.priority]);
    for (const p of boarding) {
      car.assigned = car.assigned.filter((id) => id !== p.id);
      const used = car.riders.reduce((s, id) => s + this.passengers.get(id)!.truth.units, 0);
      if (used + p.truth.units > CAR_CAPACITY) {
        p.car = undefined;
        p.blockedCar = car.id;
        p.blockedUntil = this.now + 30;
        p.wastedTrips++;
        this.wastedTrips++;
        if (car.exclusiveFor === p.id) car.exclusiveFor = undefined;
        this.push({ kind: "wasted", text: `${carName(car.id)} arrived too full: "${p.note}" left behind` });
        continue;
      }
      car.riders.push(p.id);
      p.status = "riding";
      p.pickedAt = this.now;
    }
    car.doorTimer = DOOR_DWELL + (car.faulty ? FAULT_DWELL : 0);
  }

  private stops(car: Car, exclude?: Set<number>): number[] {
    const s = new Set<number>();
    for (const id of car.assigned) if (!exclude?.has(id)) s.add(this.passengers.get(id)!.from);
    for (const id of car.riders) s.add(this.passengers.get(id)!.to);
    return [...s];
  }

  // Riders are measured by the car's load-weighing sensor (every real elevator
  // has one); passengers not yet aboard are counted as the dispatcher believes.
  private loadUnits(car: Car) {
    let units = 0;
    for (const id of car.riders) units += this.passengers.get(id)!.truth.units;
    for (const id of car.assigned) units += this.passengers.get(id)!.profile!.units;
    return units;
  }

  private occupants(car: Car): Passenger[] {
    return [...car.riders, ...car.assigned].map((id) => this.passengers.get(id)!);
  }

  private nearestFreeCar(floor: number): Car | undefined {
    return this.cars
      .filter((c) => !c.avoided && c.reservedFloor === undefined && c.exclusiveFor === undefined && c.riders.length === 0)
      .sort((a, b) => Math.abs(a.pos - floor) - Math.abs(b.pos - floor))[0];
  }

  private push(d: Omit<Decision, "at">) {
    this.log.unshift({ at: this.now, ...d });
    if (this.log.length > MAX_LOG) this.log.length = MAX_LOG;
  }

  // --- Metrics ------------------------------------------------------------------

  metrics() {
    const ps = [...this.passengers.values()];
    const wait = (p: Passenger) => (p.pickedAt ?? this.now) - p.at;
    const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
    let wSum = 0;
    let wWait = 0;
    for (const p of ps) {
      const w = PRIORITY_WEIGHT[p.truth.priority];
      wSum += w;
      wWait += w * wait(p);
    }
    const lat = [...this.interpLatencies].sort((a, b) => a - b);
    const pct = (q: number) => (lat.length ? lat[Math.min(lat.length - 1, Math.floor(q * lat.length))] : 0);
    return {
      requests: ps.length,
      delivered: ps.filter((p) => p.status === "done").length,
      priorityWeightedWait: wSum ? wWait / wSum : 0,
      avgWait: avg(ps.map(wait)),
      maxWait: ps.length ? Math.max(...ps.map(wait)) : 0,
      statWait: avg(ps.filter((p) => p.truth.priority === "stat").map(wait)),
      bedWait: avg(ps.filter((p) => p.truth.load === "bed").map(wait)),
      wastedTrips: this.wastedTrips,
      interpreting: this.pendingInterps,
      latencyP50: pct(0.5),
      latencyP95: pct(0.95),
      inputTokens: this.inputTokens,
    };
  }
}

export type Metrics = ReturnType<Column["metrics"]>;
