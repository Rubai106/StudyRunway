# Agent evaluation

`npm test` runs the deterministic agent evaluation alongside unit tests. The
feature suite uses the real allow-listed tools and financial forecast engine;
loop-level scenarios use a scripted model so the results are repeatable and do
not require provider credentials.

## What the suite checks

| Evaluation dimension | Coverage |
| --- | --- |
| Task completion | Tuition funding gap, delayed scholarship recovery, action plan, multi-tool orchestration, demo flow |
| Calculation accuracy | Exact minor-unit balances, scenario deltas, per-option remaining gaps, reference and manually entered quote ranking, fee treatment, recipient charges, limits, and deadline filtering |
| Tool selection and permissions | Allow-list enforcement, clarification before research, explicit draft approval, prohibited payment tools |
| Source evidence and freshness | Page-numbered document excerpts, official-domain policy citations, checked-at timestamp, period-labeled World Bank benchmark |
| Failure recovery | Timeouts, malformed provider output, retry behavior, pause/resume clarification flow |
| Security | Prompt-injection documents, direct-identifier redaction, no silent plan mutation, no external payment/sending claim |

The additional feature-completion cases live in
`tests/eval/feature-completion.test.ts`; the 13 pipeline scenarios are in
`tests/eval/scenarios.test.ts`. Regression checks run on every push and pull
request using `.github/workflows/quality.yml` (typecheck, lint, and tests).

These tests measure deterministic behavior and the agent loop contract. They
do not measure live-model answer quality or real provider transfer quotes. The
opt-in `npm run verify:live-ai` command runs real requests against the configured
Vertex project; it is intentionally excluded from CI because it requires ADC
and may incur charges.

Live check on 2026-10-16 selected Vertex AI successfully. The finance probe
received a model-driven clarification on a successful run, though another run
returned malformed JSON after retry, so response consistency is not established.
The policy probe reported three Google Search queries but no cited pages; the
smoke check correctly failed because it could not verify an answer. Rerun the
live check after correcting the project's Search grounding configuration.
