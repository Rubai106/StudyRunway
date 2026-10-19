# Latest follow-up candidate — Gemini provider + E2E/session hardening (2026-10-16)

This section describes the source currently packaged in the latest QA candidate.
It does not inherit pass results from older ZIPs. The user-reported run on the
preceding `SESSION_RECOVERY_PATCH_UNVERIFIED` archive had 44/58 E2E tests pass
and 14 fail. This candidate contains fixes aimed at those failures, but those
full runtime tests have **not been rerun here**.

| Check | Result | Evidence / limitation |
|---|---|---|
| TypeScript/TSX syntax | PASSED | TypeScript compiler API parsed 102 `.ts`/`.tsx` files under `src/` and `tests/`; zero parse diagnostics. |
| Provider modules strict typecheck | PASSED | Isolated `tsc --noEmit --strict` across provider types, HTTP adapter, xAI/OpenAI/Anthropic/Gemini adapters, and provider selector. This is not a full-project typecheck. |
| Gemini provider mock smoke check | PASSED | Node/TypeScript-transpile harness checked provider selection, model and base URL, Google-only host allowlist, Bearer header, tool-call request/response mapping, key-free label, and explicit demo override. No network request or live API key was used. |
| `npm ci` / dependencies | BLOCKED — ENVIRONMENT | Online registry DNS failed; `npm ci --offline` failed with `ENOTCACHED` because the local npm cache has zero entries. |
| Full `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, E2E | NOT RUN ON THIS CANDIDATE | Requires installed project dependencies; the full suite must be run in the user's network-enabled Windows environment. |
| Dependency audit | NOT CLEARED | User-provided audit on the preceding archive reported 21 vulnerabilities (4 moderate, 15 high, 2 critical). This candidate does not claim to have remediated them. |
| Live Gemini request | NOT RUN | No user API key was provided to this environment. Test using a local `.env.local`; never add the key to the ZIP. |

## Code changes in this candidate

- Added Gemini as a distinct provider using Google's OpenAI-compatible endpoint,
  configurable through `AI_PROVIDER=gemini`, `GEMINI_API_KEY`, `GEMINI_MODEL`,
  and `GEMINI_BASE_URL`. The URL allowlist prevents sending the key to another
  host. The provider handles function/tool calls using the compatibility API.
- Made provider selection explicit when `AI_PROVIDER` is set; an absent or
  placeholder key remains in honest demo mode rather than silently selecting
  another provider. Gemini appears as `Google Gemini · <model>` in provider status.
- Allowed `OPENAI_BASE_URL` to configure the OpenAI-compatible adapter.
- Used a `globalThis`-backed task Map to survive Next development module reloads
  within one Node process, and disabled stale Playwright server reuse by default.
- Forced Playwright's web server to `AI_PROVIDER=demo` to keep automated tests
  isolated from local provider keys, warmed the session-status route, gated chat
  actions until client session restoration completes, and narrowed the expired
  session alert selector.

**Release limitation:** this remains a QA candidate, not a fully runtime-cleared
release. User-side full-suite results are required before claiming all regressions
are fixed. The 21 reported dependency vulnerabilities are still an explicit
security-release blocker until audited and either remediated or documented with
an acceptable risk decision.

---

# StudyRunway — Verification Log

## QA follow-up patch (2026-10-16) — latest user-reported test run and changes

The user's Windows run of `npm run e2e -- --workers=1` against the session-recovery
candidate reported **44 passed and 14 failed out of 58**. Most budget-demo tests timed
out waiting for the rendered verdict; the expired-session test failed because its
`getByRole("alert")` locator matched both the intended message and Next.js's route
announcer. A separate isolated mobile budget test had previously passed. These are
not counted as a passing full suite.

The follow-up source changes in this archive:

- Added a first-class Google Gemini provider (`GEMINI_API_KEY`, `GEMINI_MODEL`,
  optional strict-host `GEMINI_BASE_URL`) using Google's OpenAI-compatible chat
  completions route, with custom function/tool-call parsing and a `Google Gemini`
  provider label. The `AI_PROVIDER=gemini` setting prevents a leftover API key from
  a different provider from silently taking precedence.
- Added mocked provider tests for endpoint, model, auth header, tool calls, placeholder
  key rejection, provider selection, and refusing non-Google custom hosts.
- Kept `OPENAI_BASE_URL` configurable for OpenAI-compatible endpoints.
- Backed the agent task store with `globalThis` so Next dev hot reloads do not
  inadvertently clear sessions; a real process restart still clears the in-memory store.
- Disabled accidental Playwright server reuse by default, warmed the newly added
  session-status route, disabled sending until browser-session restoration completes,
  and narrowed the expired-session E2E locator to avoid matching the Next.js route announcer.

**Verification status of these follow-up edits:** runtime testing was not possible in
this build sandbox because `registry.npmjs.org` did not resolve, and a clean `npm ci`
was not completed. Static source review and syntax validation do not prove type safety,
model interoperability, or passing E2E. Do not treat the older pass results below as
proof that this follow-up archive passes.

**Dependency security is not cleared:** the user's `npm audit` output reported 21
vulnerabilities (4 moderate, 15 high, 2 critical). This patch does not silently rewrite
the dependency lockfile without network access. Before submission, run `npm audit` and
remediate what is fixable in compatible versions; the reported `braces` advisory had no
patched version at the time of this audit, so document that residual toolchain risk rather
than applying `--force` upgrades that change Tailwind/Next major versions.

---

> **Verification note for the session-recovery QA patch:** The test/build results
> below describe the preceding build. The added session-status route, stale-session
> recovery UI, and placeholder-config handling were added after that run and have
> only received source/syntax inspection in this package. Rerun the commands in
> `docs/SETUP.md` before treating this patch as runtime-verified.

# Follow-up QA recheck — 2026-10-16

This section is the latest status for the follow-up QA-patch candidate. It
supersedes any implication below that the earlier 2026-10-15 test totals were
run against this patched source.

| Check | Exact action | Result | Notes |
|---|---|---|---|
| Uploaded ZIP integrity | `unzip -t StudyRunway_FinTechathon_2026_BudgetPlanner_FINAL(1).zip` | PASSED | No compressed-data errors. |
| Fresh extraction | Extracted into a new working directory | PASSED | Source tree inspected from the extracted archive. |
| Manifest/lockfile agreement | Node script compared declared direct dependency versions and package metadata | PASSED | Zero direct dependency version mismatches. |
| TypeScript/TSX syntax | TypeScript 5.8.3 compiler API parsed all `.ts`/`.tsx` files under `src/` and `tests/` | PASSED | 99 files, zero parser diagnostics. This is not a semantic typecheck. |
| Cost dataset structure | Independent validator over `docs/COST_DATASET.json` | PASSED | 6 unique destinations, 89 rows, 65 valued rows, 24 missing rows, 5 one-time costs, HTTPS source URLs and numeric ranges validated, zero structural errors. |
| Limerick arithmetic | Independent Python calculation from the selected source rows and documented 5% contingency formula | PASSED | Low €1,164.80; typical €1,503.78; high €1,842.75. Comparable core (rent, groceries, transport) €1,066.67, within the dataset's €1,000–€1,200 benchmark. This validates arithmetic from the data, not the live app. |
| Clean dependency install | `npm ci --no-audit --no-fund --fetch-retries=0 --fetch-timeout=20000` | BLOCKED — NOT RUN TO COMPLETION | Registry DNS error `EAI_AGAIN registry.npmjs.org`; no complete `node_modules` installation. |
| Dependency audit | `npm audit --json` | BLOCKED — NOT RUN TO COMPLETION | Same registry DNS error. |
| Typecheck attempt | `npm run typecheck` | BLOCKED — ENVIRONMENT | Exit 2 with missing-module/type declarations (`next`, `@playwright/test`, `vitest`, Node/React types) because dependencies were unavailable. These errors do not establish whether the patched project typechecks with its dependencies installed. |
| Lint attempt | `npm run lint` | BLOCKED — ENVIRONMENT | Exit 127: `eslint: not found`. |
| Unit/evaluation attempt | `npm test` | BLOCKED — ENVIRONMENT | Exit 127: `vitest: not found`. The three new regression tests were not executed. |
| Production build attempt | `npm run build` | BLOCKED — ENVIRONMENT | Exit 127: `next: not found`. |
| E2E attempt | `npm run e2e` | BLOCKED — ENVIRONMENT | The available `playwright` executable is the Python CLI, which reports `unknown command 'test'`; the Node Playwright package and app server are unavailable. |

The original ZIP's prior 2026-10-15 verification report lists passing tests, but those results do not verify the new 2026-10-16 integrity patch. Re-run the entire suite once dependencies are installable.

## External source spot checks (2026-10-16)

Selected source URLs were opened independently through a web viewer; this was a spot check, not a crawl of every one of the dataset's 17 unique sourced URLs.

- **Education in Ireland — Limerick:** page loaded and states the €690–€810/month on-campus and €650–€900/month off-campus accommodation ranges, and a €1,000–€1,200 monthly planning range including rent, food, and transport. This is consistent with the dataset's cited source ranges and the app's like-for-like core comparison.
- **GOV.UK Student visa:** official page loaded and currently states a £558 application fee, plus an additional healthcare surcharge. The dataset notes that the surcharge is additional and not included in its captured fee.
- **Study in Denmark — Bank & Budget:** page loaded.
- **DAAD International Programmes:** one programme page loaded; this is only a link availability check, not proof of every cost estimate on all DAAD programme pages.
- **Australian Department of Home Affairs:** URL loaded, but the text view did not expose the page's dynamic fee content; the numeric application charge was not independently verified in this spot check.
- **Citizens Information Ireland:** the research viewer received HTTP 403. This does not by itself prove the source URL is broken; it means the page content could not be independently checked through this viewer.

The remaining sourced URLs and their numerical claims were not all independently reverified during this pass.

## Follow-up integrity defect and patch

Static inspection found that `verifyPlanIntegrity()` checked category array length and compared each submitted category against a map, but did not reject duplicate category identifiers or explicitly require each expected category to be present. A submitted plan could duplicate one valid category in place of another and pass the prior amount checks, even though the obligation conversion iterates the submitted array. The verifier also did not compare source attribution against the server-recomputed lines.

The follow-up patch now rejects duplicate/missing categories and compares the category fields used in applied obligations, including labels, estimate methods, sources, and amounts. One-time items are checked by index against the server-recomputed plan (their indexes determine user-supplied due dates), and the tuition note is compared too. Three regression tests were added for duplicate categories, altered source attribution, and altered one-time labels/source attribution.

The new regression tests were **added but not executed** because dependency installation is blocked. Syntax parsing passed; runtime behavior of this patch remains unverified until the full suite runs in a network-enabled environment.

# StudyRunway — Final BudgetPlanner Verification Log

This file distinguishes the test results recorded for the previous BudgetPlanner build from checks actually completed on the patched release. Do not treat earlier passing totals as proof that the current patched source passed runtime tests.

## Repair pass (2026-10-15) — full verification rerun on the repaired source

Seven confirmed defects (F1–F7) were repaired in the working tree
(`studyrunway-agent-qa/`), and the full suite was re-run with the
pre-installed `node_modules` (`npm ci` was already complete; not re-run).
Exact commands, exit codes, and counts:

| Check | Command | Exit code | Result |
|---|---|---|---|
| Typecheck | `npm run typecheck` (`tsc --noEmit`) | 0 | **Passed, zero errors.** Previously failed with 8× `TS18047: 'activePlan' is possibly 'null'` in `src/components/results/LivingCostPlan.tsx`; fixed with a guard clause (no tsconfig loosening). |
| Lint | `npm run lint` (`eslint .`) | 0 | **Passed, zero problems.** |
| Unit + evaluation tests | `npm test` (`vitest run`) | 0 | **23 test files, 243/243 tests passed.** Includes new/updated coverage: plan-integrity verification (fabricated destinationId rejected, tampered amounts rejected, missing planInputs rejected — `src/lib/budgetApply.test.ts`, `src/app/api/agent/budget-apply/route.test.ts`), case-insensitive national-ID redaction + tool-result redaction (`orchestrator.test.ts`), `formatMinor` integer assertion (`src/lib/currency.test.ts`), Canada visa-caution warning (`engine.test.ts` 18b), demo-mode honesty label (`orchestrator.test.ts`). |
| Production build | `npm run build` (`next build`) | 0 | **Passed.** Type-checking stage clean; 6/6 static pages generated; routes `/`, `/visualizer-demo`, `/api/agent/{answer,budget-apply,budget-revert,chat,status}` emitted (historical build; later session-status/Gemini changes not covered). |
| E2E (`npm run e2e`) | — | — | Not run: Playwright browsers are not installed in this sandbox and the specs need a live dev server. |
| `npm audit` | — | — | Not run: the sandbox registry proxy blocks npm registry access. Must be run on the release machine before shipping. |

The rows below (recorded by the independent QA verifier, who had no registry
access) are superseded by the repair-pass results above for
typecheck/lint/test/build.

## Current patched source — verification status

| Check | Result | Evidence / limitation |
|---|---|---|
| ZIP archive extraction | Passed for the supplied input archive | The source archive was extracted successfully. |
| TypeScript/TSX syntax parse | Passed | Global TypeScript 5.8.3 parsed 103 `.ts`/`.tsx` files with zero parser diagnostics. This is a syntax check only, not a semantic typecheck. |
| `docs/COST_DATASET.json` validation | Passed | Parsed successfully; 6 destination profiles and 89 cost records validated (65 sourced, 24 explicitly missing), with no range-order, safe-integer, date, coverage-summary, or HTTPS-source issues. |
| Independent FX arithmetic spot checks | Passed | Fractional minor-unit FX case (BDT 10,000 at EUR 0.008/BDT → EUR 80.00) and EUR 2,000 at DKK 7.46/EUR → DKK 14,920 matched expected values. This checks arithmetic only, not the application runtime. |
| `npm ci --no-audit --no-fund --fetch-retries=0 --fetch-timeout=10000` | Blocked | npm registry DNS resolution failed with `EAI_AGAIN registry.npmjs.org`. No complete `node_modules` installation was created. |
| `npm run typecheck` | Passed in repair pass (exit 0, zero errors) — see "Repair pass" section above | QA verifier had no registry access; repaired and re-verified 2026-10-15. |
| `npm run lint` | Passed in repair pass (exit 0, zero problems) — see "Repair pass" section above | QA verifier had no registry access; repaired and re-verified 2026-10-15. |
| `npm test` | Passed in repair pass (23 files, 243/243) — see "Repair pass" section above | QA verifier had no registry access; repaired and re-verified 2026-10-15. |
| `npm run build` | Passed in repair pass (exit 0) — see "Repair pass" section above | QA verifier had no registry access; repaired and re-verified 2026-10-15. |
| `npm run e2e` | **PASSED 56/56** (2026-10-15, this environment) | Full Playwright suite: 4 specs × chromium desktop + 390px mobile, zero console errors asserted in every test. Initial run had 8 failures in `budget-planner.spec.ts` after the app-side honesty fixes (see "E2E repair" section); all fixed and the full suite re-run green. |
| `npm audit` | **BLOCKED — NOT RUN** (environmental) | Sandbox registry proxy refuses the audit endpoint: `npm warn audit 403 Forbidden - POST https://registry.npmjs.org/-/npm/v1/security/audits/quick - policy_denied` (`zz_managed_internal_spaces_package_registries`). Lockfile untouched. **Run `npm audit` on the release machine.** |
| Screenshot regeneration | **Completed** | 6 genuine screenshots captured from the actually running app (dev server, real engine, demo mode): `docs/screenshots/00-welcome.png`, `01-budget-demo.png`, `02-budget-adjusted.png`, `03-budget-sources.png`, `04-budget-applied.png`, `05-budget-demo-mobile.png`. No mockups. |

