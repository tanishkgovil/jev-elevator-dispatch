import type { EventInterpretation } from "../jev/interpretEvent";
import { FLOOR_COUNT } from "../hospital";
import { SURGE_NOTES, TEMPLATES, type Truth } from "./corpus";
import type { Column } from "./engine";
import type { Arrival } from "./types";

// Deterministic so every column, and every rerun, sees identical traffic.
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T,>(rng: () => number, xs: readonly T[]) => xs[Math.floor(rng() * xs.length)];

export interface WorldOptions {
  seed?: number;
  meanGap?: number; // mean sim seconds between background requests
}

export class World {
  now = 0;
  private rng: () => number;
  private nextId = 1;
  private schedule: Arrival[] = [];
  private nextBackground: number;
  private meanGap: number;

  constructor(
    readonly columns: Column[],
    opts: WorldOptions = {},
  ) {
    this.rng = mulberry32(opts.seed ?? 42);
    this.meanGap = opts.meanGap ?? 7;
    this.nextBackground = this.gap();
  }

  step(dt: number) {
    this.now += dt;
    while (this.nextBackground <= this.now) {
      this.schedule.push(this.backgroundArrival(this.nextBackground));
      this.nextBackground += this.gap();
    }
    this.schedule.sort((a, b) => a.at - b.at);
    while (this.schedule.length && this.schedule[0].at <= this.now) {
      const a = this.schedule.shift()!;
      for (const c of this.columns) c.addArrival({ ...a });
    }
    for (const c of this.columns) c.step(dt);
  }

  // The world changes the same way for everyone; `interp` decides what the
  // event physically is (spawned traffic, a faulty car).
  applyEvent(interp: EventInterpretation) {
    for (const c of this.columns) c.applyPhysicalEvent(interp);
    if (interp.type === "surge") {
      const floor = interp.floor ?? 1;
      for (let i = 0; i < 12; i++) {
        let to = Math.floor(this.rng() * FLOOR_COUNT);
        if (to === floor) to = (to + 3) % FLOOR_COUNT;
        const visitor = this.rng() < 0.5;
        this.schedule.push({
          id: this.nextId++,
          at: this.now + 10 + i * 4 + this.rng() * 3,
          from: floor,
          to,
          note: pick(this.rng, SURGE_NOTES),
          truth: {
            priority: visitor ? "visitor" : "routine",
            load: "walking",
            infection: "none",
            discretion: false,
            units: visitor ? 3 : 1,
          },
        });
      }
    } else if (interp.type === "priority_transport") {
      const floor = interp.floor ?? 1;
      const truth: Truth = { priority: "stat", load: "bed", infection: "none", discretion: false, units: 10 };
      this.schedule.push({
        id: this.nextId++,
        at: this.now + 45,
        from: floor,
        to: floor === 3 ? 4 : 3,
        note: "trauma pt arrived, bed to OR with team, go now",
        truth,
      });
    }
  }

  private gap() {
    return -Math.log(1 - this.rng()) * this.meanGap;
  }

  private backgroundArrival(at: number): Arrival {
    const total = TEMPLATES.reduce((s, t) => s + t.weight, 0);
    let r = this.rng() * total;
    let t = TEMPLATES[0];
    for (const cand of TEMPLATES) {
      r -= cand.weight;
      if (r <= 0) {
        t = cand;
        break;
      }
    }
    const from = pick(this.rng, t.from);
    let to = pick(this.rng, t.to);
    if (to === from) to = pick(this.rng, t.to.filter((f) => f !== from).concat([from === 1 ? 9 : 1]));
    return { id: this.nextId++, at, from, to, note: pick(this.rng, t.notes), truth: t.truth };
  }
}
