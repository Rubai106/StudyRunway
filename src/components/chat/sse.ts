/**
 * SSE parsing helpers for the StudyRunway agent chat stream.
 *
 * The server emits one JSON object per `data:` line on an event stream.
 * These helpers are pure and DOM-free so they can be unit tested in node.
 */

import type { AgentStreamEvent } from "@/lib/events";

/** Parse a single SSE `data:` line into an event. Returns null for blanks/heartbeats. */
export function parseSSELine(line: string): AgentStreamEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  if (!trimmed.startsWith("data:")) return null;
  const payload = trimmed.slice("data:".length).trim();
  if (!payload || payload === "[DONE]") return null;
  const parsed = JSON.parse(payload) as AgentStreamEvent;
  return parsed;
}

/**
 * Incremental SSE parser: feed() accepts decoded text chunks and invokes
 * onEvent for every complete event parsed so far.
 */
export function createSSEParser(onEvent: (e: AgentStreamEvent) => void) {
  let buffer = "";
  return {
    feed(chunk: string): void {
      buffer += chunk;
      // Split on newlines; keep any trailing partial line in the buffer.
      const parts = buffer.split("\n");
      buffer = parts.pop() ?? "";
      for (const line of parts) {
        try {
          const event = parseSSELine(line);
          if (event) onEvent(event);
        } catch {
          // A malformed line must not kill the stream; keep reading.
        }
      }
    },
    flush(): void {
      if (buffer.trim()) {
        try {
          const event = parseSSELine(buffer);
          if (event) onEvent(event);
        } catch {
          // ignore trailing garbage
        }
      }
      buffer = "";
    },
  };
}
