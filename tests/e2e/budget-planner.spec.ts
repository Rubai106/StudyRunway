/**
 * StudyRunway Destination Budget Planner E2E.
 *
 * How each spec reaches the deterministic engine is stated in its title:
 *
 * - [demo-mode · real engine] / [demo-mode · real routes]: NO route mocking.
 *   These hit the real /api/agent/* routes on the dev server in demo mode
 *   (no provider key configured). Demo mode runs the REAL
 *   build_living_cost_plan tool through the REAL executeToolCall path with
 *   the REAL sourced cost dataset — the unmocked deterministic-engine path.
 * - [deterministic engine · client-side]: the LivingCostPlan card re-runs
 *   the real buildLivingCostPlan() engine in the browser when assumptions
 *   change (it imports the same engine + dataset code client-side).
 * - [mocked transport · real engine data]: the SSE transport is mocked, but
 *   the payload is produced by importing the REAL engine in this spec's
 *   Node context — no hand-written figures. Used for the Canada
 *   insufficient_data case, which the demo chat flow cannot reach.
 *
 * NOTE (dev-server state): agent task state is held in a globalThis-backed
 * process-local Map so Next development hot reloads do not wipe active tasks.
 * A true process restart still clears it. The beforeAll hook warms every API
 * route to avoid first-compile races; Playwright's webServer is configured to
 * start its own demo-mode server instead of reusing an unrelated stale process.
 */
import { test, expect, type Page } from "@playwright/test";
import { buildLivingCostPlan } from "../../src/lib/livingCosts";

const BASE = "http://localhost:3100";

