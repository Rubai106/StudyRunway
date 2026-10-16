# StudyRunway — Limitations (what this product does NOT do)

Honest boundaries, so nobody mistakes the demo for more than it is.

## Data & liveness

- **No live FX rates.** The engine converts currencies with caller-supplied FX
  assumption tables. `compare_transfers` uses the engine's **sample/reference
  quotes only** — every figure is labelled `"reference estimate — not a live
  quote"`, the quote timestamp is `"sample data"`. There is no rate feed and
  no quote API integration.
- **No live policy research.** `research_policy` is an explicit honest stub:
  it always returns `answer: null` with an `"unverified — user must confirm"`
  evidence label and generic source categories. It never fabricates a policy,
  deadline, or citation.
- **No live transfer quotes, no booking, no payments.** The tool compares
  reference quotes; it never claims a transfer was sent, initiated, or locked
  in. `draft_email` drafts only — sending is not implemented.

## Model & providers

- **No provider key in this environment → demo mode.** Without
  `XAI_API_KEY`/`GEMINI_API_KEY`/`OPENAI_API_KEY`/`ANTHROPIC_API_KEY` the loop runs the
  labelled demo flow: the chat offers a **"Try the sample student budget"**
  entry point that executes the REAL deterministic budget engine
  (`build_living_cost_plan`, via the real tool registry and `executeToolCall`)
  on a source-backed sample case (Limerick, Ireland — €900/mo, shared
  accommodation) and renders the real interactive `living_cost_plan`
  component. The UI explicitly identifies demo mode; technical execution
  events remain in the tool activity panel rather than being narrated as
  model reasoning. The old `__ping` self-check is not used for the sample
  budget result.
- **Provider adapters are tested against mocked HTTP only in this environment.**
  Live requests using a real account key have not been executed here. Before a
  demo, verify that the chosen key has access to the configured model and test
  at least one plain chat turn and one tool-calling turn.
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
- **Client transcripts in localStorage only** (`studyrunway.*` keys). Clearing
  browser data or switching devices loses them. "Delete my data" wipes the
  app's keys on that device only.

## Engine & documents

- **Forecasts are deterministic projections, not predictions.** They compute
  exactly what the plan's dated records imply; they know nothing about the
  real world beyond what was entered.
- **Document extraction is heuristic** (pattern-based amounts/dates from
  text), not AI understanding. Ambiguous candidates are flagged
  `needsConfirmation`; nothing is auto-accepted into the plan. The injection
  screen is pattern-based (12 regexes) — a paraphrased injection could pass
  it; the allow-list and approval gates are the backstops.
- **Assumptions are labelled, not verified.** Anything the engine had to
  assume is listed in `assumptionsUsed`/assumption cards and can be corrected
  in the UI — corrections re-run the analysis.

## Evaluation scope

- The §11 eval suite (`tests/eval/`) drives the **real** orchestrator, tools,
  and engine, but its loop-level scenarios (7, 11, 12) use a **scripted
  provider**, not a live model. They evaluate loop mechanics
  (pause/resume, retries, chaining, verification) — never live-model quality.
- E2E tests in `chat.spec.ts` / `interaction.spec.ts` run against **mocked
  SSE** shaped to the event contract (the visualizer suite replays real
  events through the real bus). The budget-planner suite is the exception:
  6 of its 7 specs hit the real routes with the real deterministic engine
  and no mocks; only the Canada insufficient-data spec mocks the SSE
  transport, with its payload built by the real engine.

## Not production-ready

No auth, demo-grade (in-memory, per-IP) rate limiting only on the chat route,
no audit logging, no accessibility audit beyond keyboard/reduced-motion E2E
coverage, and the residual risks listed in `SECURITY_SELF_ASSESSMENT.md` §11.
Built for the FinTechathon demo and judging criteria — harden before any
real-user launch. This document claims no production readiness and no
certification.
