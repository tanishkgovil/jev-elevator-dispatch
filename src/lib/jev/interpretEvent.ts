import { choice } from "@typesafe-ai/sdk";
import { FLOORS } from "../hospital";
import { jev } from "./client";

export type EventType = "surge" | "car_fault" | "priority_transport" | "ignore";
export const CAR_NAMES = ["A", "B", "C", "D"] as const;

export interface EventInterpretation {
  type: EventType;
  typeConfidence: number;
  floor: number | null;
  floorConfidence: number;
  car: number | null;
  carConfidence: number;
  latencyMs: number;
  inputTokens: number;
  model: string;
}

// Floor and car are closed sets, so they're Choices rather than extraction.
// Speculative: floor and car are asked even when the event type won't use them.
const floorCriteria = Object.fromEntries([
  ...FLOORS.map((f) => [`floor_${f.floor}`, f.label]),
  ["none", "No specific floor is mentioned or implied."],
]);

const carCriteria = Object.fromEntries([
  ...CAR_NAMES.map((name) => [`car_${name}`, `Elevator car ${name}`]),
  ["none", "No specific elevator car is mentioned."],
]);

const QUESTIONS = {
  type: choice(
    "What kind of operational event is described in `event`, from the point of view of the hospital's elevator dispatcher?",
    {
      surge:
        "Many people will soon need elevators from one place: shift change, visiting hours starting, a large group arriving, a class or meeting ending.",
      car_fault:
        "A specific elevator car is malfunctioning, slow, stuck, making noise, has a sticking door, or needs maintenance.",
      priority_transport:
        "A critical patient or emergency team will soon need an elevator urgently: incoming trauma, code blue, stroke alert, emergency surgery.",
      ignore: "Nothing that affects elevator dispatch.",
    },
  ),
  floor: choice("Which floor is the source of the event in `event`?", floorCriteria),
  car: choice("Which elevator car does `event` refer to?", carCriteria),
};

export async function interpretEvent(text: string): Promise<EventInterpretation> {
  const started = performance.now();
  const res = await jev().systemOne({ state: { event: text }, questions: QUESTIONS });
  const latencyMs = performance.now() - started;
  const a = res.answers;
  const floor = a.floor.choice === "none" ? null : Number(a.floor.choice.slice("floor_".length));
  const car =
    a.car.choice === "none"
      ? null
      : CAR_NAMES.indexOf(a.car.choice.slice("car_".length) as (typeof CAR_NAMES)[number]);
  return {
    type: a.type.choice as EventType,
    typeConfidence: a.type.confidence,
    floor,
    floorConfidence: a.floor.confidence,
    car,
    carConfidence: a.car.confidence,
    latencyMs,
    inputTokens: res.usage.input_tokens,
    model: res.model,
  };
}
