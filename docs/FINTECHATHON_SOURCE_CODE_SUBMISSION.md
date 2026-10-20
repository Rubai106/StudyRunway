# StudyRunway — FinTechathon Source Code Submission

## Source repository

- GitHub: https://github.com/Rubai106/StudyRunway
- Live entry point: https://studyrunway-agent-dnwlfigpsa-el.a.run.app/
- Competition: FinTechathon International Track · Topic C: Cross-border & Student Finance Assistant
- Team: Ledgerlight

## What is included

The public repository contains the Next.js application and API routes, deterministic financial engines, agent orchestration and provider adapters, test suites, CI workflow, setup documentation, architecture/security documentation, researched destination-cost dataset and reference screenshots. See the root [README](../README.md) and [project layout](SETUP.md#project-layout-quick-map) for entry points.

## Local setup

1. Install Node.js 20 or newer.
2. Clone the repository and change into its root.
3. Run `npm ci`.
4. Copy `.env.example` to `.env.local`; set the environment variables for your chosen auth and provider configuration. Do not commit `.env.local`, OAuth secrets, service-account credentials or API keys.
5. Run `npm run dev` and open the local URL printed by Next.js. The configured Cloud Run deployment uses Google OAuth and Firestore; local development defaults to a process-local store unless configured otherwise. Full instructions and exact variables are in [Setup](SETUP.md).

A deterministic no-provider demo path is available for the sample budget and Safe-to-Send scenario. Demo-mode outputs are labelled and use sample data. They do not mean a live AI call occurred or that a real payment was made.

## Verification and tests

Run the following from the project root:

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run e2e
```

The latest successful [GitHub Actions run](https://github.com/Rubai106/StudyRunway/actions/runs/39411467566) on main commit `cbe0a31999b54d57299d4a49db2ef79f4b6ba184` passed typecheck, lint, build, **390/390 unit/API tests across 38 files**, and **66 Playwright E2E tests in about 1.6 minutes**. E2E uses Chromium with desktop and 390px mobile coverage. These automated tests do not prove every live external-provider response or deployment route is working end-to-end.

## Security and execution boundaries

Hosted routes require Google OAuth. Cloud Run agent task state is configured to persist in Firestore; local development uses in-memory state by default. Browser-only transcripts/budgets/reminders remain account-scoped local storage and are not synced across devices. Rate limiting is process-local and full dependency security is not cleared: the latest install/audit summary reported 15 findings (1 moderate, 12 high, 2 critical). No real payment or transfer is implemented, and email remains draft-only. See [Security self-assessment](FINTECHATHON_SECURITY_SELF_ASSESSMENT.md) and [Limitations](LIMITATIONS.md).

## Item 06 evidence note

The separately submitted `StudyRunway_Item06_Execution_Evidence_FINAL.zip` contains the primary sandbox receipt, screenshots, captioned evidence PDF, manifest and a **75-second** video. The manifest identifies the local execution revision as `e213b84272d98b03b51807bd1e416bc4f0ad0933`, explicitly enabled deterministic demo mode, and records that the hosted app showed a Google sign-in gate during review. This evidence proves the recorded local sandbox path, not a hosted authenticated transaction. No real money moved.
