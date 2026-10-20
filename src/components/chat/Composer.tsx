"use client";

import { useRef, useState } from "react";
import { buildDocumentEvidenceMessage, candidatesFromText, extractPdfFacts, hasDocumentPromptInjection } from "@/lib/extract";
import type { ExtractedCandidate } from "@/lib/extract";
import { translate, type LanguageCode } from "@/lib/multilingual";

interface Props {
  /** Request payload and privacy-safe transcript label. */
  onSend: (requestText: string, displayText?: string) => void;
  onStop: () => void;
  onRetry: () => void;
  streaming: boolean;
  canRetry: boolean;
  disabled?: boolean;
  error?: string | null;
  language: LanguageCode;
}

interface LocalAttachment {
  fileName: string;
  documentKind: "invoice" | "scholarship_letter" | "fee_schedule" | "other";
  candidates: ExtractedCandidate[];
}

const ACCEPTED = ".txt,.pdf";
const DOCUMENT_KINDS: LocalAttachment["documentKind"][] = [
  "invoice",
  "scholarship_letter",
  "fee_schedule",
  "other",
];

async function extractTextFromFile(file: File): Promise<string> {
  if (file.name.toLowerCase().endsWith(".pdf")) {
    return (await extractPdfFacts(file)).text;
  }
  return await file.text();
}

function describeKind(kind: LocalAttachment["documentKind"]): string {
  return kind.replaceAll("_", " ");
}

