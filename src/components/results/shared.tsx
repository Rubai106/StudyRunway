"use client";

import { useState, type ReactNode } from "react";
import { getCurrency } from "@/lib/currency";

/** Defensive accessor for loosely-typed result payloads. */
export function get<T>(
  data: Record<string, unknown> | undefined,
  key: string,
  fallback: T,
): T {
  if (!data) return fallback;
  const v = data[key];
  return v === undefined || v === null ? fallback : (v as T);
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function asArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

export function asString(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : typeof v === "number" ? String(v) : fallback;
}

export function asNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)))
    return Number(v);
  return null;
}

/** Format a monetary figure: value is in display units (not minor units). */
export function formatMoney(
  value: number | null | undefined,
  currency?: string,
): string {
  if (value === null || value === undefined || !Number.isFinite(value))
    return "—";
  const code = (currency ?? "").trim().toUpperCase();
  if (code.length === 3) {
    try {
      return new Intl.NumberFormat("en-GB", {
        style: "currency",
        currency: code,
        maximumFractionDigits: 2,
      }).format(value);
    } catch {
      // fall through to plain formatting
    }
  }
  return new Intl.NumberFormat("en-GB", {
    maximumFractionDigits: 2,
  }).format(value);
}

/** Format integer minor units without converting money through binary display guesses. */
export function formatMinorMoney(
  amountMinor: number | null | undefined,
  currency: string,
): string {
  if (amountMinor === null || amountMinor === undefined || !Number.isSafeInteger(amountMinor)) return "—";
  try {
    return formatMoney(amountMinor / 10 ** getCurrency(currency).minorUnits, currency);
  } catch {
    return `${amountMinor} ${currency}`;
  }
}

/** Collapsible progressive-disclosure section. */
export function Disclosure({
  label,
  children,
  defaultOpen = false,
}: {
  label: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="mt-3 rounded-xl border border-[var(--sr-line)]">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-[var(--sr-ink)]/60 transition hover:bg-[var(--sr-mist)]/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sr-pine)] rounded-xl"
      >
        <span>{label}</span>
        <span aria-hidden="true" className="text-base leading-none">
          {open ? "−" : "+"}
        </span>
      </button>
      {open && <div className="border-t border-[var(--sr-line)] px-3 py-3">{children}</div>}
    </div>
  );
}

/** "Reference estimate" honesty badge used on indicative transfer figures. */
export function EstimateBadge() {
  return (
    <span
      title="Indicative reference estimate, not a live quote. Verify with the provider before acting."
      className="inline-flex items-center rounded-full border border-[var(--sr-amber)]/40 bg-[var(--sr-amber)]/10 px-2 py-0.5 text-[11px] font-medium text-[var(--sr-amber)]"
    >
      reference estimate
    </span>
  );
}
