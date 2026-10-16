# StudyRunway — model-driven AI financial agent

FinTechathon 2026 · International Track · Topic C (Cross-border & Student Finance).

This is a fresh rebuild. The old shelved build lives at
`../studyrunway/` (read-only reference — do not modify it from here).

## Stack

Next.js 15.5.28 (pinned) · React 19.1.0 · TypeScript 5.7.3 · Tailwind CSS 3.4 ·
vitest 3.2.3 · Playwright 1.53.1 · three 0.182 + @react-three/fiber 9.4.2 + drei 10.7.7
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

## Verification status

The 2026-10-15 runtime results documented in `docs/TEST_RESULTS.md` apply to
the archive tested on that date. A follow-up QA review on 2026-10-16 found and
patched an additional budget-apply integrity edge case and added regression
tests. The follow-up source passed TypeScript/TSX syntax parsing and cost-dataset
structural validation, but runtime verification of those latest changes is
**pending**: clean dependency installation and `npm audit` were blocked by npm
registry DNS (`EAI_AGAIN registry.npmjs.org`). Do not treat the earlier test
totals as proof that the follow-up patch passes. Once registry access is
restored, run the full command set in `docs/TEST_RESULTS.md`, including the new
integrity regression tests, and record the actual outputs.
