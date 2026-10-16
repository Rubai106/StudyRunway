/**
 * INTERNAL TEST/DEMO HARNESS — not part of the StudyRunway product.
 *
 * This route exists so the 3D tool visualizer workstream can verify its
 * behavior end-to-end: it mounts <ToolVisualizer/> and publishes REAL
 * events through publishAgentEvent (the same bus the chat workstream uses),
 * with real timing. Nothing here fabricates tool activity on the
 * visualizer's behalf — the harness plays the role of the agent
 * orchestrator.
 *
 * Do not link this route from the product UI.
 */

"use client";

import { useCallback, useRef, useState } from "react";
import { publishAgentEvent } from "@/lib/events";
import {
  ToolVisualizer,
  resetVisualizerStore,
} from "@/components/visualizer/ToolVisualizer";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A realistic demo task: 5 tool calls, one failing, with real timing. */
async function playDemoTask(signal: { cancelled: boolean }) {
  const t = async (ms: number) => {
    await sleep(ms);
    return !signal.cancelled;
  };
  publishAgentEvent({ type: "status", phase: "understanding your request" });
  if (!(await t(350))) return;
  publishAgentEvent({
    type: "tool_call_start",
    id: "demo-1",
    tool: "parse_intent",
    label: "Parsing your request",
  });
  if (!(await t(500))) return;
  publishAgentEvent({
    type: "tool_call_end",
    id: "demo-1",
    tool: "parse_intent",
    ok: true,
    summary: "Intent: check whether the November tuition payment is covered.",
    durationMs: 480,
  });
  publishAgentEvent({ type: "status", phase: "running the numbers" });
  publishAgentEvent({
    type: "tool_call_start",
    id: "demo-2",
    tool: "build_forecast",
    label: "Building your money timeline",
  });
  if (!(await t(700))) return;
  publishAgentEvent({
    type: "tool_call_end",
    id: "demo-2",
    tool: "build_forecast",
    ok: true,
    summary: "Forecast built for Sep 2026 – Aug 2027 across 4 accounts.",
    durationMs: 690,
  });
  publishAgentEvent({
    type: "tool_call_start",
    id: "demo-3",
    tool: "fetch_fx_rate",
    label: "Fetching GBP/BDT rate",
  });
  if (!(await t(600))) return;
  publishAgentEvent({
    type: "tool_call_end",
    id: "demo-3",
    tool: "fetch_fx_rate",
    ok: false,
    summary: "FX provider timed out after 3 attempts.",
    durationMs: 595,
  });
  publishAgentEvent({
    type: "tool_call_start",
    id: "demo-4",
    tool: "fetch_fx_rate_cached",
    label: "Using last known rate",
  });
  if (!(await t(450))) return;
  publishAgentEvent({
    type: "tool_call_end",
    id: "demo-4",
    tool: "fetch_fx_rate_cached",
    ok: true,
    summary: "Using cached GBP/BDT rate from 14 Oct (marked as estimate).",
    durationMs: 430,
  });
  publishAgentEvent({
    type: "tool_call_start",
    id: "demo-5",
    tool: "rank_transfer_quotes",
    label: "Comparing transfer options",
  });
  if (!(await t(650))) return;
  publishAgentEvent({
    type: "tool_call_end",
    id: "demo-5",
    tool: "rank_transfer_quotes",
    ok: true,
    summary: "Ranked 4 transfer quotes; cheapest saves £18.40.",
    durationMs: 640,
  });
  publishAgentEvent({
    type: "result",
    component: "RunwayVerdict",
    data: { evidenceRefs: ["tuition-invoice.pdf", "oct-statement.csv"] },
  });
  publishAgentEvent({ type: "status", phase: "done" });
}

export default function VisualizerDemoPage() {
  const [running, setRunning] = useState(false);
  const [chatText, setChatText] = useState("");
  const signal = useRef({ cancelled: false });

  const run = useCallback(async () => {
    resetVisualizerStore();
    signal.current = { cancelled: false };
    setRunning(true);
    await playDemoTask(signal.current);
    setRunning(false);
  }, []);

  const reset = useCallback(() => {
    signal.current.cancelled = true;
    resetVisualizerStore();
    setRunning(false);
  }, []);

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-10">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
          Internal test harness
        </p>
        <h1 className="text-xl font-semibold">Tool visualizer demo</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Plays a scripted task through the real agent event bus. Every node
          you see comes from an actual published event.
        </p>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={run}
          disabled={running}
          className="rounded-lg bg-zinc-900 px-4 py-2 text-sm text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
        >
          {running ? "Demo task running…" : "Run demo task"}
        </button>
        <button
          type="button"
          onClick={reset}
          className="rounded-lg border border-zinc-300 px-4 py-2 text-sm dark:border-zinc-700"
        >
          Reset
        </button>
      </div>

      <ToolVisualizer />

      {/* Stand-in for the chat input: proves the chat stays usable when
          the 3D view is off or WebGL fails. */}
      <div className="flex flex-col gap-1">
        <label htmlFor="demo-chat-input" className="text-sm font-medium">
          Demo chat input
        </label>
        <input
          id="demo-chat-input"
          value={chatText}
          onChange={(e) => setChatText(e.target.value)}
          placeholder="Type here — the chat must stay usable"
          className="rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
        />
      </div>
    </main>
  );
}
