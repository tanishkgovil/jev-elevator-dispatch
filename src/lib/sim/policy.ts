import type { InfectionClass, Load, Priority, RequestInterpretation } from "../jev/interpretRequest";
import type { Profile } from "./types";

// Code owns policy: Jev supplies typed judgments, these rules turn them into
// dispatch constraints. Thresholds are ours to tune, not the model's.
const CONFIDENCE_FLOOR = 0.6;
const YES = 0.5;

const LOAD_UNITS: Record<Load, number> = { bed: 10, cart: 5, wheelchair: 3, walking: 2 };
const ESCALATE: Record<Priority, Priority> = {
  visitor: "routine",
  routine: "urgent",
  urgent: "stat",
  stat: "stat",
};
const PRIORITY_LABEL: Record<Priority, string> = {
  stat: "STAT",
  urgent: "Urgent",
  routine: "Routine",
  visitor: "Visitor",
};

export const BASELINE_PROFILE: Profile = {
  priority: "routine",
  units: 1,
  exclusive: false,
  infection: "none",
  flagged: false,
  tags: [],
};

export function profileFrom(i: RequestInterpretation): Profile {
  const tags: string[] = [];
  let flagged = false;

  // Unsure about priority → act as if it's the more urgent option and flag it.
  let priority = i.priority;
  if (i.priorityConfidence < CONFIDENCE_FLOOR) {
    priority = ESCALATE[i.priority];
    flagged = true;
    tags.push(`⚑ ${PRIORITY_LABEL[i.priority]}? (${i.priorityConfidence.toFixed(2)}) → ${PRIORITY_LABEL[priority]}`);
  } else {
    tags.push(`${PRIORITY_LABEL[priority]} (${i.priorityConfidence.toFixed(2)})`);
  }

  // Unsure about load → reserve space for the bulkier of the top two.
  let units = LOAD_UNITS[i.load];
  if (i.loadConfidence < CONFIDENCE_FLOOR) {
    const [first, second] = (Object.entries(i.loadProbabilities) as [Load, number][])
      .sort((a, b) => b[1] - a[1])
      .map(([load]) => load);
    units = Math.max(LOAD_UNITS[first], LOAD_UNITS[second ?? first]);
  }
  tags.push(`${i.load} (${i.loadConfidence.toFixed(2)})`);

  // Isolation is the costly miss, so a meaningful isolation probability wins.
  let infection: InfectionClass = i.infection;
  if (i.infectionProbabilities.isolation > 0.3) infection = "isolation";
  if (infection !== "none") tags.push(infection);

  const discreet = i.discretion > YES;
  if (discreet) tags.push("discretion");

  // A whole car (and bumping others) is reserved for a confident STAT; a
  // request only escalated to STAT jumps the queue but shares the car.
  const exclusive =
    (priority === "stat" && !flagged) ||
    i.load === "bed" ||
    infection === "isolation" ||
    discreet ||
    i.exclusiveCar > YES;
  if (exclusive) tags.push("exclusive car");

  return { priority, units, exclusive, infection, flagged, tags };
}