## E2E repair (2026-10-15) — 4 stale tests fixed, no app changes needed

After the repair pass, the full E2E suite found 8 failures (4 tests × 2 projects), all in `tests/e2e/budget-planner.spec.ts`. Root causes were all stale test expectations, not app defects:

1. **Sample-budget test** — strict-mode violation: the verdict copy now states the shortfall figure inline ("…by €603.78 per month"), so `getByText("€603.78")` matched 2 elements. Test now uses `.first()`; the assertion intent (figure displayed) is unchanged.
2. **Accommodation-adjustment test** — expected a "Cooking habit" select that no longer exists; the UI now uses an explicit "Monthly food budget" override input (the honest design: the dataset has no cooking-habit price split). Test rewritten to fill the food input with €300 and assert the engine-recomputed typical of **€1,591.28** (groceries €216.67 → €300.00 + 5% contingency re-derived), then reset.
3. **Apply/revert test** — the app now blocks cross-currency apply until the user supplies an explicit, dated, sourced FX rate (documented in `docs/DESTINATION_BUDGET_DEMO.md`; required by the QA brief's Phase 6 Scenario B). Test updated: asserts the Confirm button is disabled with the explanation visible, fills rate 0.86 / date / source, confirms, and asserts the "Conversion used: 1 EUR = 0.86 GBP" provenance line plus before/after forecast balances.
4. **390px keyboard test** — pressed ArrowDown on the accommodation select, but the engine-selected option is now pre-selected as the *last* option (part of the accommodation-matching fix), so ArrowDown changed nothing. Test now picks the arrow direction from the selected index. The apply portion got the same FX-rate treatment as (3).

Retest: `npx playwright test` → **56 passed, 0 failed** (EXIT:0), desktop + mobile.

## Final QA verification (2026-10-15) — current release

| Check | Exact command | Result | Evidence |
|---|---|---|---|
| Install | `npm ci` | PASSED | exit 0, 334 packages |
| Typecheck | `npm run typecheck` | PASSED | exit 0, 0 errors (independently re-run by QA lead) |
| Lint | `npm run lint` | PASSED | exit 0, 0 problems (independently re-run by QA lead) |
| Unit + eval tests | `npm test` | PASSED | **243/243 across 23 files**, exit 0 (independently re-run by QA lead) |
| Production build | `npm run build` | PASSED | exit 0, all routes emitted |
| E2E | `npm run e2e` | PASSED | **56/56**, desktop + 390px mobile, zero console errors (see "E2E repair") |
| Security audit | static review | PASSED with documented gaps | No secrets in repo/ZIP; session isolation, tool allow-list, input validation verified. Fixed: budget-apply plan-integrity verification, case-insensitive PII redaction incl. tool-result messages. Remaining demo-grade limits documented in `SECURITY_SELF_ASSESSMENT.md`. |
| `npm audit` | `npm audit` | BLOCKED — NOT RUN | 403 policy_denied from sandbox registry proxy (exact error above). **Must run on the release machine.** |

The "Previous build's reported baseline — NOT revalidated" section below is superseded by the table above.

## Release packaging — fresh-extract verification (2026-10-15)

The final `StudyRunway_FinTechathon_2026_BudgetPlanner_FINAL.zip` (1.3 MB, 167 files, `unzip -t` clean, no `node_modules`/`.next`/caches/secrets/real `.env`) was extracted into a clean directory and verified from scratch:

| Check | Exact command (from extracted copy) | Result |
|---|---|---|
| Install | `npm ci` | exit 0 |
| Typecheck | `npm run typecheck` | exit 0, 0 errors |
| Lint | `npm run lint` | exit 0, 0 problems |
| Unit + eval tests | `npm test` | **243/243 across 23 files**, exit 0 |
| Production build | `npm run build` | exit 0, 6/6 pages |
| Launch + main journey | `npm run start`, real browser: "Try the sample student budget" → real engine renders €1,503.78 verdict with honest demo label, zero console errors | PASSED |

The delivered ZIP is the exact archive that passed this verification.

## Previous build's reported baseline — NOT revalidated after these fixes

The supplied project documentation reports 210/210 unit/evaluation tests and 56/56 E2E tests passing, with typecheck, lint, and build clean. Those results were recorded for the previous build. This release changes calculation, conversion, route security, and UI code, so the numbers above must not be represented as current-release results.

## Required local release verification

After registry access is available, run from the extracted project root:

```powershell
npm ci
npm run typecheck
npm run lint
npm test
npm run build
npm run e2e
npm audit
```

Save the full output. Fix all reproducible failures before treating the release as verified. If `npm audit` reports a vulnerability, check the advisory, affected dependency path, and patched version rather than suppressing the finding.


## User-run candidate verification update (2026-10-16)

The user ran the following checks on `StudyRunway_FinTechathon_2026_BudgetPlanner_FINAL_CANDIDATE.zip` after a clean dependency install:

- `npm run typecheck`: passed with no reported TypeScript errors.
- `npm run lint`: passed with no reported lint problems.
- `npm test`: 257 tests passed across 24 files.
- `npm run build`: passed; Next.js 15.5.28 generated all app routes. The build emitted a warning that the Next.js ESLint plugin was not detected.
- `npm run e2e -- --workers=1`: 56/58 passed; only the same keyboard-operability test failed on desktop and mobile. Both failures occurred because the test tried to focus the sample-budget button while it was temporarily disabled during session restoration. The test now waits for the button to be enabled before asserting focus and pressing Enter. This test-only change has not yet been rerun in this environment.
- `npm audit`: still reports 21 findings (4 moderate, 15 high, 2 critical). Do not describe this candidate as security-cleared.

The E2E failure appears to be a test synchronization issue, not a demonstrated production interaction defect: all other budget planner flows passed in the user's sequential run, and the failed assertion observed the button in its expected temporary disabled state. The updated test waits for the UI's readiness condition instead of trying to focus a disabled control.
## Current verification summary — structured-plan session handoff (2026-10-18)

This summary records verification of the structured funding-plan handoff. The
form sends a validated session identifier; `/api/agent/funding-check` derives
one canonical plan, stores it on the matching task, invalidates stale pending
controls, and calculates from that exact plan. This summary is appended so the
historical reports above remain unchanged.

| Check | Result | Evidence / limitation |
|---|---|---|
| Focused regression tests | PASSED | 23 tests across funding form, funding-check route, and task state. |
| `npm run typecheck` | PASSED | Full TypeScript check. |
| `npm run lint` | PASSED | ESLint completed successfully. |
| `npm test` | PASSED | 37 files, 370 tests passed. |
| `npm run build` | PASSED | Next.js production build completed. |
| `npm run e2e` | BLOCKED — ENVIRONMENT | Existing process occupied port 3100 (`EADDRINUSE`); no test assertions ran. |
| `npm audit` / `npm audit --omit=dev` | BLOCKED — ENVIRONMENT | npm registry audit endpoint failed before returning advisory data. |
| Live Gemini, Vertex, Wise, deployment | NOT RUN | Automated tests use mocks/local deterministic paths. |
## Security-evidence pass — 2026-10-19 (current tree, commit 4df0fbf)

This section records the focused security-evidence pass on the current tree.
It supersedes earlier verification and audit-status statements for this tree
where they conflict with the Windows results below. Earlier entries describe
different candidates or earlier runs and remain historical.

| Check | Exact action | Result | Evidence / limitation |
|---|---|---|---|
| Install | `npm ci` | PASSED | exit 0 |
| Typecheck | `npm run typecheck` (`tsc --noEmit`) | PASSED | exit 0, zero errors |
| Lint | `npm run lint` (`eslint .`) | PASSED | exit 0, zero problems |
| Unit tests | `npm test` (`vitest run`) | PASSED | **37 files, 378/378 tests**, exit 0 |
| Production build | `npm run build` (`next build`) | PASSED | exit 0 |
| E2E | `npm run e2e` (`playwright test`) | PASSED | **64/64 tests**, exit 0, ~2.0 min |
| `npm audit` | `npm audit` | FINDINGS — NOT CLEARED | 15 vulnerabilities: 1 moderate, 12 high, 2 critical; current Windows tree, 2026-10-19 |
| `npm audit --omit=dev` | `npm audit --omit=dev` | PASSED — zero vulnerabilities reported | Actual output: `found 0 vulnerabilities`, Windows tree, 2026-10-19 |

### New tests added in this pass (6)

- `src/app/api/agent/budget-apply/route.test.ts`: rejects a **wrong** (not
  merely missing) `approvalAck` value with 400 and asserts `workingPlan` and
  `appliedBudget` remain null.
- `src/app/api/agent/safe-to-send/route.test.ts` (new describe block
  "approval-boundary hardening", 5 tests): wrong approvalAck value; tampered
  `simulationApproval` fields; stale approval after draft inputs change;
  reused approval on duplicate simulate; simulate when decision is not
  `READY_TO_SIMULATE`. Each negative-path test captures a deep snapshot of
  the session's financial obligations before the request and asserts it is
  unchanged afterward, asserts no new `sts-pay-` simulation obligation was
  created, and asserts the count of `safeToSend.records` with
  `status === "applied"` is unchanged (exactly one for the replay test, where
  the first legitimate application is established). Note: rejected attempts
  are intentionally audit-logged as `status: "rejected"` records — the tests
  assert on applied obligations and applied records, not on record absence.

### Reconciliation notes

- The 2026-10-18 summary reported 370 tests; this tree has 378 (the 6 new
  tests plus 2 from intervening commits). The current Windows audit on
  2026-10-19 reports 15 vulnerabilities (1 moderate, 12 high, 2 critical);
  `npm audit --omit=dev` reports zero vulnerabilities. The full dependency
  tree is **not cleared**. Do not use `npm audit fix --force`.

- No test outcomes in this section are invented: every PASSED row above was
  executed in this environment on 2026-10-19 with the exit codes shown.
- The final patch revises the same pass: the security assessment's §12 now
  uses the corrected acknowledgment wording (fixed public strings do not prove
  a button click, authenticate, or authorize) and correctly documents that
  `requestOriginError` permits requests without an `Origin` header (only a
  supplied mismatched origin is rejected), the tampered-fields test is
  named "without applying a simulation" (rejected-attempt audit records are
  permitted), the negative-path tests additionally assert the
  `status === "applied"` simulation-record count is unchanged (exactly one
  for the replay test), and §15's build/E2E placeholders are replaced with
  the verified PASSED outcomes recorded above. All 378 tests and 64 E2E were
  re-run after these wording changes.
