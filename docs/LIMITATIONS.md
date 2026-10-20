# StudyRunway — Limitations (what this product does NOT do)

Honest boundaries, so nobody mistakes the demo for more than it is.

## Data & liveness

- **Wise preview is optional and indicative.** When enabled, the result card
  fetches a fresh Wise display quote. It is not rate-locked, cannot be used to
  create a transfer, may not include receiving-bank/intermediary deductions,
  and requires confirmation before a financial decision. The chat
  `compare_transfers` tool still uses sample/reference data. The planning
  engine's FX table remains based on caller-supplied assumptions.
- **Policy research needs Vertex AI ADC and Search grounding.** `research_policy`
  uses Vertex Gemini with Google Search grounding when configured. It requires
  country context and, for tuition/instalment/scholarship questions, the named
  university or awarding body. It withholds the answer if citations are missing
  or a returned source fails the official-domain check. This integration has
  been exercised against the configured project: on 2026-10-16, Google Search
  reported three queries but returned no cited pages, so the app withheld the
  answer. Check the project's Search grounding availability and Google Search
  Suggestions settings, then rerun `npm run verify:live-ai`. Domain recognition
  is conservative and unusual official domains may need to be confirmed.
- **No transfer booking or payments.** Wise can provide an indicative quote
  preview when enabled, but the app never claims a transfer was sent, initiated,
  or rate-locked. Other provider quotes entered by the user are not independently
  checked. `draft_email` drafts only — sending is not implemented. Payment
  execution is intentionally not connected to a provider.
- **Reminders are browser-local.** They are stored on this device and can send
  generic browser alerts while StudyRunway is open and notification permission
  is granted. There is no background push delivery after the app is closed and
  no cross-device sync.
- **Wise Platform onboarding is external.** The opt-in Wise quote preview uses
  standard indicative pricing. Wise partner-specific pricing needs OAuth client
  credentials and mTLS, which are not implemented. Other providers' live FX
  margins, recipient charges, delivery estimates, and limits still require
  manually entered offers. The World Bank's Q3 2025 average is only a
  period-labeled benchmark, never a quote.

## Model & providers

- **No provider credentials in this environment → demo mode.** Without
  the xAI, AI Studio Gemini, OpenAI, or Anthropic API key, or a Vertex AI
  project with Google Cloud ADC, the loop runs the
  labelled demo flow: the chat offers a **"Try the sample student budget"**
  entry point that executes the REAL deterministic budget engine
  (`build_living_cost_plan`, via the real tool registry and `executeToolCall`)
  on a source-backed sample case (Limerick, Ireland — €900/mo, shared
  accommodation) and renders the real interactive `living_cost_plan`
  component. The UI explicitly identifies demo mode; technical execution
  events remain in the tool activity panel rather than being narrated as
  model reasoning. The old `__ping` self-check is not used for the sample
  budget result.
- **Provider adapters have limited live validation.** Vertex ADC was selected
  and a finance clarification succeeded in a live request on 2026-10-16; a
  separate attempt returned malformed JSON after retry. Run
  `npm run verify:live-ai` with valid ADC credentials to check the current
  project, model, and Search grounding behavior before relying on them.
- **Gemini model reference.** The configured Gemini default (`gemini-3.8-flash`)
  matches Google's current OpenAI-compatibility example as checked on
  2026-10-16. Availability and quotas can still differ by account. xAI,
  OpenAI, and Anthropic users should set provider-specific model IDs that are
  available to their accounts.

## Destination budget planner — honest boundaries

- **No FX guessing at apply time.** An accepted budget whose currency
  differs from the working plan's planning currency cannot be included in the
  numerical forecast until the user supplies a positive rate with source and
  date. Without it, the app refuses to mark the budget as applied to the
  forecast. Undated one-time costs remain incomplete even after currency
  conversion; they need their own user-confirmed due dates.
- **Dataset gaps are shown, not filled.** Canada has no typical-cost data,
  so it always renders "We can't build a reliable budget yet" with the
  what's-missing list; the visa regulatory minimum is never presented as
  a budget line. Visa requirements are regulatory minimums and sit below
  realistic typical costs — the card says so explicitly.
- **Assumption controls re-run the engine, not a copy of it.** The card
  imports the same `buildLivingCostPlan` the server uses. Where the dataset
  has no sourced lifestyle-specific price split, preferences are not assigned
  invented savings. Users can enter their own monthly food or transport
  estimates; these replace the corresponding reference line and are clearly
  labelled as unsourced assumptions.

## Sessions & storage

- **In-memory server sessions.** Task state lives in a process-local Map:
  restarting the server loses it and it is not shared between instances.
  Google OAuth sign-in and server-side route checks are implemented, and
  internal task keys are scoped to the authenticated Google identity. OAuth
  credentials must be configured before sign-in is available. The app still
  has no database or cross-device sync, so task state disappears on restart.
- **Client transcripts and reminders in localStorage only** (`studyrunway.*`
  keys, namespaced by an opaque hash of the signed-in account). They are not
  encrypted or synced. Clearing browser data or switching devices loses them.
  "Delete my data" wipes the active account's StudyRunway keys on that device.

## Engine & documents

- **Forecasts are deterministic projections, not predictions.** They compute
  exactly what the plan's dated records imply; they know nothing about the
  real world beyond what was entered.
- **Document extraction is heuristic** (pattern-based amounts/dates from
  text), not semantic understanding. The full document is extracted on-device;
  only up to 16 amount/date candidates and short source excerpts are sent for
  review. Common direct identifiers are redacted from excerpts. Unconfirmed
  `document_review` result cards are excluded from transcript localStorage;
  confirmed values may appear in the conversation. Ambiguous candidates need
  confirmation and nothing is auto-accepted into the plan. Injection checks
  are pattern-based; a paraphrased or non-English instruction could pass.
- **Assumptions are labelled, not verified.** Anything the engine had to
  assume is listed in `assumptionsUsed`/assumption cards and can be corrected
  in the UI — corrections re-run the analysis.

## Evaluation scope

- The §11 eval suite (`tests/eval/`) drives the **real** orchestrator, tools,
  and engine, but its loop-level scenarios (7, 11, 12) use a **scripted
  provider**, not a live model. They evaluate loop mechanics
  (pause/resume, retries, chaining, verification) — never live-model quality.
- GitHub Actions runs deterministic feature evaluations, typechecking, and
  lint on pushes and pull requests. It does not run an authenticated Vertex
  request; live provider behavior still needs a manual configured-project check.
- E2E tests in `chat.spec.ts` / `interaction.spec.ts` run against **mocked
  SSE** shaped to the event contract (the visualizer suite replays real
  events through the real bus). The budget-planner suite is the exception:
  6 of its 7 specs hit the real routes with the real deterministic engine
  and no mocks; only the Canada insufficient-data spec mocks the SSE
  transport, with its payload built by the real engine.

## Not production-ready

Google OAuth requires environment configuration; rate limiting is demo-grade
(in-memory, per-IP) and only on selected routes, and there is no durable
student-session store. Privacy-limited audit events can be
written directly to Cloud Logging when `STUDYRUNWAY_AUDIT_STORE=cloud-logging`
and the runtime service account has `roles/logging.logWriter`; storage
retention and access controls follow the Google Cloud project configuration.
There is no accessibility audit beyond
keyboard/reduced-motion E2E coverage, and the residual risks listed in
`SECURITY_SELF_ASSESSMENT.md` §11 still apply.
Built for the FinTechathon demo and judging criteria — harden before any
real-user launch. This document claims no production readiness and no
certification.
