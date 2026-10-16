# Destination Budget Research — StudyRunway Budget Planner (Part B)

**Research date:** 2026-10-15
**Method:** public-web text research (browser_search + browser_open). No live-browser visits; interactive calculators (e.g. the Study Australia cost-of-living calculator) were not run. Every figure in `COST_DATASET.json` traces to a source listed below.
**Goal:** at least 4 useful destination profiles (Ireland, Germany, Denmark, UK targeted), monthly student costs by category + one-time costs (including pre-arrival expenses where relevant) + visa financial-evidence requirements kept STRICTLY SEPARATE from typical living costs.

## 1. Coverage at a glance

| Destination | Scope | Currency | Sourced categories | Missing categories | One-time costs | Visa requirement |
|---|---|---|---|---|---|---|
| Ireland — Limerick | city | EUR | 9 | 3 | 1 | €10,000/year (regulatory) |
| Germany | country (city slices) | EUR | 26 | 2 | 1 | €11,904/year blocked account (regulatory) |
| Denmark | country | DKK | 9 | 3 | 1 | DKK 7,426/month (regulatory) |
| United Kingdom | country | GBP | 6 | 4 | 1 | £1,529/mo London / £1,171/mo outside London (regulatory) |
| Australia | country | AUD | 10 | 3 | 1 | AUD 29,710/year (regulatory) |
| Canada | country | CAD | 0 | 9 | 0 | C$23,448/year (regulatory — secondary-confirmed) |

All six profiles carry a `visaRequirement` object. Canada has no typical-cost data (no Canadian cost sources were read in this round) — it is a regulatory-minimum-only placeholder.

## 2. Sources studied

