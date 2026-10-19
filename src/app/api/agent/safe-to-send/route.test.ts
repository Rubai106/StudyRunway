import { beforeEach, describe, expect, it } from "vitest";
import { GET, POST } from "@/app/api/agent/safe-to-send/route";
import { clearStore, getTask, updateTask } from "@/lib/agent/state";
import { buildSamplePlan } from "@/lib/sample";
import { SAFE_TO_SEND_ACTION_ACKS } from "@/lib/tools/safeToSendApproval";

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/agent/safe-to-send", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function get(url: string, headers: Record<string, string> = {}): Request {
  return new Request(url, { method: "GET", headers });
}

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

describe("/api/agent/safe-to-send route", () => {
  beforeEach(() => {
    clearStore();
  });

  it("rejects malformed session ids", async () => {
    const badPost = await POST(post({ sessionId: "bad id", action: "get_state", payload: {} }));
    expect(badPost.status).toBe(400);

    const badGet = await GET(get("http://localhost/api/agent/safe-to-send?sessionId=bad%20id"));
    expect(badGet.status).toBe(400);
  });

  it("enforces explicit simulation approval ack in POST", async () => {
    const res = await POST(
      post({
        sessionId: "sts_ack_1",
        action: "simulate",
        payload: {
          decisionId: "d",
          expectedSendCurrency: "EUR",
          expectedSendAmountMinor: 1,
          expectedFeeMinor: 0,
          expectedReceiveCurrency: "EUR",
          expectedReceiveMinor: 1,
          expectedDueDate: "2026-10-25",
        },
      }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toContain("Explicit approval is required");
  });

  it.each(["confirm_funding_receipt", "revert_simulation"])(
    "requires an explicit acknowledgment for %s",
    async (action) => {
      const res = await POST(post({ sessionId: "sts_action_ack", action, payload: {} }));
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error?: string };
      expect(body.error).toContain("Explicit approval is required");
    },
  );

  it("blocks cross-origin requests", async () => {
    const r1 = await POST(
      post(
        { sessionId: "sts_origin", action: "get_state", payload: {} },
        { origin: "https://evil.example" },
      ),
    );
    expect(r1.status).toBe(403);

    const r2 = await GET(
      get("http://localhost/api/agent/safe-to-send?sessionId=sts_origin", {
        origin: "https://evil.example",
      }),
    );
    expect(r2.status).toBe(403);
  });

  it("returns 404 when exporting with no record", async () => {
    const res = await GET(get("http://localhost/api/agent/safe-to-send?sessionId=sts_none"));
    expect(res.status).toBe(404);
  });

  it("runs load->simulate->export download and returns sanitized JSON", async () => {
    const sid = "sts_export_1";
    seedHighHeadroomPlan(sid);

    const loaded = await POST(
      post({ sessionId: sid, action: "load_demo_scenario", payload: { scenarioId: "A_AFFORDABLE" } }),
    );
    expect(loaded.status).toBe(200);
    const loadedBody = (await loaded.json()) as {
      ok: boolean;
      data?: Record<string, unknown>;
    };
    expect(loadedBody.ok).toBe(true);

    const approval = loadedBody.data?.["simulationApproval"] as Record<string, unknown>;
    expect(approval).toBeTruthy();

    const simulated = await POST(
      post({
        sessionId: sid,
        action: "simulate",
        payload: {
          ...approval,
          approvalAck: "I_APPROVE_SIMULATION",
        },
      }),
    );
    expect(simulated.status).toBe(200);

    const download = await GET(
      get(`http://localhost/api/agent/safe-to-send?sessionId=${sid}&download=1`),
    );
    expect(download.status).toBe(200);
    expect(download.headers.get("content-type")).toContain("application/json");
    expect(download.headers.get("content-disposition")).toContain("attachment;");

    const text = await download.text();
    const record = JSON.parse(text) as Record<string, unknown>;
    expect(record["kind"]).toBe("studyrunway_safe_to_send_sandbox_receipt");
    expect(record["sessionId"]).toBe(sid);
    expect(record["storageLimitation"]).toBeTruthy();
    const simulation = record["simulation"] as Record<string, unknown>;
    expect(simulation["status"]).toBe("APPLIED");

    const raw = JSON.stringify(record).toLowerCase();
    expect(raw).not.toContain("api_key");
    expect(raw).not.toContain("authorization");
    expect(raw).not.toContain("secret");
  });

  it("enforces session boundaries: cannot access another session's simulation record", async () => {
    const sidA = "sts_session_a";
    const sidB = "sts_session_b";
    seedHighHeadroomPlan(sidA);
    seedHighHeadroomPlan(sidB);

    // Apply simulation in Session A
    const loadedA = await POST(
      post({ sessionId: sidA, action: "load_demo_scenario", payload: { scenarioId: "A_AFFORDABLE" } }),
    );
    const loadedABody = (await loadedA.json()) as { data?: Record<string, unknown> };
    const approvalA = loadedABody.data?.["simulationApproval"] as Record<string, unknown>;

    const simA = await POST(
      post({
        sessionId: sidA,
        action: "simulate",
        payload: { ...approvalA, approvalAck: "I_APPROVE_SIMULATION" },
      }),
    );
    const simABody = (await simA.json()) as { data?: Record<string, unknown> };
    const simIdA = simABody.data?.["simulationId"] as string;
    expect(simIdA).toBeTruthy();

    // Query session B requesting Session A's simulationId -> 404
    const crossRes = await GET(
      get(`http://localhost/api/agent/safe-to-send?sessionId=${sidB}&simulationId=${simIdA}`),
    );
    expect(crossRes.status).toBe(404);
  });

  it("rejects oversized request bodies with 413", async () => {
    const huge = "x".repeat(300 * 1024);
    const res = await POST(
      new Request("http://localhost/api/agent/safe-to-send", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": String(huge.length),
        },
        body: JSON.stringify({ sessionId: "sts_huge", action: "get_state", payload: { data: huge } }),
      }),
    );
    expect(res.status).toBe(413);
  });

  it("handles malformed JSON and missing action gracefully with 400", async () => {
    const malformed = await POST(
      new Request("http://localhost/api/agent/safe-to-send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "not-json{",
      }),
    );
    expect(malformed.status).toBe(400);

    const noAction = await POST(
      post({ sessionId: "sts_no_act" }),
    );
    expect(noAction.status).toBe(400);
  });
});


