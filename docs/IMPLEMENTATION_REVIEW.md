# StudyRunway — Implementation Review (PART A)

Inspection of `studyrunway-agent/` as of 2026-10-15. Written by the
implementation-review pass. Every claim below was read from the file cited —
no inferred filenames.

## 1. Current architecture

### 1.1 Orchestrator loop (`src/lib/agent/orchestrator.ts`)

`runAgent({ sessionId, message, provider, tools, signal, toolTimeoutMs, maxToolCalls })`
is an async generator yielding typed `AgentEvent`s. Phases in order:

1. **Validate** — sessionId present/≤128 chars, message truncated to 4000,
   abort check.
2. **Understand** — `askModelJson()` asks the provider for
   `{ summary, keyFacts, assumptions, missingInfo, currencies, questions[] }`
   validated against `ModelUnderstandingSchema` (one correction retry; failure
   → recoverable `error` event, task `failed`). Non-empty `questions` → emit
   `clarify`, status `clarifying`, generator **returns** (paused).
3. **Plan** — model returns `{ steps: [...] }` (2–6 steps) validated by
   `ModelPlanSchema`; steps rendered to the user as an `assistant_text`.
4. **Call tools** — up to `MAX_MODEL_ROUNDS = 3` model turns (`runModelFlow`),
   each turn may request tool calls. Every requested name is resolved via
   `findTool()` against the allow-list **before** args parsing; an unknown
   name is never executed — a refusal string is appended to the model
   conversation instead.
5. **Verify** — the last successful data-producing tool call is re-executed
   with the exact validated args stored server-side in the call record
   (`ToolCallRecordSchema.args`, never sent to client or provider); summaries
   are compared. Match → `verified: true`; mismatch → figures flagged
   provisional.
6. **Outcome** — model composes a verdict-first summary (≤150 words, every
   figure from tool results), then a `result` event with
   `{ summary, verified, verifyNote, evidence, assumptions, toolCalls }`.

Failure discipline: arg validation errors, timeouts, and tool errors become
`tool_call_end` with `ok: false` — never a fabricated success. One retry on
transient failures (`isTransientError`: HTTP 429/5xx via `HttpError`, or
`timed out | fetch failed | network | econnreset | socket hang up`). One
replan after a fully failed tool round, then stop.

### 1.2 Tool registration path (end to end)

```
src/lib/agent/tools.ts          — ToolDefinition contract (canonical):
                                    name, description, parameters (zod),
                                    requiresApproval, handler(args, ctx) → ToolResult
src/lib/tools/<toolName>.ts    — each tool implements ToolDefinition
                                  (e.g. analyzeFundingGapTool in
                                  src/lib/tools/analyzeFundingGap.ts)
src/lib/tools/types.ts          — re-exports the contract (local import point)
src/lib/tools/index.ts          — TOOLS: ToolDefinition[] (7 entries) + named re-exports
src/lib/agent/registry.ts       — loadRegistry(): dynamic-imports @/lib/tools
                                  and prepends hidden __ping test tool;
                                  getModelTools() filters out __ping/__*;
                                  findTool() resolves names at runtime
src/lib/agent/orchestrator.ts   — executeToolCall() validates args against
                                  tool.parameters (ArgsValidationError on
                                  failure) → withTimeout (15s default) → one
                                  transient retry; recordToolCall()/addEvidence()
```

Only `getModelTools()` output is exposed to the model; `__ping` is excluded.

### 1.3 Validated args

- Model-side args arrive as a JSON string (`ToolCallRequest.arguments`);
  `runModelFlow` does `JSON.parse` in try/catch — unparseable → refusal, no
  execution.
- `executeToolCall()` runs `tool.parameters.parse(rawArgs)` **before** the
  handler runs; the validated object (not the raw args) is passed to the
  handler, and a copy is stored in the tool-call record's `args` field for the
  verification re-run.
- Financial tools additionally re-validate domain data with
  `ToolPlanSchema` (from `src/lib/tools/common.ts`) and the `model.ts` zod
  schemas (`FundingSourceSchema`, `ObligationSchema`, `FxTableSchema`).

### 1.4 Result-event schema

`AgentEventSchemas` (zod, in `src/lib/agent/orchestrator.ts`) is the wire
contract for all 7 event types; the `result` schema pins
`component` to a 6-member enum:

```
financial_outcome | transfer_comparison | scenario_comparison |
action_plan | document_review | draft_email
```

