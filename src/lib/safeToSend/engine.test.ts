import { describe, expect, it } from "vitest";
import {
  evaluateSafeToSendDecision,
  SafeToSendDraftSchema,
  type SafeToSendDraft,
} from "./engine";

describe("Safe-to-Send Engine - Financial Correctness & Invariants", () => {
  it("enforces integer minor-unit arithmetic and rejects invalid inputs via schema", () => {
    // Non-integer amount
    expect(() =>
      SafeToSendDraftSchema.parse({
        tuitionAmountMinor: 100.5,
      }),
    ).toThrow(/Must be a safe integer/);

    // Negative amount
    expect(() =>
      SafeToSendDraftSchema.parse({
        tuitionAmountMinor: -500,
      }),
    ).toThrow();

    // Unsupported currency code
    expect(() =>
      SafeToSendDraftSchema.parse({
        tuitionCurrency: "XYZ",
      }),
    ).toThrow(/Unsupported currency/);
  });

  it("orders events chronologically, placing inflows before outflows on the same date", () => {
    const draft: SafeToSendDraft = {
      fundingCurrency: "EUR",
      openingAvailableMinor: 100_000,
      requiredLivingReserveMinor: 50_000,
      desiredEmergencyReserveMinor: 20_000,
      fundingRecords: [
        {
          id: "same-day",
          type: "family_transfer",
          label: "Inflow on the 10th",
          expectedAmountMinor: 50_000,
          currency: "EUR",
          expectedDate: "2027-10-10",
          status: "EXPECTED",
        },
      ],
      timelineObligations: [
        {
          id: "obl-same-day",
          label: "Outflow on the 10th",
          kind: "rent",
          amountMinor: 80_000,
          currency: "EUR",
          dueDate: "2027-10-10",
          status: "planned",
        },
      ],
      quotes: [],
    };

    const decision = evaluateSafeToSendDecision(draft, null);
    const events = decision.timeline.baseline.events;

    expect(events.length).toBe(2);
    // Inflow must precede outflow on 2027-10-10
    expect(events[0].id).toBe("fund-same-day-expected");
    expect(events[0].kind).toBe("inflow");
    expect(events[0].balanceAfterMinor).toBe(150_000); // 100_000 + 50_000

    expect(events[1].id).toBe("obl-draft-obl-same-day");
    expect(events[1].kind).toBe("outflow");
    expect(events[1].balanceAfterMinor).toBe(70_000); // 150_000 - 80_000

    // Balance never dipped below threshold (70_000) prior to or during the outflow!
    expect(decision.timeline.baseline.earliestShortfall).toBeNull();
  });

  it("treats RECEIVED, PARTIALLY_RECEIVED, and CANCELLED funds with strict factual semantics", () => {
    const draft: SafeToSendDraft = {
      fundingCurrency: "EUR",
      openingAvailableMinor: 10_000,
      requiredLivingReserveMinor: 5_000,
      desiredEmergencyReserveMinor: 5_000,
      fundingRecords: [
        {
          id: "f-recv",
          type: "scholarship",
          label: "Confirmed grant",
          expectedAmountMinor: 100_000,
          receivedAmountMinor: 100_000,
          receivedDate: "2027-09-01",
          currency: "EUR",
          expectedDate: "2027-09-01",
          status: "RECEIVED",
        },
        {
          id: "f-part",
          type: "family_transfer",
          label: "Partial transfer",
          expectedAmountMinor: 80_000,
          receivedAmountMinor: 30_000,
          receivedDate: "2027-09-02",
          currency: "EUR",
          expectedDate: "2027-09-15",
          status: "PARTIALLY_RECEIVED",
        },
        {
          id: "f-canc",
          type: "other",
          label: "Cancelled bursary",
          expectedAmountMinor: 50_000,
          currency: "EUR",
          expectedDate: "2027-09-20",
          status: "CANCELLED",
        },
      ],
      quotes: [],
      timelineObligations: [],
    };

    const decision = evaluateSafeToSendDecision(draft, null);
    const events = decision.timeline.baseline.events;

    const recvEvent = events.find((e) => e.id === "fund-f-recv-received");
    expect(recvEvent).toBeDefined();
    expect(recvEvent?.amountMinor).toBe(100_000);
    expect(recvEvent?.uncertain).toBe(false);
    expect(recvEvent?.hypothetical).toBe(false);

    const partRecvEvent = events.find((e) => e.id === "fund-f-part-received");
    expect(partRecvEvent).toBeDefined();
    expect(partRecvEvent?.amountMinor).toBe(30_000);
    expect(partRecvEvent?.date).toBe("2027-09-02");
    expect(partRecvEvent?.uncertain).toBe(false);

    const partOutEvent = events.find((e) => e.id === "fund-f-part-outstanding");
    expect(partOutEvent).toBeDefined();
    expect(partOutEvent?.amountMinor).toBe(50_000); // 80k - 30k
    expect(partOutEvent?.date).toBe("2027-09-15");
    expect(partOutEvent?.uncertain).toBe(true);

    const cancEvent = events.find((e) => e.id === "fund-f-canc-cancelled");
    expect(cancEvent).toBeDefined();
    expect(cancEvent?.amountMinor).toBe(0);
    expect(cancEvent?.uncertain).toBe(true);
  });

  it("identifies earliest shortfall correctly when balance breaches living + emergency reserves", () => {
    const draft: SafeToSendDraft = {
      fundingCurrency: "EUR",
      openingAvailableMinor: 120_000,
      requiredLivingReserveMinor: 60_000,
      desiredEmergencyReserveMinor: 30_000, // Total threshold = 90_000
      timelineObligations: [
        {
          id: "obl-1",
          label: "Rent instalment 1",
          kind: "rent",
          amountMinor: 20_000,
          currency: "EUR",
          dueDate: "2027-09-05", // Balance = 120k - 20k = 100k > 90k
          status: "planned",
        },
        {
          id: "obl-2",
          label: "Rent instalment 2",
          kind: "rent",
          amountMinor: 20_000,
          currency: "EUR",
          dueDate: "2027-09-15", // Balance = 100k - 20k = 80k < 90k threshold
          status: "planned",
        },
      ],
      fundingRecords: [],
      quotes: [],
    };

    const decision = evaluateSafeToSendDecision(draft, null);
    const shortfall = decision.timeline.baseline.earliestShortfall;

    expect(shortfall).not.toBeNull();
    expect(shortfall?.date).toBe("2027-09-15");
    expect(shortfall?.thresholdMinor).toBe(90_000);
    expect(shortfall?.balanceMinor).toBe(80_000);
    expect(shortfall?.shortfallMinor).toBe(10_000);
    expect(shortfall?.eventId).toBe("obl-draft-obl-2");
  });

  it("prioritizes material risk over missing fields (never masks risk as merely MORE_INFORMATION_REQUIRED)", () => {
    const draft: SafeToSendDraft = {
      // institutionName and tuitionDueDate intentionally missing
      fundingCurrency: "EUR",
      openingAvailableMinor: 20_000,
      requiredLivingReserveMinor: 40_000,
      desiredEmergencyReserveMinor: 20_000, // threshold = 60_000, opening = 20_000 (shortfall already exists!)
      timelineObligations: [
        {
          id: "obl-tuition",
          label: "Tuition",
          kind: "tuition",
          amountMinor: 50_000,
          currency: "EUR",
          dueDate: "2027-09-10",
          status: "planned",
        },
      ],
      fundingRecords: [],
      quotes: [],
    };

    const decision = evaluateSafeToSendDecision(draft, null);
    expect(decision.missingFields.length).toBeGreaterThan(0);
    // Because a shortfall exists, status must be RISK_DETECTED, not MORE_INFORMATION_REQUIRED
    expect(decision.status).toBe("RISK_DETECTED");
    expect(decision.reasons.some((r) => r.code === "TIMELINE_EARLIEST_SHORTFALL")).toBe(true);
  });

  it("ensures delay scenario and recovery assumptions affect only hypothetical scenario, preserving confirmed baseline", () => {
    const draft: SafeToSendDraft = {
      fundingCurrency: "EUR",
      openingAvailableMinor: 50_000,
      requiredLivingReserveMinor: 30_000,
      desiredEmergencyReserveMinor: 20_000, // threshold 50_000
      fundingRecords: [
        {
          id: "f-grant",
          type: "scholarship",
          label: "Merit grant",
          expectedAmountMinor: 60_000,
          currency: "EUR",
          expectedDate: "2027-09-05",
          status: "EXPECTED",
        },
      ],
      timelineObligations: [
        {
          id: "obl-fee",
          label: "Tuition installment",
          kind: "tuition",
          amountMinor: 40_000,
          currency: "EUR",
          dueDate: "2027-09-08",
          status: "planned",
        },
      ],
      quotes: [],
      activeDelayScenario: {
        mode: "delay",
        fundingId: "f-grant",
        revisedExpectedDate: "2027-09-20", // Moved past the obligation
      },
      selectedRecoveryAssumption: {
        id: "rec-family",
        label: "Emergency family bridge",
        type: "extra_inflow",
        amountMinor: 30_000,
        currency: "EUR",
        effectiveDate: "2027-09-07",
      },
    };

    const decision = evaluateSafeToSendDecision(draft, null);

    // Baseline: grant arrives 2027-09-05 before tuition on 2027-09-08 -> NO shortfall
    expect(decision.timeline.baseline.earliestShortfall).toBeNull();
    const baselineGrant = decision.timeline.baseline.events.find((e) => e.id === "fund-f-grant-expected");
    expect(baselineGrant?.date).toBe("2027-09-05");
    expect(baselineGrant?.hypothetical).toBe(false);

    // Scenario: grant moved to 2027-09-20, but recovery assumption added 30k on 2027-09-07
    expect(decision.timeline.scenario).not.toBeNull();
    const scenarioEvents = decision.timeline.scenario!.events;
    const scenarioGrant = scenarioEvents.find((e) => e.id === "fund-f-grant-expected");
    expect(scenarioGrant?.date).toBe("2027-09-20");
    expect(scenarioGrant?.hypothetical).toBe(true);

    const recoveryEvent = scenarioEvents.find((e) => e.id === "recovery-rec-family");
    expect(recoveryEvent).toBeDefined();
    expect(recoveryEvent?.hypothetical).toBe(true);
    expect(recoveryEvent?.uncertain).toBe(true);
  });
});

