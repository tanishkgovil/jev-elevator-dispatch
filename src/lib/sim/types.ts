import type { EventInterpretation } from "../jev/interpretEvent";
import type { InfectionClass, Priority, RequestInterpretation } from "../jev/interpretRequest";
import type { Truth } from "./corpus";

export type Mode = "baseline" | "jev" | "llm";

export const CAR_CAPACITY = 10;
export const CAR_SPEED = 0.5; // floors per sim second
export const DOOR_DWELL = 6; // sim seconds per stop
export const FAULT_DWELL = 20; // extra seconds per stop for a faulty car

// How much a second of waiting costs, by true priority. Scoring only.
export const PRIORITY_WEIGHT: Record<Priority, number> = {
  stat: 10,
  urgent: 3,
  routine: 1,
  visitor: 1,
};

export interface Arrival {
  id: number;
  at: number; // sim seconds
  from: number;
  to: number;
  note: string;
  truth: Truth;
}

// What a dispatcher believes about a request. The baseline believes nothing
// beyond origin and destination.
export interface Profile {
  priority: Priority;
  units: number;
  exclusive: boolean;
  infection: InfectionClass;
  flagged: boolean;
  tags: string[]; // human-readable, built from typed answers
}

export type PassengerStatus = "interpreting" | "waiting" | "riding" | "done";

export interface Passenger extends Arrival {
  status: PassengerStatus;
  profile?: Profile;
  interp?: RequestInterpretation;
  car?: number;
  pickedAt?: number;
  droppedAt?: number;
  wastedTrips: number;
  // After a car arrives too full, don't send that same car straight back.
  blockedCar?: number;
  blockedUntil?: number;
}

export interface Car {
  id: number;
  pos: number;
  dir: -1 | 0 | 1;
  doorTimer: number;
  riders: number[];
  assigned: number[];
  faulty: boolean; // physical: slow doors
  avoided: boolean; // policy: dispatcher knows it's faulty
  exclusiveFor?: number;
  reservedFloor?: number; // held empty for an incoming priority transport
  parkAt?: number;
}

export interface Decision {
  at: number;
  kind: "assign" | "bump" | "wasted" | "violation" | "event" | "flag";
  text: string;
  tags?: string[];
}

export interface WorldEvent {
  text: string;
  at: number;
  interp: EventInterpretation;
}
