import { describe, expect, it } from "vitest";
import { buildFeeDeadlineAlerts } from "@/lib/feeAlerts";

describe("buildFeeDeadlineAlerts", () => {
  it("turns a projected shortfall into a dated alert using only the forecast data", () => {
    const alerts = buildFeeDeadlineAlerts([
      {
        id: "funding-result",
        role: "assistant",
        results: [{
          component: "financial_outcome",
          data: {
            hasGap: true,
            gapDate: "2026-11-01",
            shortfallMinor: 95_000,
            planningCurrency: "GBP",
          },
        }],
      },
    ], "2026-10-17");

    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      title: "Projected funding shortfall",
      date: "2026-11-01",
      daysUntil: 15,
      urgency: "upcoming",
      messageId: "funding-result",
    });
    expect(alerts[0].description).toContain("£950.00");
  });

  it("prioritizes overdue and near-term tuition fees while ignoring unrelated or distant costs", () => {
    const alerts = buildFeeDeadlineAlerts([
      {
        id: "plan-result",
        role: "assistant",
        results: [{
          component: "action_plan",
          data: {
            actions: [
              { id: "tuition", label: "Tuition fee", purpose: "University fee", deadline: "2026-10-20" },
              { id: "overdue", label: "Invoice payment", purpose: "Course invoice", deadline: "2026-10-10" },
              { id: "rent", label: "Rent", purpose: "Monthly housing cost", deadline: "2026-10-19" },
              { id: "distant", label: "Tuition fee", purpose: "Later term fee", deadline: "2027-02-01" },
            ],
          },
        }],
      },
    ], "2026-10-17");

    expect(alerts.map((alert) => alert.id)).toEqual([
      "fee-plan-result-overdue-2026-10-10",
      "fee-plan-result-tuition-2026-10-20",
    ]);
    expect(alerts[0].urgency).toBe("overdue");
    expect(alerts[1].urgency).toBe("due_soon");
  });

  it("surfaces a real tuition-readiness deadline but ignores demo scenario dates", () => {
    const messages = (demo: boolean) => [{
      id: "safe-result",
      role: "assistant",
      results: [{
        component: "safe_to_send_decision",
        data: {
          ...(demo ? { demoDataLabel: "Fictitious demonstration data" } : {}),
          decision: {
            payment: {
              dueDate: "2026-12-01",
              tuitionAmountMinor: 500_000,
              tuitionCurrency: "GBP",
            },
          },
        },
      }],
    }];

    const realAlerts = buildFeeDeadlineAlerts(messages(false), "2026-10-17");
    expect(realAlerts).toHaveLength(1);
    expect(realAlerts[0]).toMatchObject({
      title: "Tuition payment deadline",
      daysUntil: 45,
      urgency: "upcoming",
      messageId: "safe-result",
    });
    expect(realAlerts[0].description).toContain("£5,000.00");
    expect(buildFeeDeadlineAlerts(messages(true), "2026-10-17")).toEqual([]);
  });
});
