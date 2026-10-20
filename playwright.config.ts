import { defineConfig, devices } from "@playwright/test";
import path from "node:path";
import { E2E_AUTH_SECRET } from "./tests/e2e/auth-state";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 90_000,
  globalSetup: "./tests/e2e/global-setup.ts",
  // The demo server compiles route bundles on demand. Keep browser pressure
  // bounded so concurrent workers cannot exhaust local resources and turn an
  // HMR-chunk load failure into a false product regression.
  workers: 2,
  use: {
    baseURL: "http://localhost:3100",
    storageState: path.join(process.cwd(), "test-results", "e2e-auth-state.json"),
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
      AUTH_SECRET: E2E_AUTH_SECRET,
      AUTH_GOOGLE_ID: "e2e-client-id",
      AUTH_GOOGLE_SECRET: "e2e-client-secret",
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
      // Chromium-based 390px emulation (only Chromium is installed here).
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
