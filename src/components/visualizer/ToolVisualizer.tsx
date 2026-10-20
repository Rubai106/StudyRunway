/**
 * ToolVisualizer — the exported 3D tool-activity panel.
 *
 * The chat workstream mounts this beside the conversation. It subscribes
 * to the agent event bus and renders ONLY real orchestration events:
 * every node comes from an actual `tool_call_start`, every status from an
 * actual `tool_call_end`, the phase from actual `status` events.
 *
 * Robustness guarantees:
 * - three.js is lazy-loaded (ssr: false); a WebGL failure degrades to an
 *   accessible list and can NEVER break the chat.
 * - prefers-reduced-motion → static list, no animation.
 * - "3D off" toggle → list view, without touching the agent.
 * - frameloop="demand" → no always-running render loop; the scene is
 *   essentially still when idle.
 * - The list view doubles as the screen-reader representation of the 3D
 *   scene (rendered sr-only while 3D is active).
 */

"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CLUSTER_ID, layoutNodes } from "./nodeState";
import { resetVisualizerStore, useVisualizerState } from "./store";
import { getUserStorageKey } from "@/lib/userStorage";
import { ToolList } from "./ToolList";
import { PeekPanel } from "./PeekPanel";
import { VisualizerErrorBoundary } from "./VisualizerErrorBoundary";

// Lazy: three.js is only downloaded when the visualizer actually mounts,
// and never on the server. A failure here must not touch the chat.
const LazyToolCanvas = dynamic(() => import("./ToolCanvas"), {
  ssr: false,
  loading: () => (
    <div
      aria-hidden="true"
      className="h-56 w-full animate-pulse rounded-xl border border-zinc-200 bg-stone-100 dark:border-zinc-800 dark:bg-zinc-900"
    />
  ),
});

const MODE_KEY = "sr-viz-3d";

function detectReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) {
    return false;
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function detectWebGL(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  try {
    const canvas = document.createElement("canvas");
    return (
      canvas.getContext("webgl2") !== null ||
      canvas.getContext("webgl") !== null
    );
  } catch {
    return false;
  }
}

export function ToolVisualizer({ className }: { className?: string }) {
  const state = useVisualizerState();
  const [threeEnabled, setThreeEnabled] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    try {
      return window.localStorage.getItem(getUserStorageKey(MODE_KEY)) !== "off";
    } catch {
      return true;
    }
  });
  const [webglOK] = useState<boolean>(detectWebGL);
  const [canvasFailed, setCanvasFailed] = useState(false);
  const [reducedMotion, setReducedMotion] = useState<boolean>(detectReducedMotion);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReducedMotion(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const toggle3D = useCallback(() => {
    setThreeEnabled((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(getUserStorageKey(MODE_KEY), next ? "on" : "off");
      } catch {
        // ignore storage failures
      }
      return next;
    });
  }, []);

  const { shown, collapsedCount, collapsed } = useMemo(
    () => layoutNodes(state),
    [state],
  );

  // Clear a selection whose node no longer exists (e.g. after a demo reset).
  useEffect(() => {
    if (
      selectedId &&
      selectedId !== CLUSTER_ID &&
      !state.nodes.some((n) => n.id === selectedId)
    ) {
      setSelectedId(null);
    }
  }, [selectedId, state.nodes]);

  const use3D =
    threeEnabled && webglOK && !canvasFailed && !reducedMotion;

  const selectedNode =
    selectedId && selectedId !== CLUSTER_ID
      ? (state.nodes.find((n) => n.id === selectedId) ?? null)
      : null;

  return (
    <section
      aria-label="Agent tool activity"
      className={`flex flex-col gap-3 ${className ?? ""}`}
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          Tool activity
        </h2>
        <div className="flex items-center gap-2">
          {state.phase && (
            <span
              aria-live="polite"
              className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
            >
              {state.awaitingClarification
                ? "Waiting for your answer"
                : state.phase}
            </span>
          )}
          <button
            type="button"
            onClick={toggle3D}
            aria-pressed={use3D}
            title={
              use3D
                ? "Switch to the accessible list view"
                : "Switch to the 3D view"
            }
            className="rounded-lg border border-zinc-200 px-2.5 py-1 text-xs text-zinc-600 hover:border-zinc-400 hover:text-zinc-900 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-zinc-500 dark:hover:text-zinc-100"
          >
            {use3D ? "3D on" : "3D off"}
          </button>
        </div>
      </div>

      {state.errorMessage && (
        <p
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200"
        >
          The agent reported an error: {state.errorMessage}
          {state.errorRecoverable ? " (it may recover)" : ""}
        </p>
      )}

      {!state.hasTask ? (
        <p className="rounded-xl border border-dashed border-zinc-300 px-4 py-8 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
          No active task — start a conversation.
          <span className="mt-1 block text-xs">
            Tool calls the agent actually makes will appear here; nothing is
            simulated.
          </span>
        </p>
      ) : use3D ? (
        <>
          <VisualizerErrorBoundary onError={() => setCanvasFailed(true)}>
            <LazyToolCanvas
              nodes={shown}
              collapsedCount={collapsedCount}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
          </VisualizerErrorBoundary>
          {/* Screen-reader representation of the same real data. */}
          <ToolList
            nodes={state.nodes}
            selectedId={selectedId}
            onSelect={setSelectedId}
            srOnly
          />
        </>
      ) : (
        <ToolList
          nodes={state.nodes}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
      )}

      {(selectedNode || selectedId === CLUSTER_ID) && state.hasTask && (
        <PeekPanel
          node={selectedNode}
          cluster={selectedId === CLUSTER_ID ? collapsed : null}
          results={state.results}
          onClose={() => setSelectedId(null)}
        />
      )}
    </section>
  );
}

// Re-exported for demo/test harnesses. Not an agent event.
export { resetVisualizerStore };
