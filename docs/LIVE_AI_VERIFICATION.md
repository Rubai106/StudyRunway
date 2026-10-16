# Live AI verification

The live check runs against the app server and uses real Vertex AI requests. It
is opt-in, does not run in CI, and may incur charges in the configured Google
Cloud project.

## Run it

1. Start the app with `AI_BACKEND=vertex-adc`, `AUTH_MODE=ADC`, a Vertex project
   and location, and valid Google Cloud Application Default Credentials.
2. Ensure Vertex AI and Google Search grounding are available to that project.
3. From the repository root, run:

   ```sh
   npm run verify:live-ai
   ```

The default target is `http://localhost:3000`. Set `LIVE_AI_BASE_URL` to check
another running instance. The overall request timeout defaults to 180 seconds;
set `LIVE_AI_TIMEOUT_MS` to override it. Set `LIVE_AI_SKIP_FINANCE=1` to run
only the policy-grounding probe.

## What it checks

- `/api/agent/status` selects configured Vertex AI rather than demo mode.
- A student-finance prompt receives a model-driven answer or clarification.
- A country-specific student-policy request returns an answer, a recent
  `checkedAt` timestamp, official HTTPS sources, and claims linked to those
  sources by Google Search grounding metadata.
- Temporary in-memory agent sessions are deleted after each probe when the
  server is reachable.

The script prints provider/model, elapsed time, source and claim counts, and
sanitized failure summaries. It does not print prompt contents, access tokens,
or full model responses. A passing checked-at timestamp means the lookup ran
recently; it does not establish that the university page itself is current.
