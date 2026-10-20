# StudyRunway — FinTechathon Submission Index

**Team:** Ledgerlight  
**Event:** 2026 Shenzhen International FinTech Competition · FinTechathon International Track · Topic C: Cross-border & Student Finance Assistant  
**Repository:** https://github.com/Rubai106/StudyRunway  
**Hosted URL:** https://studyrunway-agent-dnwlfigpsa-el.a.run.app/  
**Current CI evidence:** [main workflow run 39411467566](https://github.com/Rubai106/StudyRunway/actions/runs/39411467566), commit `cbe0a31999b54d57299d4a49db2ef79f4b6ba184`.

This page maps the six submission checklist items to maintained source documents and the current execution-evidence package. It also distinguishes current repository CI from the separate local sandbox video run.

## Checklist mapping

| # | Required item | Submission material / source | Status and caveat |
|---|---|---|---|
| 01 | Technical documentation — architecture, core algorithm, security design | [FinTechathon Technical Documentation](FINTECHATHON_TECHNICAL_DOCUMENTATION.md), [Architecture](ARCHITECTURE.md), [Safe-to-Send engine](SAFE_TO_SEND_ENGINE.md), [Setup](SETUP.md) | Architecture, deterministic decision boundary, auth/storage boundary and local setup documented. |
| 02 | Final presentation — no longer than 10 minutes | Revised deck: `StudyRunway_FinTechathon_Presentation_Final_Reviewed.pptx` (delivered separately with the submission materials) | 12 slides; speaker notes total approximately 8m55s. Current CI metrics, auth/storage state, hosted gate, evidence provenance and audit caveat updated. |
| 03 | Demo video — optional, up to 5 minutes | Item 06 ZIP: `06_execution_evidence/06d_demo_walkthrough.mp4` | 75 seconds, H.264/AAC. Local deterministic demo-mode sandbox flow; no real payment. See manifest. |
| 04 | Source code — README, repo link, deployment instructions and test cases | [GitHub repository](https://github.com/Rubai106/StudyRunway), [Source Code Submission](FINTECHATHON_SOURCE_CODE_SUBMISSION.md), [README](../README.md), [Setup](SETUP.md), [Test Results](TEST_RESULTS.md) | Latest CI: 390/390 unit/API tests and 66 E2E passed; typecheck, lint and build passed. Full dependency audit remains unresolved. |
| 05 | Security self-assessment — permission tiers and known-risk list | [FinTechathon Security Self-Assessment](FINTECHATHON_SECURITY_SELF_ASSESSMENT.md), [Detailed repository assessment](SECURITY_SELF_ASSESSMENT.md), [Limitations](LIMITATIONS.md) | Describes capability tiers (not RBAC), OAuth/Firestore deployment, public acknowledgement boundary, process-local limits, data-sync limitations and 15 dependency findings. |
| 06 | Execution evidence — logs/receipts and demo video for non-on-chain topics | `StudyRunway_Item06_Execution_Evidence_FINAL.zip` from submission materials | Contains sandbox JSON receipt, 7 screenshots, 4-page PDF, manifest, checksums and video. Receipt status APPLIED, decision READY_TO_SIMULATE → SIMULATED. No real money moved. |

## Evidence and revision boundaries

- Current automated CI is pinned to main commit `cbe0a31999b54d57299d4a49db2ef79f4b6ba184`; it reports 390 unit/API tests and 66 E2E tests passed.
- The Item 06 local sandbox execution used source revision `e213b84272d98b03b51807bd1e416bc4f0ad0933` with `STUDYRUNWAY_DEMO_MODE=true` and no AI provider configured. The evidence manifest and SHA-256 list are inside the ZIP.
- The hosted entry point displayed a Google sign-in gate during the evidence review, and anonymous agent API calls returned 401. The local video is **not** presented as a hosted authenticated execution; the deployed revision was not established by that evidence pass.
- The sample institution, quote, dates and amounts in the sandbox run are fictional demo data. Safe-to-Send added a sandbox record only. No bank transfer or payment was initiated.
- Dependency risk remains open: 15 findings (1 moderate, 12 high, 2 critical) were reported during the current main CI install. A 19 October production-only audit reported zero findings, but this does not clear the complete tree.

## Repository cleanup policy

No files were deleted or overwritten as part of this documentation refresh. Six older screenshots remain tracked under `docs/screenshots/` and are now explicitly marked legacy/reference material. Candidate obsolete patches, duplicate archives, or screenshots should only be removed after the repository owner reviews and approves each proposed deletion.
