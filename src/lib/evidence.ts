/**
 * Evidence-to-record application.
 *
 * Confirming an evidence fact only marks it as reviewed — it never changes a
 * funding source or obligation. "Apply to record" is the explicit, confirmed
 * action that copies a fact's value onto a financial record, links the fact
 * to the record (evidenceIds) and records the audit trail (appliedTo).
 * The forecast is then recalculated by the existing deterministic engine.
 */
import type { EvidenceFact, FundingSource, Obligation, PlanState } from "./model";
import { formatMinor } from "./currency";

export type ApplyRecordKind = "fundingSource" | "obligation";

/** Which record field a fact can update. Null for text facts (nothing to apply). */
export function applicableField(
  fact: EvidenceFact,
  recordKind: ApplyRecordKind,
  recordStatus?: string,
): "amount" | "expectedDate" | "availableDate" | "dueDate" | null {
  if (fact.kind === "amount") return "amount";
  if (fact.kind === "date") {
    if (recordKind === "obligation") return "dueDate";
    return recordStatus === "confirmed_available" ? "availableDate" : "expectedDate";
  }
  return null;
}

export interface ApplyPreview {
  recordKind: ApplyRecordKind;
  recordId: string;
  recordLabel: string;
  field: string;
  fieldLabel: string;
  oldText: string;
  newText: string;
}

const FIELD_LABELS: Record<string, string> = {
  amount: "Amount",
  expectedDate: "Expected date",
  availableDate: "Available date",
  dueDate: "Due date",
};

function fmtAmount(minor: number | null | undefined, currency: string | null | undefined): string {
  if (minor == null || !currency) return "—";
  try {
    return formatMinor(minor, currency);
  } catch {
    return `${(minor / 100).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
  }
}

/** Describe the proposed change without applying it. Throws on invalid input. */
export function previewApply(
  plan: PlanState,
  factId: string,
  recordKind: ApplyRecordKind,
  recordId: string,
): ApplyPreview {
  const fact = plan.evidence.find((f) => f.id === factId);
  if (!fact) throw new Error("Fact not found.");
  if (fact.conflictsWith.length > 0 && !fact.verified) {
    throw new Error("Resolve the conflict first — a disputed fact can't be applied to a record.");
  }
  if (fact.kind === "text") {
    throw new Error("Text facts carry no amount or date, so there's nothing to apply to a record.");
  }
  const list = recordKind === "fundingSource" ? plan.fundingSources : plan.obligations;
  const record = list.find((r) => r.id === recordId) as FundingSource | Obligation | undefined;
  if (!record) throw new Error("Record not found.");

  const field = applicableField(fact, recordKind, (record as FundingSource).status);
  if (!field) throw new Error("This fact can't be applied to the selected record.");

  if (field === "amount") {
    if (fact.amountMinor == null) throw new Error("The fact has no numeric value to apply.");
    return {
      recordKind, recordId, recordLabel: record.label, field,
      fieldLabel: FIELD_LABELS[field],
      oldText: fmtAmount(record.amountMinor, record.currency),
      newText: fmtAmount(fact.amountMinor, fact.currency ?? record.currency),
    };
  }
  // date field
  if (!fact.dateValue) throw new Error("The fact has no date value to apply.");
  const oldDate = (record as Record<string, unknown>)[field] as string | null | undefined;
  return {
    recordKind, recordId, recordLabel: record.label, field,
    fieldLabel: FIELD_LABELS[field],
    oldText: oldDate ?? "—",
    newText: fact.dateValue,
  };
}

/**
 * Apply a fact's value to a financial record. Returns the updated plan.
 * Marks the fact verified, links it (evidenceIds) and records appliedTo.
 * Never changes a record's status — verifying a fact does not make funding guaranteed.
 */
export function applyFactToRecord(
  plan: PlanState,
  factId: string,
  recordKind: ApplyRecordKind,
  recordId: string,
): PlanState {
  const preview = previewApply(plan, factId, recordKind, recordId);
  const fact = plan.evidence.find((f) => f.id === factId)!;

  const applyToList = <T extends { id: string; evidenceIds: string[] }>(list: T[]): T[] =>
    list.map((r) => {
      if (r.id !== recordId) return r;
      const updated = { ...r } as Record<string, unknown>;
      if (preview.field === "amount") {
        updated.amountMinor = fact.amountMinor;
        updated.currency = fact.currency ?? (r as unknown as FundingSource).currency;
      } else {
        updated[preview.field] = fact.dateValue;
      }
      const ids = new Set([...r.evidenceIds, factId]);
      return { ...updated, evidenceIds: [...ids] } as T;
    });

  return {
    ...plan,
    fundingSources: recordKind === "fundingSource" ? applyToList(plan.fundingSources) : plan.fundingSources,
    obligations: recordKind === "obligation" ? applyToList(plan.obligations) : plan.obligations,
    evidence: plan.evidence.map((f) =>
      f.id === factId
        ? {
            ...f,
            verified: true,
            appliedTo: {
              recordKind,
              recordId,
              recordLabel: preview.recordLabel,
              field: preview.field,
            },
          }
        : f,
    ),
  };
}
