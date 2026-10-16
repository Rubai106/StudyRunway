# StudyRunway — Limitations (what this product does NOT do)

Honest boundaries, so nobody mistakes the demo for more than it is.

## Data & liveness

- **No automatic live FX or transfer feed.** The engine converts currencies
  with caller-supplied FX assumption tables. `compare_transfers` uses the
  engine's **sample/reference quotes only** — every figure is labelled
  `"reference estimate — not a live quote"`, the quote timestamp is
  `"sample data"`. The result card can compare quote details the user enters
  manually, including fee handling, recipient charges, quote date, delivery
  window, and send limits; it cannot verify those entries or refresh them.
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
- **No provider-fed quotes, booking, or payments.** The tool compares reference
  quotes, and the result card can compare current quote details entered by the
  user; those entries are not independently checked. The app never claims a
  transfer was sent, initiated, or locked in. `draft_email` drafts only —
  sending is not implemented. Payment execution is intentionally not connected
  to a provider.
- **Reminders are browser-local.** They are stored on this device and can send
  generic browser alerts while StudyRunway is open and notification permission
  is granted. There is no background push delivery after the app is closed and
  no cross-device sync.
- **Transfer provider remains unselected.** The app cannot fetch live FX
  margins, recipient charges, delivery estimates, or provider limits. Manually
  entered quotes stay in the current result view and are not independently
  validated. The World Bank's Q3 2025 average is shown only as a period-labeled
  benchmark, never as a quote.

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
  There is no database, no login, and no cross-device sync. Session IDs are
  generated with browser `crypto.randomUUID()` where available and validated,
  but they are still client-supplied bearer identifiers rather than authenticated
  ownership. A party who learns a valid session ID may be able to access its
  state. Origin checks mitigate browser CSRF but do not replace authentication.
  Do not deploy this demo for real sensitive financial records without adding
  proper authentication and per-session ownership controls.
- **Client transcripts and reminders in localStorage only** (`studyrunway.*`
  keys). Clearing browser data or switching devices loses them. "Delete my
  data" wipes the app's keys on that device only.

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

No auth, demo-grade (in-memory, per-IP) rate limiting only on the chat route,
and no durable audit store. The server emits privacy-limited JSON audit events
to stdout; production retention and access controls require a configured log
sink such as Cloud Logging. There is no accessibility audit beyond
keyboard/reduced-motion E2E coverage, and the residual risks listed in
`SECURITY_SELF_ASSESSMENT.md` §11 still apply.
Built for the FinTechathon demo and judging criteria — harden before any
real-user launch. This document claims no production readiness and no
certification.