| # | Source title | URL | Pub/update date | What it gave | Kind |
|---|---|---|---|---|---|
| S1 | GOV.UK — Student visa: Money you need | https://www.gov.uk/student-visa/money | updated 2024-10-31 | UK financial requirement £1,529/mo London, £1,171/mo outside London, up to 9 months | regulatory (official) |
| S2 | GOV.UK — Student visa: Overview (fees) | https://www.gov.uk/student-visa | n/a | UK student visa application fee £558; healthcare surcharge exists (rate not captured) | regulatory (official) |
| S3 | Citizens Information — Student visas to study in Ireland | https://www.citizensinformation.ie/en/moving-country/visas-for-ireland/student-visas/ | page edited 2026-07-16 | Ireland visa: €10,000/year; €833/mo for 6–8 month courses; visa fee €60/€100; private health insurance required | regulatory (official) |
| S4 | Education in Ireland — Living Costs in Limerick | https://www.educationinireland.com/en/life-in-ireland/living-costs-in-limerick | not shown | Limerick: rent on-campus €690–810/mo; off-campus €650–900/mo; groceries €40–60/week; takeaway €9–16/order; buses €1–2/trip; total budget €1,000–1,200/mo | student_reported (official platform, student ambassador) |
| S5 | Shiksha — University of Limerick cost of living | https://www.shiksha.com/studyabroad/ireland/universities/university-of-limerick | ~2026-09-24 | UL guidance figures (via Pre-Departure PDF): utilities €50–100, food €200–300, mobile €11–20, books €75, recreation €100–300, travel €50–100 | official_estimate (2 hops from UL's PDF) |
| S6 | Make it in Germany — Visa for studying | https://www.make-it-in-germany.com/en/visa-residence/types/studying | not shown | Germany visa: blocked account **at least €11,904 in 2026** (= €992/mo); scholarship/declaration alternatives | regulatory (official) |
| S7 | DAAD — LMU Munich, Human Biology (detail 5344) | https://www2.daad.de/deutschland/studienangebote/international-programmes/en/detail/5344/ | not shown | Munich: private rooms incl. utilities €600–1,000/mo; university housing €400–600/mo; food+health+leisure €500/mo; Deutschlandticket student €38/mo | official_estimate (uni-submitted) |
| S8 | DAAD — LMU Munich, MSc International Health (detail 5590) | https://www2.daad.de/deutschland/studienangebote/international-programmes/en/detail/5590/ | not shown | Munich total living €1,000–1,500/mo incl. accommodation + health insurance | official_estimate (uni-submitted) |
| S9 | DAAD — Bielefeld University, MA British and American Studies (detail 6094) | https://www2.daad.de/deutschland/studienangebote/international-programmes/en/detail/6094/ | not shown | Bielefeld: rent ~€290/mo (halls); health insurance ~€140/mo; food ~€150/mo; total ~€992/mo | official_estimate (uni-submitted) |
| S10 | DAAD — BTU Cottbus-Senftenberg (detail 4396) | https://www2.daad.de/deutschland/studienangebote/international-programmes/en/detail/4396/ | not shown | Cottbus: rent incl. utilities €250–450/mo; groceries €160–180/mo; health insurance ~€145/mo; total €780–1,000/mo | official_estimate (uni-submitted) |
| S11 | DAAD — FAU Erlangen-Nuremberg, MSc Physics (detail 4311) | https://www2.daad.de/deutschland/studienangebote/international-programmes/en/detail/4311/ | not shown | 2021 DSW social survey: rent €410, food €198, clothing €46, travel €89, study materials €31, health €100, telecom €31; avg disposable €1,106/mo | measured_statistic (2021) |
| S12 | DAAD — University of Hohenheim, Agricultural Economics (detail 3723) | https://www2.daad.de/deutschland/studienangebote/international-programmes/en/detail/3723/ | not shown | Stuttgart/Hohenheim: rent €350–500/mo; health insurance ~€110/mo; public transport ~€60/mo; study materials €100/mo; food €150–250/mo; total €950–1,000/mo | official_estimate (uni-submitted) |
| S13 | Education Post — Germany student visa 2026 (citing German Embassy in India) | https://educationpost.in/news/education/study-abroad/germany-student-visa-2026-indian-students-need-11904-in-proof-of-funds | ~2026-09-22 | Confirms €11,904/€992-mo blocked account; national (D) visa fee €75 | official_estimate (secondary reporting) |
| S14 | New to Denmark — Self-support requirement (SIRI/nyidanmark.dk) | https://www.nyidanmark.dk/en-GB/Words%20and%20Concepts%20Front%20Page/SIRI/Self%20support%20-%20SIRI | not shown (2026 level stated) | Denmark: DKK 7,426/mo (2026 level) disposable funds, max 12 months (= DKK 89,112); tuition-paid complete-programme students exempt | regulatory (official) |
| S15 | Study in Denmark — Bank & Budget | https://studyindenmark.dk/live-in-denmark/bank-budget | not shown | DK budget: rent 3,000–6,500 (utilities usually incl.); insurance ~300; streaming licences 200; books 400–650; mobile 250; food 2,000–3,500; transport 300; other personal 2,000; price examples incl. second-hand bike 400–2,000 | official_estimate (official portal) |
| S16 | VIA University College — The Ultimate Guide to Studying in Denmark (PDF) | https://en.via.dk/-/media/VIA-EN/new-student/documents/The-Ultimate-Guide-to-Studying-in-Denmark.pdf | not shown | Corroborating student budget: rent incl. utilities DKK 3,000–4,500; food 1,500; total DKK 6,500–7,500/mo | official_estimate (university) |
| S17 | British Council — Study UK: Money and Budgeting flyer (PDF) | https://www.britishcouncil.sg/sites/default/files/study_uk_money_and_budgeting_a5_flyer_v1.pdf | not shown | UK: £800–£1,300/mo living; weekly shop £20–30; travel from £30/mo; mobile from £10/mo | official_estimate (official) |
| S18 | Leeds Beckett University — cost-of-living blog (student) | https://www.leedsbeckett.ac.uk/blogs/student-blog-squad/2025/07/an-honest-guide-to-the-cost-of-living-as-an-international-student-in-leeds/ | ~2025-07 | Leeds: £820/mo actual (£600 rent incl. bills/wifi, £55 bus pass, £85 groceries, £10 phone, £25 social, £15 clothes, £30 misc) | student_reported |
| S19 | NDTV — Total Cost of Studying in UK (citing British Council) | https://www.ndtv.com/education/total-cost-of-studying-in-uk-for-indians-fees-rent-food-visa-explained-11391655 | ~2026-04-22 | London £1,300–1,400/mo; rest of UK £900–1,300/mo living | official_estimate (secondary reporting) |
| S20 | Home Affairs (immi.homeaffairs.gov.au) — financial capacity news | http://immi.homeaffairs.gov.au/news-media/archive/article?itemId=1196&mkt_tok=MDg5LVBVUi01MzEAAAGS9egNEf9le_3Mll6DpIaf-3qlxk-0Y68FbtHXoNV25SvOQF_cQK-TSCvGK9YbM2dCN1gXIUMlZwrubNpzfvikTh81X0I1ioayYVq3xnzA8ic | 2024-05-09 | Australia: AUD 29,710/year primary applicant (from 10 May 2024); partner AUD 10,394; child AUD 4,449; school costs AUD 13,502 | regulatory (official) |
| S21 | Skyline Higher Education Australia — Living and Studying in Australia | https://shea.edu.au/future-students/living-and-studying-in-australia/ | ~2026-08-01 | Weekly cost bands by accommodation type and category (converted to monthly); cites Study Australia's living-costs page; confirms DHA AUD 29,710 figure | official_estimate (provider, cites Study Australia) |
| S22 | WIDEN (registered migration agent) — Student Visa Fee Australia 2026 | https://www.widen.com.au/student-visa-australia-cost-2026/ | ~2026-08-01 | Subclass 500 fee AUD 2,500 from 1 July 2026; concessions noted | official_estimate (secondary reporting) |
| S23 | canada.ca — Proof of financial support (study permit) | https://www.canada.ca/en/immigration-refugees-citizenship/services/study-canada/study-permit/get-documents/financial-support.html | not shown | Confirms first-year funds + plan for full duration; tuition/transport separate. Amounts table did NOT render in text fetch | regulatory (official, partial) |
| S24 | CIC News — Canada hikes funds needed by study permit applicants | https://www.cicnews.com/2026/08/canada-hikes-funds-needed-by-study-permit-applicants-0879805.html | 2026-08-31 | Canada: C$23,448/year living expenses single applicant (applications on/after 2026-09-01), family scale, reporting IRCC/cananda.ca update of 2026-08-28 | regulatory (secondary-confirmed) |

