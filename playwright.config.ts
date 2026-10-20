import { randomBytes } from "node:crypto";
import { defineConfig, devices } from "@playwright/test";

// Each E2E run gets an ephemeral secret. A signed Auth.js test cookie lets the
// existing UI and protected API routes exercise the real auth boundary without
// Google credentials; the secret is only passed to this local test server.
const e2eAuthSecret = randomBytes(32).toString("hex");
process.env.STUDYRUNWAY_E2E_AUTH_SECRET = e2eAuthSecret;

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 90_000,
  // Fail the suite as a whole if a regression causes many tests to hang.
  globalTimeout: 12 * 60 * 1000,
  globalSetup: "./tests/e2e/global-setup.ts",
  // The demo server compiles route bundles on demand. Keep browser pressure
  // bounded so concurrent workers cannot exhaust local resources and turn an
  // HMR-chunk load failure into a false product regression.
  workers: 2,
  use: {
    baseURL: "http://localhost:3100",
    storageState: "test-results/e2e-auth-state.json",
  },
  webServer: {
    command: "npm run dev -- -p 3100",
    // Browser tests must be deterministic and must never call a real provider,
    // even when the developer has a real key in .env.local.
    env: {
      AI_BACKEND: "demo",
      AI_PROVIDER: "demo",
      XAI_API_KEY: "PLACEHOLDER",
      GEMINI_API_KEY: "PLACEHOLDER",
      OPENAI_API_KEY: "PLACEHOLDER",
      ANTHROPIC_API_KEY: "PLACEHOLDER",
      // Explicit local-only Auth.js setup for the signed E2E session fixture.
      AUTH_SECRET: e2eAuthSecret,
      AUTH_GOOGLE_ID: "study-runway-e2e-client-id",
      AUTH_GOOGLE_SECRET: "study-runway-e2e-client-secret",
      AUTH_URL: "http://localhost:3100/api/auth",
      STUDYRUNWAY_SESSION_STORE: "memory",
      STUDYRUNWAY_DEMO_MODE: "true",
    },
    url: "http://localhost:3100",
    // Never accidentally test a stale app from another extracted ZIP. Opt in to
    // reusing a manually started server only with PW_REUSE_SERVER=1.
    reuseExistingServer: process.env.PW_REUSE_SERVER === "1",
    timeout: 180_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile",
      // Chromium-based 390×844 emulation (only Chromium is installed here).
      use: {
        browserName: "chromium",
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 2,
      },
    },
  ],
});
