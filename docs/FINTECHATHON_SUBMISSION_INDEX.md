# StudyRunway — FinTechathon Submission Index

**Team:** Ledgerlight  
**Event:** 2026 Shenzhen International FinTech Competition · FinTechathon International Track · Topic C: Cross-border & Student Finance Assistant  
**Repository:** https://github.com/Rubai106/StudyRunway  
**Hosted URL:** https://studyrunway-agent-dnwlfigpsa-el.a.run.app/  
**Current CI evidence:** [main-branch Actions runs](https://github.com/Rubai106/StudyRunway/actions/workflows/quality.yml?query=branch%3Amain). Each run shows the exact commit SHA and its own test counts; historic counts should not be copied to a newer revision.

This page maps the six submission checklist items to maintained source documents and the current execution-evidence package. It also distinguishes current repository CI from the separate local sandbox video run.

## Checklist mapping

| # | Required item | Submission material / source | Status and caveat |
|---|---|---|---|
| 01 | Technical documentation — architecture, core algorithm, security design | [FinTechathon Technical Documentation](FINTECHATHON_TECHNICAL_DOCUMENTATION.md), [Architecture](ARCHITECTURE.md), [Safe-to-Send engine](SAFE_TO_SEND_ENGINE.md), [Setup](SETUP.md) | Architecture, deterministic decision boundary, auth/storage boundary and local setup documented. |
| 02 | Final presentation — no longer than 10 minutes | Updated deck: `StudyRunway_FinTechathon_Presentation_Final.pptx` (delivered separately with the submission materials) | 16 slides; speaker-note timing totals 9m35s, below the 10-minute limit. The Overview and chat captures are tightly framed, and Income Shock, Housing Safety, Cross-border Cash Flow, and Arrival Costs each have a dedicated feature spotlight slide with a large cropped screenshot. Current CI metrics, auth/storage state, hosted gate, evidence provenance and audit caveat updated. |
| 03 | Demo video — optional, up to 5 minutes | Item 06 ZIP: `06_execution_evidence/06d_demo_walkthrough.mp4` | 75 seconds, H.264/AAC. Local deterministic demo-mode sandbox flow; no real payment. See manifest. |
| 04 | Source code — README, repo link, deployment instructions and test cases | [GitHub repository](https://github.com/Rubai106/StudyRunway), [Source Code Submission](FINTECHATHON_SOURCE_CODE_SUBMISSION.md), [README](../README.md), [Setup](SETUP.md), [Test Results](TEST_RESULTS.md) | Use the current main-branch Actions run above for revision-specific CI results. The full dependency tree audit remains unresolved. |
| 05 | Security self-assessment — permission tiers and known-risk list | [FinTechathon Security Self-Assessment](FINTECHATHON_SECURITY_SELF_ASSESSMENT.md), [Detailed repository assessment](SECURITY_SELF_ASSESSMENT.md), [Limitations](LIMITATIONS.md) | Describes capability tiers (not RBAC), OAuth/Firestore deployment, public acknowledgement boundary, process-local limits, data-sync limitations and 15 dependency findings. |
| 06 | Execution evidence — logs/receipts and demo video for non-on-chain topics | `StudyRunway_Item06_Execution_Evidence_FINAL.zip` from submission materials | Contains sandbox JSON receipt, 7 screenshots, 4-page PDF, manifest, checksums and video. Receipt status APPLIED, decision READY_TO_SIMULATE → SIMULATED. No real money moved. |

## Evidence and revision boundaries

- The main-branch Actions history above is the source of truth for current automated CI. Check the run's commit SHA and test totals together; a green result on an older SHA does not validate later source changes.
- The Item 06 local sandbox execution used source revision `e213b84272d98b03b51807bd1e416bc4f0ad0933` with `STUDYRUNWAY_DEMO_MODE=true` and no AI provider configured. The evidence manifest and SHA-256 list are inside the ZIP.
- The hosted entry point displayed a Google sign-in gate during the evidence review, and anonymous agent API calls returned 401. The local video is **not** presented as a hosted authenticated execution; the deployed revision was not established by that evidence pass.
- The sample institution, quote, dates and amounts in the sandbox run are fictional demo data. Safe-to-Send added a sandbox record only. No bank transfer or payment was initiated.
- Dependency risk remains open: a full-tree audit on 19 October 2026 reported 15 findings (1 moderate, 12 high, 2 critical). A production-only audit on the tested Windows tree reported zero findings, but that does not clear the full dependency tree or establish the current audit state.

## Repository cleanup policy

The root README links a curated screenshot gallery: `docs/screenshots/00-welcome.png`, `01-budget-demo.png`, `03-budget-sources.png`, and `income-shock.jpg`. The first three are reference captures from 15 October 2026; the Income Shock capture is from 20 October 2026. They demonstrate feature UI, not proof that the hosted deployment has identical screens or that a live transaction occurred. The capture script remains available for local QA; generated screenshots are ignored by default except for the curated, tracked files. The separate Item 06 evidence ZIP remains the authoritative artifact for the recorded local sandbox run.