## 3. Per-destination findings

### 3.1 Ireland — Limerick (city-level, EUR)
Richest profile for Ireland because Education in Ireland published a dedicated Limerick cost guide (S4). Limerick is ~25% cheaper than Dublin for accommodation; on-campus UL accommodation €690–810/mo, off-campus €650–900/mo. A careful student's total runs €1,000–1,200/mo (S4) — notably well above the €10,000/year (~€833/mo) visa minimum, which is exactly the kind of typical-vs-regulatory gap the agent must surface. UL's own guidance (via S5) fills utilities/transport/mobile/books/recreation. Gaps: no monthly eating-out figure (only per-order prices), no health-insurance premium, no standalone internet figure.

### 3.2 Germany (country-level with city slices, EUR)
DAAD programme pages are university-submitted cost data — the most authoritative "typical cost" source available for Germany, and they naturally give city slices: Munich (expensive), Stuttgart/Hohenheim (mid), Bielefeld/Cottbus (affordable), Erlangen (2021 measured survey). Key structural findings: rent bundles utilities ("rent including utilities"/"including ancillary costs"), so utilities is a `missing` standalone category by design; statutory student health insurance lands ~€100–145/mo across sources; the Deutschlandticket student rate is €38/mo (national product). Gaps: no standalone utilities, no monthly eating-out.