test.beforeAll(async () => {
  // Warm every route bundle so later requests never trigger a recompile.
  // The session-status route must be warmed too; otherwise its first compile
  // can restart dev modules in the middle of a session-chained test.
  await fetch(`${BASE}/api/agent/status`);
  await fetch(`${BASE}/api/agent/session-status?sessionId=warmup`);
  await fetch(`${BASE}/api/agent/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId: "warmup", message: "warmup" }),
  });
  await fetch(`${BASE}/api/agent/answer`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId: "warmup",
      questionId: "nope",
      answers: {},
    }),
  });
  await fetch(`${BASE}/api/agent/budget-apply`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  await fetch(`${BASE}/api/agent/budget-revert`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
});

function watchConsole(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(String(err)));
  return errors;
}

function expectNoConsoleErrors(errors: string[]) {
  expect(errors, `browser console errors: ${errors.join(" | ")}`).toEqual(
    [],
  );
}

/** Click the welcome-screen demo button and wait for the budget card. */
async function runSampleDemo(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Chat", exact: true }).click();
  await page
    .getByRole("button", { name: /Try the sample student budget/ })
    .click();
  const verdict = page.getByText(
    "Shortfall — typical costs are above your budget",
  );
  await expect(verdict).toBeVisible({ timeout: 60_000 });
}

/** Send a chat message through the composer. */
async function sendMessage(page: Page, text: string) {
  await page.getByRole("textbox", { name: /message studyrunway/i }).fill(text);
  await page.keyboard.press("Enter");
}

test.describe("destination budget planner", () => {
  test("[demo-mode · real engine] sample budget button renders the living-cost plan from the real deterministic engine", async ({
    page,
  }) => {
    const errors = watchConsole(page);
    await runSampleDemo(page);

    // Verdict + budget-vs-spending rows (real engine figures, EUR).
    await expect(page.getByText("Your monthly budget")).toBeVisible();
    await expect(page.getByText("Typical estimated spending")).toBeVisible();
    await expect(page.getByText("Monthly shortfall")).toBeVisible();
    await expect(page.getByText("€1,503.78").first()).toBeVisible();
    await expect(page.getByText("€603.78").first()).toBeVisible();

    // Category breakdown.
    await expect(
      page.getByRole("heading", { name: "Monthly breakdown" }),
    ).toBeVisible();
    await expect(page.getByText("Rent", { exact: true }).first()).toBeVisible();

    // Demo honesty label — no model involved.
    await expect(
      page.getByText(/Demo mode — no model provider configured/).first(),
    ).toBeVisible();

    // Visa requirement is visually separate and explicitly regulatory.
    await expect(
      page.getByText("What the visa office requires"),
    ).toBeVisible();
    await expect(
      page.getByText("Regulatory minimum — not what you'll spend"),
    ).toBeVisible();
    await expect(page.getByText("€10,000.00")).toBeVisible();

    // Sources + freshness labels.
    await page.getByRole("button", { name: /Sources \(/ }).click();
    await expect(page.getByText("educationinireland.com").first()).toBeVisible();
    await expect(page.getByText(/Checked /).first()).toBeVisible();

    expectNoConsoleErrors(errors);
  });

  test("[demo-mode · real routes] clarification question answered, then the sample run resumes", async ({
    page,
  }) => {
    const errors = watchConsole(page);
    await page.goto("/");
    await page.getByRole("button", { name: "Chat", exact: true }).click();
    await sendMessage(page, "help me plan my living costs abroad");

    // Demo mode cannot reason — it asks an honest clarifying question.
    await expect(
      page.getByText(/Pick a deterministic demo workflow/i),
    ).toBeVisible({ timeout: 30_000 });
    await page
      .getByRole("button", { name: "Answer: Try the sample student budget" })
      .click();

    // A successful one-tap answer must automatically resume the paused demo
    // flow; users should not have to send a second, artificial follow-up.
    await expect(
      page.getByText("Shortfall — typical costs are above your budget"),
    ).toBeVisible({ timeout: 60_000 });

    expectNoConsoleErrors(errors);
  });

  test("[deterministic engine · client-side] adjusting accommodation re-runs the real engine and updates totals", async ({
    page,
  }) => {
    const errors = watchConsole(page);
    await runSampleDemo(page);

    const adjustedTypical = () =>
      page
        .locator("dt", { hasText: /^Typical spending$/ })
        .locator("xpath=following-sibling::dd")
        .textContent();

    // Switch accommodation: off-campus shared (€775 est.) -> on-campus
    // student residence (€750 est.). The engine re-runs in the browser.
    await page.getByLabel("Accommodation").selectOption({
      label: "student residence (on-campus, UL)",
    });
    await expect(page.getByText("Original vs adjusted")).toBeVisible({
      timeout: 15_000,
    });
    // Original €1,503.78 vs adjusted €1,477.53 (rent −€25/mo and the 5%
    // contingency re-derives) — computed by the engine, not by hand.
    expect(await adjustedTypical()).toContain("€1,477.53");

    // Reset returns to the original plan.
    await page.getByRole("button", { name: "Reset" }).click();
    await expect(page.getByText("Original vs adjusted")).toHaveCount(0);
    await expect(page.getByText("€1,503.78").first()).toBeVisible();

    // Food habits: the dataset has no cooking-habit price split, so the honest
    // control is an explicit monthly food estimate. Entering one re-runs the
    // real engine: groceries €216.67 → €300.00 (+€83.33) and the 5%
    // contingency re-derives, so the typical total becomes €1,591.28.
    await page.getByLabel(/Monthly food budget/).fill("300");
    await expect(page.getByText("Original vs adjusted")).toBeVisible({
      timeout: 15_000,
    });
    expect(await adjustedTypical()).toContain("€1,591.28");

    // Reset restores the original plan before the scenario check below.
    await page.getByRole("button", { name: "Reset" }).click();
    await expect(page.getByText("Original vs adjusted")).toHaveCount(0);

    // Lower-cost scenario comparison: the Low band sits below Typical.
    // (The radios are sr-only inputs inside labels; clicking the label is
    // the real user interaction.)
    await page
      .locator("label", { has: page.getByRole("radio", { name: "Low" }) })
      .click();
    const lowLine = page.getByText(/Low monthly total:/);
    await expect(lowLine).toBeVisible();
    await expect(lowLine).toContainText("€1,164.80");

    expectNoConsoleErrors(errors);
  });

  test("[demo-mode · real routes] apply needs explicit confirmation, then updates the forecast; revert removes exactly the applied obligations", async ({
    page,
  }) => {
    const errors = watchConsole(page);
    await runSampleDemo(page);

    // Approval gate: nothing is written until the user confirms.
    await page
      .getByRole("button", { name: "Apply to my financial plan", exact: true })
      .click();
    await expect(
      page.getByRole("group", { name: "Confirm applying the budget" }),
    ).toBeVisible();
    await expect(page.getByText(/9 obligation\(s\)/)).toBeVisible();

    // Currency honesty gate: the EUR budget cannot enter the GBP forecast
    // without an explicit, dated, sourced rate — the confirm button stays
    // disabled and the limitation is explained rather than silently skipped.
    const confirm = page.getByRole("button", { name: "Confirm — apply budget" });
    await expect(confirm).toBeDisabled();
    await expect(
      page.getByText(
        /will not be included in the numerical forecast until you provide and confirm an explicit/,
      ),
    ).toBeVisible();

    // Supply the explicit rate the app requires (user-entered, never fetched).
    await page.getByLabel("Planning currency per 1 EUR").fill("0.86");
    await page.getByLabel("Rate date").fill("2026-10-15");
    await page.getByLabel(/Rate source/).fill("ECB reference rate (test)");
    await expect(confirm).toBeEnabled();

    await confirm.click();
    await expect(
      page.getByText(/Applied 9 obligation\(s\) for Limerick, Ireland/),
    ).toBeVisible({ timeout: 30_000 });

    // The funding-gap forecast is re-run with the converted amounts, and the
    // rate the user supplied is shown back with its provenance.
    await expect(
      page.getByText(/Conversion used: 1 EUR = 0.86 GBP/),
    ).toBeVisible();
    await expect(
      page.getByText("Lowest projected balance — before"),
    ).toBeVisible();
    await expect(
      page.getByText("Lowest projected balance — after"),
    ).toBeVisible();

    // Revert removes exactly what was applied.
    page.once("dialog", async (dialog) => {
      await dialog.accept();
    });
    await page
      .getByRole("button", { name: "Revert applied budget" })
      .click();
    await expect(
      page.getByText(/Reverted — removed 9 planned obligation\(s\)/),
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      page.getByText(/Lowest projected balance now:/),
    ).toBeVisible();

    expectNoConsoleErrors(errors);
  });

  test("[mocked transport · real engine data] Canada insufficient-data plan renders honestly with apply disabled", async ({
    page,
  }) => {
    const errors = watchConsole(page);

    // The payload comes from the REAL deterministic engine (same code and
    // dataset the server uses); only the SSE transport is mocked because
    // demo chat cannot reach arbitrary destinations.
    const plan = buildLivingCostPlan({
      destinationId: "ca-canada",
      monthlyBudgetMinor: 200000,
      budgetCurrency: "CAD",
      insuranceCovered: false,
    });
    expect(plan.verdict).toBe("insufficient_data");

    await page.route("**/api/agent/chat", async (route) => {
      const events = [
        `data: {"type":"status","phase":"planning"}`,
        `data: {"type":"assistant_text","text":"Canada check."}`,
        `data: ${JSON.stringify({
          type: "result",
          component: "living_cost_plan",
          data: {
            plan,
            inputs: {
              destinationId: "ca-canada",
              monthlyBudgetMinor: 200000,
              budgetCurrency: "CAD",
              insuranceCovered: false,
            },
            recommendations: [],
            recommendationNotes: [],
            accommodationOptions: [],
            demoMode: true,
            note: "Demo mode — no model provider configured: deterministic engine output, no model involved.",
            verified: true,
            summary:
              "Demo mode — no model provider configured: Canada has no typical-cost data.",
          },
        })}`,
      ];
      await route.fulfill({
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
        body: events.join("\n\n") + "\n\n",
      });
    });

    await page.goto("/");
    await page.getByRole("button", { name: "Chat", exact: true }).click();
    await sendMessage(page, "check canada budget please");

    await expect(
      page.getByText("We can't build a reliable budget yet"),
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      page.getByRole("heading", { name: "What's missing" }),
    ).toBeVisible();
    // No totals are guessed — the totals section must not appear.
    await expect(page.getByText("Monthly breakdown")).toHaveCount(0);

    const apply = page.getByRole("button", {
      name: "Apply to my financial plan",
      exact: true,
    });
    await expect(apply).toBeDisabled();
    await expect(apply).toHaveAttribute(
      "title",
      "An insufficient-data plan has no estimates to convert",
    );

    expectNoConsoleErrors(errors);
  });

  test("budget card has no horizontal overflow at 390px and stays keyboard-operable", async ({
    page,
  }) => {
    const errors = watchConsole(page);
    await runSampleDemo(page);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(
      overflow,
      `horizontal overflow: scrollWidth exceeds viewport by ${overflow}px`,
    ).toBeLessThanOrEqual(1);

    // Keyboard: focus the accommodation control and move to a different
    // option. The engine-selected option is pre-selected, so the arrow
    // direction depends on where it sits in the list.
    const acc = page.getByLabel("Accommodation");
    await acc.focus();
    await expect(acc).toBeFocused();
    const selectedIndex = await acc.evaluate(
      (el: HTMLSelectElement) => el.selectedIndex,
    );
    const optionCount = await acc.locator("option").count();
    await page.keyboard.press(
      selectedIndex >= optionCount - 1 ? "ArrowUp" : "ArrowDown",
    );
    await page.keyboard.press("Enter");
    await expect(page.getByText("Original vs adjusted")).toBeVisible({
      timeout: 15_000,
    });

    // Keyboard: drive the apply approval gate end to end. The EUR→GBP
    // mismatch requires an explicit, dated, sourced rate first.
    await page
      .getByRole("button", { name: "Apply to my financial plan", exact: true })
      .focus();
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("group", { name: "Confirm applying the budget" }),
    ).toBeVisible();
    const confirmBtn = page.getByRole("button", {
      name: "Confirm — apply budget",
    });
    await expect(confirmBtn).toBeDisabled();
    await page.getByLabel("Planning currency per 1 EUR").fill("0.86");
    await page.getByLabel("Rate date").fill("2026-10-15");
    await page.getByLabel(/Rate source/).fill("ECB reference rate (test)");
    await expect(confirmBtn).toBeEnabled();
    await confirmBtn.focus();
    await page.keyboard.press("Enter");
    await expect(
      page.getByText(/Applied 9 obligation\(s\) for Limerick, Ireland/),
    ).toBeVisible({ timeout: 30_000 });
    page.once("dialog", async (dialog) => {
      await dialog.accept();
    });
    await page.getByRole("button", { name: "Revert applied budget" }).focus();
    await page.keyboard.press("Enter");
    await expect(
      page.getByText(/Reverted — removed 9 planned obligation\(s\)/),
    ).toBeVisible({ timeout: 30_000 });

    expectNoConsoleErrors(errors);
  });

  test("chat sample budget button is keyboard-operable", async ({
    page,
  }) => {
    const errors = watchConsole(page);
    await page.goto("/");
    await page.getByRole("button", { name: "Chat", exact: true }).click();
    const demo = page.getByRole("button", {
      name: /Try the sample student budget/,
    });
    // Chat welcome actions are disabled until session restoration completes.
    await expect(demo).toBeEnabled({ timeout: 15_000 });
    await demo.focus();
    await expect(demo).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(
      page.getByText("Shortfall — typical costs are above your budget"),
    ).toBeVisible({ timeout: 60_000 });
    expectNoConsoleErrors(errors);
  });

  test("[demo-mode · real engine] Safe-to-Send demo supports approval, sandbox simulation, timeline review, and revert", async ({
    page,
  }) => {
    const errors = watchConsole(page);
    await page.goto("/");
    await page.getByRole("button", { name: "Chat", exact: true }).click();
    const stsButton = page.getByRole("button", {
      name: /Try the Safe-to-Send tuition demo/,
    });
    await expect(stsButton).toBeEnabled({ timeout: 15_000 });
    await stsButton.click();

    // The Safe-to-Send decision card renders with deterministic engine output
    await expect(
      page.getByText("Safe-to-Send + Funding Timeline"),
    ).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText("Ready to simulate").first()).toBeVisible();
    await expect(page.getByText("Sample University of Limerick")).toBeVisible();
    await expect(page.getByText("€3,000.00").first()).toBeVisible();

    // Handle the browser approval confirmation dialog
    page.once("dialog", async (dialog) => {
      await dialog.accept();
    });

    // Approve and simulate
    const approveBtn = page.getByRole("button", { name: "Approve and simulate" });
    await expect(approveBtn).toBeEnabled();
    await approveBtn.click();

    // Latest sandbox action shows APPLIED
    await expect(
      page.getByText(/APPLIED · sim_sts_/i),
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/Current stage:\s*SIMULATED/i)).toBeVisible();

    // Review the current baseline funding timeline through its disclosure.
    // Delay and recovery scenario controls are not part of this Safe-to-Send UI.
    await page
      .getByRole("button", { name: "Funding timeline (baseline projection)" })
      .click();
    await expect(page.getByText("Merit scholarship disbursement (demo)")).toBeVisible();
    await expect(page.getByText("Family transfer from Bangladesh (demo)")).toBeVisible();

    // Revert latest simulation
    const revertBtn = page.getByRole("button", { name: "Revert latest simulation" });
    await expect(revertBtn).toBeEnabled();
    page.once("dialog", async (dialog) => {
      await dialog.accept();
    });
    await revertBtn.click();

    // Status updates to REVERTED
    await expect(
      page.getByText(/REVERTED · sim_sts_/i),
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/Current stage:\s*REVERTED/i)).toBeVisible();

    // Export download button is available
    const exportBtn = page.getByRole("button", {
      name: "Download sandbox execution record",
    });
    await expect(exportBtn).toBeEnabled();

    expectNoConsoleErrors(errors);
  });
});

