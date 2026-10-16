# Destination Budget Planner — Engine Spec (PARTS D + E)

Deterministic living-cost engine for StudyRunway. Source code:
`src/lib/livingCosts/` (`dataset.ts`, `engine.ts`, `recommendations.ts`,
`toObligations.ts`, `index.ts`). Dataset: `docs/COST_DATASET.json`
(researched in `docs/DESTINATION_BUDGET_RESEARCH.md`).

## 1. Inputs

`LivingCostPlanInputsSchema` (zod; malformed input throws `ZodError`):

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `destinationId` | string | yes | — | must match a profile id (else `Unknown destinationId` error) |
| `monthlyBudgetMinor` | int ≥ 0 | yes | — | integer minor units, user's budget currency |
| `budgetCurrency` | ISO 4217 | yes | — | validated against `lib/currency.ts` |
| `accommodationType` | string | no | cheapest sourced | substring-matched against sourced rent entries; no match → cheapest + warning |
| `cookingHabit` | `cook_at_home`\|`mixed`\|`eat_out` | no | — | recorded as preference; no sourced cooking-specific price effect is invented |
| `transportPreference` | `public_transport`\|`cycling`\|`walking`\|`mixed` | no | — | recorded as preference; no sourced price split unless the selected profile contains comparable values |
| `insuranceCovered` | boolean | yes | — | `false` adds a warning to price mandatory cover separately |
| `utilitiesIncluded` | boolean | no | — | informational; bundling is decided by source notes, not this flag |
| `arrivalDate` | YYYY-MM-DD | no | — | informational |
| `studyMonths` | int 1–60 | no | 12 | drives obligation `occurrences` in `planToObligations` |
| `includeTuition` | boolean | no | false | `true` requires `tuitionAmountMinor` + `tuitionCurrency` |
| `tuitionAmountMinor` | int ≥ 0 | if tuition | — | user-supplied figure, never from the dataset |
| `tuitionCurrency` | ISO 4217 | if tuition | — | — |
| `fxToDestinationMinor` | finite number > 0, bounded | if currencies differ | — | **explicit user-supplied assumption**: destination minor units per 1 whole unit of `budgetCurrency`; may be fractional for rates below one target minor unit per source major unit. Never fetched or guessed. |
| `categoryOverridesMinor` | record of non-negative safe integers | no | `{}` | Optional user-entered monthly amounts in destination-currency minor units. Supported categories only; each replaces the source estimate and is labelled an assumption. |
| `protectedEssentials` | string[] | no | [] | category names the recommendation layer must not target for cuts |

## 2. Outputs

`LivingCostPlan`:

- `destinationId`, `destinationLabel`, `currency` (profile currency — all
  figures are expressed here), `scope` (`city`|`country`), `city`
- `categories[]` — one line per included monthly category:
  `{category, label, accommodationType?, lifestyle?, minMinor, maxMinor,
  estimateMinor, estimateMethod, sourceTitle, sourceUrl, valueKind,
  confidence, limitations?}`
- `monthlyTotals: {lowMinor, typicalMinor, highMinor}`
- `contingencyMinor: {lowMinor, typicalMinor, highMinor}` — the 5% lines
- `oneTime: {items[{label, minMinor, estimateMinor, maxMinor, sourceTitle, sourceUrl, valueKind}], totalMinor}`
- `budgetMinor` — monthly budget **converted to destination currency**;
  `budgetCurrencyOriginal` — the user's currency
- `verdict`, `verdictReason`, `remainingMinor` (`budget − typical`;
  negative only on `shortfall`), `shortfallMinor?` (present only on `shortfall`)
- `topContributors` — top 3 categories by `estimateMinor` (contingency excluded)
- `assumptions[]` — `{tag, text}`; every non-obvious choice is recorded
- `missingData[]` — `{category, label, reason: "no_data"|"bundled", note}`
- `sources[]` — deduplicated `{title, url, publishedDate, checkedDate, scope}`
- `warnings[]` — low-confidence figures, staleness, verify-before-use notes
- `tuition: {included, amountMinor, currency, note}`
- `visaRequirementSeparate: {amount, period, sourceTitle, sourceUrl, note} | null`

## 3. Scenario method

For each included category the dataset gives `minMinor / estimateMinor /
maxMinor` (estimate = midpoint of the source's stated range unless the
source gave a single figure; weekly figures were converted ×52/12 at
research time — see `estimateMethod` per entry).

- `lowMinor` = Σ minMinor, `typicalMinor` = Σ estimateMinor,
  `highMinor` = Σ maxMinor — integer arithmetic only.
- A **5% contingency** is computed per scenario as
  `roundHalfUp(subtotal × 5 / 100)` (halves away from zero, per
  `lib/money.ts`) and added as its own labelled line (`valueKind:
  "assumption"`, source `"StudyRunway planning assumption (no source)"`).
  It is part of the totals and of every verdict comparison.
