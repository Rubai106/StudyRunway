"use client";

import { useEffect, useMemo, useState } from "react";
import { STORAGE_PREFIX } from "../chat/persist";
import { asArray, asString, isRecord } from "./shared";

interface PlanItem {
  id: string;
  label: string;
  detail: string;
}

function readItems(v: unknown): PlanItem[] {
  return asArray<unknown>(v)
    .map((raw, i) => {
      if (typeof raw === "string")
        return { id: `item-${i}`, label: raw, detail: "" };
      if (isRecord(raw))
        return {
          id: asString(raw["id"], `item-${i}`),
          label: asString(raw["label"] ?? raw["title"], `Step ${i + 1}`),
          detail: asString(raw["detail"] ?? raw["description"]),
        };
      return null;
    })
    .filter((x): x is PlanItem => x !== null);
}

/** Deterministic key so the same plan keeps its checklist across sessions. */
function planKey(title: string, items: PlanItem[]): string {
  const raw = `${title}::${items.map((i) => i.id).join(",")}`;
  let hash = 0;
  for (let i = 0; i < raw.length; i++) {
    hash = (hash * 31 + raw.charCodeAt(i)) | 0;
  }
  return `${STORAGE_PREFIX}plan.${Math.abs(hash).toString(36)}`;
}

export default function ActionPlan({ data }: { data: Record<string, unknown> }) {
  const title = asString(data["title"], "Action plan");
  const items = useMemo(() => readItems(data["items"] ?? data["steps"]), [data]);
  const key = useMemo(() => planKey(title, items), [title, items]);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(key);
      setChecked(raw ? (JSON.parse(raw) as Record<string, boolean>) : {});
    } catch {
      setChecked({});
    }
    setLoaded(true);
  }, [key]);

  const toggle = (id: string) => {
    setChecked((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      try {
        window.localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // non-fatal
      }
      return next;
    });
  };

  const done = items.filter((i) => checked[i.id]).length;

  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-[var(--sr-ink)]">{title}</p>
        {items.length > 0 && (
          <p className="text-xs tabular-nums text-[var(--sr-ink)]/60" role="status">
            {done} of {items.length} done
          </p>
        )}
      </div>
      <ol className="mt-3 space-y-2">
        {items.map((item, idx) => {
          const isDone = !!checked[item.id];
          const checkboxId = `plan-${key}-${item.id}`;
          return (
            <li
              key={item.id}
              className={`flex items-start gap-3 rounded-xl border px-3 py-2.5 transition ${
                isDone
                  ? "border-[var(--sr-pine)]/30 bg-[var(--sr-pine)]/5"
                  : "border-[var(--sr-line)] bg-white/50"
              }`}
            >
              <input
                id={checkboxId}
                type="checkbox"
                checked={isDone}
                onChange={() => toggle(item.id)}
                disabled={!loaded}
                className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-[var(--sr-pine)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sr-pine)]"
              />
              <div className="min-w-0">
                <label
                  htmlFor={checkboxId}
                  className={`cursor-pointer text-sm font-medium ${
                    isDone
                      ? "text-[var(--sr-ink)]/50 line-through"
                      : "text-[var(--sr-ink)]"
                  }`}
                >
                  <span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-[var(--sr-mist)] text-[11px] font-bold text-[var(--sr-ink)]/60">
                    {idx + 1}
                  </span>
                  {item.label}
                </label>
                {item.detail && (
                  <p className="mt-0.5 pl-7 text-xs text-[var(--sr-ink)]/60">
                    {item.detail}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      {loaded && done === items.length && items.length > 0 && (
        <p className="mt-3 text-sm font-medium text-[var(--sr-pine)]" role="status">
          All done — your plan is complete.
        </p>
      )}
    </div>
  );
}
