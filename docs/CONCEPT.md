# Switchboard — Concept

> **Working name.** A dispatcher for any fleet. The wedge: hospital elevators.
>
> Built for JEVATHON (Jev Hackathon SF, Sept 26 2026 — TypeSafe AI × The AI Collective, hosted at CodeRabbit).

---

## One-liner

**Optimizers handle distance. They can't handle meaning.** Switchboard puts Jev inside the dispatch loop so that every decision — which elevator answers which call — accounts for *what* is waiting, not just *where*.

## The problem

In a hospital, the elevator doesn't know that the person waiting on floor 3 is a code team. It treats them the same as a visitor heading to the cafeteria.

Conventional elevator dispatch (collective control, cost-function optimizers, destination dispatch) is good at the math: positions, directions, queued stops, travel time. It is blind to context:

- **Priority** — a STAT team, a bed transport, a patient, a staff member, and a visitor are all just "a hall call."
- **Capacity semantics** — a bed effectively consumes a whole car; a wheelchair needs significant space.
- **Infection control** — clean/sterile supplies shouldn't share a car with soiled linen or waste; isolation patients need separation.
- **Discretion** — morgue transports shouldn't share a car with visitors.
- **Predictable surges** — shift changes, visiting hours, OR turnover.
- **Unstructured signals** — "trauma incoming to the ED in 5 min," "car 2 door is sticking," "floor 6 is on lockdown."

None of this fits in a cost function, and all of it changes what the right decision is.

## The key insight: average wait is the wrong metric

Conventional dispatchers minimize **average wait time**. In a hospital, the metric that matters is **priority-weighted wait** — how long did the *critical* movements wait?

This makes for an honest comparison: a heuristic may *win* on average wait while losing badly on STAT response time and bed-transport time. We show both.

## Why Jev

