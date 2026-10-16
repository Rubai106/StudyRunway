# StudyRunway Demo One-Click Resume Fix

## What was broken
When the no-key demo offered the clarification button “Try the sample student budget”, clicking it only posted the answer to `/api/agent/answer` and hid the question. The client did not call `/api/agent/chat` again to resume the paused task. The old E2E case explicitly typed a second message to resume, masking the real user-facing problem.

## Files in this overlay
- `src/components/chat/ChatWorkspace.tsx`
- `tests/e2e/budget-planner.spec.ts`

## Apply safely
1. Make sure you are in the existing `studyrunway-agent` folder whose `npm ci`, typecheck, lint, unit tests, build, and E2E runs passed after dependency hardening.
2. Back up the two files above.
3. Extract this ZIP directly into `studyrunway-agent`, allowing these two files to be overwritten. Do not replace `package.json`, `package-lock.json`, `.env.local`, or other project files.
4. Run:
   - `npm run typecheck`
   - `npm run lint`
   - `npm test`
   - `npm run build`
   - `npm run e2e -- --workers=1`
   - `npm run e2e`

## Intended behavior
After a clarification/approval answer is accepted, the UI automatically resumes the paused server-side task via an empty-message `/api/agent/chat` request. It displays the resumed assistant output without inventing a second user bubble. The E2E test now asserts that clicking the sample-budget quick reply produces the budget card without requiring a manual follow-up message.

The two changed files passed TypeScript transpile/syntax checks in the packaging environment. The full app test suite has **not** been run on this overlay in that environment; execute the commands above before treating it as verified.