`ResultComponent` (TS union) mirrors it. Component selection is
`pickComponent()` — a regex over the joined tool-call names:
`transfer|quote|\bfx\b` → transfer_comparison; `scenario|what.?if` →
scenario_comparison; `forecast|runway|funding` → financial_outcome;
`email|draft` → draft_email; `document|evidence|extract` → document_review;
default → action_plan. **It is heuristic, not declarative — a new tool's name
must match one of these patterns or the regex set must be extended.**

### 1.5 Result-card rendering

- `src/app/api/agent/chat/route.ts` streams `data: <json>\n\n` SSE.
- `src/components/chat/sse.ts` parses SSE client-side;
  `src/components/chat/ChatWorkspace.tsx` publishes **every** received event
  to the event bus (`publishAgentEvent(e)` from `src/lib/events.ts`) and
  appends `{ component, data }` results to its results list.
- `src/components/results/index.tsx` (`ResultCard`) switches on
  `component` → `FinancialOutcome | TransferComparison | ScenarioComparison |
  ActionPlan | DocumentReview | DraftEmail`, with a JSON-dump fallback for
  unknown values. `TITLES` maps component → header title.
- `FinancialOutcome` exposes assumption-correction: a "Correct" button posts
  a follow-up chat message, re-running the analysis.

### 1.6 Deterministic calculation engine (`src/lib/`)

- `model.ts` — domain zod schemas (`ObligationSchema`, `FundingSourceSchema`,
  `FxTableSchema`, `EvidenceFactSchema`, `TransferQuoteSchema`,
  `ScenarioSchema`, `PlanStateSchema`), all amounts in **integer minor units**
  (`minorInt`), dates as `ISO_DATE` (`YYYY-MM-DD`).
- `money.ts` — minor-unit conversion/rounding; `forecast.ts` —
  `buildForecast(state)` (inflows/outflows sorted date-asc, inflows first;
  FX via `resolveRate()` with derived-inverse flagging; unconvertible items
  → `incomplete[]`, never invented rates); `gapRoles()` — event-level gap
  causality (`opens | reopens | widens | reduces`); `transfers.ts` —
  `rankQuotes()` (reference estimates only, deadline-aware, missing fees
  excluded from ranking); `scenarios.ts` — `applyScenario()` /
  `diffForecasts()` on a deep-copied plan; `runReliabilityBattery()`;
  `extract.ts` — heuristic document extraction; `sample.ts` — sample plan/quotes.
- Tools compute; the model interprets. `withToolTimeout` (`common.ts`) enforces
  the 15 s internal handler discipline.

### 1.7 SSE handling

- Server: `src/app/api/agent/chat/route.ts` (POST → `text/event-stream`,
  DELETE → session removal). `req.signal` aborts the loop; stream ends
  silently on abort.
- Client: `src/components/chat/sse.ts` (parser + unit tests
  `sse.test.ts`); `ChatWorkspace` streams via `AbortController` (Stop button).
- Types mirrored in `src/lib/events.ts` (`AgentStreamEvent`) for the event
  bus shared with the 3D visualizer.

### 1.8 Approval gates

- Any tool with `requiresApproval: true` (currently only `draft_email`)
  pauses the loop with a `clarify` event carrying an Approve/Deny `form`
  question. `submitAnswers()` in the orchestrator (via
  `POST /api/agent/answer`) queues the call in `approvedCalls[]` on
  `{ decision: "approve" }`; a deny records the denial and resumes planning.
- `draft_email` drafts only — sending is not implemented; no tool in the
  registry can move money, submit payments, or contact anyone.

### 1.9 Session / persistence model

- **Server:** `src/lib/agent/state.ts` — a process-local
  `Map<string, TaskState>` keyed by sessionId. `createTask` / `getTask`
  (re-validates with zod on every read) / `updateTask` / `deleteSession` /
  `clearStore` (tests). Lifetime: **per-process only** — server restart loses
  everything; no DB, no cross-instance sharing.
- Session IDs are **client-supplied** (not authenticated, not server-issued).
  `DELETE /api/agent/chat?sessionId=...` removes a session.
- Model output may only write whitelisted fields (`applyModelUnderstanding`,
  `applyModelPlan`); `taskId`, `toolCalls`, `evidence`, `approvals`,
  `pendingApproval`, and status transitions are orchestrator-only.
