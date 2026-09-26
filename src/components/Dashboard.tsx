"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { EventInterpretation } from "@/lib/jev/interpretEvent";
import type { RequestInterpretation } from "@/lib/jev/interpretRequest";
import { Column, type Metrics } from "@/lib/sim/engine";
import type { Arrival, Decision } from "@/lib/sim/types";
import { World } from "@/lib/sim/world";
import { Building, PRIORITY_COLOR } from "./Building";

const STEP = 0.25; // sim seconds per engine step
const CLIENT_TIMEOUT_MS = 4000; // past this, dispatch without Jev's reading
const JEV_PRICE_PER_TOKEN = 0.042 / 1_000_000;
const PRESETS = [
  "Trauma incoming to the ED in 5 minutes",
  "Car C door keeps sticking",
  "Visiting hours just started",
  "Shift change on the maternity ward in 10 min",
];

async function interpretViaApi(a: Arrival): Promise<RequestInterpretation> {
  const res = await fetch("/api/interpret", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ from: a.from, to: a.to, note: a.note }),
    signal: AbortSignal.timeout(CLIENT_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`interpret ${res.status}`);
  return res.json();
}

function makeWorld() {
  return new World([new Column("baseline"), new Column("jev", interpretViaApi)], { seed: 4 });
}

const clock = (s: number) =>
  `${Math.floor(s / 60)
    .toString()
    .padStart(2, "0")}:${Math.floor(s % 60)
    .toString()
    .padStart(2, "0")}`;

