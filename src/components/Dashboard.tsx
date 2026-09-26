"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { EventInterpretation } from "@/lib/jev/interpretEvent";
import type { RequestInterpretation } from "@/lib/jev/interpretRequest";
import { Column, type Metrics } from "@/lib/sim/engine";
import type { Arrival, Decision } from "@/lib/sim/types";
import { World } from "@/lib/sim/world";
import { Building, PRIORITY_COLOR } from "./Building";

const STEP = 0.25; // sim seconds per engine step
const MIN_REQUESTS = 60; // below this, the comparison is noise
const CLIENT_TIMEOUT_MS = 4000; // past this, dispatch without Jev's reading
const PRESETS = ["Trauma incoming to the ED in 5 minutes", "Car C door keeps sticking", "Visiting hours just started"];

const EVENT_LABEL: Record<EventInterpretation["type"], string> = {
  surge: "Crowd coming",
  car_fault: "Faulty elevator",
  priority_transport: "Emergency incoming",
  ignore: "Not relevant to elevators",
};

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

type EventLogEntry = { text: string; at: number; interp?: EventInterpretation; error?: boolean };

export function Dashboard() {
  // The world is mutable and mutated by the loop; `frame` re-renders to show it.
  const [world, setWorld] = useState(makeWorld);
  const worldRef = useRef(world);
  const [, setFrame] = useState(0);
  const [running, setRunning] = useState(false);
  const [speed, setSpeed] = useState(10);
  const [lastEvent, setLastEvent] = useState<EventLogEntry | null>(null);

  useEffect(() => {
    worldRef.current = world;
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
        world.step(STEP);
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
  }, [running, speed, world]);

  const reset = () => {
    setWorld(makeWorld());
    setLastEvent(null);
    setRunning(false);
  };

  const sendEvent = useCallback(async (text: string) => {
    const w = worldRef.current;
    const entry: EventLogEntry = { text, at: w.now };
    setLastEvent(entry);
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
      setLastEvent((e) => (e === entry ? { ...entry, interp } : e));
    } catch {
      setLastEvent((e) => (e === entry ? { ...entry, error: true } : e));
    }
  }, []);

  const [baseline, jev] = world.columns;
  const mb = baseline.metrics();
  const mj = jev.metrics();

  return (
    <div className="mx-auto w-full max-w-[1280px] px-4 py-5 flex flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Hospital elevators, with and without Jev</h1>
          <p className="text-sm text-zinc-400">
            Same hospital, same requests, same dispatch algorithm. On the right, Jev reads each request first.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-lg tabular-nums text-zinc-300 mr-1" title="Simulated time">
            {clock(world.now)}
          </span>
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

      <Scoreboard baseline={mb} jev={mj} />

      <EventBox onSend={sendEvent} last={lastEvent} />

      <Legend />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 flex flex-col gap-3">
          <PanelHeader title="Without Jev" subtitle="Only knows which floor to go to" />
          <Building column={baseline} />
          <Feed
            title="Problems"
            empty="None yet"
            items={baseline.log.filter((d) => d.kind === "wasted").slice(0, 5)}
            render={(d) => (
              <span className="text-red-300">
                ✗ {d.text.replace(/ arrived too full: "(.*)" left behind/, " arrived too full — \"$1\" left behind")}
              </span>
            )}
          />
        </section>

        <section className="rounded-xl border border-emerald-800 bg-emerald-950/20 p-4 flex flex-col gap-3">
          <PanelHeader
            title="With Jev"
            subtitle={
              mj.latencyP50 > 0
                ? `Jev reads every request · ~${mj.latencyP50.toFixed(0)} ms each`
                : "Jev reads every request"
            }
          />
          <Building column={jev} />
          <Feed
            title="What Jev read"
            empty="Press Start"
            items={jev.log.filter((d) => d.kind === "assign").slice(0, 5)}
            render={(d) => <JevRead d={d} />}
          />
        </section>
      </div>
    </div>
  );
}

function PanelHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div>
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="text-sm text-zinc-400">{subtitle}</p>
    </div>
  );
}

const CARDS: { key: keyof Metrics; label: string; unit: string }[] = [
  { key: "statWait", label: "Emergency patients wait", unit: "s" },
  { key: "bedWait", label: "Patient beds wait", unit: "s" },
  { key: "avgWait", label: "Everyone waits (avg)", unit: "s" },
  { key: "wastedTrips", label: "Trips where the bed didn't fit", unit: "" },
];