describe("/api/agent/safe-to-send route — approval-boundary hardening", () => {
  beforeEach(() => {
    clearStore();
  });

  async function loadApproval(sid: string, scenarioId = "A_AFFORDABLE") {
    seedHighHeadroomPlan(sid);
    const loaded = await POST(
      post({ sessionId: sid, action: "load_demo_scenario", payload: { scenarioId } }),
    );
    expect(loaded.status).toBe(200);
    const body = (await loaded.json()) as { data?: Record<string, unknown> };
    const approval = body.data?.["simulationApproval"] as Record<string, unknown>;
    expect(approval).toBeTruthy();
    return approval;
  }

  function simulatePayload(approval: Record<string, unknown>, extra: Record<string, unknown> = {}) {
    return {
      ...approval,
      approvalAck: SAFE_TO_SEND_ACTION_ACKS.simulate,
      ...extra,
    };
  }

  /** Deep snapshot of the session's financial obligations (not audit records). */
  function obligationSnapshot(sid: string): string {
    const task = getTask(sid);
    return JSON.stringify(task?.workingPlan?.obligations ?? []);
  }

  /** Counts planned obligations produced by applied Safe-to-Send simulations. */
  function simulationObligationCount(sid: string): number {
    const task = getTask(sid);
    const obligations = task?.workingPlan?.obligations ?? [];
    return obligations.filter((o) => o.id.startsWith("sts-pay-")).length;
  }

  /** Counts Safe-to-Send simulation records with status "applied". */
  function appliedSimulationCount(sid: string): number {
    const task = getTask(sid);
    const records = task?.safeToSend?.records ?? [];
    return records.filter((r) => r.status === "applied").length;
  }

  function failureMessage(body: unknown): string {
    const b = body as { error?: string; summary?: string };
    return b.error ?? b.summary ?? "";
  }

  it("rejects a wrong (not merely missing) approvalAck value", async () => {
    const sid = "sts_wrong_ack";
    const approval = await loadApproval(sid);
    const before = obligationSnapshot(sid);
    const appliedBefore = appliedSimulationCount(sid);
    const res = await POST(
      post({
        sessionId: sid,
        action: "simulate",
        payload: simulatePayload(approval, { approvalAck: "I_APPROVE_SOMETHING_ELSE" }),
      }),
    );
    expect(res.status).toBe(400);
    expect(failureMessage(await res.json())).toContain("Explicit approval is required");
    // Financial state unchanged. (A rejected-attempt audit record is permitted;
    // the ack check rejects before the action handler runs, so none is expected here.)
    expect(obligationSnapshot(sid)).toBe(before);
    expect(simulationObligationCount(sid)).toBe(0);
    expect(appliedSimulationCount(sid)).toBe(appliedBefore);
  });

  it("rejects tampered approval fields via the route without applying a simulation", async () => {
    const sid = "sts_route_tamper";
    const approval = await loadApproval(sid);
    const before = obligationSnapshot(sid);
    const appliedBefore = appliedSimulationCount(sid);
    const res = await POST(
      post({
        sessionId: sid,
        action: "simulate",
        payload: simulatePayload(approval, {
          expectedSendAmountMinor: (approval["expectedSendAmountMinor"] as number) + 5000,
        }),
      }),
    );
    expect(res.status).toBe(400);
    expect(failureMessage(await res.json())).toMatch(/do not match|stale/i);
    // No applied simulation obligation; existing obligations untouched.
    // A rejected-attempt audit record (status "rejected") is permitted.
    expect(obligationSnapshot(sid)).toBe(before);
    expect(simulationObligationCount(sid)).toBe(0);
    expect(appliedSimulationCount(sid)).toBe(appliedBefore);
  });

  it("rejects a stale approval after draft inputs change via the route", async () => {
    const sid = "sts_route_stale";
    const approval = await loadApproval(sid);
    // Materially change the draft after the approval was issued.
    const patched = await POST(
      post({
        sessionId: sid,
        action: "upsert_draft",
        payload: { patch: { tuitionAmountMinor: 99999999 } },
      }),
    );
    expect(patched.status).toBe(200);
    const before = obligationSnapshot(sid);
    const appliedBefore = appliedSimulationCount(sid);
    const res = await POST(
      post({ sessionId: sid, action: "simulate", payload: simulatePayload(approval) }),
    );
    expect(res.status).toBe(400);
    expect(failureMessage(await res.json())).toMatch(/stale/i);
    expect(obligationSnapshot(sid)).toBe(before);
    expect(simulationObligationCount(sid)).toBe(0);
    expect(appliedSimulationCount(sid)).toBe(appliedBefore);
  });

  it("rejects a reused approval on duplicate simulate via the route", async () => {
    const sid = "sts_route_reuse";
    const approval = await loadApproval(sid);
    const first = await POST(
      post({ sessionId: sid, action: "simulate", payload: simulatePayload(approval) }),
    );
    expect(first.status).toBe(200);
    expect(simulationObligationCount(sid)).toBe(1);
    // The legitimate first application created exactly one applied record.
    expect(appliedSimulationCount(sid)).toBe(1);
    const before = obligationSnapshot(sid);
    const second = await POST(
      post({ sessionId: sid, action: "simulate", payload: simulatePayload(approval) }),
    );
    expect(second.status).toBe(400);
    // Rejected either as a duplicate or as stale (state changed after the first
    // apply, so the recomputed decision no longer matches) — either way no
    // second simulation is applied.
    expect(failureMessage(await second.json())).toMatch(/already been simulated|duplicate|stale/i);
    // Still exactly one applied obligation and exactly one applied record —
    // the reused approval created nothing new.
    expect(obligationSnapshot(sid)).toBe(before);
    expect(simulationObligationCount(sid)).toBe(1);
    expect(appliedSimulationCount(sid)).toBe(1);
  });

  it("rejects simulate when the decision is not READY_TO_SIMULATE via the route", async () => {
    const sid = "sts_route_not_ready";
    const loaded = await POST(
      post({ sessionId: sid, action: "load_demo_scenario", payload: { scenarioId: "B_LIVING_SHORTFALL" } }),
    );
    expect(loaded.status).toBe(200);
    const body = (await loaded.json()) as { data?: Record<string, unknown> };
    expect(body.data?.["status"]).not.toBe("READY_TO_SIMULATE");
    const approval = (body.data?.["simulationApproval"] as Record<string, unknown> | null) ?? {
      decisionId: body.data?.["decisionId"],
      expectedSendCurrency: "EUR",
      expectedSendAmountMinor: 1,
      expectedFeeMinor: 0,
      expectedReceiveCurrency: "EUR",
      expectedReceiveMinor: 1,
      expectedDueDate: "2026-10-25",
    };
    const before = obligationSnapshot(sid);
    const appliedBefore = appliedSimulationCount(sid);
    const res = await POST(
      post({ sessionId: sid, action: "simulate", payload: simulatePayload(approval) }),
    );
    expect(res.status).toBe(400);
    expect(failureMessage(await res.json())).toMatch(/not permitted|rejected/i);
    expect(obligationSnapshot(sid)).toBe(before);
    expect(simulationObligationCount(sid)).toBe(0);
    expect(appliedSimulationCount(sid)).toBe(appliedBefore);
  });
});
