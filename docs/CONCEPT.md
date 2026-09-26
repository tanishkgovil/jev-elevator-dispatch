# Design notes

How the experiment is set up, and why. For results and how to run it, see the [README](../README.md).

## Question

Can a fast structured-decision model be the "understanding" layer inside a control loop, where software repeatedly makes small operational decisions as the world changes?

Elevator dispatch is a clean test case:
- Decisions are frequent and small (which car answers this call?).
- Classic dispatchers are good at the math (distance, direction, stops) but blind to meaning.
- In a hospital, meaning changes the right answer: a trauma patient on a bed, a lab runner, and a visitor are all just "a hall call" to a conventional controller.

## Why Jev, and not a heuristic or an LLM

- **A heuristic** only sees floor numbers. It can't tell a code team from a visitor, or know that a bed fills a car.
- **A general-purpose LLM** can read the meaning, but at seconds per call it can't keep up with a building's worth of requests.
- **Jev** returns typed answers (choices and yes/no probabilities, each with calibrated confidence) in ~100–200 ms, at $0.042 per million input tokens.

## Division of labor

TypeSafe's guidance ([how to build](https://docs.typesafe.ai/concepts/how-to-build-with-system-one), [jaggedness](https://docs.typesafe.ai/model-jaggedness/jev-1.13)) is to keep control flow and arithmetic in code and give the model narrow semantic judgments; Jev is explicitly weak at numbers. The design follows that:

| Jev does | Code does |
|---|---|
| Read the request note and answer three typed questions | Turn answers into space and own-car rules |
| Read free-text incidents (event type, floor, car) | Compute arrival times, costs, and the car assignment |
| | Move the cars, apply physics, keep score |

A natural alternative is to let Jev pick car A/B/C/D directly. That was rejected, because it would ask Jev to compare distances and queues, which is exactly the numeric reasoning it's weakest at.

## The loop

```
free-text request ─► Jev (1 call, 3 questions) ─► rules in code ─► dispatcher (ETA + delay cost) ─► car
free-text incident ─► Jev (1 call, 3 questions) ─► fixed response per event type (Jev side only)
```

Jev is called once per request and once per incident, not every simulation tick.

### Request questions

| Question | Type | Options |
|---|---|---|
| `priority` | Choice | `stat`, `urgent`, `routine`, `visitor` |
| `load` | Choice | `bed`, `wheelchair`, `cart`, `walking` |
| `exclusive_car` | Noul | probability the trip needs an empty car |

Each option has a written definition in the question, and that is where the domain knowledge lives. All three questions go in a single request because Jev evaluates them in parallel.

### Rules (code)

- Space: bed 10, cart 5, wheelchair 3, walking 2 (car capacity 10).
- Own car: `stat`, `bed`, or `exclusive_car` > 0.5.
- Order: most urgent first.
- Cost: estimated arrival time + 6 s × priority weight (STAT 10, urgent 3, else 1) for each passenger already on the car.

### Event questions and responses

| Event type (Choice) | Jev-side response |
|---|---|
| `car_fault` + car | Car only takes routine traffic |
| `priority_transport` + floor | Hold the nearest empty car at that floor |
| `surge` + floor | Park up to two idle cars at that floor |
| `ignore` | Nothing |

The physical effect of an event (slow doors, extra arrivals) happens in both buildings, but only the Jev side reacts.

## Fairness of the comparison

- Both sides get identical arrivals from a seeded generator, identical physics, and identical events.
- Each request carries a hidden answer key used only for physics and scoring. Dispatchers never read it (this was audited, and one leak in boarding order was found and fixed).
- Both sides know a car's current load from a load-weighing sensor, as real elevators do.
- Policy was tuned while looking at seeds 1–8, and results are reported on seeds 101–116.

## Scope decisions

Cut to keep the MVP explainable:
- Infection control (sterile vs. soiled, isolation) and discretion (morgue transports) questions and rules.
- Confidence gating (escalating or flagging uncertain answers). Jev returns confidence, and using it is the first extension.
- An LLM comparison column. The speed argument rests on Jev's measured latency instead.

## Known limitations

- The request phrasings and question definitions share an author, so accuracy on real hospital language is untested.
- Simulated physics and traffic are assumptions.
- The baseline is a textbook ETA-style dispatcher, not a commercial controller.
- The live demo spends Jev credits for every visitor session (under $0.01 per 20 simulated minutes).

## Beyond elevators

The same structure (typed judgments from Jev → rules in code → a conventional optimizer) applies to other fleets where meaning changes the right decision: hospital porters, ambulances, warehouse robots, and job queues. Generalizing would mean making the questions, rules, and weights a per-domain configuration. Today they are written for the hospital case.
