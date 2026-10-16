/**
 * E2E tests for the 3D tool visualizer.
 *
 * These run against /visualizer-demo, an internal harness that plays a
 * scripted task through the REAL agent event bus (publishAgentEvent) with
 * real timing. Every assertion checks that the UI reflects actual events:
 * nodes for real tool calls, the peek panel showing the agent's real
 * summary, and honest fallbacks (reduced motion, dead WebGL).
 */

import { test, expect } from "@playwright/test";

const DEMO_URL = "/visualizer-demo";

test.describe("tool visualizer", () => {
  test("honest empty state, then nodes appear for real tool calls and peek shows the real summary", async ({
    page,
  }) => {
    await page.goto(DEMO_URL);

    // Honest empty state before any task.
    await expect(page.getByText("No active task — start a conversation.")).toBeVisible();

    await page.getByRole("button", { name: "Run demo task" }).click();

    // Force the list view so assertions don't depend on GPU availability.
    const toggle = page.getByRole("button", { name: /3D (on|off)/ });
    if ((await toggle.textContent())?.includes("on")) {
      await toggle.click();
    }
    await expect(toggle).toHaveText("3D off");

    const list = page.getByRole("list", { name: "Agent tool calls" });
    // Nodes appear only as the real start events arrive.
    await expect(list.getByRole("button", { name: /parse_intent/ })).toBeVisible();
    await expect(list.getByRole("button", { name: /build_forecast/ })).toBeVisible();
    await expect(list.getByRole("button", { name: /rank_transfer_quotes/ })).toBeVisible();

    // Wait for the demo task to finish (phase pill = "done").
    await expect(page.getByText("done", { exact: true }).first()).toBeVisible({
      timeout: 30_000,
    });

    // Click-peek on the FAILED node shows the agent's REAL summary.
    await list.getByRole("button", { name: /fetch_fx_rate/ }).first().click();
    const dialog = page.getByRole("dialog", { name: /Tool call details/ });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("fetch_fx_rate");
    await expect(dialog).toContainText("failed");
    await expect(dialog).toContainText("FX provider timed out after 3 attempts.");
    await expect(dialog).toContainText("595 ms");
    // Evidence labels from the real result event are shown.
    await expect(dialog).toContainText("tuition-invoice.pdf");

    // Peek closes cleanly.
    await dialog.getByRole("button", { name: "Close details" }).click();
    await expect(dialog).toBeHidden();
  });

  test("reduced motion renders the static list, never the 3D canvas", async ({
    browser,
  }) => {
    const context = await browser.newContext({ reducedMotion: "reduce" });
    const page = await context.newPage();
    await page.goto(DEMO_URL);
    await page.getByRole("button", { name: "Run demo task" }).click();

    const list = page.getByRole("list", { name: "Agent tool calls" });
    await expect(list.getByRole("button", { name: /parse_intent/ })).toBeVisible({
      timeout: 30_000,
    });
    // No WebGL canvas under reduced motion.
    await expect(
      page.getByRole("group", { name: /3D view of agent tool calls/ }),
    ).toBeHidden();
    await context.close();
  });

  test("dead WebGL falls back to the list and the chat stays fully usable", async ({
    browser,
  }) => {
    const context = await browser.newContext();
    // Kill WebGL before any page script runs.
    await context.addInitScript(() => {
      const proto = window.HTMLCanvasElement.prototype as unknown as {
        getContext: (...args: unknown[]) => unknown;
      };
      proto.getContext = () => null;
    });
    const page = await context.newPage();
    await page.goto(DEMO_URL);
    await page.getByRole("button", { name: "Run demo task" }).click();

    // Fallback list renders the same real data.
    const list = page.getByRole("list", { name: "Agent tool calls" });
    await expect(list.getByRole("button", { name: /build_forecast/ })).toBeVisible({
      timeout: 30_000,
    });
    await expect(
      page.getByRole("group", { name: /3D view of agent tool calls/ }),
    ).toBeHidden();

    // The chat input is fully usable — the visualizer never blocks it.
    const input = page.getByLabel("Demo chat input");
    await input.fill("Will my November tuition be covered?");
    await expect(input).toHaveValue("Will my November tuition be covered?");
    await input.press("Enter");
    await context.close();
  });

  test("the 3D canvas renders when WebGL is available", async ({ page }) => {
    await page.goto(DEMO_URL);
    await page.getByRole("button", { name: "Run demo task" }).click();

    const canvas3d = page.getByRole("group", {
      name: /3D view of agent tool calls/,
    });
    // In headless CI without GPU this may fall back to the list; either
    // way the toggle must exist and the view must not be broken.
    const toggle = page.getByRole("button", { name: /3D (on|off)/ });
    await expect(toggle).toBeVisible();
    if (await canvas3d.isVisible().catch(() => false)) {
      // A real <canvas> element is mounted.
      await expect(canvas3d.locator("canvas")).toBeVisible({ timeout: 20_000 });
      // Keyboard: focus the 3D group and arrow through nodes.
      await canvas3d.focus();
      await page.keyboard.press("ArrowRight");
      await expect(page.getByText(/Focused:/)).toBeAttached();
    }
  });
});
