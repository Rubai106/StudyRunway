"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgentStreamEvent, ClarifyQuestion } from "@/lib/events";
import { publishAgentEvent } from "@/lib/events";
import { createSSEParser } from "./sse";
import Composer from "./Composer";
import ClarifyForm from "./ClarifyForm";
import ResultCard from "../results";
import {
  clearLastSession,
  loadTranscript,
  lastSessionId,
  saveTranscript,
  wipeStudyRunwayData,
  type StoredMessage,
} from "./persist";

interface Message {
  id: string;
  role: "user" | "assistant";
  text: string;
  status: "done" | "streaming" | "error" | "stopped";
  errorMessage?: string;
  results: { component: string; data: Record<string, unknown> }[];
  pendingClarifications: ClarifyQuestion[];
  answeredQuestionIds: string[];
}

interface ProviderStatus {
  provider: "xai" | "gemini" | "openai" | "anthropic" | "demo";
  model?: string;
  configured?: boolean;
  label?: string;
}

const EXAMPLES = [
  "My scholarship may arrive late. Can I still pay tuition on time?",
  "Find the best viable way to send €3,000 for tuition.",
  "What happens if my living expenses increase by 15%?",
  "Help me recover from a tuition funding shortfall.",
];

/** Exact message the demo flow recognises as the sample-budget entry point. */
export const SAMPLE_BUDGET_MESSAGE =
  "Try the sample student budget — show me the Limerick sample";

/** Exact message the demo flow recognises as the Safe-to-Send sample entry point. */
export const SAMPLE_SAFE_TO_SEND_MESSAGE =
  "Try the Safe-to-Send tuition demo scenario";

function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function toStored(m: Message): StoredMessage {
  return {
    id: m.id,
    role: m.role,
    text: m.text,
    results: m.results,
    pendingClarifications: m.pendingClarifications,
    answeredQuestionIds: m.answeredQuestionIds,
    errorMessage: m.errorMessage,
  };
}

function fromStored(s: StoredMessage): Message {
  return {
    id: s.id,
    role: s.role,
    text: s.text,
    status: "done",
    errorMessage: s.errorMessage,
    results: s.results ?? [],
    pendingClarifications: s.pendingClarifications ?? [],
    answeredQuestionIds: s.answeredQuestionIds ?? [],
  };
}

const PHASE_LABELS: Record<string, string> = {
  understanding: "Reading your request…",
  planning: "Planning…",
  clarifying: "Just need a few details…",
  calling_tools: "Calling tools…",
  verifying: "Double-checking the numbers…",
};