export default function Composer({
  onSend,
  onStop,
  onRetry,
  streaming,
  canRetry,
  disabled,
  error,
  language,
}: Props) {
  const [value, setValue] = useState("");
  const [attachment, setAttachment] = useState<LocalAttachment | null>(null);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [attaching, setAttaching] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const trimmed = value.trim();
  const canSend = Boolean(trimmed || attachment);

  const send = () => {
    if (!canSend || streaming || disabled) return;
    const requestText = attachment
      ? [trimmed, buildDocumentEvidenceMessage(attachment.documentKind, attachment.candidates)].filter(Boolean).join("\n\n")
      : trimmed;
    const displayText = attachment
      ? [
          trimmed,
          `[Attached document: ${attachment.fileName}; ${attachment.candidates.length} local amount/date candidate(s); full document text was not saved to chat history.]`,
        ].filter(Boolean).join("\n\n")
      : undefined;
    onSend(requestText, displayText);
    setValue("");
    setAttachment(null);
    textareaRef.current?.focus();
  };

  const handleAttach = async (file: File | undefined) => {
    if (!file) return;
    setAttachError(null);
    if (file.size > 8 * 1024 * 1024) {
      setAttachError("That file is too large (8 MB max).");
      return;
    }
    setAttaching(true);
    try {
      const text = (await extractTextFromFile(file)).replace(/\s+\n/g, "\n").trim();
      if (!text) {
        setAttachError("I couldn't read any text from that file.");
        return;
      }
      if (hasDocumentPromptInjection(text)) {
        setAttachError("This document contains instruction-like text, so it wasn't attached. Enter the financial facts you need checked manually.");
        return;
      }
      const candidates = candidatesFromText(text);
      setAttachment({
        fileName: file.name.slice(0, 120),
        documentKind: "other",
        candidates,
      });
      textareaRef.current?.focus();
    } catch {
      setAttachError("I couldn't read that file. Try a .txt or a text-based PDF.");
    } finally {
      setAttaching(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <div className="border-t border-[var(--sr-line)] bg-[var(--sr-paper)]/95 px-3 pb-3 pt-2 sm:px-6 sm:pb-5">
      {(error || attachError) && (
        <p role="alert" className="mx-auto mb-2 max-w-3xl rounded-xl border border-[var(--sr-clay)]/30 bg-[var(--sr-clay)]/10 px-3 py-2 text-xs text-[var(--sr-clay)]">
          {error ?? attachError}
        </p>
      )}
      <div className="mx-auto max-w-3xl">
        <div className="rounded-2xl border border-[var(--sr-line)] bg-white shadow-[0_2px_12px_rgba(31,42,38,0.08)] transition focus-within:border-[var(--sr-pine)] focus-within:ring-2 focus-within:ring-[var(--sr-pine)]/20">
          <label htmlFor="chat-composer" className="sr-only">{translate(language, "composerAccessibleLabel")}</label>
          <textarea
            id="chat-composer"
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            rows={3}
            disabled={disabled}
            placeholder={translate(language, "composerPlaceholder")}
            aria-describedby="composer-hint"
            className="max-h-40 w-full resize-y bg-transparent px-4 pb-1 pt-3 text-sm leading-relaxed text-[var(--sr-ink)] placeholder:text-[var(--sr-ink)]/40 outline-none disabled:opacity-60"
          />
          <p id="composer-hint" className="sr-only">Press Enter to send, Shift plus Enter for a new line.</p>
          {attachment && (
            <div className="mx-3 mb-2 rounded-xl border border-[var(--sr-line)] bg-[var(--sr-mist)]/60 px-3 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="min-w-0 truncate text-xs font-medium" title={attachment.fileName}>📎 {attachment.fileName}</span>
                <div className="flex items-center gap-2">
                  <label className="text-[11px] text-[var(--sr-ink)]/60" htmlFor="document-kind">{translate(language, "documentType")}</label>
                  <select
                    id="document-kind"
                    value={attachment.documentKind}
                    onChange={(e) => setAttachment((current) => current ? { ...current, documentKind: e.target.value as LocalAttachment["documentKind"] } : current)}
                    className="rounded-lg border border-[var(--sr-line)] bg-white px-2 py-1 text-xs"
                  >
                    {DOCUMENT_KINDS.map((kind) => <option key={kind} value={kind}>{describeKind(kind)}</option>)}
                  </select>
                  <button type="button" onClick={() => setAttachment(null)} className="rounded-lg px-2 py-1 text-xs text-[var(--sr-clay)] hover:bg-white" aria-label={translate(language, "remove")}>{translate(language, "remove")}</button>
                </div>
              </div>
              <p className="mt-1 text-[11px] text-[var(--sr-ink)]/60">
                {attachment.candidates.length} amount/date candidate(s) found locally. Only these values and short source excerpts will be sent for review; the full text stays on this device.
              </p>
            </div>
          )}
          <div className="flex items-center justify-between gap-2 px-2.5 pb-2.5">
            <div className="flex items-center gap-1">
              <input ref={fileInputRef} type="file" accept={ACCEPTED} className="sr-only" aria-label="Attach a text or PDF file" onChange={(e) => handleAttach(e.target.files?.[0])} />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={attaching || disabled}
                className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-medium text-[var(--sr-ink)]/70 transition hover:bg-[var(--sr-mist)] hover:text-[var(--sr-ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sr-pine)] disabled:opacity-50"
              >
                <span aria-hidden="true">📎</span>{attaching ? translate(language, "reading") : attachment ? translate(language, "replace") : translate(language, "attach")}
              </button>
              <span className="hidden text-[11px] text-[var(--sr-ink)]/40 sm:inline">{translate(language, "attachHelp")}</span>
            </div>
            <div className="flex items-center gap-1.5">
              {streaming ? (
                <button type="button" onClick={onStop} data-testid="stop-button" className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--sr-clay)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[var(--sr-clay)]/85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sr-clay)]"><span aria-hidden="true">■</span> {translate(language, "stop")}</button>
              ) : (
                <>
                  {canRetry && <button type="button" onClick={onRetry} className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--sr-line)] px-3 py-2 text-sm font-medium text-[var(--sr-ink)]/70 transition hover:bg-[var(--sr-mist)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sr-pine)]"><span aria-hidden="true">↻</span> {translate(language, "retry")}</button>}
                  <button type="button" onClick={send} disabled={!canSend || disabled} data-testid="send-button" className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--sr-pine)] px-5 py-2 text-sm font-semibold text-white transition hover:bg-[var(--sr-pine)]/85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sr-pine)] disabled:cursor-not-allowed disabled:opacity-40">{translate(language, "send")} <span aria-hidden="true">↑</span></button>
                </>
              )}
            </div>
          </div>
        </div>
        <p className="mt-1.5 text-center text-[11px] text-[var(--sr-ink)]/40">{translate(language, "enterHint")}</p>
      </div>
    </div>
  );
}
