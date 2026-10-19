# StudyRunway — Security Self-Assessment

FinTechathon 2026 · International Track · Topic C. Judging weights security &
compliance at 30% — this document is the honest self-assessment.

Scope: the rebuilt agent at `studyrunway-agent/` (Next.js 15.5.28, React 19).
Evaluated 2026-10-15 by the evaluation workstream. "Residual risks" at the
bottom are the ones we knowingly ship with.

## 1. Tool allow-listing

- The model can only ever invoke tools returned by `getModelTools()` in
  `src/lib/agent/registry.ts`: the eight financial tools plus nothing else.
  The hidden `__ping` self-test tool is explicitly excluded.
- `runModelFlow` resolves every requested tool name with `findTool()` **before**
  touching arguments; an unknown name is never executed — the model receives a
  refusal string (`tool "X" is not on the allow-list and was not executed`).
  Covered by unit test ("never executes a tool that is not on the allow-list")
  and §11 scenario S12 of the eval suite.
- Tool arguments arrive as a JSON string from the model and are parsed with
  `JSON.parse` in a try/catch; unparseable arguments are refused without
  executing the tool.

## 2. Schema validation

- Every tool declares a zod `parameters` schema; `executeToolCall` parses and
  validates args **before** the handler runs. Invalid args throw
  `ArgsValidationError` and the handler is never invoked (eval S11 asserts
  zero handler invocations on malformed args).
- Model-produced JSON (understanding, plan) is validated against
  `ModelUnderstandingSchema` / `ModelPlanSchema` with one correction retry;
  unparseable output becomes a recoverable `error` event, never a hallucinated
  plan.
- SSE wire shapes are enforced by `AgentEventSchemas` (zod) and asserted in
  unit + E2E tests — the client never has to trust malformed events.
- Domain inputs (plan objects, FX tables, quotes) are validated with the zod
  domain model (`model.ts`) inside each tool; `ToolPlanSchema` is
  `.passthrough()` so unknown extra fields are ignored, not trusted.

## 3. Timeouts, call limits, retries

- Per-tool timeout: 15 s default (`toolTimeoutMs`, also enforced inside each
  handler by `withToolTimeout`). A hanging tool rejects with a "timed out"
  error; the timeout counts as transient → exactly one retry, then the error
  is surfaced (eval S11).
- Max tool calls per task: 8 (`maxToolCalls`); max model rounds: 3. The loop
  cannot run away.
- Retry policy: **one** retry, only on transient failures (HTTP 429/5xx via
  `HttpError`, or message patterns `timed out | fetch failed | network |
  econnreset | socket hang up`). Permanent errors are never retried.
- After a fully failed tool round the model may replan **once**, then the loop
  stops trying new approaches.

## 4. Approval gates

- `draft_email.requiresApproval = true` (the only approval-gated tool): the
  orchestrator pauses with a `clarify` event carrying an Approve/Deny form and
  the exact args summary. The call executes only after an explicit
  `{ decision: "approve" }` via `/api/agent/answer`; a deny records the denial
  and resumes planning. Unit-tested in `orchestrator.test.ts`.
- Drafting an email is a pure function — **sending is not implemented**; the
  tool has no side effects and its summary always states "Draft only — not
  sent". No tool in the registry can move money, submit payments, or contact
  anyone (stated in the `ToolDefinition` contract and in each tool's
  description).

## 5. Prompt-injection handling (documents & tool output are untrusted)

- The system prompt (`SYSTEM_PROMPT`) instructs the model to treat tool
  results, uploaded documents, and pasted text as **untrusted data**, never to
  follow instructions inside them, and never to reveal system instructions.
- Defence in depth at the tool layer: `extract_document` screens raw document
  text against 12 instruction-like patterns (ignore/disregard instructions,
  send/transfer/wire money, role override, act-as, jailbreak, system-prompt,
  reveal/forget instructions) **before** any extraction. On a match it returns
  `ok: false`, extracts nothing, follows nothing, and warns the user (eval
  S10 covers the classic shapes).
- Off-allow-list tool names — the classic "model told by a document to call a
  new tool" path — are refused at the orchestrator (see §1).
- The 3D visualizer renders only real execution events; a document cannot
  inject a fake node.

## 6. Secrets

