# Student-finance feature status

This status reflects the current local implementation and the choices made for
this demo. “Implemented locally” describes code paths covered by deterministic
tests; it does not imply a live external provider was verified.

| Feature | Current status | Boundary |
| --- | --- | --- |
| Autonomous student-finance agent | Implemented locally: understand, clarify, plan, call allow-listed tools, verify calculations, and return a result. Vertex ADC is supported, with an opt-in live smoke command. | Vertex was selected in a live check on 2026-10-16 and a finance clarification succeeded; a separate attempt returned malformed JSON after retry, so live response consistency remains unverified. Demo mode is intentionally available. |
| Cross-border transfer optimizer | Implemented locally for reference quotes and user-entered provider offers: compares rate, sender-fee treatment, recipient charges, arrival window, and send limits; ranks deadline-feasible offers by net received, sender outlay, or speed. Shows a World Bank RPW benchmark. | No transfer provider was selected, so automatic live rates/quotes are unavailable. User-entered quote details are not independently verified or saved. The benchmark is historical market context, not a quote. |
| Financial document understanding | Implemented locally: extracts candidate amounts, dates, and currencies with page-tagged excerpts; redacts common identifiers and requires explicit confirmation. | Extraction is heuristic; scanned-image OCR and all possible injection wording are not guaranteed. Candidates do not enter calculations before confirmation. |
| Official student-finance research | Implemented for Vertex Gemini with Google Search grounding, official-domain source checks, direct citations, and a checked-at timestamp. The opt-in live smoke command checks for grounded citations. | A live request on 2026-10-16 reported three Google Search queries but returned zero cited pages, so a source-backed live answer is not yet verified. Check the project's grounding/Search Suggestions configuration and rerun the smoke command. |
| Crisis and recovery planner | Implemented locally: models delays and other shocks, compares stated backup-funding or tuition-installment scenarios, recalculates the remaining gap, and ranks dated actions by urgency. | Recovery options are scenarios. Funding arrival and university approval remain unconfirmed until the user verifies them. |
| Approved action execution | Implemented to the selected scope: approved email drafts only, plus user-saved browser reminders and optional generic notifications. | Email is not sent. Payment execution was explicitly deferred. Reminders are local to this browser and work while the app is open. |
| Financial trust and security | Safeguards include input validation, tool allow-lists, document-injection checks, identifier redaction, confirmation gates, and privacy-limited audit events. | Demo access remains enabled by choice. Audit records go to stdout unless deployment logging is configured; authentication and durable audit storage are not provided here. |
| Automated agent evaluation | Deterministic feature/pipeline evaluations run with typechecking and lint in CI on pushes and pull requests. `npm run verify:live-ai` provides a separate opt-in, real-Vertex check. | CI uses scripted or mocked model/provider responses; the live check may incur Vertex charges and currently reports the Search citation failure described above. Neither check supplies real transfer quotes. |

## Merged payment-safety workflow

The Safe-to-Send workflow adds a deterministic tuition-payment readiness check,
baseline funding timeline, quote and reserve validation, explicit approval before
a sandbox-only simulation, a reversible simulation record, and decision evidence.
It does not initiate real transfers. Delay and recovery analysis stays in the
crisis planner's `simulate_scenario` flow to avoid duplicate controls.

## Overview dashboard

The Overview screen summarizes the latest funding result and action plan, shows
saved browser reminders and items awaiting a response, and links back to each
source conversation. It does not create missing financial values. The summary
uses the current browser transcript; document candidate reviews remain limited
to the active session, and reminders remain local to this browser.

## Decisions that require a later provider or product choice

- Keep demo access; no OAuth sign-in is configured.
- Keep institutional email as draft-only.
- Do not initiate tuition payments; no payment rail is connected.
- No transfer-quote provider has been chosen, so sample/reference comparisons
  remain clearly labeled and no live quote is claimed.
