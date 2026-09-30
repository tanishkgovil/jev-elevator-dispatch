"use client";

import { FLOORS, FLOOR_COUNT } from "@/lib/hospital";
import { CAR_COUNT, carName, type Column } from "@/lib/sim/engine";
import type { Priority } from "@/lib/jev/interpretRequest";
import type { Passenger } from "@/lib/sim/types";

export const PRIORITY_COLOR: Record<Priority, string> = {
  stat: "#ef4444",
  urgent: "#f59e0b",
  routine: "#38bdf8",
  visitor: "#a1a1aa",
};

const FLOOR_H = 26;
const LABEL_W = 118;
const QUEUE_W = 230;
const SHAFT_W = 40;
const SHAFT_GAP = 8;
const WIDTH = LABEL_W + QUEUE_W + CAR_COUNT * (SHAFT_W + SHAFT_GAP);
const HEIGHT = FLOOR_COUNT * FLOOR_H;
const MAX_DOTS = 8;

const yOf = (floor: number) => HEIGHT - (floor + 1) * FLOOR_H;

// Waiting passengers are colored by their true priority: this is the world as
// it is, which the baseline can't see and Jev has to infer.
export function Building({ column }: { column: Column }) {
  const waiting = new Map<number, Passenger[]>();
  for (const p of column.passengers.values()) {
    if (p.status !== "waiting" && p.status !== "interpreting") continue;
    const list = waiting.get(p.from) ?? [];
    list.push(p);
    waiting.set(p.from, list);
  }

  return (
    <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="w-full h-auto" role="img" aria-label="Elevator bank">
      {FLOORS.map((f) => (
        <g key={f.floor}>
          <rect x={0} y={yOf(f.floor)} width={WIDTH} height={FLOOR_H} fill={f.floor % 2 ? "#18181b" : "#1c1c20"} />
          <text x={6} y={yOf(f.floor) + FLOOR_H / 2 + 4} fontSize={11} fill="#a1a1aa">
            {f.short}
          </text>
        </g>
      ))}

      {[...waiting.entries()].map(([floor, ps]) => {
        const y = yOf(floor) + FLOOR_H / 2;
        const shown = ps
          .slice()
          .sort((a, b) => a.at - b.at)
          .slice(0, MAX_DOTS);
        return (
          <g key={floor}>
            {shown.map((p, i) => (
              <circle
                key={p.id}
                cx={LABEL_W + 6 + (i % 4) * 11}
                cy={y + (i < 4 ? -4 : 5)}
                r={3.5}
                fill={p.status === "interpreting" ? "none" : PRIORITY_COLOR[p.truth.priority]}
                stroke={PRIORITY_COLOR[p.truth.priority]}
                strokeWidth={1.5}
              >
                <title>{`${p.note} (waiting ${(column.now - p.at).toFixed(0)}s)`}</title>
              </circle>
            ))}
            {ps.length > MAX_DOTS && (
              <text x={LABEL_W + 50} y={y + 4} fontSize={10} fill="#e4e4e7">
                +{ps.length - MAX_DOTS}
              </text>
            )}
          </g>
        );
      })}

      {column.cars.map((car) => {
        const x = LABEL_W + QUEUE_W + car.id * (SHAFT_W + SHAFT_GAP);
        const riders = car.riders.map((id) => column.passengers.get(id)!);
        const top = riders.reduce<Priority | undefined>(
          (best, p) =>
            !best || ["stat", "urgent", "routine", "visitor"].indexOf(p.truth.priority) <
              ["stat", "urgent", "routine", "visitor"].indexOf(best)
              ? p.truth.priority
              : best,
          undefined,
        );
        const used = riders.reduce((s, p) => s + p.truth.units, 0);
        const y = HEIGHT - (car.pos + 1) * FLOOR_H + 3;
        return (
          <g key={car.id}>
            <rect x={x} y={0} width={SHAFT_W} height={HEIGHT} fill="#09090b" opacity={0.55} />
            {car.reservedFloor !== undefined && (
              <rect
                x={x + 1}
                y={yOf(car.reservedFloor) + 1}
                width={SHAFT_W - 2}
                height={FLOOR_H - 2}
                fill="none"
                stroke="#ef4444"
                strokeDasharray="3 3"
              />
            )}
            <rect
              x={x + 3}
              y={y}
              width={SHAFT_W - 6}
              height={FLOOR_H - 6}
              rx={4}
              fill={top ? PRIORITY_COLOR[top] : "#3f3f46"}
              opacity={car.doorTimer > 0 ? 0.65 : 1}
              stroke={car.faulty ? "#facc15" : car.exclusiveFor !== undefined ? "#fafafa" : "none"}
              strokeWidth={car.faulty || car.exclusiveFor !== undefined ? 2 : 0}
              strokeDasharray={car.faulty ? "4 2" : undefined}
            >
              <title>{`${carName(car.id)} · ${used}/10 load${car.faulty ? " · faulty doors" : ""}`}</title>
            </rect>
            <rect x={x + 5} y={y + FLOOR_H - 12} width={((SHAFT_W - 10) * Math.min(used, 10)) / 10} height={3} fill="#fafafa" opacity={0.8} />
            <text x={x + SHAFT_W / 2} y={y + 13} fontSize={10} fontWeight={700} textAnchor="middle" fill="#fafafa">
              {"ABCD"[car.id]}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
