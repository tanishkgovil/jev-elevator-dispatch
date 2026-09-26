// Real Jev calls on a handful of hospital requests: checks the key, the
// question wording, and actual latency. Run: npm run smoke
import { interpretRequest, type ElevatorRequest } from "../src/lib/jev/interpretRequest";

const SAMPLES: (ElevatorRequest & { expect: string })[] = [
  { from: 1, to: 4, note: "Bed transport ER to ICU, pt intubated, need to go NOW", expect: "stat/bed/excl" },
  { from: 6, to: 3, note: "code blue team heading up to OR 2", expect: "stat/walking/excl" },
  { from: 7, to: 2, note: "wheelchair pt for scheduled CT, on contact precautions", expect: "urgent/wheelchair" },
  { from: 0, to: 3, note: "sterile instrument trays for OR restock", expect: "routine/cart" },
  { from: 6, to: 0, note: "dirty linen cart to laundry", expect: "routine/cart" },
  { from: 4, to: 0, note: "morgue transport, pt expired 0300", expect: "routine/bed/excl" },
  { from: 1, to: 9, note: "family of 4 going to the cafeteria", expect: "visitor/walking" },
  { from: 5, to: 2, note: "stat troponin sample to lab", expect: "urgent/walking" },
];

async function main() {
  // Warm-up call so connection setup doesn't skew the first measurement.
  await interpretRequest(SAMPLES[0]);

  console.log("Sequential calls:\n");
  for (const s of SAMPLES) {
    const r = await interpretRequest(s);
    console.log(
      `${r.latencyMs.toFixed(0).padStart(5)}ms  ${s.note}\n` +
        `         priority=${r.priority} (${r.priorityConfidence.toFixed(2)})  load=${r.load} (${r.loadConfidence.toFixed(2)})  ` +
        `exclusive=${r.exclusiveCar.toFixed(2)}\n` +
        `         expected: ${s.expect}\n`,
    );
  }

  console.log("Burst: all requests concurrently…");
  const t0 = performance.now();
  const burst = await Promise.all(SAMPLES.map((s) => interpretRequest(s)));
  const lat = burst.map((r) => r.latencyMs).sort((x, y) => x - y);
  console.log(
    `  wall=${(performance.now() - t0).toFixed(0)}ms  p50=${lat[Math.floor(lat.length / 2)].toFixed(0)}ms  max=${lat[lat.length - 1].toFixed(0)}ms  model=${burst[0].model}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
