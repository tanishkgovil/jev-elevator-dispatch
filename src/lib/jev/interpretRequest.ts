import { choice, noul } from "@typesafe-ai/sdk";
import { floorLabel } from "../hospital";
import { jev } from "./client";

export type Priority = "stat" | "urgent" | "routine" | "visitor";
export type Load = "bed" | "wheelchair" | "cart" | "walking";
export type InfectionClass = "sterile" | "soiled" | "isolation" | "none";

export interface ElevatorRequest {
  from: number;
  to: number;
  note: string;
}

export interface RequestInterpretation {
  priority: Priority;
  priorityConfidence: number;
  priorityProbabilities: Record<Priority, number>;
  load: Load;
  loadConfidence: number;
  loadProbabilities: Record<Load, number>;
  infection: InfectionClass;
  infectionConfidence: number;
  infectionProbabilities: Record<InfectionClass, number>;
  exclusiveCar: number; // probability 0–1
  discretion: number; // probability 0–1
  latencyMs: number;
  inputTokens: number;
  model: string;
}

// All questions go in one call: they're evaluated in parallel, so the extra
// (sometimes irrelevant) questions cost tokens but barely any latency.
const QUESTIONS = {
  priority: choice(
    "How time-critical is the elevator trip described in `request`?",
    {
      stat: "A patient's life is at immediate risk and minutes matter: code blue or rapid response team, trauma, stroke, heart attack, emergency transfer to the OR, ICU, or cath lab.",
      urgent:
        "Clinically important and should move quickly, but not an emergency: patient transfers between units, time-sensitive lab specimens or medications (even when labeled \"stat\"), patients going to a scheduled procedure.",
      routine:
        "Normal hospital operations with no time pressure: staff moving between floors, restocking supplies, linen, meals, equipment, trash.",
      visitor:
        "Visitors, family members, or other members of the public moving around the hospital.",
    },
  ),
  load: choice("What will occupy the elevator on the trip described in `request`?", {
    bed: "A patient bed, stretcher, or gurney.",
    wheelchair: "A patient in a wheelchair.",
    cart: "A cart or large equipment: supply, linen, meal, waste, or medical equipment cart.",
    walking: "Only people on foot, with at most small hand-carried items.",
  }),
  infection: choice(
    "Which infection-control category applies to the trip described in `request`?",
    {
      sterile:
        "Clean or sterile items that must not be contaminated: sterile supplies, surgical instruments, clean linen, medications.",
      soiled:
        "Dirty or contaminated items: used linen, trash, biohazard waste, used instruments.",
      isolation:
        "A patient on isolation precautions (contact, droplet, or airborne), or with a contagious infection.",
      none: "No infection-control concern, including lab specimens in sealed containers.",
    },
  ),
  exclusive_car: noul(
    "The trip described in `request` needs an elevator car with no other passengers, because the load fills the car, the patient is critical or on isolation, or a team is responding to an emergency.",
  ),
  discretion: noul(
    "The trip described in `request` involves a deceased patient or something else that should be kept out of view of visitors.",
  ),
};

export async function interpretRequest(
  req: ElevatorRequest,
  options?: { signal?: AbortSignal },
): Promise<RequestInterpretation> {
  const started = performance.now();
  const res = await jev().systemOne(
    {
      state: {
        request: {
          note: req.note,
          from: floorLabel(req.from),
          to: floorLabel(req.to),
        },
      },
      questions: QUESTIONS,
    },
    { signal: options?.signal },
  );
  const latencyMs = performance.now() - started;
  const a = res.answers;
  return {
    priority: a.priority.choice,
    priorityConfidence: a.priority.confidence,
    priorityProbabilities: { ...a.priority.probabilities },
    load: a.load.choice,
    loadConfidence: a.load.confidence,
    loadProbabilities: { ...a.load.probabilities },
    infection: a.infection.choice,
    infectionConfidence: a.infection.confidence,
    infectionProbabilities: { ...a.infection.probabilities },
    exclusiveCar: a.exclusive_car.noul,
    discretion: a.discretion.noul,
    latencyMs,
    inputTokens: res.usage.input_tokens,
    model: res.model,
  };
}
