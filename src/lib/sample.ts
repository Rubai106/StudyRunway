/**
 * Demonstration dataset: "Ayesha's plan".
 *
 * A Bangladeshi student preparing for a UK master's programme. The figures
 * are synthetic and deliberately arranged so the forecast tells the core
 * StudyRunway story: total funding is almost enough, but the conditional
 * scholarship arrives AFTER the first tuition instalment is due — a timing
 * gap the student cannot see by totalling money alone.
 *
 * All dates are generated relative to "today" so the demo works on any date.
 * Nothing here is real: no real university, no real amounts owed.
 */

import { toMinor } from "./money";
import { FxTable, PlanState, addDaysISO, newId, todayISO } from "./model";

export const SAMPLE_FX_SOURCE = "Sample assumption — replace with a real quoted rate before deciding.";

export function buildSamplePlan(): PlanState {
  const today = todayISO(null);
  const d = (days: number) => addDaysISO(today, days);
  const now = new Date().toISOString();

  const gbp = (major: number) => toMinor(major, "GBP");
  const bdt = (major: number) => toMinor(major, "BDT");

  const fx: FxTable = {
    rates: {
      "BDT>GBP": 0.0064, // ≈ 1 GBP = 156.25 BDT (sample assumption)
      "USD>GBP": 0.75,
    },
    asOf: today,
    source: SAMPLE_FX_SOURCE,
  };

  const scholarshipId = newId("src");

  return {
    version: 1,
    profile: {
      studentName: "Ayesha Rahman",
      homeCountry: "Bangladesh",
      destinationCountry: "United Kingdom",
      homeCurrency: "BDT",
      planningCurrency: "GBP",
      asOfDate: null,
    },
    fundingSources: [
      {
        id: newId("src"), label: "Personal savings (DBBL account)", kind: "savings",
        amountMinor: bdt(900000), currency: "BDT", status: "confirmed_available",
        availableDate: d(-30), expectedDate: null,
        notes: "Savings built up over two years; already in hand.",
        evidenceIds: [],
      },
      {
        id: newId("src"), label: "Family contribution — parents", kind: "family",
        amountMinor: bdt(400000), currency: "BDT", status: "confirmed_pending",
        availableDate: null, expectedDate: d(10),
        notes: "Parents confirmed; transfer initiated after visa decision.",
        evidenceIds: [],
      },
      {
        id: scholarshipId, label: "Dean's Excellence Scholarship", kind: "scholarship",
        amountMinor: gbp(3000), currency: "GBP", status: "conditional",
        availableDate: null, expectedDate: d(75),
        notes: "Conditional on final transcript (expected July). Deducted from second instalment if awarded.",
        evidenceIds: ["ev_schol_amt", "ev_schol_date"],
      },
      {
        id: newId("src"), label: "Part-time campus work (estimate)", kind: "income",
        amountMinor: gbp(800), currency: "GBP", status: "estimated",
        availableDate: null, expectedDate: d(60),
        notes: "Rough estimate — 8 hrs/week once term starts.",
        evidenceIds: [],
      },
    ],
    obligations: [
      {
        id: newId("obl"), label: "Tuition — instalment 1", kind: "tuition",
        amountMinor: gbp(7500), currency: "GBP", status: "committed",
        dueDate: d(20), recurring: null,
        notes: "First instalment must clear before enrolment.",
        evidenceIds: ["ev_tuition_amt", "ev_tuition_date"],
      },
      {
        id: newId("obl"), label: "Accommodation deposit", kind: "deposit",
        amountMinor: gbp(1000), currency: "GBP", status: "committed",
        dueDate: d(25), recurring: null,
        notes: "Refundable deposit for university halls.",
        evidenceIds: ["ev_deposit_amt", "ev_deposit_date_a", "ev_deposit_date_b"],
      },
      {
        id: newId("obl"), label: "Monthly rent — halls", kind: "rent",
        amountMinor: gbp(550), currency: "GBP", status: "planned",
        dueDate: d(30), recurring: { everyMonths: 1, occurrences: 4 },
        notes: "Term-time rent, paid monthly.",
        evidenceIds: [],
      },
      {
        id: newId("obl"), label: "Student visa fee", kind: "visa",
        amountMinor: gbp(490), currency: "GBP", status: "committed",
        dueDate: d(5), recurring: null, notes: "", evidenceIds: [],
      },
      {
        id: newId("obl"), label: "Flight + initial setup", kind: "travel",
        amountMinor: bdt(95000), currency: "BDT", status: "planned",
        dueDate: d(12), recurring: null,
        notes: "Dhaka → London flight plus first-week essentials.",
        evidenceIds: [],
      },
      {
        id: newId("obl"), label: "Living costs top-up", kind: "living",
        amountMinor: gbp(300), currency: "GBP", status: "planned",
        dueDate: d(35), recurring: { everyMonths: 1, occurrences: 2 },
        notes: "Groceries and transport beyond rent.",
        evidenceIds: [],
      },
    ],
    evidence: [
      {
        id: "ev_tuition_amt", documentLabel: "Offer letter — MSc Data Science (sample)",
        factLabel: "Tuition instalment 1 amount", kind: "amount",
        valueText: "£7,500 — first instalment", amountMinor: gbp(7500), currency: "GBP",
        dateValue: null, page: 2, confidence: "high", verified: true,
        conflictsWith: [], extractedAt: now, appliedTo: null,
      },
      {
        id: "ev_tuition_date", documentLabel: "Offer letter — MSc Data Science (sample)",
        factLabel: "Tuition instalment 1 due date", kind: "date",
        valueText: `Due ${d(20)}`, amountMinor: null, currency: null,
        dateValue: d(20), page: 2, confidence: "high", verified: true,
        conflictsWith: [], extractedAt: now, appliedTo: null,
      },
      {
        id: "ev_schol_amt", documentLabel: "Scholarship award letter (sample)",
        factLabel: "Scholarship amount", kind: "amount",
        valueText: "£3,000 conditional award", amountMinor: gbp(3000), currency: "GBP",
        dateValue: null, page: 1, confidence: "medium", verified: false,
        conflictsWith: [], extractedAt: now, appliedTo: null,
      },
      {
        id: "ev_schol_date", documentLabel: "Scholarship award letter (sample)",
        factLabel: "Scholarship expected date", kind: "date",
        valueText: `Expected ${d(75)}`, amountMinor: null, currency: null,
        dateValue: d(75), page: 1, confidence: "medium", verified: false,
        conflictsWith: [], extractedAt: now, appliedTo: null,
      },
      {
        id: "ev_deposit_amt", documentLabel: "Accommodation agreement (sample)",
        factLabel: "Deposit amount", kind: "amount",
        valueText: "£1,000 deposit", amountMinor: gbp(1000), currency: "GBP",
        dateValue: null, page: 3, confidence: "high", verified: true,
        conflictsWith: [], extractedAt: now, appliedTo: null,
      },
      {
        id: "ev_deposit_date_a", documentLabel: "Accommodation agreement (sample)",
        factLabel: "Deposit due date", kind: "date",
        valueText: `Due ${d(25)}`, amountMinor: null, currency: null,
        dateValue: d(25), page: 3, confidence: "medium", verified: false,
        conflictsWith: ["ev_deposit_date_b"], extractedAt: now, appliedTo: null,
      },
      {
        id: "ev_deposit_date_b", documentLabel: "Fee schedule PDF (sample)",
        factLabel: "Deposit due date", kind: "date",
        valueText: `Due ${d(20)}`, amountMinor: null, currency: null,
        dateValue: d(20), page: 1, confidence: "low", verified: false,
        conflictsWith: ["ev_deposit_date_a"], extractedAt: now, appliedTo: null,
      },
    ],
    quotes: [
      {
        id: newId("q"), provider: "Wise (sample)",
        sendAmountMinor: bdt(1200000), sendCurrency: "BDT", receiveCurrency: "GBP",
        exchangeRate: 0.0061, feeMinor: bdt(4500), feeCurrency: "BDT",
        otherCostsMinor: null, otherCostsCurrency: null,
        deliveryDaysMin: 1, deliveryDaysMax: 2,
        quoteDate: today, paymentDeadline: d(20),
        notes: "Sample quote — not a live rate.",
      },
      {
        id: newId("q"), provider: "High-street bank (sample)",
        sendAmountMinor: bdt(1200000), sendCurrency: "BDT", receiveCurrency: "GBP",
        exchangeRate: 0.0057, feeMinor: bdt(12000), feeCurrency: "BDT",
        otherCostsMinor: bdt(3000), otherCostsCurrency: "BDT",
        deliveryDaysMin: 25, deliveryDaysMax: 30,
        quoteDate: today, paymentDeadline: d(20),
        notes: "Sample quote — cheaper rate but arrives after the tuition deadline.",
      },
      {
        id: newId("q"), provider: "New corridor fintech (sample)",
        sendAmountMinor: bdt(1200000), sendCurrency: "BDT", receiveCurrency: "GBP",
        exchangeRate: 0.0063, feeMinor: null, feeCurrency: null,
        otherCostsMinor: null, otherCostsCurrency: null,
        deliveryDaysMin: 0, deliveryDaysMax: 1,
        quoteDate: today, paymentDeadline: d(20),
        notes: "Fee not disclosed — quote is incomplete by design.",
      },
    ],
    scenarios: [],
    fx,
    updatedAt: now,
  };
}