- Provider keys and Vertex ADC (`XAI_API_KEY`, `GEMINI_API_KEY`,
  `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, and Google Cloud credentials) are read
  **server-side only** (`readXaiConfig` etc. run in route handlers / server
  code). Vertex tokens are acquired server-side and sent only to the fixed
  Google Vertex endpoint. The frontend bundle never contains credentials;
  `/api/agent/status` returns only `{ provider, model, configured, label }`.
- The provider unit tests assert the Authorization header is the literal
  `Bearer <redacted>` in logs and that keys never appear in labels.
- `.env.example` contains placeholders only; `.gitignore` excludes
  `.env.local`. No real key or Google Cloud credential exists in this repo or
  environment.

## 7. PII redaction before provider calls

- `sanitizeForModel()` in `orchestrator.ts` redacts email addresses,
  account-number-like digit runs (10–19 digits), national-ID-like strings
  (e.g. passport-shaped `AB1234567`, case-insensitive so lowercase IDs are
  caught too), and phone-like numbers from every user/model message before
  it is sent to a provider — including tool-result messages pushed back into
  the provider conversation, not just user/context messages. Unit-tested,
  including non-redaction of ordinary years and short numbers.

## 8. Data retention & deletion

- Server task state is in-memory only (process-local `Map`); it is lost on
  restart and never leaves the server.
- Server-side agent audit events are emitted as privacy-limited JSON lines to
  stdout. They record task lifecycle, clarification kind/count, approval
  outcome, tool name/outcome/duration, and task deletion. They omit prompts,
  answers, documents, session IDs, tool arguments/results, and credentials.
  Cloud Logging can ingest these on Google Cloud, but durable retention,
  access controls, and tamper-evident exports are deployment configuration;
  local stdout is not a durable audit store.
- Client transcripts live in `localStorage` under the `studyrunway.*` prefix.
  "Delete my data" wipes every key with that prefix after a confirm dialog and
  starts a fresh session (E2E-tested: keys gone, transcript cleared). Reminders
  are also stored only in browser localStorage and are removed by the same
  action; their browser notifications contain no financial details.
- No analytics, no third-party trackers, no cookies set by the app.

## 9. Dependency & platform posture (verified 2026-10-15)

- `next` pinned to **15.5.28** + `sharp` 0.35.5: covers GHSA-p293-qw3h-jr36
  (Windows RCE), GHSA-2464-fhr4-w9xw (image SVG RCE), GHSA-p3m5-59mp-jv5r
  (server-action DoS), and the React2Shell RCE chain (CVE-2025-66478,
  CVE-2025-55183/55184) that affected the scaffolded 15.3.4.
- **Historical audit note — earlier candidate/run (superseded by §14):** `npm audit` could not be completed for that earlier source because registry DNS resolution failed with `EAI_AGAIN registry.npmjs.org`. This is not the current Windows audit result; see §14 for the October 19, 2026 findings.

## 10. What the budget-planner phase fixed (2026-10-15)

- **Strict session-ID validation** (`src/lib/agent/session.ts`): allowlist
  `^[A-Za-z0-9_-]{1,128}$`; anything else is rejected with a clear 400 before
  any state is touched. One session cannot read or delete another's state —
  unknown ids return 404/undefined, never a leak (tested: mismatched access,
  delete isolation).
- **Request-size limits**: 256 KB on `/api/agent/chat` and
  `/api/agent/budget-apply`, 64 KB on `/api/agent/answer` and
  `/api/agent/budget-revert` (413 on oversize).
- **Demo-grade rate limiting** on `/api/agent/chat`, `/api/agent/funding-analysis`,
  and the Wise quote preview (`src/lib/agent/rateLimit.ts`): 30, 10, and 15
  `Retry-After`. In-memory and process-local — explicitly NOT production
  rate limiting. Proxy identity headers are ignored by default so callers
  cannot rotate spoofed `X-Forwarded-For` values to bypass a bucket;
  deployments behind a sanitizing proxy may opt in with
  `STUDYRUNWAY_TRUST_PROXY_HEADERS=true`.
- **Origin check** on state-changing `POST /api/agent/chat`, `DELETE
  /api/agent/chat`, `POST /api/agent/answer`, `POST
  /api/agent/budget-apply`, and `POST /api/agent/budget-revert`: when a
  browser sends an `Origin` header, it must match the request origin (403
  otherwise). Requests with no `Origin` remain available for test/CLI use.
  This mitigates browser CSRF; it is not authentication.
- **PII redaction extended** (see §7): account-number-like and
  national-ID-like strings are now redacted in addition to emails/phones; the
  national-ID pattern is case-insensitive (lowercase IDs are redacted too),
  and redaction is also applied to tool-result messages sent back to the
  provider — not just user/context messages.
- **Keys stay server-side**: source-reviewed — no `NEXT_PUBLIC` key, no
  `*_API_KEY` reference is intentionally exposed by client code;
  `/api/agent/status` returns only provider/model/label.
- **Budget apply validates its input AND verifies plan integrity**: the
  server still validates the destination plan fields that feed obligations
  (safe integer amounts, supported currency codes, bounded labels/source
  fields, tuition consistency) before conversion — and, since the 2026-10-15
  QA hardening pass, it no longer trusts the client-returned plan on shape
  alone. The caller must also send `planInputs` (the budget inputs that
  produced the plan); the server cross-checks `destinationId` against the
  server-side cost dataset (fabricated ids are rejected) and re-runs the
  deterministic engine from those inputs, comparing every key amount
  (currency, verdict, budget, monthly totals, per-category and one-time
  amounts, tuition) with exact minor-unit equality. Any mismatch is rejected
  with HTTP 400 before any state is mutated (implemented in
  `verifyPlanIntegrity`, `src/lib/budgetApply.ts`; enforced by
  `POST /api/agent/budget-apply`).
  Currency conversion requires a positive explicit user rate plus source and
  date; invalid or absent conversion data is rejected without mutating state.
- **Remaining budget-apply limitation**: the final confirmation is a UI-side
  approval gate — the route mutates session state on POST once the gate's
  confirmation reaches the server. There is no server-side "pending approval"
  record; recovery from an accidental confirmed apply is the explicit revert
  endpoint (`POST /api/agent/budget-revert`), which removes exactly the
  applied obligations that are still `planned`.

## 11. Known residual risks (shipped knowingly)

1. **No live provider testing.** All provider adapters are tested against
   mocked HTTP; no real API key exists here, so wire behaviour against the
   live xAI/OpenAI/Anthropic endpoints is unverified in this environment.
   Provider model IDs (`grok-4.7` default) are unverified against a live account.
2. **Injection screening is pattern-based, not semantic.** The 12 regexes in
   `extract_document` catch the classic shapes (eval S10) but a paraphrased or
   non-English injection could pass the screen. The backstops are the system
   prompt, the allow-list, and the approval gate — but a sufficiently clever
   instruction inside a document could still influence model *wording* (not
   tool execution).
3. **In-memory server state and no authentication** mean task state is keyed by
   a client-supplied UUID-like session identifier. IDs are random UUIDs in modern
   browsers and origin checks mitigate browser CSRF, but the ID still acts as a
   bearer identifier. If it is exposed or known, another caller could access the
   matching state. Unknown IDs return 404; this is not user authentication and
   is not acceptable for sensitive production data. Add authenticated ownership
   and durable per-user storage before a real-user launch. Acceptable only for a
   competition
   demo, not for production.
4. **Policy research depends on Vertex and official-domain screening.** The
   implementation uses Vertex Google Search grounding, redacts common direct
   identifiers in the query, and withholds an answer unless cited pages pass
   the official-domain check. The integration has only deterministic mocked
   evaluation here, not a live project run. The domain suffix list can miss a
   legitimate authority; a user-confirmed official host is supported.
5. **Demo mode is a fallback, not a sandbox**: it executes the real tool path
   with real (sample) data; outputs are labelled but could be screenshotted
   out of context.
6. **Rate limiting is demo-grade**: process-local, per-IP from proxy headers
   only when `STUDYRUNWAY_TRUST_PROXY_HEADERS=true`; otherwise a conservative
   shared fallback bucket is used. There is still no distributed enforcement.
   Do not rely on it in production.

7. **Earlier sandbox audit status (superseded by §14).** In that earlier run, both `npm audit` and `npm audit --omit=dev` failed at npm's registry audit endpoint before returning advisory data. That was an environment limitation at the time, not the current Windows audit result. Section 14 records the current result: 15 findings in the full audit and zero reported by the production-only audit. No dependency update or full dependency-security clearance is claimed.

## 12. Approval acknowledgments — what they are and are not (2026-10-19)

- `BUDGET_ACTION_ACKS` (`I_APPROVE_BUDGET_APPLY` / `I_APPROVE_BUDGET_REVERT`,
  `src/lib/budgetApproval.ts`) and `SAFE_TO_SEND_ACTION_ACKS`
  (`I_APPROVE_SIMULATION` / `I_CONFIRM_FUNDING_RECEIPT` /
  `I_APPROVE_SIMULATION_REVERT`, `src/lib/tools/safeToSendApproval.ts`) are
  **fixed, client-visible string constants**. They are imported by client UI
  components (`LivingCostPlan.tsx`, `SafeToSendDecision.tsx`) and therefore
  shipped in the browser bundle; anyone can read or replay them from devtools.
- The server requires the expected acknowledgment value for approval-gated
  actions. This rejects requests with a missing or incorrect acknowledgment,
  but the value is a fixed public string and can be replayed by a caller who
  knows it. It does not prove that a user clicked the confirmation button,
  authenticate a user, or provide strong transaction authorization.
  Request-origin validation is a separate CSRF mitigation, not authentication.
- Four distinct layers must not be conflated:
  1. **Acknowledgment presence check** — the request carries the expected
     fixed string. Rejects missing/wrong values; replayable by anyone who
     knows the string.
  2. **Request-origin check** (`requestOriginError`) — a CSRF mitigation, not
     authentication. It does **not** require an `Origin` header: requests
     without one are allowed (the implementation returns no error when the
     header is absent). Only when a caller supplies an `Origin` header must
     it match the request origin (403 otherwise). This blocks certain
     cross-site browser submissions while leaving headerless callers
     (curl, tests, non-browser clients) unaffected — which is precisely why
     it cannot serve as authentication or authorization.
  3. **Server-side business-rule validation and integrity checks** — the
     actual tamper protection, independent of the ack string: budget-apply
     re-runs the deterministic engine from `planInputs` and rejects any
     amount/label/source mismatch with exact minor-unit equality
     (`verifyPlanIntegrity`); Safe-to-Send recomputes the decision and
     rejects when the `decisionId` hash or any expected field (amounts,
     currencies, due date) differs, and refuses duplicate or stale
     approvals.
  4. **Authentication and authorization** — absent in this build. The ack
     strings provide neither.
- The route-level tests added 2026-10-19 cover layers 1 and 3 (wrong ack
  value; tampered approval fields; stale approval after draft change; reused
  approval; non-ready decision state). Each asserts the rejected request
  leaves financial state unchanged: no applied simulation obligation, no
  change to existing obligations, no new applied record. Rejected attempts
  may still appear as audit-logged `status: "rejected"` records with a
  rejection event and blocked workflow stage — that is intentional
  rejection evidence, not a successful application.

## 13. Demo protections vs production requirements (2026-10-19)

The controls in §§1–10, 12 are **demo-grade** and are sufficient for a
controlled competition demo with a cooperative user. They are **not**
production controls. Before any real-user launch, the following are required
and are currently absent:

| Demo protection (present) | Production requirement (absent) |
|---|---|
| Fixed client-visible ack strings (§12) | Authenticated sessions; per-user ownership of state; signed or server-issued approval tokens bound to the exact transaction |
| Client-supplied UUID session IDs + origin check | Real authentication; server-side session binding to an authenticated principal |
| In-memory per-process rate-limit buckets | Distributed rate limiting (Redis or gateway-level) |
| In-memory task state (lost on restart) | Durable, access-controlled per-user storage |
| Stdout JSON audit lines | Tamper-evident, retained audit store with access controls |
| Pattern-based document-injection screening | Semantic/additional-layer injection defenses for untrusted content |

## 14. Dependency audit status — Windows verification (2026-10-19)

- **Full dependency audit (`npm audit`):** 15 vulnerabilities reported — 1 moderate, 12 high, and 2 critical.
- **Production-only dependency audit (`npm audit --omit=dev`):** zero vulnerabilities reported (`found 0 vulnerabilities`).
- The full audit includes findings involving `@vitest/mocker`, `vitest`, `tinypool`, and `braces` through development/build-tool dependency paths.
- npm's suggested automatic remediation would require `--force` and potentially breaking major-version upgrades, including Vitest 5 and Tailwind CSS 4. No forced upgrade was applied.
- **Dependency security is not cleared.** The production-only result is encouraging, but it does not establish that the entire application is secure.
- This Windows run supersedes earlier audit-blocked and 21-finding reports for the current tree. Those earlier reports remain historical observations from previous runs or dependency trees.
- Review compatible fixes separately, and rerun the full verification suite after dependency changes. Do not run `npm audit fix --force`.

## 15. Verification evidence for this pass (2026-10-19)

All checks below were run on the patched working tree
(commit `4df0fbf` + the 4-file patch, including the §12 wording correction and
the revised test names/invariants). Results are consistent with the
"Security-evidence pass — 2026-10-19" section in `docs/TEST_RESULTS.md`;
earlier PENDING placeholders have been replaced with the actual outcomes.

| Check | Result | Evidence |
|---|---|---|
| `npm ci` | PASSED | exit 0 |
| `npm run typecheck` | PASSED | exit 0, zero errors |
| `npm run lint` | PASSED | exit 0, zero problems |
| `npm test` | PASSED | **37 files, 378/378 tests**, exit 0 — includes 6 new approval-boundary tests (1 budget-apply wrong-ack; 5 safe-to-send route: wrong ack, tampered fields, stale approval, reused approval, non-ready state) |
| `npm run build` | PASSED | exit 0, all routes emitted |
| `npm run e2e` | PASSED | **64/64 tests**, exit 0, ~2.0 min |
| `npm audit` | FINDINGS — NOT CLEARED | 15 vulnerabilities: 1 moderate, 12 high, 2 critical; current Windows audit, 2026-10-19 |
| `npm audit --omit=dev` | PASSED — zero vulnerabilities reported | Actual output: `found 0 vulnerabilities`, Windows audit, 2026-10-19 |

This assessment claims no production readiness and no certification. No
payments, banking credentials, live transfer provider, or outbound email
integration exists in this build. Email stays draft-only; reminders may raise
generic browser notifications on the same device after permission is granted.
The user selected demo access, so authentication remains absent by design.
