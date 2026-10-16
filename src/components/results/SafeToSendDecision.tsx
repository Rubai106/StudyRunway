"use client";

import { useEffect, useMemo, useState } from "react";
import { formatMinor } from "@/lib/currency";
import { Disclosure, asArray, asString, isRecord } from "./shared";

function money(minor: unknown, currency: unknown): string {
  if (typeof minor !== "number" || !Number.isInteger(minor)) return "—";
  const c = typeof currency === "string" ? currency : "";
  if (c.length !== 3) return `${minor}`;
  try {
    return formatMinor(minor, c);
  } catch {
    return `${minor}`;
  }
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

function tone(status: string): { label: string; cls: string } {
  switch (status) {
    case "READY_TO_SIMULATE":
      return {
        label: "Ready to simulate",
        cls: "border-[var(--sr-pine)]/40 bg-[var(--sr-pine)]/10 text-[var(--sr-pine)]",
      };
    case "RISK_DETECTED":
      return {
        label: "Risk detected",
        cls: "border-[var(--sr-clay)]/40 bg-[var(--sr-clay)]/10 text-[var(--sr-clay)]",
      };
    case "MORE_INFORMATION_REQUIRED":
      return {
        label: "More information required",
        cls: "border-[var(--sr-amber)]/45 bg-[var(--sr-amber)]/12 text-[var(--sr-amber)]",
      };
    default:
      return {
        label: "Blocked",
        cls: "border-[var(--sr-clay)]/60 bg-[var(--sr-clay)]/15 text-[var(--sr-clay)]",
      };
  }
}

export default function SafeToSendDecision({
  data,
  sessionId,
}: {
  data: Record<string, unknown>;
  sessionId?: string;
}) {
  const [cardData, setCardData] = useState<Record<string, unknown>>(data);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [delayFundingId, setDelayFundingId] = useState<string>("");
  const [delayDays, setDelayDays] = useState<string>("7");
  const [customDate, setCustomDate] = useState<string>("");
  const [downloadBusy, setDownloadBusy] = useState(false);

  useEffect(() => setCardData(data), [data]);

  const action = async (name: string, payload: Record<string, unknown>) => {
    if (!sessionId) return;
    setBusy(name);
    setError(null);
    try {
      const res = await fetch("/api/agent/safe-to-send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, action: name, payload }),
      });
      const body = (await res.json()) as {
        ok?: boolean;
        data?: Record<string, unknown>;
        summary?: string;
        error?: string;
      };
      if (!res.ok || body.ok === false) {
        setError(body.error ?? body.summary ?? "Action failed");
        return;
      }
      if (body.data) setCardData(body.data);
    } catch {
      setError("Could not reach Safe-to-Send service.");
    } finally {
      setBusy(null);
    }
  };

  const status = asString(cardData["status"]);
  const t = tone(status);
  const decision = isRecord(cardData["decision"]) ? cardData["decision"] : {};
  const draft = isRecord(cardData["draft"]) ? cardData["draft"] : {};
  const payment = isRecord(decision["payment"]) ? decision["payment"] : {};
  const affordability = isRecord(decision["affordability"]) ? decision["affordability"] : {};

  const timeline = isRecord(decision["timeline"]) ? decision["timeline"] : {};
  const baseline = isRecord(timeline["baseline"]) ? timeline["baseline"] : null;
  const scenario = isRecord(timeline["scenario"]) ? timeline["scenario"] : null;
  const selectedRecovery = isRecord(timeline["selectedRecovery"]) ? timeline["selectedRecovery"] : null;
  const recoveryOptions = asArray<Record<string, unknown>>(timeline["recoveryOptions"]);

  const reasons = asArray<Record<string, unknown>>(decision["reasons"]);
  const warnings = asArray<string>(decision["warnings"]);
  const missing = asArray<string>(decision["missingFields"]);
  const assumptions = asArray<string>(decision["assumptions"]);
  const latestSimulation = isRecord(cardData["latestSimulation"]) ? cardData["latestSimulation"] : null;
  const simulationApproval = isRecord(cardData["simulationApproval"])
    ? cardData["simulationApproval"]
    : null;

  const fundingRecords = asArray<Record<string, unknown>>(draft["fundingRecords"]);
  const delayCandidates = fundingRecords.filter((f) => asString(f["status"]) !== "RECEIVED");
  const workflowStage = asString(cardData["workflowStage"], "INTAKE");
  const events = asArray<Record<string, unknown>>(cardData["events"]);

  useEffect(() => {
    if (!delayFundingId && delayCandidates.length > 0) {
      setDelayFundingId(asString(delayCandidates[0]?.["id"]));
    }
  }, [delayFundingId, delayCandidates]);

  const timelineRows = useMemo(() => {
    const active = scenario ?? baseline;
    if (!active) return [] as Record<string, unknown>[];
    return asArray<Record<string, unknown>>(active["events"]);
  }, [baseline, scenario]);

  const applyDelay = async () => {
    const base = fundingRecords.find((f) => asString(f["id"]) === delayFundingId);
    if (!base) return;
    const expectedDate = asString(base["expectedDate"]);
    const revised =
      delayDays === "custom"
        ? customDate
        : expectedDate
          ? addDays(expectedDate, Number(delayDays))
          : "";
    if (!revised) {
      setError("Provide a valid revised date for the delay scenario.");
      return;
    }
    await action("set_delay_scenario", {
      scenario: {
        mode: "delay",
        fundingId: delayFundingId,
        revisedExpectedDate: revised,
        note: "Hypothetical delay scenario",
      },
    });
  };

  const statusIsReady = status === "READY_TO_SIMULATE";

  const downloadSandboxRecord = async () => {
    if (!sessionId) return;
    setDownloadBusy(true);
    setError(null);
    try {
      const simId = latestSimulation ? asString(latestSimulation["simulationId"]) : "";
      const qp = new URLSearchParams({
        sessionId,
        download: "1",
      });
      if (simId) qp.set("simulationId", simId);
      const res = await fetch(`/api/agent/safe-to-send?${qp.toString()}`, {
        method: "GET",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "Could not generate sandbox execution record.");
        return;
      }
      const text = await res.text();
      const blob = new Blob([text], { type: "application/json" });
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = `studyrunway-sandbox-record-${simId || "latest"}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(href);
    } catch {
      setError("Could not download sandbox execution record.");
    } finally {
      setDownloadBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-[var(--sr-ink)]">Safe-to-Send + Funding Timeline</p>
        <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${t.cls}`}>{t.label}</span>
      </div>

      <div className="rounded-xl border border-[var(--sr-line)] bg-white/50 p-3 text-xs">
        <p className="font-semibold text-[var(--sr-ink)]">Task progress</p>
        <p className="mt-1 text-[var(--sr-ink)]/80">
          Current stage: <span className="font-medium">{workflowStage}</span>
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-lg border border-[var(--sr-line)] px-2.5 py-1.5 disabled:opacity-50"
            disabled={!sessionId || downloadBusy}
            onClick={downloadSandboxRecord}
          >
            {downloadBusy ? "Preparing…" : "Download sandbox execution record"}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <button
          type="button"
          className="rounded-xl border border-[var(--sr-line)] px-3 py-2 text-left text-xs hover:bg-[var(--sr-mist)]/60"
          disabled={!sessionId || !!busy}
          onClick={() => action("load_demo_scenario", { scenarioId: "A_AFFORDABLE" })}
        >
          <span className="font-semibold">Load demo baseline</span>
          <span className="block text-[var(--sr-ink)]/65">Scholarship + family inflow with tuition/rent timeline</span>
        </button>
        <button
          type="button"
          className="rounded-xl border border-[var(--sr-line)] px-3 py-2 text-left text-xs hover:bg-[var(--sr-mist)]/60"
          disabled={!sessionId || !!busy}
          onClick={() => action("recalculate", {})}
        >
          <span className="font-semibold">Recalculate deterministically</span>
          <span className="block text-[var(--sr-ink)]/65">Refresh status after any change</span>
        </button>
      </div>

      <dl className="grid grid-cols-1 gap-2 rounded-xl border border-[var(--sr-line)] bg-white/50 p-3 text-xs sm:grid-cols-2">
        <div>
          <dt className="text-[var(--sr-ink)]/55">Institution</dt>
          <dd className="font-medium text-[var(--sr-ink)]">{asString(draft["institutionName"], "—")}</dd>
        </div>
        <div>
          <dt className="text-[var(--sr-ink)]/55">Destination</dt>
          <dd className="font-medium text-[var(--sr-ink)]">{asString(draft["destinationCountry"], "—")}</dd>
        </div>
        <div>
          <dt className="text-[var(--sr-ink)]/55">Tuition due</dt>
          <dd className="font-medium text-[var(--sr-ink)]">{money(payment["tuitionAmountMinor"], payment["tuitionCurrency"])}</dd>
        </div>
        <div>
          <dt className="text-[var(--sr-ink)]/55">Due date</dt>
          <dd className="font-medium text-[var(--sr-ink)]">{asString(payment["dueDate"], "—")}</dd>
        </div>
      </dl>

      <div className="rounded-xl border border-[var(--sr-line)] bg-white/50 p-3 text-xs">
        <p className="font-semibold text-[var(--sr-ink)]">Funding delay scenario</p>
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
          <select
            className="rounded-lg border border-[var(--sr-line)] px-2 py-1.5"
            value={delayFundingId}
            onChange={(e) => setDelayFundingId(e.target.value)}
          >
            {delayCandidates.map((f) => (
              <option key={asString(f["id"])} value={asString(f["id"])}>
                {asString(f["label"], asString(f["id"]))}
              </option>
            ))}
          </select>
          <select
            className="rounded-lg border border-[var(--sr-line)] px-2 py-1.5"
            value={delayDays}
            onChange={(e) => setDelayDays(e.target.value)}
          >
            <option value="0">No delay</option>
            <option value="3">+3 days</option>
            <option value="7">+7 days</option>
            <option value="14">+14 days</option>
            <option value="custom">Custom date</option>
          </select>
          {delayDays === "custom" ? (
            <input
              type="date"
              className="rounded-lg border border-[var(--sr-line)] px-2 py-1.5"
              value={customDate}
              onChange={(e) => setCustomDate(e.target.value)}
            />
          ) : (
            <div className="text-[var(--sr-ink)]/60">Choose a delay option and apply.</div>
          )}
        </div>
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            className="rounded-lg bg-[var(--sr-pine)] px-3 py-1.5 text-white disabled:opacity-50"
            onClick={applyDelay}
            disabled={!sessionId || !!busy || !delayFundingId || delayDays === "0" || (delayDays === "custom" && !customDate)}
          >
            Apply delay
          </button>
          <button
            type="button"
            className="rounded-lg border border-[var(--sr-line)] px-3 py-1.5 disabled:opacity-50"
            onClick={() => action("clear_delay_scenario", {})}
            disabled={!sessionId || !!busy}
          >
            Clear
          </button>
        </div>
      </div>

      {baseline && (
        <div className="rounded-xl border border-[var(--sr-line)] bg-white/50 p-3 text-xs">
          <p className="font-semibold text-[var(--sr-ink)]">Earliest shortfall analysis</p>
          <p className="mt-1 text-[var(--sr-ink)]/75">
            Baseline: {isRecord(baseline["earliestShortfall"]) ? `shortfall on ${asString((baseline["earliestShortfall"] as Record<string, unknown>)["date"])} (${money((baseline["earliestShortfall"] as Record<string, unknown>)["shortfallMinor"], baseline["currency"])})` : "no shortfall detected"}
          </p>
          <p className="text-[var(--sr-ink)]/75">
            Scenario: {scenario && isRecord(scenario["earliestShortfall"]) ? `shortfall on ${asString((scenario["earliestShortfall"] as Record<string, unknown>)["date"])} (${money((scenario["earliestShortfall"] as Record<string, unknown>)["shortfallMinor"], scenario["currency"])})` : scenario ? "no shortfall detected" : "no active delay scenario"}
          </p>
        </div>
      )}

      {recoveryOptions.length > 0 && (
        <div className="rounded-xl border border-[var(--sr-line)] bg-white/50 p-3 text-xs">
          <p className="font-semibold text-[var(--sr-ink)]">Delay recovery options (hypothetical)</p>
          <ul className="mt-2 space-y-2">
            {recoveryOptions.map((o) => {
              const assumption = isRecord(o["assumption"]) ? o["assumption"] : null;
              return (
                <li key={asString(o["id"])} className="rounded-lg border border-[var(--sr-line)] p-2">
                  <p className="font-medium">{asString(o["label"])}</p>
                  <p className="mt-0.5 text-[var(--sr-ink)]/70">{asString(o["rationale"])}</p>
                  {assumption && (
                    <button
                      type="button"
                      className="mt-2 rounded-lg border border-[var(--sr-line)] px-2.5 py-1.5 disabled:opacity-50"
                      onClick={() => action("apply_recovery_assumption", { assumption })}
                      disabled={!sessionId || !!busy}
                    >
                      Apply assumption
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {selectedRecovery && (
        <div className="rounded-xl border border-[var(--sr-line)] bg-white/50 p-3 text-xs">
          <p className="font-semibold text-[var(--sr-ink)]">Active recovery assumption</p>
          <p className="mt-1 text-[var(--sr-ink)]/75">
            <span className="font-medium">{asString(selectedRecovery["label"])}</span>
          </p>
          <button
            type="button"
            className="mt-2 rounded-lg border border-[var(--sr-line)] px-2.5 py-1.5 disabled:opacity-50"
            onClick={() => action("clear_recovery_assumption", {})}
            disabled={!sessionId || !!busy}
          >
            Clear recovery assumption
          </button>
        </div>
      )}

      <Disclosure label="Funding timeline (active projection)">
        <div className="space-y-2">
          {timelineRows.length === 0 ? (
            <p className="text-xs text-[var(--sr-ink)]/60">No timeline events yet.</p>
          ) : (
            timelineRows.map((e) => {
              const inflow = asString(e["kind"]) === "inflow";
              const statusText = asString(e["status"]);
              return (
                <div key={asString(e["id"])} className="rounded-lg border border-[var(--sr-line)] p-2 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-medium">{asString(e["label"])}</p>
                    <span className="text-[var(--sr-ink)]/60">{asString(e["date"])}</span>
                  </div>
                  <p className="mt-0.5 text-[var(--sr-ink)]/70">
                    {inflow ? "+" : "−"}
                    {money(e["amountInFundingMinor"], baseline?.["currency"])} · {statusText}
                  </p>
                  <p className="text-[var(--sr-ink)]/65">
                    Balance after: {money(e["balanceAfterMinor"], baseline?.["currency"])}
                  </p>
                </div>
              );
            })
          )}
        </div>
      </Disclosure>

      <div className="rounded-xl border border-[var(--sr-line)] bg-white/50 p-3 text-xs">
        <p className="font-semibold text-[var(--sr-ink)]">Affordability check</p>
        <ul className="mt-1 space-y-1 text-[var(--sr-ink)]/75">
          <li>Available funds: {money(affordability["availableFundsMinor"], draft["fundingCurrency"])}</li>
          <li>Transfer requirement: {money(payment["paymentRequirementMinorInFunding"], draft["fundingCurrency"])}</li>
          <li>Other obligations: {money(affordability["knownObligationsMinor"], draft["fundingCurrency"])}</li>
          <li>Living reserve: {money(affordability["requiredLivingReserveMinor"], draft["fundingCurrency"])}</li>
          <li>Emergency reserve: {money(affordability["desiredEmergencyReserveMinor"], draft["fundingCurrency"])}</li>
          <li className="font-semibold text-[var(--sr-ink)]">Remaining: {money(affordability["remainingAfterPaymentMinor"], draft["fundingCurrency"])}</li>
        </ul>
      </div>

      <div className="rounded-xl border border-[var(--sr-line)] bg-white/50 p-3 text-xs">
        <p className="font-semibold text-[var(--sr-ink)]">Sandbox simulation approval</p>
        <p className="mt-1 text-[var(--sr-ink)]/70">
          This operation is simulated only. No real transfer is executed.
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!sessionId || !statusIsReady || !!busy || !simulationApproval}
            className="rounded-lg bg-[var(--sr-pine)] px-3 py-1.5 text-white disabled:opacity-50"
            onClick={async () => {
              if (!simulationApproval) return;
              const ok = window.confirm(
                "Approve simulated tuition-payment action in SANDBOX mode for the exact values shown?",
              );
              if (!ok) return;
              await action("simulate", {
                ...simulationApproval,
                approvalAck: "I_APPROVE_SIMULATION",
              });
            }}
          >
            Approve and simulate
          </button>
          <button
            type="button"
            disabled={!sessionId || !!busy}
            className="rounded-lg border border-[var(--sr-line)] px-3 py-1.5 disabled:opacity-50"
            onClick={() => action("revert_simulation", {})}
          >
            Revert latest simulation
          </button>
        </div>
      </div>

      {events.length > 0 && (
        <Disclosure label="Decision evidence">
          <div className="space-y-2">
            {events
              .slice()
              .reverse()
              .map((ev) => (
                <div key={asString(ev["id"])} className="rounded-lg border border-[var(--sr-line)] p-2 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-medium">{asString(ev["label"], "Event")}</p>
                    <span className="text-[var(--sr-ink)]/60">{asString(ev["status"], "")}</span>
                  </div>
                  <p className="text-[var(--sr-ink)]/70">{asString(ev["at"], "")}</p>
                  <p className="mt-0.5 text-[var(--sr-ink)]/75">{asString(ev["detail"], "")}</p>
                </div>
              ))}
          </div>
        </Disclosure>
      )}

      <Disclosure label="Why this decision?">
        <div className="space-y-2 text-xs">
          <div className="rounded-lg border border-[var(--sr-line)] p-2">
            <p className="font-medium">Expected amount received vs tuition due</p>
            <p className="text-[var(--sr-ink)]/75">
              {money(payment["expectedReceiveMinor"], payment["receiveCurrency"])} expected vs{" "}
              {money(payment["tuitionAmountMinor"], payment["tuitionCurrency"])} due.
            </p>
          </div>
          <div className="rounded-lg border border-[var(--sr-line)] p-2">
            <p className="font-medium">Delivery timing vs tuition deadline</p>
            <p className="text-[var(--sr-ink)]/75">
              Expected arrival: {asString(payment["expectedArrivalDate"], "unknown")} · Due: {asString(payment["dueDate"], "unknown")}.
            </p>
          </div>
          <div className="rounded-lg border border-[var(--sr-line)] p-2">
            <p className="font-medium">Affordability and reserve impact</p>
            <p className="text-[var(--sr-ink)]/75">
              Remaining after proposed payment: {money(affordability["remainingAfterPaymentMinor"], draft["fundingCurrency"])}.
            </p>
          </div>
          {reasons.length > 0 && (
            <div className="rounded-lg border border-[var(--sr-line)] p-2">
              <p className="font-medium">Deterministic rule outcomes</p>
              <ul className="mt-1 list-disc pl-4 text-[var(--sr-ink)]/80">
                {reasons.map((r, i) => (
                  <li key={i}>{asString(r["message"], "")}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </Disclosure>

      {missing.length > 0 && (
        <div className="rounded-xl border border-[var(--sr-amber)]/45 bg-[var(--sr-amber)]/10 p-3 text-xs text-[var(--sr-ink)]">
          <p className="font-semibold">Missing required information</p>
          <p className="mt-1">{missing.join(", ")}</p>
        </div>
      )}

      {warnings.length > 0 && (
        <div className="rounded-xl border border-[var(--sr-clay)]/35 bg-[var(--sr-clay)]/10 p-3 text-xs text-[var(--sr-ink)]">
          <p className="font-semibold">Warnings</p>
          <ul className="mt-1 list-disc pl-4">
            {warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      {latestSimulation && (
        <div className="rounded-xl border border-[var(--sr-line)] bg-[var(--sr-mist)]/40 p-3 text-xs text-[var(--sr-ink)]/85">
          <p className="font-semibold">Latest sandbox action</p>
          <p className="mt-1">
            {asString(latestSimulation["status"], "unknown").toUpperCase()} · {asString(latestSimulation["simulationId"], "")}
          </p>
          <p className="mt-1">{asString(latestSimulation["reason"], "")}</p>
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-[var(--sr-clay)]/35 bg-[var(--sr-clay)]/10 p-3 text-xs text-[var(--sr-ink)]">
          {error}
        </div>
      )}

      <Disclosure label="Calculation assumptions and uncertainty">
        <ul className="list-disc space-y-1 pl-4 text-xs text-[var(--sr-ink)]/75">
          {assumptions.length > 0 ? assumptions.map((a, i) => <li key={i}>{a}</li>) : <li>No extra assumptions were recorded.</li>}
          <li>All actions are simulated in SANDBOX mode only. No real transfer is executed.</li>
          <li>User-provided quote links are treated as evidence inputs, not automatic verification.</li>
          <li>Storage is session-scoped in-memory state and is not durable across server restarts.</li>
        </ul>
      </Disclosure>

      {fundingRecords.length > 0 && (
        <Disclosure label="Mark expected funding as received">
          <div className="space-y-2">
            {fundingRecords.map((f) => {
              const statusText = asString(f["status"]);
              if (statusText === "RECEIVED" || statusText === "CANCELLED") return null;
              return (
                <div key={asString(f["id"])} className="rounded-lg border border-[var(--sr-line)] p-2 text-xs">
                  <p className="font-medium">{asString(f["label"])}</p>
                  <p className="text-[var(--sr-ink)]/70">Expected: {money(f["expectedAmountMinor"], f["currency"])} on {asString(f["expectedDate"])}</p>
                  <button
                    type="button"
                    className="mt-2 rounded-lg border border-[var(--sr-line)] px-2.5 py-1.5 disabled:opacity-50"
                    disabled={!sessionId || !!busy}
                    onClick={() =>
                      action("confirm_funding_receipt", {
                        fundingId: asString(f["id"]),
                        receivedAmountMinor: f["expectedAmountMinor"],
                        receivedDate: todayIso(),
                      })
                    }
                  >
                    Mark full amount received today
                  </button>
                </div>
              );
            })}
          </div>
        </Disclosure>
      )}
    </div>
  );
}
