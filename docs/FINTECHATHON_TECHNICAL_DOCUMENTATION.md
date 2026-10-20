# StudyRunway — FinTechathon Technical Documentation

**Team:** Ledgerlight  
**Competition:** 2026 Shenzhen International FinTech Competition · FinTechathon International Track · Topic C: Cross-border & Student Finance Assistant  
**Repository:** https://github.com/Rubai106/StudyRunway  
**Hosted entry point:** https://studyrunway-agent-dnwlfigpsa-el.a.run.app/  
**Current automated verification:** main CI commit `cbe0a31999b54d57299d4a49db2ef79f4b6ba184`, 20 October 2026.

## 1. System overview

StudyRunway is a financial-readiness copilot for international students. It combines a chat-first interface with structured funding forms, a deterministic budget and forecast engine, a Safe-to-Send tuition-payment readiness workflow, delay/recovery scenarios and optional AI explanations. It is decision support: it does not move money, execute bank transfers or send email.

The AI layer may clarify a user's goal, ask for missing facts, prepare a plan, call allow-listed tools and explain the result. Server-side deterministic code remains authoritative for financial amounts, dates, statuses, forecasts, approval eligibility, and sandbox apply/revert operations. An AI response cannot directly authorize a simulated action or override the engine's status.

## 2. Architecture

- **Web client:** Next.js 15.5.28, React 19 and TypeScript 5.7. Dashboard results are rendered as UI cards; the chat API streams typed agent events.
- **API and orchestration:** routes under `src/app/api/agent/` validate requests, enforce session requirements and connect the client to the orchestrator in `src/lib/agent/orchestrator.ts`.
- **Agent loop:** validate → understand → clarify if needed → plan → call allow-listed tools → verify eligible deterministic results → return an evidence-aware outcome. Structured model outputs are schema-validated with Zod. Unknown tool names are not executed.
- **Financial engine:** `src/lib/` and `src/lib/safeToSend/` hold currency/money arithmetic, forecast and shortfall detection, living-cost estimates, scenarios, budget integrity checks and Safe-to-Send decision logic. Monetary arithmetic uses integer minor units where applicable.
- **Providers:** the code supports a configurable provider adapter layer including Vertex AI/Gemini and other compatible provider adapters. Provider use depends on environment configuration. The submitted Item 06 video was recorded in deterministic demo mode with no provider configured; it therefore contains no live model-generated financial figures.
- **Authentication:** Auth.js Google OAuth protects the hosted application. The system accepts Google profiles whose email is verified and scopes task keys to the authenticated identity.
- **Server task storage:** local development defaults to in-memory state. The configured Cloud Run deployment uses the Firestore session store with database-scoped runtime IAM, expiry metadata and update-time preconditions for conflicting writes. Stateful production routes fail closed when that store is unavailable.
- **Browser-only data:** transcripts, reminders, budgets and preferences use account-namespaced local storage on that device; they are not synced to Firestore or across devices.

For deeper repository details, see [Architecture](ARCHITECTURE.md), [Setup](SETUP.md), [Feature status](FEATURE_STATUS.md), [Safe-to-Send engine](SAFE_TO_SEND_ENGINE.md) and [Limitations](LIMITATIONS.md).

## 3. Core algorithm and decision boundary

### Funding readiness and forecast

1. Collect dated costs, amounts, currencies and funding sources, including each source's arrival/availability status. Missing or ambiguous material facts should be clarified rather than guessed.
2. Validate user and tool inputs against schema, supported currencies, bounds and business rules.
3. Convert supported values only when an explicit rate with source/date is provided; missing or invalid conversion data blocks conversion rather than inferring an exchange rate.
4. Build an ordered timeline of inflows and obligations. Calculate projected balances and the earliest shortfall from dates and amounts; distinguish available/received funds from expected or unverified funds.
5. Present the deterministic result, its assumptions, uncertainty and relevant evidence. AI explanation is optional and cannot replace the underlying result.

### Safe-to-Send sandbox workflow

The Safe-to-Send engine returns one primary state: `READY_TO_SIMULATE`, `RISK_DETECTED`, `MORE_INFORMATION_REQUIRED`, or `BLOCKED`. Blocking conditions remain blocking, and known material risk is not hidden by missing inputs. Before a sandbox action is applied, the server recomputes the decision and checks the decision identifier/hash, readiness, exact approved action fields and duplicate/stale status. An applied sandbox obligation can be reverted when it remains planned. Rejected attempts may be audit-logged; the relevant invariant is that they do not create an applied obligation.

The exported execution receipt is a sanitized record from recorded sandbox state. The submitted run has simulation `sim_sts_mvghcgmo_1`, status `APPLIED`, and decision `READY_TO_SIMULATE` → `SIMULATED`. It uses a fictional institution and sample quote/amounts. The receipt's SHA-256 is recorded in the evidence package's `SHA256SUMS.txt`.

## 4. Security design

- Google OAuth is required for hosted access; verified email is checked and API routes require a valid server-side session.
- Server task IDs are HMAC-scoped to identity and session; Firestore persistence is configured for Cloud Run.
- Tool names are allow-listed; request schemas and domain rules are checked server-side.
- Financial integrity is re-computed server-side before relevant applies; stale, changed or duplicate sandbox actions are rejected.
- Request origin checks mitigate browser CSRF when an Origin header is present. Pattern-based document injection screening and common-identifier redaction are defense-in-depth, not complete detection.
- Provider credentials remain server-side. Model prose is separated from calculation authority.
- Rate limits remain process-local rather than distributed. Browser-only records remain on the user's device. A fixed public acknowledgment string is not identity verification or a strong transaction authorization token.
- No real money movement or outbound email sending is implemented.

The separate [Security Self-Assessment](FINTECHATHON_SECURITY_SELF_ASSESSMENT.md) is the risk register and should be read alongside [Security Self-Assessment in docs](SECURITY_SELF_ASSESSMENT.md), which contains detailed control evidence and historical audit notes.

## 5. Deployment and limitations

The hosted URL was observed presenting Google sign-in during the 20 October evidence review; anonymous agent API requests returned HTTP 401. The Item 06 walkthrough was executed locally at source revision `e213b84272d98b03b51807bd1e416bc4f0ad0933` with `STUDYRUNWAY_DEMO_MODE=true` and no AI provider. It is a valid deterministic sandbox demonstration but is not proof that the same workflow was performed on the hosted revision. The manifest records this distinction. No real payment or bank transfer occurred.

Cloud Run uses the Google OAuth and Firestore configuration described in [Setup](SETUP.md). Local developers should follow those setup instructions and keep `.env.local`, OAuth secrets, service-account credentials and API keys out of Git. Local development may use process-local memory, but that is not durable across process restarts.

## 6. Verification

Latest successful GitHub Actions run: [39411467566](https://github.com/Rubai106/StudyRunway/actions/runs/39411467566), main commit `cbe0a31999b54d57299d4a49db2ef79f4b6ba184`.

- `npm ci`: passed (installation reported dependency audit findings)
- `npm run typecheck`: passed
- `npm run lint`: passed
- `npm test`: 390/390 tests across 38 files passed
- `npm run build`: passed
- `npm run e2e`: 66 passed in about 1.6 minutes
- Dependency security: **not cleared** — 15 findings were reported (1 moderate, 12 high, 2 critical). The 19 October production-only audit reported zero findings; this does not clear the full dependency tree.

These results are CI results for the named source commit. The separately packaged local execution receipt/video records a different historical source revision; the two forms of evidence should not be conflated.