### 3.3 Denmark (country-level, DKK)
studyindenmark.dk's own rough budget (S15) is the anchor; VIA University College's budget (S16) corroborates the same order of magnitude (total DKK 6,500–7,500 vs S15's ~DKK 8,000–13,000 mid-point — the range reflects the older/broader official table vs a smaller-city university budget). Note the discrepancy explicitly in UI copy: S15 is a national rough guide, S16 is smaller-city (Aarhus/Horsens). Denmark's self-support rule (S14) is notable: it equals the SU grant rate and is *waived* if tuition for a complete programme is paid — a logic branch the agent should encode. Gaps: standalone utilities (included in rent), health insurance premium, monthly eating-out. Second-hand bike (DKK 400–2,000) is the only sourced one-time arrival cost.

### 3.4 United Kingdom (country-level, GBP)
British Council's official budget (S17) is deliberately broad (£800–1,300/mo total) — fine for planning bands but weak for personalization; the Leeds student account (S18) gives a concrete frugal datapoint (£820/mo). The visa requirement (S1) gives a useful London/outside-London split (£1,529 vs £1,171/mo). The healthcare surcharge rate was NOT captured — do not hard-code £776/year; fetch from gov.uk at build time. Gaps: standalone utilities, health insurance rate, study materials, eating-out.

### 3.5 Australia (country-level, AUD)
Weekly figures from a registered provider citing Study Australia (S21), converted to monthly (×52/12). Five rent types give the planner real accommodation-type choice — the strongest accommodation-type coverage in the dataset. The visa minimum (AUD 29,710/year, S20) vs Sydney reality (Uni of Sydney cites Study Australia calculator ranges up to ~AUD 2,500/mo for food alone) again shows the regulatory/typical gap. Gaps: monthly OSHC premium (mandatory but unpriced here), study materials, separable eating-out.

### 3.6 Canada (country-level, CAD) — regulatory only
Visa requirement captured (S23/S24); no typical-cost sources read. Do NOT present the C$23,448 regulatory minimum as a budget line. Fill categories from Canadian university cost-of-living pages in a follow-up round.

## 4. Visa financial-evidence requirements (kept separate by design)

| Country | Requirement | Period | Status |
|---|---|---|---|
| UK | £1,529/mo London / £1,171/mo outside London, max 9 months; 28-day holding rule | month | official (gov.uk) |
| Ireland | €10,000/year (€833/mo for 6–8 month courses); tuition + health insurance separate | year | official (citizensinformation) |
| Germany | €11,904/year blocked account (= €992/mo withdrawable); or scholarship/declaration | year | official (make-it-in-germany) |
| Denmark | DKK 7,426/month, max 12 months (DKK 89,112); waived if tuition paid | month | official (nyidanmark/SIRI) |
| Australia | AUD 29,710/year (+partner/child add-ons) | year | official (Home Affairs) |
| Canada | C$23,448/year single applicant (from 2026-09-01) | year | secondary-confirmed (canada.ca table didn't render) |

These are stored in `visaRequirement` and tagged `valueKind: "regulatory"`. The agent MUST present them as "what the visa office requires you to prove" and never as "what you will actually spend". The consistent finding across destinations: regulatory minimums sit below realistic typical costs.

## 5. Design decisions

1. **Minor units everywhere** (cents/pence/øre integers) to match the deterministic engine.
2. **City slices where the source supports them**: Ireland = Limerick (city) because the official national platform published a Limerick guide; Germany = country with per-entry city attribution in `limitations` (Munich vs Cottbus vs Bielefeld vs Erlangen vs Hohenheim) so the planner can expose a city toggle later; Denmark/UK/Australia/Canada = country.
3. **No invented values**: categories with no evidence are `missing` with number fields omitted. Eating-out is `missing` everywhere (only per-order/per-occasion prices were found; monthly totals would be guesses). Utilities is `missing` for Germany/Denmark (bundled into rent by the sources themselves — this is a bundling fact, not a gap).
4. **Estimate convention**: `estimateMinor` = midpoint of a stated range unless the source gave a single figure ("flat figure stated by source"); weekly→monthly uses ×52/12. The method is recorded per entry in `estimateMethod`.
5. **One-time costs** carry the same provenance as monthly categories. Only genuinely sourced items are included (visa fees, second-hand bike). Accommodation deposits were NOT priced — no source gave amounts, so no deposit line exists; do not invent "1 month's rent" rules.
6. **Confidence** is per-entry: high (read on official page, current), medium (official but undated/broad, or first-person student account on official platform), low (secondary reporting, 5-year-old survey, floor-only figures), none (missing).
7. **Differentiator language**: do not claim any cost calculator is "globally unique". The StudyRunway differentiator is personalization (destination × accommodation type × lifestyle), integration with the funding-gap forecast, and full source traceability — all of which this dataset's per-entry provenance enables.

## 6. Limitations

- **Secondary reporting** underlies some entries: Ireland's UL figures (via Shiksha), Canada's requirement (via CIC News), Germany's visa fee (via Education Post), Australia's visa fee (via WIDEN). Each is flagged `confidence: low` and its `limitations` field names the hop.
- **DAAD programme pages carry no publication dates**; figures are university-submitted and update asynchronously. Treat German city slices as planning bands, not current market rents.
- **Survey staleness**: the FAU Erlangen figures come from the 2021 DSW social survey (5 years old) and predate the Deutschlandticket; marked low confidence.
- **Bundled categories**: Germany/Denmark rent figures include utilities; Australia's food figure includes eating out; Munich's €500/mo "food, health insurance, leisure" is a bundle that cannot be split. Bundles are documented, not split.
- **UK is the weakest typical-cost profile** (broad British Council bands + one Leeds datapoint). A follow-up round should add a UKCISA or HEPI-based profile.
- **Canada has no typical-cost data at all** in this round.
- **No currency conversion** is performed in the dataset; the engine must convert at use time with an attributed rate.

## 7. Staleness warnings (re-check before competition use)

1. **Canada C$23,448** — IRCC updates annually each 1 September; re-check the canada.ca proof-of-financial-support page; the new figure may not have propagated everywhere.
2. **UK visa financial requirement (£1,529/£1,171)** — gov.uk page last updated 2024-10-31; these figures change with immigration-rule updates.
3. **UK healthcare surcharge rate** — NOT captured; fetch the current student rate from gov.uk before packaging.
4. **German blocked-account amount** — "at least €11,904 in 2026" on make-it-in-germany.com; re-check before demo. Note the portal quotes €1,091/month for the *seeker* visa route — a different visa, not the study visa.
5. **Denmark DKK 7,426** — explicitly labelled "2026 level" and adjusted yearly with the SU grant.
6. **Australia AUD 29,710** — unchanged since 10 May 2024 but indexed to minimum wage; re-check Home Affairs before use.
7. **Ireland €10,000** — citizensinformation page edited 2026-07-16; the older €7,000 figure still circulates in stale guides and DFA PDFs — ignore it.
8. **Currency conversion guidance on studyindenmark.dk** (1 EUR ≈ 7.5 DKK) is outdated (EUR/DKK is pegged ~7.46); do not use for conversion.

## 8. Unreachable / unlocated sources

- **Study Australia cost-of-living calculator (costofliving.studyaustralia.gov.au)**: interactive tool — could not be run via text fetch. Institutional guidance citing it (S21) used instead. The `education.gov.au` accommodation-guidance page named in the brief could not be located (search returned unrelated policy docs) — not a blocker, as S21 cites the same Study Australia data.
- **canada.ca amounts table**: page opened successfully but the funds-amount table did not render in extracted text; requirement taken from CIC News' reporting of the same page's 2026-08-28 update, with an explicit verify-before-use flag.
- **UL Pre-Departure cost-of-living PDF** (the primary source behind S5): not directly accessible; reached via Shiksha's summary.
- **Home Affairs subclass 500 fee**: verified only via secondary (WIDEN); Home Affairs' pricing estimator is interactive.
- **UKCISA living-costs guidance**: not reached this round — recommended next source for strengthening the UK profile.
