import type { Load, Priority, RequestInterpretation } from "../jev/interpretRequest";
import type { Profile } from "./types";

// Code owns policy: Jev supplies typed judgments, these rules turn them into
// dispatch constraints.
const YES = 0.5;

const LOAD_UNITS: Record<Load, number> = { bed: 10, cart: 5, wheelchair: 3, walking: 2 };
export const PRIORITY_LABEL: Record<Priority, string> = {
  stat: "STAT",
  urgent: "Urgent",
  routine: "Routine",
  visitor: "Visitor",
};

// What the baseline assumes about every request: a normal passenger.
export const BASELINE_PROFILE: Profile = {
  priority: "routine",
  units: 1,
  exclusive: false,
  tags: [],
};

export function profileFrom(i: RequestInterpretation): Profile {
  const exclusive = i.priority === "stat" || i.load === "bed" || i.exclusiveCar > YES;
  const tags = [PRIORITY_LABEL[i.priority], i.load];
  if (exclusive) tags.push("own car");
  return { priority: i.priority, units: LOAD_UNITS[i.load], exclusive, tags };
}
