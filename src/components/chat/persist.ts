/**
 * localStorage persistence for chat transcripts.
 * Keys are namespaced so "Delete my data" can wipe everything this app owns.
 */

import type { ClarifyQuestion } from "@/lib/events";

export const STORAGE_PREFIX = "studyrunway.";
export const LAST_SESSION_KEY = `${STORAGE_PREFIX}last-session`;

export interface StoredResult {
  component: string;
  data: Record<string, unknown>;
}

export interface StoredMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  label?: string;
  results: StoredResult[];
  pendingClarifications: ClarifyQuestion[];
  answeredQuestionIds: string[];
  errorMessage?: string;
}

function isLocalStorageAvailable(): boolean {
  try {
    return typeof window !== "undefined" && !!window.localStorage;
  } catch {
    return false;
  }
}

export function transcriptKey(sessionId: string): string {
  return `${STORAGE_PREFIX}chat.${sessionId}`;
}

export function saveTranscript(
  sessionId: string,
  messages: StoredMessage[],
): void {
  if (!isLocalStorageAvailable()) return;
  try {
    window.localStorage.setItem(
      transcriptKey(sessionId),
      JSON.stringify({ sessionId, savedAt: Date.now(), messages }),
    );
    window.localStorage.setItem(LAST_SESSION_KEY, sessionId);
  } catch {
    // Storage full or blocked — the conversation still works in memory.
  }
}

export function loadTranscript(sessionId: string): StoredMessage[] | null {
  if (!isLocalStorageAvailable()) return null;
  try {
    const raw = window.localStorage.getItem(transcriptKey(sessionId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      messages?: StoredMessage[];
    };
    return Array.isArray(parsed.messages) ? parsed.messages : null;
  } catch {
    return null;
  }
}

export function lastSessionId(): string | null {
  if (!isLocalStorageAvailable()) return null;
  return window.localStorage.getItem(LAST_SESSION_KEY);
}

/** Remove every StudyRunway-owned key from localStorage. Returns key count removed. */
export function wipeStudyRunwayData(): number {
  if (!isLocalStorageAvailable()) return 0;
  const keys: string[] = [];
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key && key.startsWith(STORAGE_PREFIX)) keys.push(key);
    }
    for (const key of keys) window.localStorage.removeItem(key);
    return keys.length;
  } catch {
    return 0;
  }
}

/** Clear the pointer to the last session without deleting its saved transcript. */
export function clearLastSession(): void {
  if (!isLocalStorageAvailable()) return;
  try {
    window.localStorage.removeItem(LAST_SESSION_KEY);
  } catch {
    // Storage may be blocked; the next startup still validates the session.
  }
}
