# StudyRunway — Setup & Run Guide

## Requirements

- **Node.js 20+** (`node --version` must be ≥ 20; the engine uses
  `crypto.randomUUID` and modern APIs).
- npm (ships with Node). `package-lock.json` is committed — use `npm ci` for
  reproducible installs.

## Install & run

```bash
cd studyrunway-agent
npm ci            # reproducible install from package-lock.json
npm run dev       # next dev → http://localhost:3000
npm run build     # production build
npm start         # serve the production build
```

## Environment variables (all optional)

Copy `.env.example` to `.env.local` and fill in **server-side only** values.
Never commit `.env.local`; never put these in client code.

| Variable | Purpose |
|---|---|
| `AI_PROVIDER` | Optional explicit provider selection: `demo`, `vertex`, `gemini`, `xai`, `openai`, or `anthropic`. This prevents a leftover key for another provider from taking precedence. |
| `AI_BACKEND` | Optional backend selector; `vertex-adc` selects Vertex AI with ADC and takes precedence over `AI_PROVIDER`. |
| `AUTH_MODE` | Vertex authentication mode. This integration supports `ADC`. |
| `VERTEX_AI_PROJECT` | Google Cloud project ID for Vertex AI. `VERTEX_AI_PROJECT_ID` and `GOOGLE_CLOUD_PROJECT` are accepted as fallbacks. |
| `VERTEX_AI_LOCATION` | Vertex AI location; defaults to `global`. `GOOGLE_CLOUD_LOCATION` is accepted as a fallback. |
| `VERTEX_AI_MODEL` | Vertex-hosted Gemini model; defaults to `google/gemini-3.5-flash`. Set a model enabled for your project. |
| `VERTEX_AI_RESEARCH_MODEL` | Native Gemini model for policy research with Google Search grounding; defaults to `gemini-2.5-flash`. |
| `GOOGLE_APPLICATION_CREDENTIALS` | Optional path to a service-account JSON credentials file. Local `gcloud` Application Default Credentials are also supported. |
| `GEMINI_API_KEY` | Google AI Studio API key. For the Google provider, use an API key created at https://aistudio.google.com/app/apikey. |
| `GEMINI_MODEL` | Gemini model ID available to your key; default is `gemini-3.8-flash` as listed in Google's current OpenAI-compatibility example. Verify model availability in your AI Studio/account if rejected. |
| `GEMINI_BASE_URL` | Defaults to `https://generativelanguage.googleapis.com/v1beta/openai/`. Custom values are accepted only for Google's HTTPS compatibility endpoint. |
| `XAI_API_KEY`, `XAI_BASE_URL`, `XAI_MODEL` | Optional xAI/Grok provider. |
| `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL` | Optional OpenAI or OpenAI-compatible provider. `OPENAI_BASE_URL` now honours the environment variable. |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | Optional Anthropic/Claude provider. |
| `STUDYRUNWAY_SESSION_STORE` | Session-store selector. `memory` is for local/dev only; production requires a supported shared adapter. The current build does not bundle a Firestore adapter and fails closed when production persistence is unavailable. |
| `STUDYRUNWAY_DEMO_MODE` | Set `true` only for an explicitly labelled demo deployment that accepts process-local in-memory sessions. It is not a durability or identity guarantee. |
| `WISE_QUOTES_ENABLED` | Set `true` only after confirming Wise Platform permits the app to show unauthenticated quote previews. Defaults to off. This adds indicative quotes only and never initiates a transfer. |
| `WISE_QUOTES_ENV` | `production` for current indicative quotes or `sandbox` for non-live test quotes. Defaults to production, but the Wise quote endpoint remains disabled until the flag is enabled. |

If `AI_PROVIDER` is set to a valid provider, StudyRunway uses only that provider; set it to `demo` to disable external model calls (as the browser tests do). It does not silently fall back to another configured provider. Without `AI_PROVIDER`, selection priority is xAI → Vertex AI → Gemini → OpenAI → Anthropic → demo mode. The header badge and `/api/agent/status` show the active provider honestly. The application does not silently fall back to another configured provider when `AI_PROVIDER` explicitly selects a provider that is missing required configuration.

### Google Vertex AI / Gemini setup

1. In your Google Cloud project, enable the Vertex AI API and billing, and grant the identity you will use the Vertex AI User (`roles/aiplatform.user`) role.
2. For local development, install the Google Cloud CLI and run `gcloud auth application-default login`. Alternatively, configure `GOOGLE_APPLICATION_CREDENTIALS` to a service-account JSON file stored outside the repository.
3. In `.env.local`, set `AUTH_MODE=ADC`, `AI_BACKEND=vertex-adc`, `VERTEX_AI_PROJECT` to your project ID, and `VERTEX_AI_LOCATION` to a supported location (the default is `global`). Optionally set `VERTEX_AI_MODEL`; the default is `google/gemini-3.5-flash`.
4. Restart `npm run dev`. The header should display `Google Vertex AI · <model>` when the provider is configured.

