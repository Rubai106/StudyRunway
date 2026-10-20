# StudyRunway — Architecture

Model-driven AI financial-readiness agent for international students.
FinTechathon 2026 · International Track · Topic C (Cross-border & Student Finance).

Stack: Next.js 15.5.28 (pinned) · React 19 · TypeScript 5.7 · Tailwind 3.4 ·
vitest 3.2.3 · Playwright 1.53.1 · three 0.182 / @react-three/fiber 9.4.2 /
drei 10.7.7 (3D tool visualizer) · zod 3.24.2 · pdfjs-dist (local PDF evidence
extraction) · sharp 0.35.5.

## 1. Orchestration loop (`src/lib/agent/orchestrator.ts`)

`runAgent({ sessionId, message, provider, tools, signal, toolTimeoutMs, maxToolCalls })`
is an async generator yielding typed `AgentEvent`s (see §5). Phases, in order:

1. **Validate** input (sessionId present, message ≤ 4000 chars, abort check).
2. **Understanding** — the model returns structured JSON
   (`{ summary, keyFacts, assumptions, missingInfo, currencies, questions[] }`,
   validated by zod). If it asks clarification questions → emit `clarify`,
   set status `clarifying`, and **pause**: the generator returns; the client
   POSTs answers to `/api/agent/answer` (`submitAnswers`) and re-opens the
   stream to resume.
3. **Planning** — model returns `{ steps: [...] }` (2–6 steps), shown to the user.
4. **Calling tools** — up to `MAX_MODEL_ROUNDS` (3) model turns; each turn may
   request tool calls. Every requested name is checked against the allow-list
   first: anything off the list is **never executed** — the model gets a refusal
   string in its conversation context instead.
5. **Verification** — only tools explicitly marked deterministic and
   side-effect-free are re-executed with their validated args. Matching
   summaries set `verified: true`; mismatches are provisional. Live research,
   approval-gated actions, and stateful tools are not replayed and are labeled
   as not independently re-checked.
6. **Outcome** — the model composes a verdict-first summary (every figure must
   come from tool results), then a `result` event carries the selected tool's
   transient structured data together with evidence, assumptions, and the
   tool-call log. Tool data is not copied into persistent server task state.

Failure handling: arg validation errors, timeouts, and tool errors become
`tool_call_end` events with `ok: false` — never a fabricated success. One
retry is allowed on transient failures (HTTP 429/5xx, timeouts, network
resets). Model-level failures (unparseable JSON after a correction retry,
provider errors) emit a recoverable `error` event and mark the task `failed`.
Local financial tools keep the 15-second default timeout. `research_policy`
gets up to 55 seconds for the Vertex Google Search request, 60 seconds for its
handler, and 65 seconds at the orchestrator boundary so citation metadata has
time to return without letting the operation hang indefinitely.
Approval gates (`requiresApproval: true`, including draft preparation and
Safe-to-Send actions) pause the loop with a `clarify` event carrying an
Approve/Deny form; the call runs only after an explicit "approve" via
`/api/agent/answer`. Client abort (Stop
button → `AbortSignal`) ends the stream quietly mid-phase.

## 2. Task state model (`src/lib/agent/state.ts`)

Per-session `TaskState`, validated on every read/write and keyed by the
authenticated user's HMAC-scoped session ID. Local development uses a
process-local `Map`. Production can use the Firestore REST adapter in
`src/lib/agent/firestoreSessionStore.ts`; each API request hydrates the task,
then commits changed state with a Firestore update-time precondition. Concurrent
writes fail with 409 rather than silently overwriting one another. The adapter
stores one JSON payload per session in `studyrunway_sessions`, with a 180-day
application retention window. It never writes prompts or financial state to the
audit log.

- `userGoal`, `status` (`planning | clarifying | executing | verifying | done | failed`)
- `confirmedFacts[]` (source-tagged; only from user answers, never invented;
  clarification prompts are retained so research can safely use the user's
  confirmed country, institution, or official domain)
- `assumptions[]` (explicitly unconfirmed — the model is told not to present
  them as facts)
- `planSteps[]` with `pending | active | done | skipped`
- `toolCalls[]` — every call: id, tool, args summary, **the validated args
  object** (server-side only; never sent to the client), ok, summary
- `evidence[]`, `approvals[]`, `pendingQuestions[]`, `pendingApproval`,
  `approvedCalls[]`

`submitAnswers(sessionId, questionId, answers)` is the single resume primitive
used by POST `/api/agent/answer` for both clarification answers and
Approve/Deny decisions.

