# Latest verification record — 2026-10-20

## Current main CI result

The latest successful GitHub Actions quality workflow on `main` is commit
`cbe0a31999b54d57299d4a49db2ef79f4b6ba184` ([run 39411467566](https://github.com/Rubai106/StudyRunway/actions/runs/39411467566)). The run completed the following checks:

| Check | Current result | Evidence / boundary |
|---|---|---|
| `npm ci` | PASSED | Dependency installation completed; npm reported 15 audit findings. |
| `npm run typecheck` | PASSED | GitHub Actions on the exact main commit above. |
| `npm run lint` | PASSED | GitHub Actions on the exact main commit above. |
| `npm test` | PASSED — **390/390 tests across 38 files** | Unit and API tests under CI. |
| `npm run build` | PASSED | Production build completed. |
| `npm run e2e` | PASSED — **66 passed in about 1.6 minutes** | Playwright Chromium E2E in CI, including desktop and 390px mobile coverage. |
| Full dependency audit | **NOT CLEARED** | 15 findings reported: 1 moderate, 12 high, 2 critical. A clean CI run does not mean this audit is clean. |

The older sections below are retained as a chronological QA history. The 378/378 unit/API and 64/64 E2E figures in the 19 October security-evidence pass are historical and are superseded for current CI reporting by the 20 October main run. Do not combine test counts from different commits into one test result.

### Evidence package provenance

The separately submitted Item 06 ZIP contains a 75-second narrated video, screenshots, an exported sandbox receipt, a captioned PDF and a manifest. The manifest identifies the local execution source revision as `e213b84272d98b03b51807bd1e416bc4f0ad0933`; it was run in explicit deterministic demo mode with no AI provider configured. It is a genuine local sandbox execution, not proof of an authenticated execution on the hosted deployment. During the review the hosted URL showed a Google sign-in gate and anonymous agent API requests returned 401. No real payment occurred. See `docs/FINTECHATHON_SUBMISSION_INDEX.md` for the submission mapping.

---

## Historical QA candidate — Gemini provider + E2E/session hardening (2026-10-16)

This section describes an earlier QA candidate and must not be read as the current verification status. It does not inherit pass results from older ZIPs. The user-reported run on the preceding `SESSION_RECOVERY_PATCH_UNVERIFIED` archive had 44/58 E2E tests pass and 14 fail. That candidate contained fixes aimed at those failures, but full runtime tests had not been rerun in that environment.

audit findings. |
| `npm run typecheck` | PASSED | GitHub Actions on the exact main commit above. |
| `npm run lint` | PASSED | GitHub Actions on the exact main commit above. |
| `npm test` | PASSED — **390/390 tests across 38 files** | Unit and API tests under CI. |
| `npm run build` | PASSED | Production build completed. |
| `npm run e2e` | PASSED — **66 passed in about 1.6 minutes** | Playwright Chromium E2E in CI, including desktop and 390px mobile coverage. |
| Full dependency audit | **NOT CLEARED** | 15 findings reported: 1 moderate, 12 high, 2 critical. A clean CI run does not mean this audit is clean. |

The older sections below are retained as a chronological QA history. The 378/378 unit/API and 64/64 E2E figures in the 19 October security-evidence pass are historical and are superseded for current CI reporting by the 20 October main run. Do not combine test counts from different commits into one test result.

### Evidence package provenance

The separately submitted Item 06 ZIP contains a 75-second narrated video, screenshots, an exported sandbox receipt, a captioned PDF and a manifest. The manifest identifies the local execution source revision as `e213b84272d98b03b51807bd1e416bc4f0ad0933`; it was run in explicit deterministic demo mode with no AI provider configured. It is a genuine local sandbox execution, not proof of an authenticated execution on the hosted deployment. During the review the hosted URL showed a Google sign-in gate and anonymous agent API requests returned 401. No real payment occurred. See `docs/FINTECHATHON_SUBMISSION_INDEX.md` for the submission mapping.

---

## Historical QA candidate — Gemini provider + E2E/session hardening (2026-10-16)

This section describes an earlier QA candidate and must not be read as the current verification status. It does not inherit pass results from older ZIPs. The user-reported run on the preceding `SESSION_RECOVERY_PATCH_UNVERIFIED` archive had 44/58 E2E tests pass and 14 fail. That candidate contained fixes aimed at those failures, but full runtime tests had not been rerun in that environment.