export default function ChatWorkspace() {
  const [sessionId, setSessionId] = useState<string>(() => newId());
  const [sessionReady, setSessionReady] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [activeStatus, setActiveStatus] = useState<string | null>(null);
  const [provider, setProvider] = useState<ProviderStatus | null>(null);
  const [providerError, setProviderError] = useState(false);
  const [composerError, setComposerError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeAssistantId = useRef<string | null>(null);

  // Restore the last transcript only when its server-side task still exists.
  // The demo task store is in memory, so a server restart invalidates old
  // clarification/approval controls even though their transcript survives in
  // localStorage. Starting fresh is safer than showing controls that can only
  // fail with "unknown session".
  useEffect(() => {
    let cancelled = false;
    const restore = async () => {
      const last = lastSessionId();
      if (!last) {
        setSessionId(newId());
        setSessionReady(true);
        return;
      }
      const stored = loadTranscript(last);
      if (!stored || stored.length === 0) {
        clearLastSession();
        setSessionId(newId());
        setSessionReady(true);
        return;
      }
      try {
        const res = await fetch(
          `/api/agent/session-status?sessionId=${encodeURIComponent(last)}`,
          { cache: "no-store" },
        );
        const status = res.ok
          ? (await res.json()) as { active?: boolean }
          : { active: false };
        if (cancelled) return;
        if (status.active) {
          setSessionId(last);
          setMessages(stored.map(fromStored));
          setSessionReady(true);
          return;
        }
        clearLastSession();
        setSessionId(newId());
        setMessages([]);
        setComposerError(
          "Your previous conversation expired when the server restarted. Start a new conversation; old pending actions can no longer be resumed.",
        );
        setSessionReady(true);
      } catch {
        if (cancelled) return;
        clearLastSession();
        setSessionId(newId());
        setMessages([]);
        setComposerError(
          "StudyRunway couldn't reconnect to your previous session. Start a new conversation and try again.",
        );
        setSessionReady(true);
      }
    };
    void restore();
    return () => {
      cancelled = true;
    };
  }, []);

  // Persist transcript on change.
  useEffect(() => {
    if (messages.length === 0) return;
    const normalized = messages.map((m) =>
      m.status === "streaming" ? { ...m, status: "stopped" as const } : m,
    );
    saveTranscript(sessionId, normalized.map(toStored));
  }, [messages, sessionId]);

  // Provider availability indicator.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/agent/status")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data: ProviderStatus) => {
        if (!cancelled) setProvider(data);
      })
      .catch(() => {
        if (!cancelled) setProviderError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Keep the newest content in view.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    el.scrollTo({
      top: el.scrollHeight,
      behavior: reduced ? "auto" : "smooth",
    });
  }, [messages, activeStatus]);

  const updateAssistant = useCallback(
    (fn: (m: Message) => Message) => {
      const id = activeAssistantId.current;
      if (!id) return;
      setMessages((prev) =>
        prev.map((m) => (m.id === id && m.role === "assistant" ? fn(m) : m)),
      );
    },
    [],
  );

  const handleStreamEvent = useCallback(
    (e: AgentStreamEvent) => {
      publishAgentEvent(e);
      switch (e.type) {
        case "status":
          setActiveStatus(
            e.phase === "done" ? null : (PHASE_LABELS[e.phase] ?? "Working…"),
          );
          break;
        case "tool_call_start":
          setActiveStatus(`Calling ${e.label || e.tool}…`);
          break;
        case "tool_call_end":
          setActiveStatus(
            e.ok ? "Working…" : `That step failed — trying another way…`,
          );
          break;
        case "assistant_text":
          updateAssistant((m) => ({ ...m, text: m.text + e.text }));
          break;
        case "clarify":
          updateAssistant((m) => ({
            ...m,
            pendingClarifications: [
              ...m.pendingClarifications,
              ...e.questions.filter(
                (q) =>
                  !m.pendingClarifications.some((p) => p.id === q.id) &&
                  !m.answeredQuestionIds.includes(q.id),
              ),
            ],
          }));
          setActiveStatus(null);
          break;
        case "result":
          updateAssistant((m) => ({
            ...m,
            results: [
              ...m.results,
              { component: e.component, data: e.data },
            ],
          }));
          break;
        case "error":
          updateAssistant((m) => ({
            ...m,
            status: "error",
            errorMessage: e.message || "Something went wrong.",
          }));
          setActiveStatus(null);
          setStreaming(false);
          break;
      }
    },
    [updateAssistant],
  );

  const sendMessage = useCallback(
    async (
      text: string,
      options: { showUserMessage?: boolean; allowEmpty?: boolean } = {},
    ) => {
      if (streaming || !sessionReady) return;
      setComposerError(null);
      const trimmed = text.trim();
      if (!trimmed && !options.allowEmpty) return;

      // A successful clarification/approval is already recorded by
      // /api/agent/answer. Resume the paused task with an empty message and
      // show only the assistant's continuation (not a fabricated user turn).
      const userMessage: Message | null = options.showUserMessage === false
        ? null
        : {
            id: newId(),
            role: "user",
            text: trimmed,
            status: "done",
            results: [],
            pendingClarifications: [],
            answeredQuestionIds: [],
          };
      const assistantMessage: Message = {
        id: newId(),
        role: "assistant",
        text: "",
        status: "streaming",
        results: [],
        pendingClarifications: [],
        answeredQuestionIds: [],
      };
      activeAssistantId.current = assistantMessage.id;
      setMessages((prev) => userMessage
        ? [...prev, userMessage, assistantMessage]
        : [...prev, assistantMessage]);
      setStreaming(true);
      setActiveStatus(
        userMessage ? "Reading your request…" : "Continuing from your answer…",
      );

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const res = await fetch("/api/agent/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId, message: trimmed }),
          signal: controller.signal,
        });
        if (!res.ok || !res.body) {
          throw new Error(
            `The agent service answered with HTTP ${res.status}. ` +
              (res.status === 404
                ? "The chat API isn't available in this build yet."
                : "Please try again in a moment."),
          );
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        const parser = createSSEParser(handleStreamEvent);
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          parser.feed(decoder.decode(value, { stream: true }));
        }
        parser.flush();
        // Mark done unless an error/stop already settled the message.
        const id = activeAssistantId.current;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === id && m.role === "assistant" && m.status === "streaming"
              ? {
                  ...m,
                  status:
                    !m.text &&
                    m.results.length === 0 &&
                    m.pendingClarifications.length === 0
                      ? "error"
                      : "done",
                  errorMessage:
                    !m.text &&
                    m.results.length === 0 &&
                    m.pendingClarifications.length === 0
                      ? "The agent finished without a reply. Please try again."
                      : undefined,
                }
              : m,
          ),
        );
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          updateAssistant((m) =>
            m.status === "streaming" ? { ...m, status: "stopped" } : m,
          );
        } else {
          updateAssistant((m) =>
            m.status === "streaming"
              ? {
                  ...m,
                  status: "error",
                  errorMessage:
                    err instanceof Error
                      ? err.message
                      : "The request failed. Please try again.",
                }
              : m,
          );
        }
      } finally {
        setActiveStatus(null);
        setStreaming(false);
        abortRef.current = null;
        activeAssistantId.current = null;
      }
    },
    [handleStreamEvent, sessionId, sessionReady, streaming, updateAssistant],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const retry = useCallback(() => {
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (!lastUser || streaming) return;
    // Drop any trailing failed/stopped assistant message before retrying.
    setMessages((prev) => {
      const idx = prev.findIndex((m) => m.id === lastUser.id);
      return prev.slice(0, idx + 1);
    });
    // Defer so state settles first.
    window.setTimeout(() => sendMessage(lastUser.text), 0);
  }, [messages, sendMessage, streaming]);

  const markAnswered = useCallback((messageId: string, questionId: string) => {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === messageId
          ? {
              ...m,
              answeredQuestionIds: [...m.answeredQuestionIds, questionId],
              pendingClarifications: m.pendingClarifications.filter(
                (q) => q.id !== questionId,
              ),
            }
          : m,
      ),
    );
  }, []);

  const newConversation = useCallback(() => {
    stop();
    clearLastSession();
    setSessionId(newId());
    setMessages([]);
    setActiveStatus(null);
    setComposerError(null);
  }, [stop]);

  const deleteData = useCallback(() => {
    if (
      typeof window !== "undefined" &&
      window.confirm(
        "Delete all StudyRunway conversation data stored on this device?",
      )
    ) {
      stop();
      wipeStudyRunwayData();
      setSessionId(newId());
      setMessages([]);
      setActiveStatus(null);
      setComposerError(null);
    }
  }, [stop]);

  const lastUserMessage = useMemo(
    () => [...messages].reverse().find((m) => m.role === "user") ?? null,
    [messages],
  );
  const canRetry =
    !streaming &&
    lastUserMessage !== null &&
    messages.some(
      (m) =>
        m.role === "assistant" &&
        (m.status === "error" || m.status === "stopped"),
    );

  const providerBadge = providerError ? (
    <span className="rounded-full border border-[var(--sr-line)] px-2.5 py-1 text-[11px] font-medium text-[var(--sr-ink)]/50">
      Agent offline
    </span>
  ) : !provider ? (
    <span className="rounded-full border border-[var(--sr-line)] px-2.5 py-1 text-[11px] font-medium text-[var(--sr-ink)]/50">
      Checking…
    </span>
  ) : provider.provider === "demo" || !provider.configured ? (
    <span
      className="rounded-full border border-[var(--sr-amber)]/50 bg-[var(--sr-amber)]/10 px-2.5 py-1 text-[11px] font-semibold text-[var(--sr-amber)]"
      title="No AI provider is configured, so the agent runs its built-in demo engine."
    >
      Demo mode
    </span>
  ) : (
    <span
      className="rounded-full border border-[var(--sr-pine)]/40 bg-[var(--sr-pine)]/10 px-2.5 py-1 text-[11px] font-semibold text-[var(--sr-pine)]"
      title={`Model: ${provider.model ?? "unknown"}`}
    >
      {provider.label ?? provider.provider}
    </span>
  );

  return (
    <div className="flex h-dvh flex-col bg-[var(--sr-paper)] text-[var(--sr-ink)]">
      {/* Header */}
      <header className="flex items-center justify-between gap-3 border-b border-[var(--sr-line)] bg-[var(--sr-paper)]/95 px-3 py-2.5 sm:px-6">
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            aria-hidden="true"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[var(--sr-pine)] text-white"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 20h20" />
              <path d="M4 20 12 4l8 16" />
              <path d="M8.5 13h7" />
            </svg>
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-sm font-bold tracking-tight">
              StudyRunway
            </h1>
            <p className="hidden truncate text-[11px] text-[var(--sr-ink)]/50 sm:block">
              Your AI financial readiness agent for studying abroad
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {providerBadge}
          <button
            type="button"
            onClick={newConversation}
            disabled={!sessionReady}
            className="rounded-xl border border-[var(--sr-line)] px-3 py-1.5 text-xs font-medium text-[var(--sr-ink)]/70 transition hover:bg-[var(--sr-mist)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sr-pine)] disabled:cursor-wait disabled:opacity-50"
          >
            New conversation
          </button>
          <button
            type="button"
            onClick={deleteData}
            disabled={!sessionReady}
            className="hidden rounded-xl border border-[var(--sr-line)] px-3 py-1.5 text-xs font-medium text-[var(--sr-ink)]/70 transition hover:bg-[var(--sr-mist)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sr-pine)] disabled:cursor-wait disabled:opacity-50 sm:block"
            title="Erase every StudyRunway conversation stored on this device"
          >
            Delete my data
          </button>
        </div>
      </header>

      {/* Conversation */}
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-6"
        role="log"
        aria-label="Conversation"
        aria-live="polite"
      >
        <div className="mx-auto max-w-3xl">
          {messages.length === 0 ? (
            <Intro
              onExample={(text) => sendMessage(text)}
              disabled={!sessionReady}
            />
          ) : (
            messages.map((m) =>
              m.role === "user" ? (
                <UserMessage key={m.id} text={m.text} />
              ) : (
                <AssistantMessage
                  key={m.id}
                  message={m}
                  isActive={streaming && activeStatus !== null}
                  activeStatus={activeStatus}
                  onAnswered={(qid) => {
                    markAnswered(m.id, qid);
                    // Wait until every clarification in this message has an
                    // answer. Then resume the paused task in one tap without
                    // adding a fake user bubble to the transcript.
                    if (m.pendingClarifications.length <= 1) {
                      window.setTimeout(() => {
                        void sendMessage("", {
                          showUserMessage: false,
                          allowEmpty: true,
                        });
                      }, 0);
                    }
                  }}
                  onFollowUpMessage={(text) => sendMessage(text)}
                  onRetry={retry}
                  sessionId={sessionId}
                />
              ),
            )
          )}
        </div>
      </div>

      {/* Mobile delete-data link */}
      <div className="border-t border-[var(--sr-line)] bg-[var(--sr-paper)] px-3 pt-1 sm:hidden">
        <button
          type="button"
          onClick={deleteData}
          disabled={!sessionReady}
          className="text-[11px] text-[var(--sr-ink)]/50 underline disabled:opacity-50"
        >
          Delete my data
        </button>
      </div>

      <Composer
        onSend={sendMessage}
        onStop={stop}
        onRetry={retry}
        streaming={streaming}
        canRetry={canRetry}
        disabled={!sessionReady}
        error={composerError}
      />
    </div>
  );
}

