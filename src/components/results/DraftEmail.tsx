"use client";

import { useState } from "react";
import { asString } from "./shared";

const inputClass =
  "w-full rounded-xl border border-[var(--sr-line)] bg-white/70 px-3 py-2 text-sm text-[var(--sr-ink)] outline-none transition focus:border-[var(--sr-pine)] focus:ring-2 focus:ring-[var(--sr-pine)]/25";

export default function DraftEmail({ data }: { data: Record<string, unknown> }) {
  const [to, setTo] = useState(asString(data["to"] ?? data["recipient"]));
  const [subject, setSubject] = useState(asString(data["subject"]));
  const [body, setBody] = useState(asString(data["body"]));
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);

  const copy = async () => {
    const text = `To: ${to}\nSubject: ${subject}\n\n${body}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setCopyError(null);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      // Fallback for browsers without clipboard permission.
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        setCopied(true);
        setCopyError(null);
        window.setTimeout(() => setCopied(false), 2500);
      } catch {
        setCopyError("Copy didn't work — select the text manually instead.");
      }
    }
  };

  return (
    <div>
      <p
        className="flex items-center gap-2 rounded-xl border border-[var(--sr-amber)]/40 bg-[var(--sr-amber)]/10 px-3 py-2 text-xs font-medium text-[var(--sr-ink)]"
        role="note"
      >
        <span aria-hidden="true">⚠</span>
        This is a draft only — nothing has been sent.
      </p>
      <div className="mt-3 space-y-2.5">
        <div>
          <label
            htmlFor="draft-email-to"
            className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-[var(--sr-ink)]/50"
          >
            To
          </label>
          <input
            id="draft-email-to"
            type="text"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="recipient@example.com"
            className={inputClass}
          />
        </div>
        <div>
          <label
            htmlFor="draft-email-subject"
            className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-[var(--sr-ink)]/50"
          >
            Subject
          </label>
          <input
            id="draft-email-subject"
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label
            htmlFor="draft-email-body"
            className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-[var(--sr-ink)]/50"
          >
            Body
          </label>
          <textarea
            id="draft-email-body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={6}
            className={`${inputClass} resize-y leading-relaxed`}
          />
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={copy}
            className="inline-flex items-center gap-2 rounded-xl bg-[var(--sr-pine)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[var(--sr-pine)]/85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sr-pine)]"
          >
            {copied ? "✓ Copied" : "Copy email"}
          </button>
          {copyError && (
            <p role="alert" className="text-xs text-[var(--sr-clay)]">
              {copyError}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
