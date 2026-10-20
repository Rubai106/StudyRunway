# StudyRunway — FinTechathon Security Self-Assessment

**Scope:** public source repository and configured hosted demo for the 2026 FinTechathon International Track, Topic C.  
**Assessment date:** 20 October 2026.  
**Status:** security controls are implemented and partially tested, but the project is not certified or production-cleared for real financial operations.

## 1. Current identity and persistence design

- The hosted app uses Auth.js Google OAuth. Agent, funding, budget, quote and Safe-to-Send API routes require a valid session; the Google email must be marked verified.
- Server task keys are HMAC-scoped to the authenticated Google identity and client session ID.
- The configured Cloud Run deployment uses Firestore for task persistence with database-scoped IAM and update-time preconditions; stateful routes fail closed if configured Firestore storage is unavailable.
- Local development defaults to a process-local in-memory task store unless Firestore is configured.
- Browser-only transcripts, reminders, budgets and preferences remain in account-namespaced local storage on that device; they are not encrypted by the application, synced across devices or backed up to Firestore.

During the 20 October evidence review, the hosted URL showed the Google sign-in gate and anonymous agent API calls returned HTTP 401. The submitted Item 06 video is a separate local deterministic demo-mode run at revision `e213b84272d98b03b51807bd1e416bc4f0ad0933`; it does not represent a hosted authenticated transaction.

## 2. Current action/permission tiers

| Tier | Capability | Control and limit |
|---|---|---|
| 0 — untrusted input | User forms, imported document text, provider/model outputs | Validate schemas, bounds, currencies and domain constraints; inputs remain untrusted. Pattern screening does not detect every prompt injection. |
| 1 — calculation and planning | Budget estimates, cash-flow forecasts, shortfall detection, scenarios and explanations | Deterministic server calculations own the numbers and statuses. Estimates depend on the source dataset and user-confirmed inputs. |
| 2 — sandbox mutation | Budget apply/revert and Safe-to-Send simulation/revert | Server re-computes integrity-relevant values and rejects blocked, stale, duplicate or tampered actions. Fixed acknowledgement strings are public constants and are not identity proof or strong transaction authorization. |
| 3 — external financial action | Real transfer/payment execution | Not implemented. No real money is moved. Email remains draft-only. |

These are capability tiers, **not RBAC roles**. The app does not claim separate admin/approver roles. A future external financial action would require stronger authenticated, expiring, single-use, server-bound authorization and a separately reviewed payment integration.

## 3. Implemented controls

- Google OAuth and server-side session checks on hosted routes.
- Per-user HMAC scoping for server task/session IDs; configured Cloud Run Firestore persistence and concurrent-write preconditions.
- Zod schema validation, supported currency checks, bounded payloads and allow-listed tool execution.
- Server-side calculation recomputation before relevant apply operations; Safe-to-Send checks decision state, exact action fields, freshness and duplicate status.
- Origin matching for state-changing requests when an `Origin` header is supplied (CSRF mitigation, not authentication).
- Pattern-based document injection screening and common-identifier redaction before provider calls; defense in depth only.
- Server-side provider credentials and limited provider-status disclosure.
- Privacy-limited audit events; Cloud Logging is used when configured, with stdout fallback.

## 4. Residual risks and remediation

| Risk | Current mitigation | Remaining work / impact |
|---|---|---|
| Full dependency audit has unresolved findings | Latest install reported 15 findings; production-only audit on 19 Oct reported zero | Full audit is **not cleared**: 1 moderate, 12 high, 2 critical. Review compatible fixes, re-audit exact release tree, and avoid blind forced major upgrades. |
| Rate limits are process-local | Route-level caps and proxy-header trust is conservative by default | Not distributed; add a shared gateway/Redis limit before broader real-user access. |
| Approval acknowledgement strings are public | Server recomputes decision and validates exact values/freshness/duplicates | Not identity proof. Add expiring, single-use approvals bound to authenticated user and exact action before any external transaction feature. |
| Injection defenses are pattern-based | Screening, allow-listed tools, typed schemas and deterministic authority | Paraphrased/non-English attacks may bypass patterns; use layered tests and never allow model-controlled side effects. |
| Browser-only personal data is local | Per-account namespace and explicit wipe path | Not encrypted/synced/backed up by this design; explain browser/device boundary and add secure sync only with a separate privacy review. |
| Audit durability depends on deployment config | Privacy-limited structured audit events and Cloud Logging when configured | Verify retention, access monitoring and immutable/tamper-evident export for production use. |
| Live policy and transfer integrations | Official-source gate, labels, explicit source/date; optional indicative quote path | A prior live research check returned no citable pages and correctly withheld a result. Do not claim all live research/quote paths are reliably verified; real transfers are not implemented. |
| Verification spans different revisions | CI run is pinned to commit SHA; execution manifest records a separate source revision | Keep automated test results and local video evidence distinct; re-run tests and live smoke checks for the exact future release SHA. |

## 5. Verification record

The latest successful [GitHub Actions workflow](https://github.com/Rubai106/StudyRunway/actions/runs/39411467566) on main commit `cbe0a31999b54d57299d4a49db2ef79f4b6ba184` completed `npm ci`, typecheck, lint, build, **390/390 unit/API tests across 38 files**, and **66 Playwright E2E tests**. CI installation still reported 15 dependency findings. The 19 October production-only audit reported zero vulnerabilities; this does not mean the full tree is clear.

The Item 06 package's 75-second video and exported receipt document one local deterministic Safe-to-Send run in demo mode. The receipt marks the sandbox simulation as APPLIED; all quote/payment values are fictional sample data. The video/manifest explicitly say no real transfer occurred and do not claim a hosted authenticated execution. SHA-256 values and run metadata are included in the evidence package.

## 6. Release decision

**Controlled competition demo:** suitable with its sample data, Google sign-in gate, deterministic mode/environment, receipt provenance and no-real-payment limitation clearly disclosed.

**Production service handling real financial decisions or external actions:** **NO-GO until the full dependency audit is triaged, distributed rate limits and audit retention are reviewed, browser-data limitations are addressed, stronger action approvals are designed for any external integrations, and exact-release live/security verification is completed.** This document is an internal self-assessment, not a certification or guarantee.