## 2.1 Audit events (`src/lib/agent/audit.ts`)

The server emits one-line JSON audit records for agent turns, clarification
requests and submissions, approval decisions, tool outcomes, and task deletion.
Records use the opaque server-generated task ID for correlation. They exclude
session IDs, prompts, answer values, amounts, document contents, tool
arguments/results, provider error bodies, and credentials. With
`STUDYRUNWAY_AUDIT_STORE=cloud-logging`, the server uses ADC to write entries to
the `studyrunway-audit` Cloud Logging log; the Cloud Run service account needs
`roles/logging.logWriter`. Project sinks and bucket retention policies govern
storage (the default `_Default` bucket retains logs for 30 days). A failed API
write falls back to structured stdout, which Cloud Run also collects; this
fallback is visible in the entry. Local stdout alone is not durable or
tamper-evident storage.

## 3. Provider adapters (`src/lib/providers/`)

`Provider` interface: `chat(messages, toolSchemas) → { text, toolCalls,
stopReason }`. Adapters: **xAI (Grok, primary)**, **Vertex AI Gemini** via the
Google Cloud OpenAI-compatible endpoint and Application Default Credentials,
**Google AI Studio Gemini** via Google's API-key endpoint, **OpenAI**, and
**Anthropic** (messages API with tool_use blocks). `selectProvider()` prefers
xAI → Vertex AI → Gemini → OpenAI → Anthropic when no provider is explicitly
selected. All JSON parsing of model output goes through `zodjson.ts` (strip
code fences, one correction retry). Credentials stay server-side; the frontend
only receives provider/model labels from the status endpoint.

> Provider model availability depends on the configured account/project. The
> Vertex default is `google/gemini-3.5-flash`; it has not been called against a
> live project in this environment.

## 4. Tool registry (`src/lib/agent/registry.ts`, `src/lib/tools/`)

- The registry merges a hidden `__ping` self-test tool (used by agent-core
  tests; **excluded from `getModelTools()`** so the model never sees it) with
  the eight financial tools in `src/lib/tools/TOOLS`:
  `analyze_funding_gap`, `compare_transfers`, `extract_document`,
  `simulate_scenario`, `research_policy` (Vertex AI Gemini + Google Search
  grounding, with an official-domain citation gate),
  `build_action_plan`, `draft_email` (requires approval; draft only, never
  sends), and `build_living_cost_plan` (source-backed destination budget).
- Every tool satisfies the `ToolDefinition` contract (`src/lib/agent/tools.ts`):
  zod `parameters` schema, `handler(args, ctx) → ToolResult`, `ok / summary /
  data / evidence`. Args are validated **before** the handler runs
  (`executeToolCall`); a tool never sees invalid input.
- The tools compute; the model interprets. All figures come from the
  deterministic engine in minor units (`money.ts`, `forecast.ts`,
  `transfers.ts`, `scenarios.ts`, `extract.ts`): no tool invents financial
  figures, rates, or quotes.
- `ReminderCenter` is available in the chat header. Action-plan items can open
  it with a suggested title; the user chooses the local reminder time and
  explicitly saves it. Reminders live in browser `localStorage`; optional
  generic browser notifications fire once while the app is open and never
  expose the reminder title on the lock screen.
- `compare_transfers` compares the engine's **sample/reference quotes only**;
  every figure is labelled `"reference estimate — not a live quote"`, the
  quote timestamp is `"sample data"`, missing fees are never treated as zero
  (such quotes are excluded from ranking), and ranking follows the caller's
  objective (`min_total_cost | fastest | balanced`) while quotes that would
  miss the deadline are excluded with a reason.
- Transfer comparisons carry a period-labeled World Bank RPW benchmark for
  context; it is never presented as a live quote or used to fabricate a
  provider's fees or exchange rate. `TransferComparison` also has a local form
  for details the user reads from provider quotes: exchange rate, fee treatment,
  recipient charges, quote date, delivery window, and send limits. It ranks
  only complete quotes that meet the deadline, by amount received, sender cost,
  or speed. Entered quote values are not saved, sent, or independently verified.
  Separately, the manual comparison card can fetch an opt-in, indicative Wise
  quote through `/api/transfers/wise-quote`; that quote is not locked or
  executable, and recipient-bank/intermediary charges remain a separate
  unknown. Other providers still have no automatic quote feed.
- `simulate_scenario` can compare up to eight user-stated recovery options
  (additional funding or a tuition installment), each independently against
  the stressed forecast. It reports the remaining gap and labels funding
  availability and university approval as unconfirmed assumptions.
