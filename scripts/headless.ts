// Runs baseline vs. Jev headlessly at 10× speed with real Jev calls, then
// prints the scoreboard. Run: npm run headless
import { interpretEvent } from "../src/lib/jev/interpretEvent";
import { interpretRequest } from "../src/lib/jev/interpretRequest";
import { Column } from "../src/lib/sim/engine";
import { World } from "../src/lib/sim/world";

const SIM_SECONDS = Number(process.env.SIM_SECONDS ?? 1200);
const DT = 0.5;
const SPEED = 10;
const EVENTS: [number, string][] = [
  [300, "Trauma incoming to the ED in 5 minutes"],
  [420, "Car C door keeps sticking"],
  [600, "Visiting hours just started"],
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const baseline = new Column("baseline");
  const smart = new Column("jev", (a) => interpretRequest(a));
  const world = new World([baseline, smart], { seed: 7 });

  const events = [...EVENTS];
  while (world.now < SIM_SECONDS) {
    if (events.length && world.now >= events[0][0]) {
      const [, text] = events.shift()!;
      const interp = await interpretEvent(text);
      world.applyEvent(interp);
      for (const c of world.columns) c.applyPolicy(interp, text);
      console.log(`t=${world.now.toFixed(0)}s event: ${text} → ${interp.type} floor=${interp.floor} car=${interp.car}`);
    }
    world.step(DT);
    await sleep((DT * 1000) / SPEED);
  }

  const rows = [baseline, smart].map((c) => ({ mode: c.mode, ...c.metrics() }));
  const fmt = (v: unknown) => (typeof v === "number" ? (Number.isInteger(v) ? String(v) : v.toFixed(1)) : String(v));
  const keys = Object.keys(rows[0]) as (keyof (typeof rows)[0])[];
  for (const k of keys) console.log(k.padEnd(22), ...rows.map((r) => fmt(r[k]).padStart(10)));
  console.log("\nJev decisions (latest):");
  for (const d of smart.log.slice(0, 12)) console.log(`  [${d.kind}] ${d.text}${d.tags ? `  · ${d.tags.join(" · ")}` : ""}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