function Scoreboard({ baseline, jev }: { baseline: Metrics; jev: Metrics }) {
  const settled = jev.requests >= MIN_REQUESTS;
  return (
    <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {CARDS.map((c) => {
        const b = baseline[c.key];
        const j = jev[c.key];
        const change = b > 0 ? Math.round(((b - j) / b) * 100) : null;
        return (
          <div key={c.key} className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
            <div className="text-sm text-zinc-300">{c.label}</div>
            <div className="mt-2 grid grid-cols-2 gap-2 font-mono tabular-nums">
              <div>
                <div className="text-[11px] text-zinc-500">Without Jev</div>
                <div className="text-xl text-zinc-300">
                  {Math.round(b)}
                  {c.unit}
                </div>
              </div>
              <div>
                <div className="text-[11px] text-emerald-400">With Jev</div>
                <div className="text-xl text-zinc-50">
                  {Math.round(j)}
                  {c.unit}
                </div>
              </div>
            </div>
            {settled ? (
              <div
                className={`mt-1 text-xs ${change === null ? "text-zinc-500" : change >= 0 ? "text-emerald-400" : "text-red-400"}`}
              >
                {change === null ? "—" : change >= 0 ? `${change}% less with Jev` : `${-change}% more with Jev`}
              </div>
            ) : (
              <div className="mt-1 text-xs text-zinc-500">
                Gathering data… {jev.requests}/{MIN_REQUESTS} requests
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}

function EventBox({ onSend, last }: { onSend: (text: string) => void; last: EventLogEntry | null }) {
  const [text, setText] = useState("");
  const submit = () => {
    const t = text.trim();
    if (!t) return;
    onSend(t);
    setText("");
  };
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3 flex flex-col gap-2">
      <div className="text-sm text-zinc-300">Tell the hospital what&apos;s happening — Jev interprets it</div>
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="e.g. “code stroke on 6”"
          className="flex-1 rounded-md bg-zinc-950 border border-zinc-700 px-3 py-2 text-sm outline-none focus:border-emerald-500"
        />
        <button onClick={submit} className="rounded-md bg-zinc-100 text-zinc-900 px-4 py-2 text-sm font-medium">
          Send
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {PRESETS.map((p) => (
          <button
            key={p}
            onClick={() => onSend(p)}
            className="rounded-full border border-zinc-700 px-3 py-1 text-xs text-zinc-300 hover:bg-zinc-800"
          >
            {p}
          </button>
        ))}
        {last && (
          <span className="ml-auto text-sm">
            <span className="text-zinc-400">“{last.text}” → </span>
            {last.error ? (
              <span className="text-red-400">Jev unavailable</span>
            ) : last.interp ? (
              <span className="text-emerald-300">
                {EVENT_LABEL[last.interp.type]}
                {last.interp.car !== null && ` · Car ${"ABCD"[last.interp.car]}`}
                {last.interp.floor !== null && last.interp.car === null && ` · floor ${last.interp.floor}`}
                <span className="text-zinc-500"> · {last.interp.latencyMs.toFixed(0)} ms</span>
              </span>
            ) : (
              <span className="text-zinc-500">Jev is reading…</span>
            )}
          </span>
        )}
      </div>
    </section>
  );
}

function Feed({
  title,
  empty,
  items,
  render,
}: {
  title: string;
  empty: string;
  items: Decision[];
  render: (d: Decision) => React.ReactNode;
}) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-zinc-500 mb-1">{title}</div>
      <ol className="h-36 overflow-hidden flex flex-col gap-1.5 text-sm">
        {items.length === 0 && <li className="text-zinc-500">{empty}</li>}
        {items.map((d, i) => (
          <li key={`${d.at}-${i}`} className="truncate">
            {render(d)}
          </li>
        ))}
      </ol>
    </div>
  );
}

// Decision text is `Car X → floor N for "note"`; show it as note → Jev's reading → car.
function JevRead({ d }: { d: Decision }) {
  const m = d.text.match(/^(Car [A-D]) → floor \d+ for "(.*)"$/);
  if (!m) return <span className="text-zinc-300">{d.text}</span>;
  const [, car, note] = m;
  return (
    <span className="flex items-center gap-2 min-w-0">
      <span className="truncate text-zinc-200">“{note}”</span>
      <span className="shrink-0 flex gap-1">
        {d.tags?.map((t) => (
          <span
            key={t}
            className={`rounded px-1.5 py-0.5 text-[11px] ${
              t === "STAT" ? "bg-red-500/20 text-red-300" : t === "own car" ? "bg-zinc-100/10 text-zinc-100" : "bg-zinc-800 text-zinc-300"
            }`}
          >
            {t}
          </span>
        ))}
      </span>
      <span className="shrink-0 text-zinc-400">→ {car}</span>
      {d.latencyMs !== undefined && <span className="shrink-0 text-zinc-600 text-xs">{d.latencyMs.toFixed(0)} ms</span>}
    </span>
  );
}

function Legend() {
  const labels: Record<keyof typeof PRIORITY_COLOR, string> = {
    stat: "Emergency",
    urgent: "Urgent",
    routine: "Staff / supplies",
    visitor: "Visitor",
  };
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 px-4 py-3 flex flex-wrap items-center gap-x-6 gap-y-3 text-sm text-zinc-300">
      <div className="flex items-center gap-3">
        <span className="text-zinc-500">Person waiting:</span>
        {(Object.keys(PRIORITY_COLOR) as (keyof typeof PRIORITY_COLOR)[]).map((k) => (
          <span key={k} className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded-full" style={{ background: PRIORITY_COLOR[k] }} />
            {labels[k]}
          </span>
        ))}
      </div>
      <div className="flex items-center gap-4">
        <span className="text-zinc-500">Elevator:</span>
        <CarIcon fill={PRIORITY_COLOR.stat} label="Carrying an emergency" />
        <CarIcon fill="#3f3f46" outline="#fafafa" label="Reserved for one patient" />
        <CarIcon fill="#3f3f46" outline="#facc15" dashed label="Faulty doors" />
      </div>
      <span className="text-xs text-zinc-500 basis-full">
        Only you can see the colors. The left side treats every dot the same; the right side learns them from Jev.
      </span>
    </section>
  );
}

function CarIcon({ fill, outline, dashed, label }: { fill: string; outline?: string; dashed?: boolean; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <svg width="22" height="16" viewBox="0 0 22 16" aria-hidden>
        <rect
          x="1"
          y="1"
          width="20"
          height="14"
          rx="3"
          fill={fill}
          stroke={outline ?? "none"}
          strokeWidth={outline ? 2 : 0}
          strokeDasharray={dashed ? "3 2" : undefined}
        />
      </svg>
      {label}
    </span>
  );
}