- Categories with `valueKind: "missing"` are **omitted from totals** and
  listed in `missingData` — never filled with guesses.
- `total_monthly_living` entries (a source's own all-in figure) are
  **excluded from totals** (summing them would double-count) and noted as a
  cross-check in `assumptions`.
- Deposit ≠ prepaid rent ≠ monthly rent: the dataset contains no deposit
  figure, so no deposit line is invented; one-time items are counted exactly
  once (`oneTime.totalMinor` = Σ estimates).
- Bundling: a missing category whose source note says the cost is bundled
  (regex on `limitations`: `bundled|bundling|included in rent|includes
  bills`) is recorded as `reason: "bundled"` — a documented fact, not a gap.

## 4. Category selection (deterministic)

- **Rent**: `accommodationType` substring-matched (case-insensitive) against
  sourced rent entries; default = cheapest sourced estimate. No match →
  cheapest + warning. The choice is recorded in `assumptions`.
- **Other categories**: entries with `valueKind: "missing"` skipped. If
  several sourced entries exist (e.g. Germany's city slices), prefer the
  entry from the **same city** as the selected rent (city keywords scanned
  from `limitations`/`sourceTitle`); otherwise the **median estimate**
  (estimate-sorted, index `floor((n−1)/2)`). Every multi-option choice is
  recorded in `assumptions`.
- **Food**: `groceries` preferred when sourced, else `groceries_eating_out`;
  the choice is recorded. Cooking preferences alone do not invent a price split.
  If a user enters a monthly food amount in the interactive result card, that
  amount replaces the selected food line and is explicitly labelled as an
  unsourced user assumption. The same replacement rule applies to monthly
  transport amounts where supported.

## 5. Verdict rules (implemented exactly)

1. `insufficient_data` — if rent has no sourced estimate, or groceries/food
   has no sourced estimate, or (when `budgetCurrency` ≠ profile currency) no
   explicit `fxToDestinationMinor` rate was supplied. No totals are produced;
   missing data is listed, never guessed.
2. `shortfall` — `typicalMinor > budgetMinor`. `shortfallMinor = typical −
   budget`; `remainingMinor` is negative.
3. `tight` — budget covers typical, but **either**
   `(budget − typical) × 10 < typical` (headroom below 10% of typical),
   **or** any essential category is weak. Essential categories:
   `rent`, `groceries`/`groceries_eating_out`, `health_insurance`,
   `local_transport`, `utilities`. "Weak" = missing with no data (bundled
   essentials don't count) or the used figure has `confidence: "low"`.
4. `within_budget` — otherwise.

## 6. FX

- Same currency: no conversion, no assumption.
- Different currency: `fxToDestinationMinor` (destination minor units per 1
  whole unit of `budgetCurrency`) is **required**. It can be fractional: for
  example, 0.8 euro cents per BDT corresponds to €0.008 per BDT. It is
  converted to a major-unit ratio using the destination currency's minor-unit
  convention, then passed through the shared currency conversion helper.
  Rates are bounded; overflow/non-safe-integer results are rejected. Absent →
  `insufficient_data` with a clear warning. Rates are never fetched or guessed.

## 7. Recommendation rules (`recommendations.ts`)

`buildRecommendations(plan, profile, {protectedEssentials, cookingHabit})`
returns `{recommendations[], notes[]}`.

- Compares **sourced alternatives only**: other accommodation types, other
  sourced transport figures. `impactMinor = alternativeEstimate −
  currentEstimate` (negative = saving), `impactKind` monthly/one_time.
- `supportsBy` cites the source title + URL; `tradeoff` always states the
  downside (accommodation switches carry a verify-safety/commute note).
- Ranked: monthly by impact ascending (biggest saving first), then one-time;
  capped at 5.
- Cooking habits: the dataset has **no price split**, so this is a `notes`
  entry only — never a quantified number.
- `protectedEssentials` categories are never targeted.

### Safety rules (enforced)

- NEVER recommend skipping meals, foregoing required insurance, unsafe
  accommodation, reckless borrowing, or illegal work (a banned-pattern
  filter guards the generator as defense in depth).
- NEVER present "reduce everything to minimum" as optimal — the low
  scenario is a planning band, stated in `notes`.
- Insurance is never a suggested cut; if `insuranceCovered` is false the
  plan warns to price mandatory cover separately.

## 8. Obligations (`toObligations.ts`)

`planToObligations(plan, {startDate, studyMonths, oneTimeDueDates?,
tuitionDueDate?})` → `{obligations, tuitionIncluded, tuitionNote,
undatedOneTimeLabels, tuitionDueDateMissing}`. Pure — no store writes.

- Each monthly category → one obligation: `rent` → kind `"rent"`, everything
  else (incl. contingency) → `"living"`; `amountMinor` = typical estimate;
  `recurring = {everyMonths: 1, occurrences: studyMonths}` (or `null` when
  `studyMonths` is 1); `dueDate` = `startDate`; `status: "planned"`;
  `notes` = `"Estimated budget item, not a committed bill."` + source
  attribution (≤500 chars). Every record is re-validated with
  `ObligationSchema`.
- One-time items → kind by label: `/visa/` → `"visa"`, `/deposit/` →
  `"deposit"`, `/bike|bicycle|transport|travel|flight/` → `"travel"`, else
  `"living"`; non-recurring. Each requires its own confirmed due date; when
  missing, `dueDate = null`, it is returned in `undatedOneTimeLabels`, and it
  remains incomplete in the dated forecast rather than being scheduled on the
  plan start or arrival date.
- Included tuition uses `tuitionDueDate`; without it the obligation is
  incomplete and `tuitionDueDateMissing` is true.
- IDs are deterministic: `lcp-<destinationId>-<category>` /
  `lcp-<destinationId>-onetime-<i>` / `lcp-<destinationId>-tuition`.
- **Tuition is EXCLUDED unless the plan was built with
  `includeTuition: true`**; `tuitionNote` then says `TUITION EXCLUDED…`
  prominently (or `TUITION INCLUDED…` when a tuition obligation was made).
  When included, its own due date must be provided before the obligation can
  affect the dated forecast.
- Refuses `insufficient_data` plans (nothing to convert) and invalid
  `startDate`/`studyMonths`.
- `describePlanRevert(obligations)` — pure helper returning
  `{obligationIds, count, summary}` describing what a revert would remove
  (only `lcp-`-prefixed, still-`planned` items; committed/paid never
  touched). The store-level revert is a later phase.

## 9. Dataset validation (`dataset.ts`)

`docs/COST_DATASET.json` is imported and Zod-validated at load; any failure
throws one error listing every bad entry as `[destination "<id>"] <path>:
<message>`. Rules:

- `currency`: supported ISO 4217 code (checked against `lib/currency.ts`).
- `geographicScope`: explicitly `"city"` or `"country"`; `destinationId`
  unique.
- Costs: non-negative integers, `minMinor ≤ estimateMinor ≤ maxMinor`.
- Every **sourced** entry has `sourceTitle` + `sourceUrl` (http/https);
  `checkedDate` a real calendar date; `publishedDate` a real date or null.
- `valueKind: "missing"` entries carry **no numbers and no sources**, but
  must explain the gap in `limitations`.
- `valueKind: "regulatory"` is **forbidden in monthly categories** —
  regulatory figures live in `oneTimeCosts`/`visaRequirement` only and never
  enter typical-expense totals.

## 10. Known data limitations

- Ireland–Limerick: no monthly eating-out, health-insurance, or standalone
  internet figures (internet typically bundled with accommodation).
- Germany: utilities bundled into rent by the sources (by design, not a
  gap); no monthly eating-out; DAAD pages are undated university-submitted
  figures; Erlangen figures are a 5-year-old (2021) survey — low confidence.
- Denmark: utilities included in rent; no health-insurance premium; no
  monthly eating-out.
- UK: weakest typical-cost profile (broad British Council bands + one Leeds
  student datapoint); healthcare surcharge rate not captured.
- Australia: no monthly OSHC premium (mandatory but unpriced), no
  study-materials figure.
- Canada: **regulatory minimum only** (C$23,448/year, secondary-confirmed —
  verify at canada.ca); no typical-cost data → always `insufficient_data`.
- Visa requirements are regulatory minimums and consistently sit **below**
  realistic typical costs — they are surfaced separately, never as budget
  lines.
- Staleness: `sourceWarnings(profile)` flags any source whose `checkedDate`
  is older than 12 months and surfaces verify-before-use cautions from visa
  notes (e.g. Canada's secondary-confirmed figure).


## 10. Applying a destination budget to the financial plan

- The application layer validates all consumed budget fields at the API trust
  boundary, including safe integer minor-unit amounts, supported currencies,
  category/source strings, and the tuition amount/currency contract.
- Budget and working-plan currencies must match for direct application.
  When they differ, a positive explicit user-entered rate, rate source, and
  valid rate date are mandatory. The system does not fetch or guess a rate.
- Every obligation is converted through the shared currency conversion helper
  before merging into the working plan. The rate, direction, date, and source
  are preserved in obligation notes and the apply result.
- Cross-origin browser requests with an `Origin` header are rejected on
  state-changing agent, answer, budget-apply and budget-revert routes. This is
  a CSRF mitigation, not authentication; see `SECURITY_SELF_ASSESSMENT.md`.
