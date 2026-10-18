# Student-finance feature status

This status reflects the current local implementation and the choices made for
this demo. “Implemented locally” describes code paths covered by deterministic
tests; it does not imply a live external provider was verified.

| Feature | Current status | Boundary |
| --- | --- | --- |
| Autonomous student-finance agent | Implemented locally: understand, clarify, plan, call allow-listed tools, verify calculations, and return a result. Vertex ADC is supported, with an opt-in live smoke command. | Vertex was selected in a live check on 2026-10-16 and a finance clarification succeeded; a separate attempt returned malformed JSON after retry, so live response consistency remains unverified. Demo mode is intentionally available. |
| Cross-border transfer optimizer | Implemented locally for reference quotes and user-entered provider offers, plus an opt-in Wise indicative quote preview. Compares rate, fees, recipient charges, arrival window, and send limits; ranks complete, deadline-feasible offers. Shows a World Bank RPW benchmark separately. | The Wise quote is not locked or executable; production use may require Wise Platform approval. User-entered quote details and receiving-bank charges are not independently verified or saved. The benchmark is historical market context, not a quote. |
| Financial document understanding | Implemented locally: extracts candidate amounts, dates, and currencies with page-tagged excerpts; redacts common identifiers and requires explicit confirmation. | Extraction is heuristic; scanned-image OCR and all possible injection wording are not guaranteed. Candidates do not enter calculations before confirmation. |
| Official student-finance research | Implemented for Vertex Gemini with Google Search grounding, official-domain source checks, claim-level citations, and a checked-at timestamp. Uncited model prose is withheld. The grounded request has a 55-second network timeout and a 60-second tool timeout. | A live request on 2026-10-16 reported three Google Search queries but returned zero cited pages, so a source-backed live answer is not yet verified. Confirm Google Search Suggestions are enabled for the project and rerun the smoke command. |
| Credit-building guide by destination | Added as a specialized official-research topic. It requires a confirmed destination country, returns claim-level citations and a checked-at time, and emphasizes eligibility caveats without recommending borrowing. | Depends on Vertex Google Search grounding and sources that pass the official-domain check; it cannot decide whether a student qualifies for a specific provider. |
| Crisis and recovery planner | Implemented locally: models delays and other shocks, compares stated backup-funding or tuition-installment scenarios, recalculates the remaining gap, and ranks dated actions by urgency. | Recovery options are scenarios. Funding arrival and university approval remain unconfirmed until the user verifies them. |
| Approved action execution | Implemented to the selected scope: approved email drafts only, plus user-saved browser reminders and optional generic notifications. | Email is not sent. Payment execution was explicitly deferred. Reminders are local to this browser and work while the app is open. |
| Daily student budget planner | Added to the dashboard: set a per-day spending limit, record dated expenses by category and currency, review daily category totals, and see a seven-day trend. | Expense records are stored in this browser only. Daily totals include only the selected budget currency; other currencies are listed separately without conversion. |
| Tuition-protected spending review | The daily planner can share a seven-day total and category summary with the agent on request; the agent compares that pace with the latest tuition/funding plan and essential bills. | The 30-day pace is a simple estimate from the selected week, not a prediction. Purchase notes stay local. Currency mismatches or missing dates must be clarified. |
| Tuition transfer quote comparison | Dashboard comparison accepts provider quotes and can fetch a live indicative Wise quote when enabled; compares fees, recipient amount, delivery, and tuition deadline. | Wise's unauthenticated display quote is not rate-locked or executable; partner approval/access may be required. Receiving-bank/intermediary charges and other providers still need user-confirmed quotes. Reference data and World Bank RPW remain separately labeled context. |
| Destination banking setup | Added a grounded official-research topic and dashboard guide for account documents, address/residency conditions, timing, fees, and pre-arrival access where cited sources support those details. | Country rules and provider terms differ. Provider-specific domains must pass the official-source check; no account eligibility or remote opening is promised. |
| Credit guide for students without a cosigner | The destination credit guide now also asks for official processes or non-lending alternatives when a student lacks local history or a cosigner. | Alternatives are shown only if a cited official source confirms them; the guide does not recommend borrowing or promise acceptance. |
| Arrival and emergency costs | Added a browser-local planner for one-time housing/setup, travel, health, insurance, books, and paperwork costs, with dates, currency, paid/planned state, and a source/basis label. It can send planned costs to a draft funding review only after the user clicks. | User entries are estimates or quotes, not independently verified. The planner keeps currencies separate and does not invent local prices. Grounded destination research returns amounts only when official citations state them. |
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
source conversation. Fee and deadline alerts flag forecast shortfalls and
upcoming tuition/fee dates (60-day window), rank urgent and overdue items, and
link to their source result. “Set reminder” opens the existing reminder form;
the student chooses and saves the reminder. Alerts use only dates and figures
from the current browser transcript. Browser reminders remain local to this
device and work while the app is open; cross-device delivery needs sign-in and
a notification service.

The multi-currency cash-flow panel shows incoming sources and unpaid bills in
their original currencies, with subtotals kept separate per currency. It shows
the FX pair, numeric rate, as-of date, and stated source as assumptions; it
never presents them as live transfer quotes or adds unlike currencies into a
single total. The panel uses the latest funding result and needs a new funding
check to populate older results that predate this data.
The dashboard also links to the country-specific credit-building guide, which
uses the official-research pipeline and clearly states that provider approval
and international-student eligibility are not guaranteed.
The daily budget planner stores validated spending entries in this browser's
local storage and are not synced across devices. Currency totals are kept
separate; no exchange rate is assumed. A student can explicitly share only the
selected seven-day total and category totals for a tuition-planning
conversation; transaction notes are excluded.
The arrival-cost planner is also browser-local and only shares planned entries
after the student selects its funding-plan action.

## Decisions that require a later provider or product choice

- Keep demo access; no OAuth sign-in is configured.
- Keep institutional email as draft-only.
- Do not initiate tuition payments; no payment rail is connected.
- The chat `compare_transfers` tool still uses sample/reference comparisons.
  The separate Wise preview is opt-in and display-only; other providers have
  not been integrated.