This uses the standard project-scoped Vertex AI OpenAI-compatible endpoint and Google Cloud Application Default Credentials. It does **not** use an AI Studio API key. Google documents the endpoint and authentication in [Vertex AI's OpenAI compatibility guide](https://cloud.google.com/vertex-ai/generative-ai/docs/start/openai). Keep credentials out of chat and source control.

Official policy research uses Vertex's native `generateContent` endpoint with Google Search grounding, separate from the OpenAI-compatible chat endpoint. Enable Vertex AI API/billing and Google Search suggestions for the project. Set `VERTEX_AI_RESEARCH_MODEL` to a Gemini model that supports Search grounding. Research needs a destination country; tuition, instalment, and scholarship lookups also need the university or awarding body. Returned claims include direct source pages and a checked-at timestamp. A result is withheld unless every returned source passes the app's official-domain check (`.gov`, recognized `.edu`/`.ac` domains, or a domain you provide). Google Search suggestions are displayed as returned by Vertex. Grounded Search has separate [Google Search grounding](https://cloud.google.com/vertex-ai/generative-ai/docs/grounding/grounding-with-google-search) and [Search suggestion display requirements](https://cloud.google.com/vertex-ai/generative-ai/docs/grounding/grounding-search-suggestions).

### Wise Platform quote preview

The transfer-comparison card can fetch a live indicative Wise quote when
`WISE_QUOTES_ENABLED=true`. It uses Wise's unauthenticated display endpoint;
the quote cannot create a transfer or lock a rate. Confirm Wise Platform's
terms/partner access before enabling production quotes. For Cloud Run, set the
two Wise environment variables on a new service revision as described in
[Wise quote preview setup](WISE_QUOTES_SETUP.md). Partner-specific pricing
and OAuth/mTLS credential handling are not implemented.

### Google AI Studio / Gemini setup

1. Copy `.env.example` to `.env.local` in the same folder as `package.json`.
2. Replace `GEMINI_API_KEY=PLACEHOLDER` with your real Google AI Studio key.
3. Keep `AI_PROVIDER=gemini` and set `GEMINI_MODEL` to a model supported by your account. Leave the unused provider keys as placeholders.
4. Save the file and restart `npm run dev`.
5. Confirm the header displays `Google Gemini · <model>` rather than `Demo mode`. Then test both ordinary chat and a workflow that invokes financial tools.

The provider uses Google's documented OpenAI-compatible endpoint and standard function calling. It does not implement Gemini-native-only tools such as Google Search grounding; those require a separate native Gemini API integration. Do not put your API key in React/client code or commit `.env.local`.

### Demo mode (no key configured)

If the header says **Demo mode**, real model reasoning is not enabled. Custom
requests (for example, a tuition-transfer recommendation) cannot be answered
by an AI model until provider credentials are configured. The sample budget
button runs only the deterministic living-cost demo. Copying `.env.example`
is not enough: replace its placeholders with valid credentials/configuration.

Without any key the agent runs its **explicitly labelled demo mode**: the
same structured loop (understand → clarify → plan → tools → verify →
outcome) executes with the real tools and the real deterministic engine, but
every user-visible string is prefixed
`"Demo mode — no model provider configured"` and the final result carries
`demoMode: true`. Demo mode never claims model reasoning happened. To get the
real thing: configure one provider in `.env.local` (for Vertex AI, set the project and ADC) and restart.

#### Running the Destination Budget Planner demo (no key needed)

1. `npm ci && npm run dev` (or `npm run build && npm start`), open the app.
2. On the welcome screen, click **"Try the sample student budget"**
   (subtitled "Limerick, Ireland — €900/mo · real budget engine, no AI key
   needed"). This sends the recognised sample message and runs the REAL
   `build_living_cost_plan` tool through the real `executeToolCall` path —
   no mocks, no second implementation.
3. You get the interactive budget card: the shortfall verdict
   (€1,503.78/mo typical vs €900/mo budget), the category breakdown with
   Low/Typical/High bands, "Ways to bring costs down", sources with
   checked-dates, and the visa requirement in its separate regulatory box.
4. Try the controls: change **Accommodation** and watch the engine
   recompute. Enter a personal monthly food or transport amount to replace
   the sourced estimate for that category, then reset to the original.
   These are labelled user assumptions, not published prices. Open Sources
   for citations and checked dates.
5. Click **"Apply to my financial plan"** and review the approval gate.
   Supply dates for one-time costs you know, and a tuition date if included.
   Undated costs stay incomplete. The sample working plan is GBP-based while
   the Limerick budget is EUR, so you must enter an explicit FX rate, source
   and date before it can affect the numerical forecast. Without that
   information, the application refuses to mark the budget as applied to the
   forecast. **"Revert applied budget"** removes exactly the obligations it
   added.
6. Alternative entry: type any message (e.g. "help me plan my living
   costs"), answer the clarifying question ("Try the sample student
   budget"), then send any follow-up — the paused demo resumes and runs
   the engine.

No provider key, no network calls, and no account are needed for any of
the above.

### Structured funding details

In Chat, open **Enter funding details** to enter multiple costs and funding
sources with their own currencies, dates, schedules, and certainty status.
**Calculate funding readiness** calls `/api/agent/funding-check`, which validates
the payload on the server and runs the existing deterministic
`analyze_funding_gap`/forecast engine directly. It does not send the form
through the model, persist a second plan, or perform a payment. Different
currencies remain incomplete unless an explicit FX assumption exists; expected
or unverified funding is shown separately from money available now.
The deterministic result is displayed first. The client then calls
`/api/agent/funding-analysis`, which server-recomputes the result and asks the
configured hosted Google Gemini/Vertex-Gemini provider for an explanation only.
Provider failure leaves the deterministic result visible and enables retry;
the AI response cannot modify calculations or trigger protected actions.

If you restart the server, its in-memory task state is reset. The client now
checks whether a restored transcript still has a live server-side session and
starts fresh with a clear notice when that state has expired, instead of leaving
clarification or approval buttons that can only return `unknown session`.

### Cloud Run session continuity

Cloud Run instance affinity is not durable storage. Pending clarifications,
confirmed facts, approvals, Safe-to-Send decisions, simulation receipts, and
duplicate-prevention records must be stored in a shared transactional store
before this application can safely serve stateful production workflows.

This repository exposes a typed local `TaskStore` interface and fails
stateful production routes with HTTP 503 unless a shared adapter is installed.
It does not claim Firestore persistence yet. A production rollout must install
and review a Firestore (or equivalent transactional store) adapter, grant the
Cloud Run service identity least-privilege access, set
`STUDYRUNWAY_SESSION_STORE` to that adapter, and add restart/concurrency tests
before enabling it. Set `STUDYRUNWAY_DEMO_MODE=true` only when the deployment
is intentionally demo-only and can tolerate instance-local state.

## Test commands

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # eslint .
npm test            # vitest run — unit + §11 eval scenarios (no network)
npm run e2e         # playwright test — chromium (desktop) + mobile (390px)
```

Playwright starts its own isolated dev server on port 3100 (`webServer` in
`playwright.config.ts`) and does not reuse an unrelated server by default. Stop any
existing process bound to port 3100 before running the suite. To intentionally reuse
a server started from this exact project root, set `PW_REUSE_SERVER=1`. The `mobile`
project is a Chromium-based 390×844 emulation.

## npm audit (must run on your machine)

`npm audit` is **blocked in this environment** — npm registry DNS returned
`EAI_AGAIN registry.npmjs.org`. It was therefore not run here. Before
submitting, run on a network-enabled machine:

```bash
npm audit
```

and address anything actionable. The build already pins `next@15.5.28` +
`sharp@0.35.5`, covering the known Next.js RCE/DoS advisories (see
`SECURITY_SELF_ASSESSMENT.md` §9).

## Project layout (quick map)

- `src/lib/agent/` — orchestration loop, task state, tool registry, tool contract
- `src/lib/providers/` — xAI / Vertex AI / Gemini / OpenAI / Anthropic adapters + selection
- `src/lib/tools/` — the 8 financial tools (deterministic engine wrappers),
  including `build_living_cost_plan`
- `src/lib/livingCosts/` — the destination budget engine (`dataset`,
  `engine`, `recommendations`, `toObligations`) + unit tests
- `src/lib/budgetApply.ts` — apply/revert logic for accepted budgets
- `src/app/api/agent/` — `chat` (SSE), `answer` (clarification/approval resume), `status` (provider indicator), `session-status`, `funding-check` (structured deterministic funding form), `funding-analysis` (server-side hosted Gemini explanation), `budget-apply`, `budget-revert`
- `src/lib/` — the deterministic financial engine (`money`, `forecast`, `transfers`, `scenarios`, `extract`, `evidence`, `export`, `model`, `currency`, `sample`)
- `src/components/chat/` — chat UI; `src/components/results/` — result cards; `src/components/visualizer/` — 3D tool visualizer
- `src/app/visualizer-demo/` — internal harness replaying real events through the real event bus (E2E only)
- `tests/eval/` — §11 12-scenario evaluation suite (vitest)
- `tests/e2e/` — Playwright UI/interaction + visualizer suites
- `docs/` — this documentation set
