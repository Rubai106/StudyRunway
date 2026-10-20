# Destination Budget Planner — Demo Script

How to demo the budget planner live (no API key needed), in the order a
judge would experience it. Sourced category figures are attributed; the 5%
contingency and any student-entered values are explicitly labelled assumptions.
Screenshots are intentionally not included in this patched release: the bundled captures were taken before the latest UX/currency fixes and show stale narration and minor-unit values. Do not use those old captures in a competition deck. Recapture screenshots from the running, patched application after dependency installation and E2E verification.

## The story (60–90 seconds)

**1. Fixed budget.** "Meet a student with a fixed budget: €900 a month to
live in Limerick, Ireland, sharing a flat and cooking at home." Click **"Try
the sample student budget"** on the welcome screen. No AI key is needed; Google
sign-in must be configured and completed —
the app runs the real budget engine through the real tool path and says so
on screen ("Demo mode — no model provider configured").

**2. Destination & lifestyle in.** The engine reads the sourced cost
dataset (`docs/COST_DATASET.json` — every figure traces to a named source)
for Limerick: rent, groceries, utilities, transport, mobile, study
materials, leisure, plus a clearly labelled 5% planning contingency. The
sample records cooking-at-home as a preference, but does not reduce the grocery
estimate because the sources do not price cooking habits separately.

**3. Evidence-backed breakdown.** The card shows the verdict first:
**"Shortfall — typical costs are above your budget"** — typical spending
**€1,503.78/mo** against a **€900/mo** budget, a **€603.78/mo** shortfall.
Below it, every category with its source-derived range (e.g. Rent €775,
€650–€900), the Low/Typical/High bands, one-time costs (€60 visa
fee; set the actual due date separately), and "Ways to bring costs down" with sourced trade-offs.

**4. Dominant categories.** Rent (€775) dominates, then groceries, then
leisure — the bars make it visual. The visa requirement sits in its own
box: **"What the visa office requires — regulatory minimum, not what
you'll spend"** (€10,000/year), deliberately separated from typical costs.

**5. Adjust assumptions, watch totals update.** Change **Accommodation** to
"student residence (on-campus, UL)": the engine re-runs and the comparison
panel shows the new sourced estimate and recalculated contingency. Use the
monthly food and transport amount fields to enter personal estimates; each
amount replaces (it does not add to) the reference category estimate and is
clearly labelled as user-entered rather than sourced. Cooking/transport
preferences alone are not assigned invented price effects where the dataset
has no relevant breakdown. Reset restores the original assumptions.

**6. Approve → obligations feed the forecast.** Click **"Apply to my
financial plan"**: nothing happens until you confirm at the approval gate.
Supply the start date, each known one-time due date, and a tuition date if
relevant. One-time costs with no date remain incomplete rather than being
silently scheduled on the arrival date. The sample financial plan is GBP-based
while the Limerick plan is EUR-based, so a dated, sourced, user-entered GBP-per-EUR
rate is required before the costs can affect the numerical forecast. Without
that rate the app refuses to claim that the budget has been included.
**7. Revert.** **"Revert applied budget"** removes exactly those 9
obligations and restores the forecast. Committed/paid items are never
touched.

## Fallbacks if something goes wrong live

- **Canada question** ("what about Toronto?"): the engine has no
  typical-cost data for Canada — the card says "We can't build a reliable
  budget yet", lists what's missing, and disables Apply. That's a feature,
  not an error.
- **Stale sources**: any source unchecked for 12+ months carries an
  "older than 12 months — verify before use" badge; open Sources (2).
- **No model key**: the deterministic budget calculation uses the bundled
  dataset and needs no paid LLM key. Installing dependencies still requires a
  working package registry or a populated npm cache.

## What NOT to claim

- The demo does not use a model — say "deterministic engine", never "AI
  calculated".
- The visa figures are regulatory minimums, not budgets.
- The Low band is a planning band, not a target.
- FX between the budget and the plan is never assumed — without a sourced,
  dated user-entered rate the app will not claim the budget was applied to the
  numerical forecast.
