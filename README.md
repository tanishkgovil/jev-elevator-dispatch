# Elevator Sense

**Does a fast "understanding" model help inside a control loop?** An experiment built at JEVATHON (Jev Hackathon SF, Sept 26 2026).

A simulated hospital runs two identical elevator banks side by side, with the same building, the same stream of requests, and the same dispatch algorithm. The only difference is that on one side, [Jev](https://typesafe.ai/blog/introducing-system-one-models-and-jev) (TypeSafe AI's fast, structured-decision model) reads each free-text request before the dispatcher assigns an elevator.

**Live demo:** https://jev-elevator-dispatch.vercel.app

## The idea

A normal elevator dispatcher only knows *where* someone is going. In a hospital, *who* is waiting matters: a trauma patient on a bed, a nurse on break, and a family going to the cafeteria all look like the same hall call.

Language models can read that meaning but take seconds per call, which is too slow for a control loop. Jev answers typed questions in ~100–200 ms, so it can sit inside the loop.

## How it works

Every request arrives as a free-text note, e.g. *"Bed transport ER to ICU, pt intubated, need to go NOW"*.

**1. Jev reads it** in one call with three questions ([`src/lib/jev/interpretRequest.ts`](src/lib/jev/interpretRequest.ts)):

| Question | Type | Answers |
|---|---|---|
| How time-critical is this trip? | Choice | `stat` · `urgent` · `routine` · `visitor` |
| What will occupy the elevator? | Choice | `bed` · `wheelchair` · `cart` · `walking` |
| Does this trip need a car with no other passengers? | Noul (yes/no) | probability 0–1 |

Example answer: `stat (0.99) · bed (1.00) · own car 0.90`, in ~120 ms.

**2. Plain code turns the answers into rules** ([`src/lib/sim/policy.ts`](src/lib/sim/policy.ts)):
- **Space:** bed = 10 units (a full car), cart = 5, wheelchair = 3, walking = 2.
- **Own car:** STAT, beds, or "needs own car" > 0.5 get an empty car. A STAT request may re-route passengers who were assigned to that car but haven't boarded yet.

**3. The same dispatcher runs on both sides** ([`src/lib/sim/engine.ts`](src/lib/sim/engine.ts)). For each request it rules out cars that can't take it, then picks the one with the lowest *estimated arrival time + 6 s × (priority weight of each passenger already on that car)*.
- **Without Jev:** every request is treated as one ordinary passenger, handled first-come-first-served, with every passenger weighted 1.
- **With Jev:** requests are handled most-urgent first, space and own-car rules apply, and adding a stop to a car carrying a STAT patient costs more (weight 10 vs. 3 urgent, 1 otherwise).

Jev never picks the elevator or does arithmetic. TypeSafe's docs note Jev is weak at numbers, so it only supplies meaning, and code does the rest.

**4. Live events.** Free text typed into the event box ("Car C door keeps sticking", "Trauma incoming to the ED in 5 minutes") goes through a second Jev call (event type, floor, car). The physical effect happens in both buildings (e.g. car C's doors get slow), but only the Jev side responds: it keeps urgent patients off a faulty car, holds an empty car for an incoming emergency, or pre-positions cars for a crowd.

**What's shared and what's hidden.** Each simulated request has a hidden answer key (true priority, true size). No dispatcher sees it. It's used only for physics (does the bed actually fit?) and for scoring.

## Results

Mean over **16 randomized traffic scenarios that were not used while tuning** (seeds 101–116, 20 simulated minutes each, three live events per run, real Jev answers):

| | Without Jev | With Jev | Change |
|---|---|---|---|
| Emergency (STAT) patients wait | 46.2 s | 13.2 s | **−71%** |
| Patient beds wait | 80.0 s | 23.7 s | **−70%** |
| Everyone waits (average) | 31.2 s | 19.2 s | **−38%** |
| Worst single wait | 342 s | 162 s | −53% |
| Trips where the bed didn't fit | 120 | 3 | −98% |

Jev came out ahead on priority-weighted wait in 14 of 16 scenarios. Reproduce with `SEED_START=101 SEEDS=16 npm run tune`.

## Caveats (read these)

- **I wrote the test requests.** The ~40 request phrasings and the question definitions came from the same author, so Jev's accuracy on real hospital language is unproven. Requests written by someone else are the next test.
- **It's a simulation.** The simplified physics (speed, door times, capacity) and traffic mix are assumptions, not hospital data.
- **The baseline is a textbook dispatcher** (an estimated-time-of-arrival rule plus a per-passenger delay penalty), not a commercial group controller. The claim is "the same dispatcher with vs. without understanding", not "better than industry systems".
- **Some wording was tuned.** A few question definitions were adjusted after seeing Jev's first answers (e.g. lab samples labeled "stat" count as urgent, not emergencies).
- **Jev isn't perfect.** It lost in 2 of 16 scenarios. Giving critical patients their own car costs capacity, so results depend on the traffic mix.

## Run it locally

Requires Node 20+ and a TypeSafe API key from [console.typesafe.ai](https://console.typesafe.ai/keys).

```bash
npm install
cp .env.example .env.local   # then set TYPESAFE_API_KEY
npm run dev                  # http://localhost:3000
```

Scripts:
- `npm run smoke`: a few real Jev calls with answers and latency printed
- `npm run tune`: multi-scenario benchmark, with `SEED_START` and `SEEDS` to pick scenarios
- `npm run headless`: a single real-time run in the terminal

## Project layout

```
src/lib/jev/        Jev calls: request and event interpreters (server-side only)
src/lib/sim/        simulation: traffic (world, corpus), policy, dispatcher/physics (engine)
src/app/api/        API routes the browser calls; the Jev key stays on the server
src/components/     dashboard UI
scripts/            smoke test, benchmark, headless run
docs/CONCEPT.md     design notes
```

## What's next

1. Test on requests written by other people, and measure Jev's accuracy on each question.
2. Use Jev's confidence scores, e.g. treat uncertain requests conservatively or escalate them to a human.
3. Compare against published dispatch algorithms (nearest car, estimated time to destination) and open-source simulators.
4. Generalize the setup (questions + rules + dispatcher) to other fleets: hospital porters, warehouse robots, ambulances.
