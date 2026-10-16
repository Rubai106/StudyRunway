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
5. **Verification** — the orchestrator independently re-executes the last
   successful data-producing tool call with the exact validated args captured
   server-side at execution time, and compares summaries. Match → `verified:
   true`; mismatch → figures are flagged provisional.
6. **Outcome** — the model composes a verdict-first summary (every figure must
   come from tool results), then a `result` event carries the structured
   component payload, evidence, assumptions, and the tool-call log.

Failure handling: arg validation errors, timeouts, and tool errors become
`tool_call_end` events with `ok: false` — never a fabricated success. One
retry is allowed on transient failures (HTTP 429/5xx, timeouts, network
resets). Model-level failures (unparseable JSON after a correction retry,
provider errors) emit a recoverable `error` event and mark the task `failed`.
Approval gates (`requiresApproval: true`, currently only `draft_email`) pause
the loop with a `clarify` event carrying an Approve/Deny form; the call runs
only after an explicit "approve" via `/api/agent/answer`. Client abort (Stop
button → `AbortSignal`) ends the stream quietly mid-phase.

## 2. Task state model (`src/lib/agent/state.ts`)

Per-session `TaskState`, kept **in memory on the server** (a `Map`; no DB):

- `userGoal`, `status` (`planning | clarifying | executing | verifying | done | failed`)
- `confirmedFacts[]` (source-tagged; only from user answers, never invented)
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

## 3. Provider adapters (`src/lib/providers/`)

`Provider` interface: `chat(messages, toolSchemas) → { text, toolCalls,
stopReason }`. Adapters: **xAI (Grok, primary)** via the OpenAI-compatible
`/chat/completions` wire format, **OpenAI**, **Anthropic** (messages API with
tool_use blocks). `selectProvider()` picks xAI → OpenAI → Anthropic by which
`*_API_KEY` env var is set; returns `null` when none is configured. All JSON
parsing of model output goes through `zodjson.ts` (strip code fences, one
correction retry). **API keys live only in server-side env vars**; the
frontend never sees them (the status endpoint returns the literal string
`"<redacted>"` for the Authorization header in tests, and the real adapters
never log keys).

> Provider model IDs are placeholders in this repo (`.env.example` uses
> `PLACEHOLDER`); the default xAI model id in code is `grok-4.7`, unverified
> against a live account in this environment.

## 4. Tool registry (`src/lib/agent/registry.ts`, `src/lib/tools/`)

- The registry merges a hidden `__ping` self-test tool (used by agent-core
  tests and demo mode; **excluded from `getModelTools()`** so the model never
  sees it) with the seven financial tools in `src/lib/tools/TOOLS`:
  `analyze_funding_gap`, `compare_transfers`, `extract_document`,
  `simulate_scenario`, `research_policy` (honest no-live-data stub),
  `build_action_plan`, `draft_email` (requires approval; draft only, never sends).
- Every tool satisfies the `ToolDefinition` contract (`src/lib/agent/tools.ts`):
  zod `parameters` schema, `handler(args, ctx) → ToolResult`, `ok / summary /
  data / evidence`. Args are validated **before** the handler runs
  (`executeToolCall`); a tool never sees invalid input.
- The tools compute; the model interprets. All figures come from the
  deterministic engine in minor units (`money.ts`, `forecast.ts`,
  `transfers.ts`, `scenarios.ts`, `extract.ts`): no tool invents financial
  figures, rates, or quotes.
- `compare_transfers` compares the engine's **sample/reference quotes only**;
  every figure is labelled `"reference estimate — not a live quote"`, the
  quote timestamp is `"sample data"`, missing fees are never treated as zero
  (such quotes are excluded from ranking), and ranking follows the caller's
  objective (`min_total_cost | fastest | balanced`) while quotes that would
  miss the deadline are excluded with a reason.

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
| `result` | `{ component, data }` — components: `financial_outcome \| transfer_comparison \| scenario_comparison \| action_plan \| document_review \| draft_email` |
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

When `selectProvider()` finds no API key, `runAgent` runs `runDemoFlow`
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

- Server task state: in-memory only, per process. Restarting the server loses
  it; there is no database, no cross-device sync.
- Client: transcripts persist in `localStorage` under the `studyrunway.`
  prefix (`studyrunway.chat.<sessionId>`, `studyrunway.last-session`). "Delete
  my data" (header button + mobile link, with a confirm dialog) calls
  `wipeStudyRunwayData()`, which removes **every** `studyrunway.*` key and
  starts a fresh session.
- Documents uploaded for `extract_document` are processed in memory and are
  not retained beyond the session state.

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
            POST /api/agent/budget-revert; the component requires explicit
            user confirmation (approval-gate UX pattern) before calling apply.

Demo wiring: runDemoFlow() (no provider key) calls
executeToolCall("build_living_cost_plan", DEMO_SAMPLE_ARGS) through the real
registry, verifies by deterministic re-run, and returns the living_cost_plan
component with demoMode:true. The hidden __ping tool is not used in the demo
path.
