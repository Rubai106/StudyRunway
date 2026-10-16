# StudyRunway Clarification UI Fix

## What this fixes

- A currency clarification with omitted or invalid model-provided options now gets a supported ISO currency list instead of an empty dropdown.
- Currency options display readable labels such as `BDT — Bangladeshi Taka`, while the submitted value remains the ISO code.
- The server normalizes omitted currency options and validates submitted currency answers against supported codes.
- Only one clarification form is displayed at a time. After it is answered, the next question is shown; the task resumes after the final answer.
- A plain greeting such as `hi` or `hello` receives a greeting instead of triggering financial intake questions. In demo mode, the reply is clear that unrestricted AI guidance requires a configured model.

## Files included

- `src/components/chat/ClarifyForm.tsx`
- `src/components/chat/answers.ts`
- `src/components/chat/answers.test.ts`
- `src/components/chat/ChatWorkspace.tsx`
- `src/lib/agent/orchestrator.ts`
- `src/lib/agent/__tests__/orchestrator.test.ts`

## Apply

1. Stop the dev server with Ctrl+C.
2. Back up the six files above.
3. Extract this ZIP into the existing `studyrunway-agent` folder and allow the six files to be overwritten. Do not replace `package.json`, `package-lock.json`, or `.env.local`.
4. Click **New conversation** in the browser after restarting the server. This avoids old clarification cards from the previous session.
5. Run `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, and both `npm run e2e -- --workers=1` and `npm run e2e`.

## Verification status

This is a source patch. Static TypeScript syntax validation is performed during packaging, but the full runtime suite has not been run against this exact patch in this environment. Do not treat it as verified until the commands above pass.