- **Client:** transcripts persist in `localStorage` under the `studyrunway.`
  prefix (`studyrunway.chat.<sessionId>`, `studyrunway.last-session` —
  `src/components/chat/persist.ts`). "Delete my data" wipes all
  `studyrunway.*` keys.
- **Note:** `src/lib/agent.ts` (the legacy rule-based "Evidence-Based Action
  Agent") is **dead code** — nothing imports it. The live path is
  `src/lib/agent/*` only.

### 1.10 Provider adapters (`src/lib/providers/`)

- `Provider` interface (`types.ts`): `chat(messages, toolSchemas) →
  { text, toolCalls, stopReason }`.
- Adapters: `xai.ts` (primary, OpenAI-compatible `/chat/completions`,
  default model `grok-4.7` — **unverified** against a live account),
  `openai.ts`, `anthropic.ts` (messages API with tool_use blocks).
  `selectProvider()` (index.ts) picks xAI → OpenAI → Anthropic by which
  `*_API_KEY` env var is set; null when none. Keys are server-side only;
  `/api/agent/status` returns only provider/model/label (never keys).
- Zod schemas are converted to JSON Schema for providers by
  `zodjson.ts` (`toJsonSchema`).

### 1.11 Demo flow (`runDemoFlow` in `orchestrator.ts`)

Runs when `selectProvider()` returns null (no provider key). It uses the
**real registry and real `executeToolCall` path** but is scripted:

1. First call: sets `userGoal` from the message, emits two scripted
   `clarify` questions (`demo_focus`: Runway forecast/Transfer quotes/
   What-if scenario; `demo_currency`: GBP/USD/BDT/EUR), then returns paused.
2. On resume (`/api/agent/answer`): emits a scripted 3-step plan, runs a
   `__ping` self-check via `executeToolCall`, then a verification re-run of
   the same `__ping` call and compares outputs deterministically.
3. Final `result` uses component `action_plan` with `data.demoMode: true`.

**Every user-visible string is prefixed with
`"Demo mode — no model provider configured"`** (`DEMO_LABEL`). It never
claims model reasoning. Weakness (target of the next phase): it only runs the
`__ping` self-check — no real financial tool, no real financial result
component.

## 2. Exact extension points for the next phase

To add a **new tool** (`build_living_cost_plan`) + **new interactive result
component** (`living_cost_plan`):

1. **Tool implementation** — new file `src/lib/tools/buildLivingCostPlan.ts`
   exporting `buildLivingCostPlanTool: ToolDefinition` conforming to the
   contract in `src/lib/agent/tools.ts`. Reuse `ToolPlanSchema` /
   `assemblePlanState` / `withToolTimeout` / `zodIssues` from
   `src/lib/tools/common.ts`. Keep all arithmetic in integer minor units via
   `src/lib/money.ts`; never invent figures.
2. **Tool registration** — append the tool to `TOOLS` and the named exports
   in `src/lib/tools/index.ts`. `src/lib/agent/registry.ts`
   (`loadRegistry()`) picks it up automatically; `getModelTools()` exposes it
   to the model unless its name starts with `__`. Add a fake-tool case in
   `src/lib/agent/__tests__/registry.test.ts` if needed.
3. **Result-component union** — add `"living_cost_plan"` to the
   `ResultComponent` union and to `AgentEventSchemas.result`'s `z.enum` in
   `src/lib/agent/orchestrator.ts`.
4. **Component selection** — extend `pickComponent()` in the same file: e.g.
   match `/living|cost.?of.?living|budget/.test(names)` → `living_cost_plan`.
   Without this, a `build_living_cost_plan` call would fall through to
   `action_plan` (no "budget" pattern exists today).
5. **UI registration** — `src/components/results/index.tsx`: import the new
   component, add a `TITLES` entry, and add a `switch` case in `ResultCard`.
   Create the component file `src/components/results/LivingCostPlan.tsx`
   following the existing interactive pattern (`FinancialOutcome` shows
   assumption-correction via `onCorrectAssumption` → `onFollowUpMessage`).
6. **Wiring check** — `AgentStreamEvent` in `src/lib/events.ts` is a plain
   string `component`, so it needs no change; the wire is validated by
   `AgentEventSchemas` and asserted by `src/lib/events.test.ts`,
   `src/components/chat/sse.test.ts`, and the E2E suites.

## 3. How the forecast engine consumes obligations

`buildForecast(state: PlanState)` iterates `state.obligations`
(`src/lib/forecast.ts`, "Obligations" section):

- `ObligationSchema` (`src/lib/model.ts`): `id: string`;
  `label: string (1–120)`; `kind: z.enum(OBLIGATION_KINDS)` where
  `OBLIGATION_KINDS = ["tuition", "deposit", "rent", "living", "travel",
  "visa", …]`; `amountMinor: minorInt | null` (integer minor units);
  `currency: currencyCode` (3-letter, validated against supported currencies);
  `dueDate: ISO_DATE | null` (`YYYY-MM-DD`); `recurring: { everyMonths:
  1–12, occurrences: 2–60 } | null`; `status: z.enum(["planned",
  "committed", "paid"])`; `notes: string`; `evidenceIds: string[]`.
- Semantics: `status === "paid"` → skipped entirely (not in the forward
  forecast). `amountMinor == null` → `incomplete[]` ("Amount is unknown").
  Negative amount → `incomplete[]`. Missing `dueDate` → `incomplete[]`.
  Missing FX pair → `incomplete[]` (never invents a rate).
- Each obligation becomes one outflow event per `expandRecurring()` occurrence
  (id `${o.id}@${occ.date}`, label suffixed `(n/m)` when multiple),
  `amountMinor` negative, `certainty: "confirmed"`, with `fxPair`/`fxRate`/
  `fxDerived` recorded and every assumption added to `assumptionsUsed`.
- Events sort date-ascending (inflows before outflows on the same day), then
  accumulate `balanceAfterMinor`; `firstGap` and `gapRoles()` derive gap
  causality from these rows.

## 4. Current risks / limitations

1. **Process-local `Map` session state** (`src/lib/agent/state.ts`) — lost on
   restart; no cross-instance or cross-device sharing; no durability.
2. **Client-supplied session IDs, no auth** — any caller can pick a sessionId;
   a guessed ID exposes another session's task state. Acceptable for a
   competition demo; not production.
3. **No rate limiting on API routes** — `/api/agent/chat` runs the full model
   loop per request; expensive/abuse risk.
4. **PII handling** — `sanitizeForModel()` redacts emails and phone-like
   numbers only; account numbers / national IDs in pasted documents are NOT
   redacted before provider calls.
5. **Pattern-based document-injection filtering** — `extractDocument`
   (`src/lib/tools/extractDocument.ts`) screens with 12 regexes; paraphrased
   or non-English injections can pass. Backstops: system prompt, allow-list,
   approval gates.
6. **Unverified live provider behavior** — all adapters tested against mocked
   HTTP; `grok-4.7` model ID unverified against a live account in this
   environment.
7. **Historical baseline: weak no-key demo flow** — this issue was identified
   during initial review. The current patched `runDemoFlow` executes the real
   `build_living_cost_plan` tool and renders its result with a deterministic
   demo label; current runtime verification remains blocked by npm registry DNS.
8. **`research_policy` is an honest stub** (returns `answer: null`,
   "unverified — user must confirm") — cannot verify policy claims.
9. **`npm audit` remains unverified for the patched release** — npm registry DNS
   returned `EAI_AGAIN registry.npmjs.org`; rerun on a network-enabled machine.
10. **Dead code:** `src/lib/agent.ts` is not imported anywhere.

## 5. Changes planned for the next phase

1. **New tool + interactive component:** `build_living_cost_plan`
   (source-attributed cost dataset for ≥4 destinations — Ireland, Germany,
   Denmark, UK; deterministic budget engine; explicit user approval before
   feeding its output into the funding-gap forecast; revert path), with a
   `living_cost_plan` interactive result component (interactive assumption
   controls) registered at all six wiring points in §2.
2. **No-API-key demo flow fix:** run the REAL deterministic budget engine
   (and/or existing financial tools) in demo mode and render the real result
   component — honestly labelled `DEMO_LABEL`, with no second divergent
   implementation that could drift from the real one.
3. **Security mitigations:** document session/privacy risks (process-local
   state, client-supplied session IDs, no auth, no rate limiting, PII
   redaction scope) and apply mitigations within what a competition demo can
   support; keep prompt-injection handling pattern-based with the existing
   allow-list/system-prompt/approval backstops, extended if needed.
4. **Verification:** full test + verified release as
   `StudyRunway_FinTechathon_2026_BudgetPlanner.zip`.
5. All prior builds (`FINAL.zip`, `UX_Redesign.zip`, `AGENT.zip`) remain
   shelved as fallback; the sibling `studyrunway/` directory is untouched.