- `build_action_plan` orders actions by urgency derived from explicit dates,
  then by the action category. Missing deadlines are marked unknown.
- Document text and PDF pages are extracted locally. The request includes only
  bounded candidate values plus page-tagged, identifier-redacted excerpts;
  the transcript stores an attachment summary rather than the document text.
  Attachment turns can call only `extract_document`, so unconfirmed candidates
  cannot reach a financial calculation. Document review values and their
  assistant summary stay in the active view and are not persisted to localStorage.

## 5. SSE event protocol

`src/app/api/agent/chat` streams `AgentEvent`s as `text/event-stream`;
`src/components/chat/sse.ts` parses them client-side. The exact wire shapes
are enforced by `AgentEventSchemas` (zod) in `orchestrator.ts` and asserted in
both unit tests and the mocked E2E suite:

| event | payload |
|---|---|
| `status` | `{ phase: understanding \| planning \| clarifying \| calling_tools \| verifying \| done }` |
| `tool_call_start` | `{ id, tool, label }` |
| `tool_call_end` | `{ id, tool, ok, summary, durationMs }` |
| `assistant_text` | `{ text }` |
| `clarify` | `{ questions: ClarifyQuestion[] }` — kinds: `quick_replies \| date \| amount \| currency \| form` |
| `result` | `{ component, data }` — components include `financial_outcome \| transfer_comparison \| scenario_comparison \| action_plan \| document_review \| policy_research \| draft_email \| living_cost_plan \| safe_to_send_decision` |
| `error` | `{ message, recoverable }` |

`src/lib/events.ts` is the shared event-bus type module used by the UI.

## 6. Chat UI + result components

`/` renders `ChatWorkspace` (`src/components/chat/`): transcript (persisted to
localStorage, see §8), `Composer` (Enter sends / Shift+Enter newline, Stop
button aborts via `AbortController`), `ClarifyForm` (quick replies, date,
amount, currency, and generic form questions with client-side validation —
invalid input never reaches `/api/agent/answer`), and result cards in
`src/components/results/` (one component per `result` event kind).
`FinancialOutcome` exposes an assumption-correction flow: each listed
assumption has a "Correct" button that posts a follow-up chat message, which
re-runs the analysis with the correction. Provider state is shown honestly in
the header badge (`Demo mode` vs the configured provider label) via
`/api/agent/status`.

The Overview dashboard derives fee/deadline alerts from the latest funding
forecast, non-demo Safe-to-Send decision, and dated action plan. Tuition/fee
items within 60 days and projected shortfalls are ranked by urgency and link
back to their source result. The user can open the existing reminder form from
an alert; reminders stay in this browser and are not sent across devices.
The latest funding result also carries a minimal cash-flow view of original-
currency funding sources and unpaid obligations, plus the FX assumptions table.
The dashboard groups amounts by currency and labels each relevant rate with its
pair, as-of date, and source; it does not combine unlike currencies or claim a
live rate.
The dashboard also starts `research_policy` with `topic=credit_building`. That
topic requires a confirmed destination country, asks Google Search grounding
for government/regulator/official-registry sources, and uses the same
claim-to-source citation gate as other policy research. Known public financial
authority hosts are explicitly allow-listed; student eligibility remains a
caveated informational guide, never a provider approval decision.
`DailyBudgetPlanner` keeps a separate validated expense ledger in browser
localStorage. It computes per-day totals, category breakdowns, a daily-limit
progress value, and a seven-day trend in integer minor units. Entries keep
their own currency, and only amounts matching the selected budget currency
count toward its limit; no exchange rate or server sync is assumed.

## 7. 3D tool visualizer — the honesty rule

`src/components/visualizer/` renders the agent's tool-call graph. **The
single hard rule: a node appears only when a real `tool_call_start` event
arrives on the event bus, and its state (running / ok / failed) and peek-panel
summary come only from the corresponding real `tool_call_end` event.**
No synthetic, scripted, or decorative nodes are ever rendered. Consequences:

- Empty state ("No active task — start a conversation.") when nothing has run.
- Failed nodes show the real failure summary, not a placeholder.
- Reduced-motion (`prefers-reduced-motion`) or dead WebGL → the static list
  view renders instead of the 3D canvas; the list shows the same real events.
- `/visualizer-demo` is an internal harness that replays *real* events through
  the *real* event bus with real timing — used by the E2E suite
  (`tests/e2e/visualizer.spec.ts`), not a fake UI.

