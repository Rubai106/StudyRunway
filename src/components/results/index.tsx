"use client";

import FinancialOutcome from "./FinancialOutcome";
import TransferComparison from "./TransferComparison";
import ScenarioComparison from "./ScenarioComparison";
import ActionPlan from "./ActionPlan";
import DocumentReview from "./DocumentReview";
import PolicyResearch from "./PolicyResearch";
import DraftEmail from "./DraftEmail";
import LivingCostPlan from "./LivingCostPlan";
import SafeToSendDecision from "./SafeToSendDecision";
import { asString } from "./shared";

const TITLES: Record<string, string> = {
  financial_outcome: "Financial outcome",
  transfer_comparison: "Transfer options",
  scenario_comparison: "Scenario comparison",
  action_plan: "Your action plan",
  document_review: "Document review",
  policy_research: "Official policy research",
  draft_email: "Email draft",
  living_cost_plan: "Destination budget",
  safe_to_send_decision: "Safe-to-Send decision",
};

interface Props {
  component: string;
  data: Record<string, unknown>;
  /** Sends a follow-up chat message (assumption/document corrections). */
  onFollowUpMessage: (message: string) => void;
  /** Active chat session — forwarded to components that write plan state. */
  sessionId?: string;
}

export default function ResultCard({ component, data, onFollowUpMessage, sessionId }: Props) {
  const policyTitles: Record<string, string> = {
    credit_building: "Credit-building guide · official sources",
    banking_setup: "Banking setup · official sources",
    arrival_costs: "Arrival cost guide · official sources",
  };
  const title = component === "policy_research" && typeof data["topic"] === "string" && policyTitles[data["topic"]]
    ? policyTitles[data["topic"]]
    : TITLES[component] ?? asString(data["title"], "Result");
  let body: React.ReactNode;
  switch (component) {
    case "financial_outcome":
      body = (
        <FinancialOutcome data={data} onCorrectAssumption={onFollowUpMessage} />
      );
      break;
    case "transfer_comparison":
      body = <TransferComparison data={data} />;
      break;
    case "scenario_comparison":
      body = <ScenarioComparison data={data} />;
      break;
    case "action_plan":
      body = <ActionPlan data={data} />;
      break;
    case "document_review":
      body = (
        <DocumentReview
          data={data}
          onConfirmed={onFollowUpMessage}
          onCorrected={onFollowUpMessage}
        />
      );
      break;
    case "policy_research":
      body = <PolicyResearch data={data} />;
      break;
    case "draft_email":
      body = <DraftEmail data={data} />;
      break;
    case "living_cost_plan":
      body = <LivingCostPlan data={data} sessionId={sessionId} />;
      break;
    case "safe_to_send_decision":
      body = <SafeToSendDecision data={data} sessionId={sessionId} />;
      break;
    default:
      body = (
        <pre className="overflow-x-auto whitespace-pre-wrap text-xs text-[var(--sr-ink)]/70">
          {JSON.stringify(data, null, 2)}
        </pre>
      );
  }

  return (
    <section
      aria-label={title}
      className="mt-3 overflow-hidden rounded-2xl border border-[var(--sr-line)] bg-white/70 shadow-[0_1px_2px_rgba(31,42,38,0.06)]"
    >
      <header className="border-b border-[var(--sr-line)] bg-[var(--sr-mist)]/60 px-4 py-2.5">
        <h3 className="text-xs font-bold uppercase tracking-widest text-[var(--sr-ink)]/60">
          {title}
        </h3>
      </header>
      <div className="px-4 py-4">{body}</div>
    </section>
  );
}
