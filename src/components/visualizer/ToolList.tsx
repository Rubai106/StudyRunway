/**
 * ToolList — the honest, always-accessible representation of the agent's
 * tool activity.
 *
 * Rendered visibly when: reduced motion is preferred, the user toggles
 * "3D off", or WebGL is unavailable/failed. Rendered sr-only alongside
 * the 3D canvas so screen readers always get the same real data.
 *
 * Every row is a button: activating it opens the peek panel with that
 * tool call's real data. No animation, no fabrication.
 */

"use client";

import type { ToolNodeView } from "./nodeState";

interface Props {
  nodes: ToolNodeView[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** When true, rendered for screen readers only. */
  srOnly?: boolean;
}

const STATUS_TEXT: Record<ToolNodeView["status"], string> = {
  active: "running",
  success: "succeeded",
  failed: "failed",
};

const STATUS_DOT: Record<ToolNodeView["status"], string> = {
  active: "bg-amber-500",
  success: "bg-teal-600",
  failed: "bg-red-600",
};

function formatDuration(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

export function ToolList({ nodes, selectedId, onSelect, srOnly }: Props) {
  return (
    <ul
      aria-label="Agent tool calls"
      className={
        srOnly
          ? "sr-only"
          : "flex max-h-64 flex-col gap-1.5 overflow-y-auto pr-1"
      }
    >
      {nodes.map((node, i) => {
        const selected = node.id === selectedId;
        return (
          <li key={node.id}>
            <button
              type="button"
              onClick={() => onSelect(node.id)}
              aria-current={selected ? "true" : undefined}
              className={`flex w-full items-center gap-2.5 rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                selected
                  ? "border-zinc-800 bg-zinc-900 text-zinc-50 dark:border-zinc-200 dark:bg-zinc-100 dark:text-zinc-900"
                  : "border-zinc-200 bg-white text-zinc-800 hover:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200"
              }`}
            >
              <span
                aria-hidden="true"
                className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[node.status]}`}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">
                  <span className="mr-2 text-xs text-zinc-500 dark:text-zinc-400">
                    {i + 1}
                  </span>
                  {node.tool}
                </span>
                <span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">
                  {STATUS_TEXT[node.status]}
                  {" · "}
                  {formatDuration(node.durationMs)}
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
