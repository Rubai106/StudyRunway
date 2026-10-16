# StudyRunway Deterministic-First Student Finance Engine (Sandbox)

This module combines two connected capabilities:

1. Safe-to-Send tuition-payment decision
2. Funding Timeline projection

Funding delays and recovery options are handled by the existing `simulate_scenario`
workflow, which can compare user-stated shocks and responses against the funding gap.

## Deterministic authority

Authoritative rules and calculations are implemented in ordinary server code:

- `src/lib/safeToSend/engine.ts`
- `src/lib/tools/safeToSend.ts`

The AI layer may explain and collect inputs, but it does not authorize financial actions or override deterministic status.

## Safe-to-Send statuses

Exactly one primary status is returned:

- `READY_TO_SIMULATE`
- `RISK_DETECTED`
- `MORE_INFORMATION_REQUIRED`
- `BLOCKED`

Blocking conditions always block. Known material risk remains `RISK_DETECTED` even when additional fields are missing.

## Funding Timeline model

Draft state supports explicit incoming-funding records and timeline obligations:

- Incoming funding statuses: `EXPECTED`, `AT_RISK`, `DELAYED`, `PARTIALLY_RECEIVED`, `RECEIVED`, `CANCELLED`
- Timeline obligations: tuition/rent/living/other with amount, currency, due date, status

Timeline output includes ordered events, balances, reserve threshold, earliest shortfall, and incomplete conversion notes.

## Sandbox simulation integrity

Simulation (`simulate_safe_to_send_payment`) remains sandbox-only and server-authoritative.

Before apply, server revalidates:

- current recomputed decision hash (`decisionId`)
- status is `READY_TO_SIMULATE`
- approved amount/currency/date fields still match
- duplicate apply guard for same decision

Applied simulation adds one planned sandbox obligation to `workingPlan` and records immutable session-scoped audit metadata. Revert removes only that simulated obligation (when still planned).

## Workflow stage machine and event evidence

Session state now tracks a server-authoritative workflow stage:

- `INTAKE`
- `COLLECTING_INFORMATION`
- `FUNDING_PLAN_READY`
- `AWAITING_APPROVAL`
- `SIMULATED`
- `REVERTED`
- `BLOCKED`

Tool actions append structured event records (`safeToSend.events`) such as:

- input collected
- baseline timeline calculated
- receipt confirmed
- simulation applied/reverted/rejected

The result card renders this as **Task progress** and **Decision evidence**.

## Sandbox receipt export

A sanitized execution record can be exported from real recorded state:

- `GET /api/agent/safe-to-send?sessionId=<id>`
- Optional `simulationId=<id>`
- Optional `download=1` (attachment response)

The export includes simulation id/status, decision status/reasons, quote summary,
assumptions, and forecast-before/after fields. It excludes secrets, API keys,
and hidden prompts.

## No-AI-key operation

Without an AI provider, users can still:

- load deterministic demo scenario data
- inspect timeline and shortfall
- recalculate Safe-to-Send
- run explicit simulated actions in sandbox mode

via `POST /api/agent/safe-to-send` actions and the `SafeToSendDecision` result card controls.

Delay and recovery scenarios remain available through the existing student-finance
crisis planner and are intentionally not duplicated in this workflow.

## Storage limitation

State and audit records are stored in the existing in-memory session store (`TaskState.safeToSend`).

This is process-local sandbox storage and is not durable across server restarts or shared across instances.
