"use client";

import { useRef, useState } from "react";

interface Props {
  /** Called with the message text to send. */
  onSend: (text: string) => void;
  /** Called when the user clicks Stop during a stream. */
  onStop: () => void;
  /** Called when the user clicks Retry after an error/stop. */
  onRetry: () => void;
  streaming: boolean;
  canRetry: boolean;
  disabled?: boolean;
  error?: string | null;
}

const MAX_ATTACH_CHARS = 40000;
const ACCEPTED = ".txt,.pdf";

async function extractTextFromFile(file: File): Promise<string> {
  if (file.name.toLowerCase().endsWith(".pdf")) {
    const pdfjs = await import("pdfjs-dist");
    pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
    const buffer = await file.arrayBuffer();
    const doc = await pdfjs.getDocument({ data: buffer }).promise;
    const pages: string[] = [];
    const count = Math.min(doc.numPages, 20);
    for (let i = 1; i <= count; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      pages.push(
        content.items
          .map((item) =>
            "str" in item && typeof item.str === "string" ? item.str : "",
          )
          .join(" "),
      );
    }
    return pages.join("\n\n");
  }
  return await file.text();
}

export default function Composer({
  onSend,
  onStop,
  onRetry,
  streaming,
  canRetry,
  disabled,
  error,
}: Props) {
  const [value, setValue] = useState("");
  const [attachError, setAttachError] = useState<string | null>(null);
  const [attaching, setAttaching] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const trimmed = value.trim();

  const send = () => {
    if (!trimmed || streaming || disabled) return;
    onSend(trimmed);
    setValue("");
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
      const text = await extractTextFromFile(file);
      const clean = text.replace(/\s+\n/g, "\n").trim();
      if (!clean) {
        setAttachError("I couldn't read any text from that file.");
        return;
      }
      const clipped =
        clean.length > MAX_ATTACH_CHARS
          ? clean.slice(0, MAX_ATTACH_CHARS) + "\n…(truncated)"
          : clean;
      const prefix = `I've attached the text of "${file.name}" below.\n\n`;
      setValue((v) => (v ? `${v}\n\n${prefix}${clipped}` : `${prefix}${clipped}`));
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
        <p
          role="alert"
          className="mx-auto mb-2 max-w-3xl rounded-xl border border-[var(--sr-clay)]/30 bg-[var(--sr-clay)]/10 px-3 py-2 text-xs text-[var(--sr-clay)]"
        >
          {error ?? attachError}
        </p>
      )}
      <div className="mx-auto max-w-3xl">
        <div className="rounded-2xl border border-[var(--sr-line)] bg-white shadow-[0_2px_12px_rgba(31,42,38,0.08)] transition focus-within:border-[var(--sr-pine)] focus-within:ring-2 focus-within:ring-[var(--sr-pine)]/20">
          <label htmlFor="chat-composer" className="sr-only">
            Message StudyRunway — Enter to send, Shift+Enter for a new line
          </label>
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
            placeholder="Ask about your tuition, transfers, or funding…"
            aria-describedby="composer-hint"
            className="max-h-40 w-full resize-y bg-transparent px-4 pb-1 pt-3 text-sm leading-relaxed text-[var(--sr-ink)] placeholder:text-[var(--sr-ink)]/40 outline-none disabled:opacity-60"
          />
          <p id="composer-hint" className="sr-only">
            Press Enter to send, Shift plus Enter for a new line.
          </p>
          <div className="flex items-center justify-between gap-2 px-2.5 pb-2.5">
            <div className="flex items-center gap-1">
              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPTED}
                className="sr-only"
                aria-label="Attach a text or PDF file"
                onChange={(e) => handleAttach(e.target.files?.[0])}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={attaching || disabled}
                className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-medium text-[var(--sr-ink)]/70 transition hover:bg-[var(--sr-mist)] hover:text-[var(--sr-ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sr-pine)] disabled:opacity-50"
              >
                <span aria-hidden="true">📎</span>
                {attaching ? "Reading…" : "Attach"}
              </button>
              <span className="hidden text-[11px] text-[var(--sr-ink)]/40 sm:inline">
                .txt / .pdf — text is extracted on your device
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              {streaming ? (
                <button
                  type="button"
                  onClick={onStop}
                  data-testid="stop-button"
                  className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--sr-clay)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[var(--sr-clay)]/85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sr-clay)]"
                >
                  <span aria-hidden="true">■</span> Stop
                </button>
              ) : (
                <>
                  {canRetry && (
                    <button
                      type="button"
                      onClick={onRetry}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--sr-line)] px-3 py-2 text-sm font-medium text-[var(--sr-ink)]/70 transition hover:bg-[var(--sr-mist)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sr-pine)]"
                    >
                      <span aria-hidden="true">↻</span> Retry
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={send}
                    disabled={!trimmed || disabled}
                    data-testid="send-button"
                    className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--sr-pine)] px-5 py-2 text-sm font-semibold text-white transition hover:bg-[var(--sr-pine)]/85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sr-pine)] disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Send <span aria-hidden="true">↑</span>
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
        <p className="mt-1.5 text-center text-[11px] text-[var(--sr-ink)]/40">
          Enter to send · Shift+Enter for a new line
        </p>
      </div>
    </div>
  );
}
