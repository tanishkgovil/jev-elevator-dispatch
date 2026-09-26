// Policy tuning harness: real Jev answers, cached per unique request, replayed
// across many seeds at full speed. Run: npm run tune
import { interpretEvent, type EventInterpretation } from "../src/lib/jev/interpretEvent";
import { interpretRequest, type RequestInterpretation } from "../src/lib/jev/interpretRequest";
import { Column, type Metrics } from "../src/lib/sim/engine";
import type { Arrival } from "../src/lib/sim/types";
import { World } from "../src/lib/sim/world";

const SEEDS = Number(process.env.SEEDS ?? 8);
const SEED_START = Number(process.env.SEED_START ?? 1); // tune on 1–8; report held-out seeds
const SIM_SECONDS = 1200;
const DT = 0.25;
const EVENTS: [number, string][] = [
  [100, "Trauma incoming to the ED in 5 minutes"],
  [250, "Car C door keeps sticking"],
  [400, "Visiting hours just started"],
];

const cache = new Map<string, Promise<RequestInterpretation>>();
const cachedInterpret = (a: Arrival) => {
  const key = `${a.from}|${a.to}|${a.note}`;
  if (!cache.has(key)) cache.set(key, interpretRequest(a));
  return cache.get(key)!;
};

async function run(seed: number, events: Map<string, EventInterpretation>) {
  const baseline = new Column("baseline");
  const smart = new Column("jev", cachedInterpret);
  const world = new World([baseline, smart], { seed });
  const pending = [...EVENTS];
  while (world.now < SIM_SECONDS) {
    if (pending.length && world.now >= pending[0][0]) {
      const [, text] = pending.shift()!;
      const interp = events.get(text)!;
      world.applyEvent(interp);
      for (const c of world.columns) c.applyPolicy(interp, text);
    }
    world.step(DT);
    // Let resolved interpretations land; wait for any in-flight Jev calls.
    while (smart.pendingInterps > 0) await new Promise((r) => setTimeout(r, 5));
  }
  return [baseline.metrics(), smart.metrics()];
}

async function main() {
  const events = new Map<string, EventInterpretation>();
  for (const [, text] of EVENTS) events.set(text, await interpretEvent(text));

  const keys: (keyof Metrics)[] = ["priorityWeightedWait", "statWait", "bedWait", "avgWait", "maxWait", "wastedTrips", "violations"];
  const sums = { b: {} as Record<string, number>, j: {} as Record<string, number> };
  let pwWins = 0;
  for (let seed = SEED_START; seed < SEED_START + SEEDS; seed++) {
    const [b, j] = await run(seed, events);
    if (j.priorityWeightedWait < b.priorityWeightedWait) pwWins++;
    for (const k of keys) {
      sums.b[k] = (sums.b[k] ?? 0) + (b[k] as number) / SEEDS;
      sums.j[k] = (sums.j[k] ?? 0) + (j[k] as number) / SEEDS;
    }
    console.log(`seed ${seed}: pw ${b.priorityWeightedWait.toFixed(1)} → ${j.priorityWeightedWait.toFixed(1)}  stat ${b.statWait.toFixed(1)} → ${j.statWait.toFixed(1)}  avg ${b.avgWait.toFixed(1)} → ${j.avgWait.toFixed(1)}`);
  }
  console.log(`\nmean over ${SEEDS} seeds (Jev wins priority-weighted wait in ${pwWins}/${SEEDS}):`);
  for (const k of keys) {
    const b = sums.b[k];
    const j = sums.j[k];
    const d = b ? ((j - b) / b) * 100 : 0;
    console.log(`  ${k.padEnd(22)} ${b.toFixed(1).padStart(8)} ${j.toFixed(1).padStart(8)}  ${d > 0 ? "+" : ""}${d.toFixed(0)}%`);
  }
  console.log(`(unique requests interpreted: ${cache.size})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
