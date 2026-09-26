// Real Jev calls on chaos-box style events. Run: npx tsx --env-file=.env.local scripts/smoke-events.ts
import { interpretEvent } from "../src/lib/jev/interpretEvent";

const EVENTS = [
  "Trauma incoming to the ED in 5 minutes",
  "Car C door keeps sticking",
  "Visiting hours just started",
  "Shift change on the maternity ward in 10 min",
  "elevator B is making a grinding noise",
  "code stroke on 6",
  "the cafeteria is serving free pizza",
];

async function main() {
  for (const e of EVENTS) {
    const r = await interpretEvent(e);
    console.log(
      `${r.latencyMs.toFixed(0).padStart(5)}ms  ${e}\n         type=${r.type} (${r.typeConfidence.toFixed(2)})  floor=${r.floor} (${r.floorConfidence.toFixed(2)})  car=${r.car} (${r.carConfidence.toFixed(2)})`,
    );
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
