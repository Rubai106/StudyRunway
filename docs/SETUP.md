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
| `AI_PROVIDER` | Optional explicit provider selection: `demo`, `gemini`, `xai`, `openai`, or `anthropic`. This prevents a leftover key for another provider from taking precedence. The example config selects `gemini`. |
| `GEMINI_API_KEY` | Google AI Studio API key. For the Google provider, use an API key created at https://aistudio.google.com/app/apikey. |
| `GEMINI_MODEL` | Gemini model ID available to your key; default is `gemini-3.8-flash` as listed in Google's current OpenAI-compatibility example. Verify model availability in your AI Studio/account if rejected. |
| `GEMINI_BASE_URL` | Defaults to `https://generativelanguage.googleapis.com/v1beta/openai/`. Custom values are accepted only for Google's HTTPS compatibility endpoint. |
| `XAI_API_KEY`, `XAI_BASE_URL`, `XAI_MODEL` | Optional xAI/Grok provider. |
| `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL` | Optional OpenAI or OpenAI-compatible provider. `OPENAI_BASE_URL` now honours the environment variable. |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | Optional Anthropic/Claude provider. |

If `AI_PROVIDER` is set to a valid provider, StudyRunway uses only that provider; set it to `demo` to disable external model calls (as the browser tests do). it does not silently fall back to another configured provider. Without `AI_PROVIDER`, selection priority is xAI → Gemini → OpenAI → Anthropic → demo mode. The header badge and `/api/agent/status` show the active provider honestly. The application does not silently fall back to another configured provider when `AI_PROVIDER` explicitly selects a provider that is missing a valid key.

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
by an AI model until a valid provider API key is configured. The sample budget
button runs only the deterministic living-cost demo. Copying `.env.example`
is not enough: replace its placeholder key values with real credentials.

Without any key the agent runs its **explicitly labelled demo mode**: the
same structured loop (understand → clarify → plan → tools → verify →
outcome) executes with the real tools and the real deterministic engine, but
every user-visible string is prefixed
`"Demo mode — no model provider configured"` and the final result carries
`demoMode: true`. Demo mode never claims model reasoning happened. To get the
real thing: configure one provider key in `.env.local` (for example `GEMINI_API_KEY`) and restart.

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

If you restart the server, its in-memory task state is reset. The client now
checks whether a restored transcript still has a live server-side session and
starts fresh with a clear notice when that state has expired, instead of leaving
clarification or approval buttons that can only return `unknown session`.

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
- `src/lib/providers/` — xAI / Gemini / OpenAI / Anthropic adapters + selection
- `src/lib/tools/` — the 8 financial tools (deterministic engine wrappers),
  including `build_living_cost_plan`
- `src/lib/livingCosts/` — the destination budget engine (`dataset`,
  `engine`, `recommendations`, `toObligations`) + unit tests
- `src/lib/budgetApply.ts` — apply/revert logic for accepted budgets
- `src/app/api/agent/` — `chat` (SSE), `answer` (clarification/approval resume), `status` (provider indicator), `session-status`, `budget-apply`, `budget-revert`
- `src/lib/` — the deterministic financial engine (`money`, `forecast`, `transfers`, `scenarios`, `extract`, `evidence`, `export`, `model`, `currency`, `sample`)
- `src/components/chat/` — chat UI; `src/components/results/` — result cards; `src/components/visualizer/` — 3D tool visualizer
- `src/app/visualizer-demo/` — internal harness replaying real events through the real event bus (E2E only)
- `tests/eval/` — §11 12-scenario evaluation suite (vitest)
- `tests/e2e/` — Playwright UI/interaction + visualizer suites
- `docs/` — this documentation set