[Jev](https://typesafe.ai/blog/introducing-system-one-models-and-jev) is TypeSafe AI's first *System One* model: send a **state** (text or JSON) plus **typed questions**, get back typed answers with calibrated probabilities. It doesn't generate text — it makes decisions.

Two properties together, which nothing else offers:

1. **It reads meaning.** Jev turns messy context ("bed transport, ER → 7, contact isolation") into typed, atomic decisions — intelligence-fused switch statements.
2. **It's fast enough to live inside a control loop.** 70–500 ms end-to-end, reported 40–200× faster than comparable LLMs, at $0.042 per million input tokens (output free). A general-purpose LLM can also read meaning, but at seconds per call it falls behind a busy building.

Heuristics are fast but blind. LLMs are smart but slow. Jev is the one that belongs in the loop.

### We use Jev the way TypeSafe says to

TypeSafe's own guidance ([jaggedness](https://docs.typesafe.ai/model-jaggedness/jev-1.13), [how to build](https://docs.typesafe.ai/concepts/how-to-build-with-system-one)) is: *keep control flow and arithmetic in code; give the model narrow, typed semantic judgments.* Jev is explicitly weak at math, numeric comparison, dates, and counting.

That is exactly our split: **the optimizer does the math, Jev does the meaning.** Jev never computes distances or travel times.

## How it works

Jev is called **once per event** (a new request or a free-text incident) — not every simulation tick.

```
 free-text request ──► ┌─────────────────────┐  typed answers   ┌──────────────────────┐
 "Bed transport ER→7,  │ Jev: request        │ ───────────────► │ Optimizer (code)     │
  contact isolation"   │ interpreter         │  priority, load, │ cost = travel time   │
                       │ (one call, parallel │  exclusivity,    │  × priority weight   │
                       │  questions)         │  infection class │  + constraint costs  │
                       └─────────────────────┘                  └──────────┬───────────┘
                                                                           │ assignment
 free-text incident ──► ┌─────────────────────┐  typed answers             ▼
 "Car 3 door sticking"  │ Jev: event          │ ──► rule changes ──► ┌──────────┐
                        │ interpreter         │  (reserve, remove,   │ Dispatch │
                        └─────────────────────┘   pre-position)      └──────────┘

 Low confidence ──► treat conservatively (assume higher priority) + flag to human dispatcher
 Jev slow / down ──► fall back to structured fields only (baseline behavior)
```

### 1. Request interpreter (core)

Every elevator request arrives as free text from a nurse, porter, or hospital system. One Jev call answers all questions in parallel:

| Question | Type | Options |
|---|---|---|
| `priority` | Choice | `stat` · `urgent` · `routine` · `visitor` |
| `load` | Choice | `bed` · `wheelchair` · `cart` · `walking` |
| `needs_exclusive_car` | Noul | yes/no probability |
| `infection_class` | Choice | `sterile` · `soiled` · `isolation` · `none` |
| `requires_discretion` | Noul | yes/no probability |

Code turns these into weights and constraints in the optimizer's cost function — TypeSafe's [composite scoring](https://docs.typesafe.ai/patterns/composite-scoring) pattern. Questions that only matter sometimes are asked anyway ([speculative fan-out](https://docs.typesafe.ai/patterns/fan-out)); parallel evaluation keeps latency flat.

### 2. Event interpreter (the chaos box)

Free-text incidents are mapped to typed events:

| Question | Type | Options |
|---|---|---|
| `event_type` | Choice | `surge` · `car_fault` · `lockdown` · `priority_transport` · `ignore` |
| `affected_floor` | Choice | the building's floor list |
| `affected_car` | Choice | the car list |

Code applies the resulting rule change: reserve a car, take one out of service, pre-position idle cars ahead of a surge, block a floor.

### 3. Confidence gating (production readiness)

Every Choice answer carries a calibrated `confidence` ([confidence-gated routing](https://docs.typesafe.ai/patterns/confidence-routing)). Thresholds scale with risk:

- Uncertain priority → treat as the **higher** plausible priority and flag it to the human dispatcher.
- Uncertain event interpretation → surface it to the dispatcher instead of acting automatically.

The system knows when it's unsure, and fails safe.

### 4. Reasons are built in code

Jev does not generate text, so per-decision explanations are assembled from its typed answers and the optimizer's numbers — structured and auditable:

> **Car C → Floor 3** · Priority: STAT (0.94) · Needs exclusive car: yes (0.97) · Skipped Car A: 4 pending stops

### 5. Optional: tie-breaker

When the optimizer's top 2–3 candidates are nearly tied, a Jev Choice picks among them using context. Numbers are converted to words in code first ("close," "heading away") because Jev is weak with raw numbers. Stretch goal only.

### Safety

Hospitals already have key-operated emergency override modes for elevators. Switchboard operates alongside them, in the large gray zone of everyday decisions below "emergency override." Hard safety systems are untouched, and if Jev is unavailable the system degrades to baseline behavior.

## The demo

### Three-way side-by-side

Same hospital, same stream of free-text requests, three dispatchers running in parallel. **Only the interpreter differs:**

| Column | Interpreter | Shows |
|---|---|---|
| **Baseline** | None — structured fields only (floor, direction) | The status quo: fast but blind to meaning |
| **LLM** | General-purpose LLM, same questions as JSON output (run on GMI Cloud) | Smart but slow — during bursts its request queue backs up |
| **Jev** | Jev, typed questions | Smart *and* fast enough to keep up |

Jev vs. baseline proves it's **smarter**. Jev vs. LLM proves it's **fast enough** — a *Jev* win, not just an "AI helps" win.

**Where the speed gap shows:** bursts. Shift change, visiting hours, and trauma surges produce many requests at once. At 2–5 s per request the LLM column accumulates a backlog of uninterpreted requests; at 70–500 ms Jev stays current. Running the simulation at accelerated time (e.g. 10–20×) makes this visible.

Each column also shows live interpreter latency and cumulative cost.

### Scoreboard

- Priority-weighted wait (headline metric)
- STAT / code team response time
- Bed transport wait
- Average wait (shown honestly, even where the baseline is competitive)
- Worst-case wait
- Interpreter latency (p50 / p95) and cost

### The chaos box

Judges type free-text events into the live simulation:

- *"Trauma incoming to the ED in 5 minutes"*
- *"Car 3 is out of service"*
- *"Visiting hours just started"*
- *"Floor 6 is on lockdown"*

The baseline can't read them. Jev interprets them in well under a second, and the building adapts. This is the memorable moment.

### Scripted scenarios where the greedy choice is a trap

1. **Bed transport vs. nearest car** — the nearest car is half full; sending it wastes a trip.
2. **Wrong-way car** — the nearest car is heading the other direction with a queue of stops.
3. **Bunching** — all cars cluster (like buses) and a floor gets abandoned.
4. **Anticipation** — shift change is coming; reposition idle cars *before* the surge.
5. **Clean/dirty conflict** — sterile supplies and soiled linen request the same car.

### Request corpus

The simulation draws from a corpus of realistic, varied free-text requests (different phrasings, abbreviations, and levels of detail) so that interpretation is genuinely needed — not a lookup on a fixed set of strings.

### Scope for the sprint

One building, ~4 cars, ~10 floors, 3–5 scripted scenarios plus the chaos box. Hospital only — no live reskin of other domains unless there is spare time.

## Tech stack

- **TypeScript** throughout.
- **Next.js** app: simulation engine, dashboard, and API routes in one codebase.
- **[`@typesafe-ai/sdk`](https://docs.typesafe.ai/sdk/javascript)** (Node 20+) for Jev calls; `TYPESAFE_API_KEY` in the environment.
- **GMI Cloud** for the LLM baseline column.
- **CodeRabbit** reviews on PRs.

Jev constraints to design around ([models](https://docs.typesafe.ai/models)): text-only input, 64k-token context per request, rate limits of ~1,200 requests/min (adjusting dynamically). One call per event keeps us well inside these.

## The pitch (≈3 minutes)

1. **Hook (20s)** — "In a hospital, the elevator doesn't know the person waiting on floor 3 is a code team."
2. **Insight (20s)** — Optimizers handle distance, not meaning. LLMs handle meaning but are too slow for a control loop.
3. **Live demo (90s)** — Three-way side-by-side; judges drive the chaos box; priority-weighted scoreboard; per-decision reasons.
4. **Why it's real (20s)** — Jev does meaning, code does math (exactly TypeSafe's recommended architecture); confidence gating; baseline fallback; safety systems untouched.
5. **Vision (30s)** — A dispatcher for any fleet.

## The vision: a dispatcher for any fleet

Hospital elevators are the wedge. The underlying loop is general:

> **state + context → fast decision → act → repeat**

Physical operations still run on switch statements written decades ago. The same engine can dispatch:

- Hospital porters and bed transport
- Ambulances and field crews
- Warehouse robots
- EV charger queues
- Restaurant kitchen tickets
- GPU / compute job queues

Later: **decision replay** — log every decision and replay a real day with and without Switchboard ("this would have saved N minutes of critical-movement wait on Tuesday").

## How it maps to the judging rubric

| Criterion | Our answer |
|---|---|
| 1. Problem relevance & real-world value | Hospital elevators are a known operational bottleneck; clear stakeholders (facilities, patient transport, patient flow). |
| 2. Technical execution | Live, running simulation with real Jev calls on free-text requests — no mocked flows. |
| 3. Architecture & system design | Code owns math and control flow; Jev owns narrow semantic judgments — TypeSafe's recommended architecture. Explicit latency, cost, and fallback design. |
| 4. Production readiness | Confidence gating, human-dispatcher escalation, baseline fallback, safety systems untouched; decision replay as a validation path. |
| 5. Vision & continuation | Hospital wedge → general fleet dispatcher. |

## Risks & open questions

- **Rate limits** — TypeSafe notes limits are adjusting dynamically; bursts in an accelerated sim must stay under them. Mitigate with one call per event and client-side queuing.
- **Question wording** — Jev reads instructions literally; criteria need explicit boundary cases (e.g. what counts as `stat` vs. `urgent`). Test against the request corpus early.
- **Domain validation** — "Have you talked to a hospital?" Honest answer: this is the next thing we'd validate.
- **Don't overclaim** — say "priority-weighted wait," not "saves lives."
- **Safety optics** — always frame as a dispatch layer operating alongside, not replacing, emergency and safety systems.
- **Scope creep** — one building, one sharp demo.

## References

- [Introducing System One Models & Jev](https://typesafe.ai/blog/introducing-system-one-models-and-jev)
- [TypeSafe docs](https://docs.typesafe.ai/introduction) · [Quick start](https://docs.typesafe.ai/introduction/quickstart) · [Models](https://docs.typesafe.ai/models) · [Jev 1.13 jaggedness](https://docs.typesafe.ai/model-jaggedness/jev-1.13)
- Patterns: [Speculative fan-out](https://docs.typesafe.ai/patterns/fan-out) · [Composite scoring](https://docs.typesafe.ai/patterns/composite-scoring) · [Confidence-gated routing](https://docs.typesafe.ai/patterns/confidence-routing)
