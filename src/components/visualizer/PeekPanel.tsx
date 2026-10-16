/**
 * PeekPanel — details for one tool call, shown when a node (3D or list)
 * is selected. Displays ONLY data that arrived in the real events:
 * tool name, start/end time, duration, status, the agent's summary,
 * and evidence labels. Never API keys or reasoning traces.
 */

"use client";

import type { AgentResultView, ToolNodeView } from "./nodeState";

interface Props {
  /** The selected node, or null. */
  node: ToolNodeView | null;
  /** Collapsed older nodes, shown when the "+n earlier" cluster is open. */
  cluster: ToolNodeView[] | null;
  /** Task-level results, shown with an explicit non-attribution label. */
  results: AgentResultView[];
  onClose: () => void;
}

function formatTime(ms: number | null): string {
  if (ms === null) return "—";
  return new Date(ms).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatDuration(ms: number | null): string {
  if (ms === null) return "still running";
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

function StatusBadge({ status }: { status: ToolNodeView["status"] }) {
  const styles: Record<ToolNodeView["status"], string> = {
    active:
      "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200",
    success:
      "bg-teal-100 text-teal-900 dark:bg-teal-900/40 dark:text-teal-200",
    failed: "bg-red-100 text-red-900 dark:bg-red-900/40 dark:text-red-200",
  };
  const labels: Record<ToolNodeView["status"], string> = {
    active: "running",
    success: "succeeded",
    failed: "failed",
  };
  return (
    <span
      className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${styles[status]}`}
    >
      {labels[status]}
    </span>
  );
}

export function PeekPanel({ node, cluster, results, onClose }: Props) {
  return (
    <aside
      role="dialog"
      aria-label={node ? `Tool call details: ${node.tool}` : "Earlier tool calls"}
      className="flex max-h-72 flex-col gap-3 overflow-y-auto rounded-xl border border-zinc-200 bg-white p-4 text-sm shadow-sm dark:border-zinc-800 dark:bg-zinc-950"
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-semibold text-zinc-900 dark:text-zinc-100">
          {node ? node.tool : `Earlier tool calls (${cluster?.length ?? 0})`}
        </h3>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close details"
          className="rounded-md px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
        >
          ✕
        </button>
      </div>

      {node && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13px]">
          <dt className="text-zinc-500 dark:text-zinc-400">Status</dt>
          <dd>
            <StatusBadge status={node.status} />
          </dd>
          <dt className="text-zinc-500 dark:text-zinc-400">Label</dt>
          <dd className="text-zinc-800 dark:text-zinc-200">{node.label}</dd>
          <dt className="text-zinc-500 dark:text-zinc-400">Started</dt>
          <dd className="text-zinc-800 dark:text-zinc-200 tabular-nums">
            {formatTime(node.startedAt)}
          </dd>
          <dt className="text-zinc-500 dark:text-zinc-400">Ended</dt>
          <dd className="text-zinc-800 dark:text-zinc-200 tabular-nums">
            {formatTime(node.endedAt)}
          </dd>
          <dt className="text-zinc-500 dark:text-zinc-400">Duration</dt>
          <dd className="text-zinc-800 dark:text-zinc-200 tabular-nums">
            {formatDuration(node.durationMs)}
          </dd>
          <dt className="text-zinc-500 dark:text-zinc-400">Summary</dt>
          <dd className="text-zinc-800 dark:text-zinc-200">
            {node.summary ?? "No summary yet — the call is still running."}
          </dd>
        </dl>
      )}

      {cluster && (
        <ul className="flex flex-col gap-1.5">
          {cluster.map((n) => (
            <li
              key={n.id}
              className="rounded-lg border border-zinc-200 px-2.5 py-1.5 text-[13px] dark:border-zinc-800"
            >
              <span className="font-medium text-zinc-800 dark:text-zinc-200">
                {n.tool}
              </span>{" "}
              <span className="text-zinc-500 dark:text-zinc-400">
                — {n.status === "active" ? "running" : n.status},{" "}
                {formatDuration(n.durationMs)}
              </span>
              {n.summary && (
                <span className="block text-zinc-600 dark:text-zinc-400">
                  {n.summary}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {results.length > 0 && (
        <div className="border-t border-zinc-200 pt-2.5 dark:border-zinc-800">
          <p className="mb-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">
            Results reported by the agent
            <span className="font-normal">
              {" "}
              (task-level — not tied to one tool call)
            </span>
          </p>
          <ul className="flex flex-col gap-1.5">
            {results.map((r, i) => (
              <li key={i} className="text-[13px] text-zinc-700 dark:text-zinc-300">
                <span className="font-medium">{r.component}</span>
                {r.evidenceLabels.length > 0 && (
                  <span className="block text-zinc-500 dark:text-zinc-400">
                    Evidence: {r.evidenceLabels.join(", ")}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </aside>
  );
}
