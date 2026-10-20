# StudyRunway — model-driven AI financial agent

FinTechathon 2026 · International Track · Topic C (Cross-border & Student Finance).

This is a fresh rebuild. The old shelved build lives at
`../studyrunway/` (read-only reference — do not modify it from here).

## Stack

Next.js 15.5.28 (pinned) · React 19.1.0 · TypeScript 5.7.3 · Tailwind CSS 3.4 ·
vitest 3.2.7 · Playwright 1.64.1 · three 0.182 + @react-three/fiber 9.4.2 + drei 10.7.7
(3D tool visualizer) · zod 3.24.2 (domain validation) · pdfjs-dist (local PDF evidence
extraction) · sharp 0.35.5.

## What's here

- `src/lib/` — the deterministic financial engine copied verbatim from the old
  build: minor-unit money arithmetic (`money.ts`), currency registry
  (`currency.ts`), zod domain model (`model.ts`), funding-gap forecast engine
  (`forecast.ts`), evidence-apply workflow (`evidence.ts`), transfer quote
  comparison (`transfers.ts`), scenario/stress engine (`scenarios.ts`),
  evidence CSV/plan exports (`export.ts`), PDF/text evidence extraction
  (`extract.ts`), sample plan fixture (`sample.ts`), and the deterministic
  action-agent layer (`agent.ts`). No old UI components, pages, or routes were
  carried over — the chat-first UI is built fresh in a later workstream.
- `.env.example` — placeholders only; includes `AI_PROVIDER=gemini`,
  `GEMINI_API_KEY`, `GEMINI_MODEL`, and the Google AI Studio-compatible base URL,
  plus optional xAI, OpenAI, and Anthropic settings. Server-side adapters support
  xAI, Gemini, OpenAI, and Anthropic. No API key is included. Without a real
  configured provider key, the app uses the clearly labelled deterministic sample workflow.

## Commands

```bash
npm install      # or npm ci (package-lock.json is committed)
npm run dev      # next dev
npm run typecheck # tsc --noEmit
npm run lint     # eslint .
npm test         # vitest run (unit + eval suite)
npm run e2e      # playwright test (chromium desktop + mobile 390px)
npm run build    # next build
```

## Use Google AI Studio / Gemini

1. Copy `.env.example` to `.env.local` beside `package.json`.
2. Set `GEMINI_API_KEY` to your own key from https://aistudio.google.com/app/apikey.
3. Keep `AI_PROVIDER=gemini` and choose an available `GEMINI_MODEL` (default:
   `gemini-3.8-flash`). Leave other providers as `PLACEHOLDER` unless you intend
   to switch providers.
4. Restart `npm run dev`. The header must display `Google Gemini · <model>`.

Gemini is connected through Google's documented OpenAI-compatible endpoint for
chat completions and custom tool calls. Gemini-native tools such as Google Search
grounding are not provided by this compatibility adapter. API keys remain server-side.
See `docs/SETUP.md` for full instructions.

## Destination Budget Planner

The headline feature: a deterministic, source-attributed living-cost
engine for international students (`src/lib/livingCosts/`, dataset in
`docs/COST_DATASET.json` — researched costs for Ireland, Germany, Denmark,
UK, Australia; Canada is regulatory-minimum-only). The agent tool
`build_living_cost_plan` (registered in `src/lib/tools/`) renders the
interactive `living_cost_plan` result card: verdict, budget-vs-spending,
category breakdown with low/typical/high bands, adjustable assumptions
(accommodation, manually entered monthly food/transport costs, budget — each
supported change re-runs the real engine), sourced recommendations, visa requirements kept strictly
regulatory, and per-source freshness labels. With explicit confirmation the
plan converts to dated obligations (`/api/agent/budget-apply`) and feeds
the funding-gap forecast; `/api/agent/budget-revert` removes exactly what
was applied. See `docs/DESTINATION_BUDGET_DEMO.md` for the demo script,
`docs/DESTINATION_BUDGET_SPEC.md` for the engine spec, and
`docs/DESTINATION_BUDGET_RESEARCH.md` for the sources.

**Try it with no API key:** open the app, click **"Try the sample student
budget"** (welcome screen) — the demo runs the real engine on the verified
sample case (Limerick, Ireland — €900/mo, shared accommodation) through the
real tool path, honestly labelled. Or type any message and answer the
clarifying question it asks.

### Wise transfer quote preview

The transfer-comparison card can fetch an indicative Wise quote for display
when `WISE_QUOTES_ENABLED=true`. It shows the live rate, provider fees, payout
method, and ETA, and can add a selected option to the manual comparison. The
quote is not locked or executable, recipient-bank charges remain a separate
unknown, and other providers still require manually entered quotes. Wise quote
preview setup and Cloud Run instructions are in `docs/WISE_QUOTES_SETUP.md`.

## Judge-ready Funding Risk Agent (deterministic-first)

