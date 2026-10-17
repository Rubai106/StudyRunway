import { beforeEach, describe, expect, it } from "vitest";
import { getTask, clearStore, updateTask } from "@/lib/agent/state";
import { buildSamplePlan } from "@/lib/sample";
import { getSafeToSendApprovalActions, runSafeToSendAction, upsertSafeToSendDraftTool } from "@/lib/tools/safeToSend";
import { SAFE_TO_SEND_ACTION_ACKS } from "@/lib/tools/safeToSendApproval";

function seedHighHeadroomPlan(sessionId: string): void {
  const sample = buildSamplePlan();
  updateTask(sessionId, {
    workingPlan: {
      fundingSources: sample.fundingSources.map((f, i) =>
        i === 0 ? { ...f, amountMinor: (f.amountMinor ?? 0) + 10_000_000, certainty: "confirmed" as const } : f,
      ),
      obligations: [],
      planningCurrency: sample.profile.planningCurrency,
      asOfDate: sample.profile.asOfDate,
      fx: sample.fx,
      evidence: sample.evidence,
      quotes: sample.quotes,
    },
  });
}

describe("safe-to-send deterministic action invariants", () => {
  it("upserts a repeated quote id without duplicating it or dropping other options", async () => {
    const sid = "sts_quote_upsert";
    const ctx = { sessionId: sid, taskId: "task-quote-upsert" };
    const quoteA = {
      id: "quote-a", providerName: "Provider A", sendCurrency: "BDT", sendAmountMinor: 40000000,
      feeMinor: 100000, feeCurrency: "BDT", targetCurrency: "EUR", expectedReceiveMinor: 315000,
      expectedDeliveryDate: "2027-09-08", verificationStatus: "user_provided_unverified" as const,
    };
    const quoteB = { ...quoteA, id: "quote-b", providerName: "Provider B" };
    await upsertSafeToSendDraftTool.handler({ patch: { quotes: [quoteA, quoteB] } }, ctx);
    await upsertSafeToSendDraftTool.handler({ patch: { quotes: [{ ...quoteA, expectedReceiveMinor: 320000 }] } }, ctx);

    const draft = getTask(sid)?.safeToSend.draft as { quotes?: { id: string; expectedReceiveMinor?: number }[] } | null | undefined;
    const quotes = draft?.quotes ?? [];
    expect(quotes).toHaveLength(2);
    expect(quotes.find((quote) => quote.id === "quote-a")?.expectedReceiveMinor).toBe(320000);
    expect(quotes.some((quote) => quote.id === "quote-b")).toBe(true);
  });

  it("has an explicit route acknowledgment for every approval-gated action", () => {
    expect(getSafeToSendApprovalActions()).toEqual(
      Object.keys(SAFE_TO_SEND_ACTION_ACKS).sort(),
    );
  });

  it("keeps decision id stable across identical recalculations", async () => {
    const sid = "sts_decision_stable";
    seedHighHeadroomPlan(sid);
    const loaded = await runSafeToSendAction(sid, "load_demo_scenario", {
      scenarioId: "A_AFFORDABLE",
    });
    expect(loaded.ok).toBe(true);
    const firstDecisionId = (loaded.data as Record<string, unknown>)["decisionId"];

    const recalculated = await runSafeToSendAction(sid, "recalculate", {});
    expect(recalculated.ok).toBe(true);
    const secondDecisionId = (recalculated.data as Record<string, unknown>)["decisionId"];

    expect(firstDecisionId).toBe(secondDecisionId);
  });

  beforeEach(() => {
    clearStore();
  });

  it("prevents simulation when status is not READY_TO_SIMULATE", async () => {
    const sid = "sts_non_ready";
    const loaded = await runSafeToSendAction(sid, "load_demo_scenario", {
      scenarioId: "B_LIVING_SHORTFALL",
    });
    expect(loaded.ok).toBe(true);
    const approval = (loaded.data as Record<string, unknown>)["simulationApproval"] as
      | Record<string, unknown>
      | null;
    // Scenario B can still have quote fields, but simulation must still be blocked by status.
    expect((loaded.data as Record<string, unknown>)["status"]).not.toBe("READY_TO_SIMULATE");
    const tried = await runSafeToSendAction(sid, "simulate", {
      ...(approval ?? {
        decisionId: (loaded.data as Record<string, unknown>)["decisionId"],
        expectedSendCurrency: "EUR",
        expectedSendAmountMinor: 1,
        expectedFeeMinor: 0,
        expectedReceiveCurrency: "EUR",
        expectedReceiveMinor: 1,
        expectedDueDate: "2026-10-25",
      }),
    });
    expect(tried.ok).toBe(false);
    expect(tried.summary).toMatch(/Simulation rejected:|not permitted/i);
  });

  it("rejects replayed approvals after material state changes", async () => {
    const sid = "sts_stale_dup";
    seedHighHeadroomPlan(sid);
    const loaded = await runSafeToSendAction(sid, "load_demo_scenario", {
      scenarioId: "A_AFFORDABLE",
    });
    expect(loaded.ok).toBe(true);
    const approval = (loaded.data as Record<string, unknown>)["simulationApproval"] as Record<string, unknown>;

    const first = await runSafeToSendAction(sid, "simulate", approval);
    expect(first.ok).toBe(true);

    const second = await runSafeToSendAction(sid, "simulate", approval);
    expect(second.ok).toBe(false);
    expect(second.summary).toMatch(/stale|approve again/i);
    const appliedCount =
      getTask(sid)?.safeToSend.records.filter((r) => r.status === "applied").length ?? 0;
    expect(appliedCount).toBe(1);

    // Change material inputs; the old approval should still be stale.
    const changed = await runSafeToSendAction(sid, "upsert_draft", {
      patch: { tuitionDueDate: "2026-10-28" },
    });
    expect(changed.ok).toBe(true);

    const stale = await runSafeToSendAction(sid, "simulate", approval);
    expect(stale.ok).toBe(false);
    expect(stale.summary).toMatch(/stale|Recalculate and approve again/i);
  });

  it("reverts only the simulated obligation and blocks repeated reverts", async () => {
    const sid = "sts_revert";
    seedHighHeadroomPlan(sid);
    const loaded = await runSafeToSendAction(sid, "load_demo_scenario", {
      scenarioId: "A_AFFORDABLE",
    });
    const approval = (loaded.data as Record<string, unknown>)["simulationApproval"] as Record<string, unknown>;
    const simulated = await runSafeToSendAction(sid, "simulate", approval);
    expect(simulated.ok).toBe(true);

    const taskAfterSim = getTask(sid)!;
    const simId = (simulated.data as Record<string, unknown>)["simulationId"] as string;
    const plannedAfterSim = taskAfterSim.workingPlan?.obligations.filter((o) => o.status === "planned") ?? [];
    expect(plannedAfterSim.some((o) => o.id.includes(simId))).toBe(true);

    const reverted = await runSafeToSendAction(sid, "revert_simulation", { simulationId: simId });
    expect(reverted.ok).toBe(true);

    const taskAfterRevert = getTask(sid)!;
    const plannedAfterRevert = taskAfterRevert.workingPlan?.obligations.filter((o) => o.status === "planned") ?? [];
    expect(plannedAfterRevert.some((o) => o.id.includes(simId))).toBe(false);

    const secondRevert = await runSafeToSendAction(sid, "revert_simulation", { simulationId: simId });
    expect(secondRevert.ok).toBe(false);
    expect(secondRevert.summary).toMatch(/No matching applied simulation record|not applied/i);
  });

  it("preserves unrelated obligations during simulation and revert", async () => {
    const sid = "sts_unrelated_obls";
    seedHighHeadroomPlan(sid);

    // Add an unrelated planned obligation and a committed obligation
    const task = getTask(sid)!;
    const existingPlan = task.workingPlan!;
    existingPlan.obligations.push(
      {
        id: "obl-unrelated-rent",
        label: "Unrelated monthly rent",
        kind: "rent",
        amountMinor: 60_000,
        currency: existingPlan.planningCurrency,
        dueDate: "2027-10-01",
        recurring: null,
        status: "planned",
        notes: "Real user obligation",
        evidenceIds: [],
      },
      {
        id: "obl-committed-insurance",
        label: "Student health insurance",
        kind: "other",
        amountMinor: 25_000,
        currency: existingPlan.planningCurrency,
        dueDate: "2027-09-15",
        recurring: null,
        status: "committed",
        notes: "Already committed",
        evidenceIds: [],
      },
    );
    updateTask(sid, { workingPlan: existingPlan });

    const loaded = await runSafeToSendAction(sid, "load_demo_scenario", {
      scenarioId: "A_AFFORDABLE",
    });
    const approval = (loaded.data as Record<string, unknown>)["simulationApproval"] as Record<string, unknown>;

    // Simulate
    const simulated = await runSafeToSendAction(sid, "simulate", approval);
    expect(simulated.ok).toBe(true);

    const taskMid = getTask(sid)!;
    expect(taskMid.workingPlan?.obligations.some((o) => o.id === "obl-unrelated-rent")).toBe(true);
    expect(taskMid.workingPlan?.obligations.some((o) => o.id === "obl-committed-insurance")).toBe(true);

    // Revert
    const simId = (simulated.data as Record<string, unknown>)["simulationId"] as string;
    const reverted = await runSafeToSendAction(sid, "revert_simulation", { simulationId: simId });
    expect(reverted.ok).toBe(true);

    const taskEnd = getTask(sid)!;
    // Unrelated obligations must remain intact with identical attributes
    const unrelatedRent = taskEnd.workingPlan?.obligations.find((o) => o.id === "obl-unrelated-rent");
    expect(unrelatedRent).toBeDefined();
    expect(unrelatedRent?.amountMinor).toBe(60_000);
    expect(unrelatedRent?.status).toBe("planned");

    const committedInsurance = taskEnd.workingPlan?.obligations.find((o) => o.id === "obl-committed-insurance");
    expect(committedInsurance).toBeDefined();
    expect(committedInsurance?.amountMinor).toBe(25_000);
    expect(committedInsurance?.status).toBe("committed");
  });

  it("keeps the Safe-to-Send workflow focused on baseline decisions and sandbox actions", async () => {
    const sid = "sts_stage_machine";
    seedHighHeadroomPlan(sid);

    // Step 1: Initial state is INTAKE
    const initialTask = getTask(sid)!;
    expect(initialTask.safeToSend.workflowStage).toBe("INTAKE");

    // Step 2: Load demo scenario (Scenario A is affordable -> AWAITING_APPROVAL)
    const loaded = await runSafeToSendAction(sid, "load_demo_scenario", {
      scenarioId: "A_AFFORDABLE",
    });
    expect(loaded.ok).toBe(true);
    expect((loaded.data as Record<string, unknown>)["workflowStage"]).toBe("AWAITING_APPROVAL");

    // Delay/recovery stay in the existing simulate_scenario planner.
    for (const action of [
      "set_delay_scenario",
      "clear_delay_scenario",
      "apply_recovery_assumption",
      "clear_recovery_assumption",
    ]) {
      const result = await runSafeToSendAction(sid, action, {});
      expect(result.ok).toBe(false);
      expect(result.summary).toContain("Unknown safe-to-send action");
    }

    // Recalculate the baseline decision before the explicit sandbox simulation.
    const recalc = await runSafeToSendAction(sid, "recalculate", {});
    expect(recalc.ok).toBe(true);
    expect((recalc.data as Record<string, unknown>)["workflowStage"]).toBe("AWAITING_APPROVAL");

    // Step 6: Simulate -> SIMULATED
    const approval = (recalc.data as Record<string, unknown>)["simulationApproval"] as Record<string, unknown>;
    const simulated = await runSafeToSendAction(sid, "simulate", approval);
    expect(simulated.ok).toBe(true);
    expect((simulated.data as Record<string, unknown>)["workflowStage"]).toBe("SIMULATED");

    // Step 7: Revert -> REVERTED
    const simId = (simulated.data as Record<string, unknown>)["simulationId"] as string;
    const reverted = await runSafeToSendAction(sid, "revert_simulation", { simulationId: simId });
    expect(reverted.ok).toBe(true);
    expect((reverted.data as Record<string, unknown>)["workflowStage"]).toBe("REVERTED");
  });

  it("rejects simulation attempts when approval payload fields are tampered with", async () => {
    const sid = "sts_tamper_check";
    seedHighHeadroomPlan(sid);
    const loaded = await runSafeToSendAction(sid, "load_demo_scenario", {
      scenarioId: "A_AFFORDABLE",
    });
    const approval = (loaded.data as Record<string, unknown>)["simulationApproval"] as Record<string, unknown>;

    // Tamper with expectedSendAmountMinor
    const tamperedAmount = await runSafeToSendAction(sid, "simulate", {
      ...approval,
      expectedSendAmountMinor: (approval["expectedSendAmountMinor"] as number) - 1000,
    });
    expect(tamperedAmount.ok).toBe(false);
    expect(tamperedAmount.summary).toMatch(/Approval details do not match/i);

    // Tamper with expectedDueDate
    const tamperedDate = await runSafeToSendAction(sid, "simulate", {
      ...approval,
      expectedDueDate: "2029-01-01",
    });
    expect(tamperedDate.ok).toBe(false);
    expect(tamperedDate.summary).toMatch(/Approval details do not match/i);
  });
});