## 8. Demo mode

When `selectProvider()` finds no provider credentials/configuration, `runAgent` runs `runDemoFlow`
instead of the model loop: the same structured phases
(understand → clarify → plan → tools → verify → outcome) execute against the
real registry and real `executeToolCall` path — now running the REAL
`build_living_cost_plan` tool on a verified source-backed sample case
(Limerick, Ireland — €900/mo, `DEMO_SAMPLE_ARGS` in `orchestrator.ts`) and
returning the real `living_cost_plan` component. **Every user-visible string
is prefixed with `"Demo mode — no model provider configured"`** and the final
`result` carries `demoMode: true`. Demo mode never claims model reasoning
happened. It is an explicitly labelled fallback — not a keyword router
pretending to be AI. The chat UI exposes an obvious entry point: the "Try the
sample student budget" button on the welcome screen (exact message matched by
the demo flow; any other first message gets a labelled clarification offering
the same). Demo mode is fully offline — the engine and dataset are local.

## 9. Data & retention

- Server task state: in-memory in local development; Firestore-backed in
  production when `STUDYRUNWAY_SESSION_STORE=firestore` and
  `FIRESTORE_PROJECT_ID` are configured. Stored state is user-scoped and expires
  after 180 days. Browser-only records remain in account-namespaced localStorage
  on the current device; they are not synced across devices.
- Client: transcripts persist in `localStorage` under the `studyrunway.`
  prefix (`studyrunway.chat.<sessionId>`, `studyrunway.last-session`). "Delete
  my data" (header button + mobile link, with a confirm dialog) calls
  `wipeStudyRunwayData()`, which removes **every** `studyrunway.*` key and
  starts a fresh session.
- Documents uploaded for `extract_document` are processed in memory and are
  not retained in full. The bounded, redacted excerpts sent for extraction may
  remain in server task memory until the task is deleted or the process stops;
  unconfirmed document-review cards are not copied into browser localStorage.

## 10. Destination budget planner — data flow

The Destination Budget Planner wires the researched cost dataset into the
agent as a first-class, interactive capability. One engine, three consumers —
no divergent reimplementations.

```
docs/COST_DATASET.json (researched, zod-validated at load by dataset.ts)
        │
        ▼
src/lib/livingCosts/ — the deterministic engine
  engine.ts        buildLivingCostPlan(inputs) → LivingCostPlan
                   (integer minor units; 5% contingency; insufficient_data
                   instead of guesses; visa minimums stay regulatory-only)
  recommendations.ts  buildRecommendations() — sourced alternatives only
  toObligations.ts    planToObligations() / describePlanRevert()
        │
        ├─► src/lib/tools/buildLivingCostPlan.ts — the build_living_cost_plan
        │   tool (requiresApproval=false). Handler calls buildLivingCostPlan()
        │   directly; returns the structured plan + validated inputs +
        │   recommendations + accommodation options + source evidence.
        │   Registered in TOOLS → loadRegistry() → getModelTools().
        │
        ├─► src/components/results/LivingCostPlan.tsx — the living_cost_plan
        │   result component. Every assumption control (accommodation, cooking
        │   habit, transport, monthly budget) re-runs buildLivingCostPlan()
        │   client-side via the same pure import. Compare view (original vs
        │   adjusted) + reset. pickComponent() routes any tool name matching
        │   /living.?cost|budget/ here — never to the generic action plan.
        │
        └─► src/lib/budgetApply.ts — applyBudgetToTask() / revertBudgetFromTask()
            convert the ACCEPTED plan via planToObligations() into
            ObligationSchema records (status "planned", "estimated budget
            item, not a committed bill" notes, tuition excluded unless
            explicitly included), append them to the task's workingPlan
            (TaskState.workingPlan; seeded from the sample student plan when
            empty — documented demo behaviour), and re-run buildForecast so
            the UI shows the new projected minimum balance / gap. Revert
            removes exactly the describePlanRevert ids that are still
            "planned" (committed/paid records are never touched) and
            recalculates. Served by POST /api/agent/budget-apply and
            POST /api/agent/budget-revert; both routes require an explicit
            action acknowledgment, and the component asks for confirmation
            before applying or reverting.

Demo wiring: runDemoFlow() (no provider credentials) calls
executeToolCall("build_living_cost_plan", DEMO_SAMPLE_ARGS) through the real
registry, verifies by deterministic re-run, and returns the living_cost_plan
component with demoMode:true. The hidden __ping tool is not used in the demo
path.