function Intro({
  onExample,
  disabled = false,
}: {
  onExample: (text: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col items-center py-6 text-center sm:py-10">
      <span
        aria-hidden="true"
        className="flex h-14 w-14 items-center justify-center rounded-3xl bg-[var(--sr-pine)] text-white shadow-lg"
      >
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 20h20" />
          <path d="M4 20 12 4l8 16" />
          <path d="M8.5 13h7" />
        </svg>
      </span>
      <h2 className="mt-5 max-w-md text-2xl font-bold tracking-tight sm:text-3xl">
        Know you can afford the whole journey
      </h2>
      <p className="mt-3 max-w-md text-sm leading-relaxed text-[var(--sr-ink)]/65">
        StudyRunway is an AI agent that checks whether your tuition and living
        costs stay funded — and finds a way when they don&apos;t. Ask in plain
        words; it plans, checks live details, and shows its work.
      </p>
      <button
        type="button"
        onClick={() => onExample(SAMPLE_BUDGET_MESSAGE)}
        disabled={disabled}
        className="mt-5 w-full rounded-2xl bg-[var(--sr-pine)] px-4 py-3.5 text-left shadow-[0_2px_8px_rgba(31,42,38,0.15)] transition hover:bg-[var(--sr-pine)]/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sr-pine)] disabled:cursor-wait disabled:opacity-60"
      >
        <span className="block text-sm font-semibold text-white">
          Try the sample student budget
        </span>
        <span className="mt-0.5 block text-xs text-white/75">
          Limerick, Ireland — €900/mo · real budget engine, no AI key needed
        </span>
      </button>
      <button
        type="button"
        onClick={() => onExample(SAMPLE_SAFE_TO_SEND_MESSAGE)}
        disabled={disabled}
        className="mt-3 w-full rounded-2xl border border-[var(--sr-line)] bg-white/90 px-4 py-3.5 text-left shadow-[0_1px_2px_rgba(31,42,38,0.08)] transition hover:border-[var(--sr-pine)]/60 hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sr-pine)] disabled:cursor-wait disabled:opacity-60"
      >
        <span className="block text-sm font-semibold text-[var(--sr-ink)]">
          Try the Safe-to-Send tuition demo
        </span>
        <span className="mt-0.5 block text-xs text-[var(--sr-ink)]/65">
          Deterministic decision card + sandbox approval rules · no real transfer
        </span>
      </button>
      <div className="mt-4 grid w-full gap-2 text-left sm:grid-cols-2">
        {EXAMPLES.map((example) => (
          <button
            key={example}
            type="button"
            onClick={() => onExample(example)}
            disabled={disabled}
            className="rounded-2xl border border-[var(--sr-line)] bg-white/70 px-4 py-3 text-left text-sm text-[var(--sr-ink)] shadow-[0_1px_2px_rgba(31,42,38,0.06)] transition hover:border-[var(--sr-pine)]/50 hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sr-pine)]"
          >
            {example}
          </button>
        ))}
      </div>
      <p className="mt-5 max-w-md text-[11px] leading-relaxed text-[var(--sr-ink)]/45">
        Demo build for the 2026 Shenzhen International FinTech Competition —
        International Track, Topic C. Nothing here is financial advice.
      </p>
    </div>
  );
}

function UserMessage({ text }: { text: string }) {
  return (
    <div className="mb-4 flex justify-end">
      <div className="max-w-[85%] rounded-2xl rounded-br-md bg-[var(--sr-pine)] px-4 py-2.5 text-sm leading-relaxed text-white">
        <p className="whitespace-pre-wrap">{text}</p>
      </div>
    </div>
  );
}

function AssistantMessage({
  message,
  isActive,
  activeStatus,
  onAnswered,
  onFollowUpMessage,
  onRetry,
  sessionId,
}: {
  message: Message;
  isActive: boolean;
  activeStatus: string | null;
  onAnswered: (questionId: string) => void;
  onFollowUpMessage: (text: string) => void;
  onRetry: () => void;
  sessionId: string;
}) {
  const showStatus =
    message.status === "streaming" && (isActive || activeStatus);
  return (
    <div className="mb-6">
      {message.text && (
        <div className="max-w-[92%] text-sm leading-relaxed">
          <p className="whitespace-pre-wrap">{message.text}</p>
        </div>
      )}
      {showStatus && activeStatus && (
        <p
          className="status-line mt-1.5 flex items-center gap-2 text-xs text-[var(--sr-ink)]/55"
          role="status"
          aria-live="polite"
        >
          <span className="status-dots" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          {activeStatus}
        </p>
      )}
      {/* Show one question at a time so the user can answer each step without competing forms. */}
      {message.pendingClarifications.slice(0, 1).map((q) => (
        <ClarifyForm
          key={q.id}
          question={q}
          sessionId={sessionId}
          onAnswered={onAnswered}
        />
      ))}
      {message.results.map((r, i) => (
        <ResultCard
          key={`${r.component}-${i}`}
          component={r.component}
          data={r.data}
          onFollowUpMessage={onFollowUpMessage}
          sessionId={sessionId}
        />
      ))}
      {message.status === "stopped" && (
        <p className="mt-2 text-xs italic text-[var(--sr-ink)]/50">
          Stopped.{" "}
          <button
            type="button"
            onClick={onRetry}
            className="font-medium text-[var(--sr-pine)] underline"
          >
            Retry
          </button>
        </p>
      )}
      {message.status === "error" && (
        <div
          className="mt-2 rounded-2xl border border-[var(--sr-clay)]/30 bg-[var(--sr-clay)]/10 px-4 py-3"
          role="alert"
        >
          <p className="text-sm text-[var(--sr-ink)]">
            {message.errorMessage ?? "Something went wrong."}
          </p>
          <button
            type="button"
            onClick={onRetry}
            className="mt-2 rounded-xl bg-[var(--sr-clay)] px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-[var(--sr-clay)]/85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sr-clay)]"
          >
            Retry
          </button>
        </div>
      )}
    </div>
  );
}