export function Dashboard() {
  const worldRef = useRef<World | null>(null);
  const [, setFrame] = useState(0);
  const [running, setRunning] = useState(false);
  const [speed, setSpeed] = useState(10);
  const [events, setEvents] = useState<{ text: string; at: number; interp?: EventInterpretation; error?: string }[]>([]);

  worldRef.current ??= makeWorld();
  const world = worldRef.current;
  useEffect(() => {
    if (process.env.NODE_ENV === "development") (window as unknown as { __world?: World }).__world = world;
  }, [world]);

  useEffect(() => {
    if (!running) return;
    let raf = 0;
    let last = performance.now();
    let carry = 0;
    let lastPaint = 0;
    const loop = (t: number) => {
      // Cap catch-up after the tab stalls, so we never run minutes of sim in one frame.
      carry += (Math.min(t - last, 250) / 1000) * speed;
      last = t;
      while (carry >= STEP) {
        worldRef.current!.step(STEP);
        carry -= STEP;
      }
      if (t - lastPaint > 90) {
        lastPaint = t;
        setFrame((f) => f + 1);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [running, speed]);

  const reset = () => {
    worldRef.current = makeWorld();
    setEvents([]);
    setRunning(false);
    setFrame((f) => f + 1);
  };

  const sendEvent = useCallback(async (text: string) => {
    const w = worldRef.current!;
    const at = w.now;
    setEvents((es) => [{ text, at }, ...es]);
    try {
      const res = await fetch("/api/event", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) throw new Error(`event ${res.status}`);
      const interp: EventInterpretation = await res.json();
      if (worldRef.current !== w) return; // reset while in flight
      w.applyEvent(interp);
      for (const c of w.columns) c.applyPolicy(interp, text);
      setEvents((es) => es.map((e) => (e.text === text && e.at === at ? { ...e, interp } : e)));
    } catch (err) {
      setEvents((es) => es.map((e) => (e.text === text && e.at === at ? { ...e, error: String(err) } : e)));
    }
  }, []);

  const [baseline, jev] = world.columns;
  const mb = baseline.metrics();
  const mj = jev.metrics();

  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 py-5 flex flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Switchboard</h1>
          <p className="text-sm text-zinc-400">
            Hospital elevator dispatch · same building, same traffic · the only difference is who understands the requests
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-lg tabular-nums text-zinc-300 mr-2">{clock(world.now)}</span>
          <button
            onClick={() => setRunning((r) => !r)}
            className="rounded-md bg-emerald-600 hover:bg-emerald-500 px-4 py-1.5 text-sm font-medium"
          >
            {running ? "Pause" : world.now > 0 ? "Resume" : "Start"}
          </button>
          <button onClick={reset} className="rounded-md bg-zinc-800 hover:bg-zinc-700 px-3 py-1.5 text-sm">
            Reset
          </button>
          <select
            value={speed}
            onChange={(e) => setSpeed(Number(e.target.value))}
            className="rounded-md bg-zinc-800 px-2 py-1.5 text-sm"
            aria-label="Simulation speed"
          >
            {[5, 10, 20].map((s) => (
              <option key={s} value={s}>
                {s}× speed
              </option>
            ))}
          </select>
        </div>
      </header>

      <ChaosBox onSend={sendEvent} events={events} />

      <Scoreboard baseline={mb} jev={mj} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Panel
          title="Baseline dispatcher"
          subtitle="Conventional optimizer: ETA + stops. Sees floors, not meaning."
          column={baseline}
          metrics={mb}
        />
        <Panel
          title="Jev dispatcher"
          subtitle="Same optimizer + Jev reading every request and event."
          column={jev}
          metrics={mj}
          accent
        />
      </div>

      <Legend />
    </div>
  );
}

function ChaosBox({
  onSend,
  events,
}: {
  onSend: (text: string) => void;
  events: { text: string; at: number; interp?: EventInterpretation; error?: string }[];
}) {
  const [text, setText] = useState("");
  const submit = () => {
    const t = text.trim();
    if (!t) return;
    onSend(t);
    setText("");
  };
  const last = events[0];
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3 flex flex-col gap-2">
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="Tell the building what's happening… e.g. “code stroke on 6”"
          className="flex-1 rounded-md bg-zinc-950 border border-zinc-700 px-3 py-2 text-sm outline-none focus:border-emerald-500"
        />
        <button onClick={submit} className="rounded-md bg-zinc-100 text-zinc-900 px-4 py-2 text-sm font-medium">
          Send event
        </button>
      </div>
      <div className="flex flex-wrap gap-2">
        {PRESETS.map((p) => (
          <button
            key={p}
            onClick={() => onSend(p)}
            className="rounded-full border border-zinc-700 px-3 py-1 text-xs text-zinc-300 hover:bg-zinc-800"
          >
            {p}
          </button>
        ))}
      </div>
      {last && (
        <div className="text-xs text-zinc-400 font-mono">
          [{clock(last.at)}] “{last.text}” →{" "}
          {last.error ? (
            <span className="text-red-400">interpreter error</span>
          ) : last.interp ? (
            <span className="text-emerald-300">
              {last.interp.type} ({last.interp.typeConfidence.toFixed(2)})
              {last.interp.floor !== null && ` · floor ${last.interp.floor}`}
              {last.interp.car !== null && ` · car ${"ABCD"[last.interp.car]}`} · Jev {last.interp.latencyMs.toFixed(0)}ms
            </span>
          ) : (
            <span>interpreting…</span>
          )}
        </div>
      )}
    </section>
  );
}

const ROWS: { key: keyof Metrics; label: string; unit: string; lowerIsBetter: boolean; headline?: boolean }[] = [
  { key: "priorityWeightedWait", label: "Priority-weighted wait", unit: "s", lowerIsBetter: true, headline: true },
  { key: "statWait", label: "STAT wait", unit: "s", lowerIsBetter: true },
  { key: "bedWait", label: "Bed transport wait", unit: "s", lowerIsBetter: true },
  { key: "maxWait", label: "Worst wait", unit: "s", lowerIsBetter: true },
  { key: "avgWait", label: "Average wait", unit: "s", lowerIsBetter: true },
  { key: "wastedTrips", label: "Wasted trips", unit: "", lowerIsBetter: true },
  { key: "violations", label: "Infection / discretion breaches", unit: "", lowerIsBetter: true },
];

function Scoreboard({ baseline, jev }: { baseline: Metrics; jev: Metrics }) {
  return (
    <section className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
      {ROWS.map((r) => {
        const b = baseline[r.key];
        const j = jev[r.key];
        const delta = b > 0 ? ((j - b) / b) * 100 : 0;
        const better = r.lowerIsBetter ? j < b : j > b;
        const same = Math.abs(j - b) < 1e-9;
        return (
          <div
            key={r.key}
            className={`rounded-xl border p-3 ${r.headline ? "border-emerald-700 bg-emerald-950/40" : "border-zinc-800 bg-zinc-900/60"}`}
          >
            <div className="text-[11px] uppercase tracking-wide text-zinc-400">{r.label}</div>
            <div className="mt-1 flex items-baseline gap-2 font-mono tabular-nums">
              <span className="text-xl text-zinc-100">
                {fmt(j)}
                {r.unit}
              </span>
              <span className="text-xs text-zinc-500">
                vs {fmt(b)}
                {r.unit}
              </span>
            </div>
            <div className={`text-xs font-mono ${same ? "text-zinc-500" : better ? "text-emerald-400" : "text-red-400"}`}>
              {same || b === 0 ? "—" : `${delta > 0 ? "+" : ""}${delta.toFixed(0)}%`} Jev vs baseline
            </div>
          </div>
        );
      })}
    </section>
  );
}

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

function Panel({
  title,
  subtitle,
  column,
  metrics,
  accent,
}: {
  title: string;
  subtitle: string;
  column: Column;
  metrics: Metrics;
  accent?: boolean;
}) {
  return (
    <section
      className={`rounded-xl border p-3 flex flex-col gap-3 ${accent ? "border-emerald-800 bg-emerald-950/20" : "border-zinc-800 bg-zinc-900/40"}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="font-semibold">{title}</h2>
          <p className="text-xs text-zinc-400">{subtitle}</p>
        </div>
        <div className="text-right text-xs font-mono text-zinc-400 tabular-nums">
          <div>
            {metrics.delivered}/{metrics.requests} delivered
          </div>
          {column.mode !== "baseline" && (
            <div>
              Jev p50 {metrics.latencyP50.toFixed(0)}ms · p95 {metrics.latencyP95.toFixed(0)}ms · $
              {(metrics.inputTokens * JEV_PRICE_PER_TOKEN).toFixed(4)}
              {metrics.flagged > 0 && <span className="text-amber-400"> · ⚑ {metrics.flagged} flagged</span>}
            </div>
          )}
        </div>
      </div>
      <Building column={column} />
      <DecisionLog log={column.log} />
    </section>
  );
}

const KIND_STYLE: Record<Decision["kind"], string> = {
  assign: "text-zinc-300",
  bump: "text-amber-300",
  wasted: "text-red-400",
  violation: "text-red-400",
  event: "text-emerald-300",
  flag: "text-amber-300",
};

function DecisionLog({ log }: { log: Decision[] }) {
  return (
    <ol className="h-56 overflow-y-auto rounded-lg bg-zinc-950/70 p-2 text-xs font-mono flex flex-col gap-1">
      {log.length === 0 && <li className="text-zinc-500">Decisions appear here.</li>}
      {log.slice(0, 40).map((d, i) => (
        <li key={`${d.at}-${i}`} className={KIND_STYLE[d.kind]}>
          <span className="text-zinc-500">{clock(d.at)} </span>
          {d.kind === "wasted" && "✗ "}
          {d.kind === "violation" && "⚠ "}
          {d.text}
          {d.tags && d.tags.length > 0 && (
            <span className="ml-1">
              {d.tags.map((t) => (
                <span key={t} className="ml-1 rounded bg-zinc-800 px-1 py-px text-[10px] text-zinc-300">
                  {t}
                </span>
              ))}
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}

function Legend() {
  return (
    <footer className="flex flex-wrap gap-4 text-xs text-zinc-400">
      {(Object.keys(PRIORITY_COLOR) as (keyof typeof PRIORITY_COLOR)[]).map((k) => (
        <span key={k} className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: PRIORITY_COLOR[k] }} />
          {k}
        </span>
      ))}
      <span>○ being interpreted</span>
      <span>white outline: exclusive car</span>
      <span className="text-yellow-400">dashed yellow: faulty doors</span>
      <span className="text-red-400">dashed red: car held for emergency</span>
    </footer>
  );
}