### Structured funding details

The Chat view also provides **Enter funding details**, an additive structured
form for multiple tuition/living costs and multiple savings, scholarship,
family, loan, or other funding sources. Each row retains its own amount,
currency, deadline, frequency, and availability status. Submission goes
directly to the validated `/api/agent/funding-check` route and the existing
deterministic forecast engine; it does not ask the model to parse financial
JSON and it never performs a transfer. Confirmed money, future confirmed
funding, and expected/unverified funding remain separate in the result.
After the deterministic result is shown, the form can request a separate
server-side explanation from the configured hosted Google Gemini/Vertex-Gemini
provider. The explanation receives a server-recomputed calculation summary,
cannot modify the result or trigger actions, and can be retried without
re-entering the form; if Gemini is unavailable, the deterministic result stays
visible. The submitted form also saves the same validated canonical plan to
the active agent session, so later scenario and recovery requests reuse the
baseline without asking the user to re-enter it.

StudyRunway now connects three deterministic capabilities into one workflow:

1. **Safe-to-Send** tuition decisioning (`READY_TO_SIMULATE`, `RISK_DETECTED`, `MORE_INFORMATION_REQUIRED`, `BLOCKED`)
2. **Funding Timeline** (expected/received/delayed/cancelled inflows + obligations + projected balance)
3. **Delay Recovery** (hypothetical delay/cancellation scenarios + earliest-shortfall + recovery assumptions)

Core implementation:

- Engine: `src/lib/safeToSend/engine.ts`
- Tool/actions + state transitions: `src/lib/tools/safeToSend.ts`
- API route: `src/app/api/agent/safe-to-send/route.ts`
- UI card: `src/components/results/SafeToSendDecision.tsx`

### Deterministic vs AI responsibilities

- **Deterministic server code (authoritative):** calculations, timeline projection,
  earliest-shortfall detection, Safe-to-Send status, stage transitions,
  approval validation, sandbox simulation apply/revert, and receipt export.
- **AI (optional):** natural-language understanding, clarification prompts,
  and explanation of deterministic outputs.

No AI response can authorize a simulation or override a decision status.

### Run the no-key demo (judge flow)

1. Open chat and click **Try the Safe-to-Send tuition demo**.
2. In the card, click **Load demo baseline**.
3. Review baseline timeline and earliest shortfall.
4. Apply **+7 days** delay on scholarship funding.
5. Review scenario shortfall and obligations at risk.
6. Apply a recovery assumption and recalculate.
7. Review **Why this decision?** and **Decision evidence**.
8. If status is `READY_TO_SIMULATE`, click **Approve and simulate**.
9. Review latest sandbox action and updated forecast impact.
10. Optionally **Revert latest simulation**.
11. Click **Download sandbox execution record** for a sanitized JSON receipt.

### Sandbox execution record export

- Endpoint: `GET /api/agent/safe-to-send?sessionId=...&simulationId=...&download=1`
- Returns only sanitized simulation/decision/forecast fields from recorded state.
- No API keys, secrets, or hidden prompts are included.

### Session and browser storage

On the configured Cloud Run deployment, authenticated agent task state is stored
in Firestore with request-level concurrency checks and expiry metadata. Local
development defaults to process-local memory unless the Firestore store is
configured. Browser-only transcripts, reminders, budgets, and preferences remain
in account-namespaced local storage on that device; they are not synced or backed
up to Firestore. See `docs/SETUP.md` and `docs/SECURITY_SELF_ASSESSMENT.md` for
the exact deployment boundary and remaining risks.

## Latest verification status — 2026-10-20

The latest successful GitHub Actions quality run on `main` is commit
`cbe0a31999b54d57299d4a49db2ef79f4b6ba184` ([workflow run](https://github.com/Rubai106/StudyRunway/actions/runs/39411467566)). It completed `npm ci`, typecheck, lint, unit/API tests (**390 tests across 38 files**), production build, and Playwright E2E (**66 passed in 1.6 minutes**). Older totals in the historical QA log are not current.

**Dependency risk remains open.** The latest CI install reported 15 dependency findings (1 moderate, 12 high, 2 critical). A Windows production-only audit on 2026-10-19 reported zero vulnerabilities, but that does not clear the full dependency tree. Do not run `npm audit fix --force` blindly; assess compatible updates and re-run checks after changing dependencies.

The submission's execution-evidence video records a separate local sandbox run at revision `e213b84272d98b03b51807bd1e416bc4f0ad0933` in demo mode. It is not evidence that the hosted app completed an authenticated transaction workflow. During the evidence review, the hosted app displayed a Google sign-in gate and anonymous agent API requests returned 401. The video and manifest make the environment and revision explicit; no real payment occurred.

For the submission checklist and the current evidence boundaries, start at `docs/FINTECHATHON_SUBMISSION_INDEX.md`.
