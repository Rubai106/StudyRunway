/**
 * StudyRunway chat-workstream E2E.
 *
 * The real /api/agent/* routes are owned by the agent-core workstream and are
 * not landed yet. These specs run against mocked responses shaped exactly to
 * the SSE contract in the chat workstream's task brief, so they verify the UI
 * wiring deterministically. Set LIVE_API=1 to skip mocking and hit the real
 * routes once they exist.
 */
import { test, expect, type Page, type Route } from "@playwright/test";

const LIVE = process.env.LIVE_API === "1";

async function installMocks(page: Page) {
  // Resume gate: the SSE stream pauses at `clarify` until /api/agent/answer lands.
  let releaseResume!: () => void;
  const resumeGate = new Promise<void>((resolve) => {
    releaseResume = resolve;
  });

  await page.route("**/api/agent/status", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        provider: "demo",
        model: "demo-engine",
        configured: false,
        label: "Demo engine",
      }),
    });
  });

  await page.route("**/api/agent/answer", async (route: Route) => {
    releaseResume();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true }),
    });
  });

  await page.route("**/api/agent/chat", async (route: Route) => {
    const req = route.request();
    const body = req.postDataJSON() as { sessionId?: string; message?: string };
    expect(body.sessionId, "chat posts a sessionId").toBeTruthy();
    expect(typeof body.message, "chat posts a message string").toBe("string");

    const slow = (body.message ?? "").includes("SLOW-STREAM");    const events: string[] = [
      `data: {"type":"status","phase":"planning"}`,
      `data: {"type":"assistant_text","text":"Here's what I found. "}`,
      `data: {"type":"tool_call_start","id":"t1","tool":"compare_transfers","label":"Comparing transfer quotes"}`,
      `data: {"type":"tool_call_end","id":"t1","tool":"compare_transfers","ok":true,"summary":"3 quotes compared","durationMs":120}`,
      `data: {"type":"clarify","questions":[{"id":"q-term","kind":"quick_replies","prompt":"Which term is this for?","options":["Fall","Spring"]}]}`,
      `data: {"type":"clarify","questions":[{"id":"q-amount","kind":"amount","prompt":"How much do you need to send?","options":["EUR","GBP","USD"]}]}`,
    ];
    if (slow) {
      // Keep the stream open long enough for the Stop button to cancel it.
      await new Promise((r) => setTimeout(r, 15000));
      await route.fulfill({
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
        body: `data: {"type":"assistant_text","text":"too late"}\n\n`,
      });
      return;
    }
    // Small delay before the first byte so the inline "working" status is
    // observable — a real model stream behaves the same way.
    await new Promise((r) => setTimeout(r, 700));
    await route.fulfill({
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
      body: events.join("\n\n") + "\n\n",
    });
    // Simulate the resumed stream: after the answer POST, append text.
    // (No-op here — the clarify round-trip is asserted via the answer POST.)
    void resumeGate;
  });
}

test.beforeEach(async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));
  // Stash on the page for the error assertion in each test.
  (page as unknown as { __consoleErrors?: string[] }).__consoleErrors =
    consoleErrors;
  if (!LIVE) await installMocks(page);
  await page.goto("/");
  const chat = page.getByRole("button", { name: "Chat", exact: true });
  if ((page.viewportSize()?.width ?? 1280) < 768) {
    await page.getByRole("button", { name: "Open navigation menu", exact: true }).click();
  }
  await chat.click();
});

test.afterEach(async ({ page }) => {
  const errors =
    (page as unknown as { __consoleErrors?: string[] }).__consoleErrors ?? [];
  expect(errors, `browser console errors: ${errors.join(" | ")}`).toEqual([]);
});

test("provider indicator honestly shows Demo mode when unconfigured", async ({
  page,
}) => {
  // Works against the mock and the real /api/agent/status alike: no provider
  // is configured in either, so "Demo mode" must show.
  await expect(page.getByText("Demo mode", { exact: true })).toBeVisible();
});

test("example chip submits a real request to the API", async ({ page }) => {
  const chip = page.getByRole("button", {
    name: /scholarship may arrive late/i,
  });
  await expect(chip).toBeVisible();
  await chip.click();
  // The user message appears in the transcript…
  await expect(
    page.getByText(/scholarship may arrive late/i).first(),
  ).toBeVisible();
  // …and the agent streams a reply, with an inline working status
  // (never a silent wait) while the first byte is on its way.
  if (LIVE) {
    // Real demo-mode API: scripted clarify questions arrive in the stream.
    await expect(
      page.locator('[data-testid^="clarify-"]').first(),
    ).toBeVisible({ timeout: 30000 });
  } else {
    await expect(page.getByText(/Reading your request…|Planning…/)).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByText("Here's what I found.")).toBeVisible({
      timeout: 15000,
    });
  }
});

test("quick reply resumes the task via /api/agent/answer", async ({ page }) => {
  await page
    .getByRole("button", { name: /scholarship may arrive late/i })
    .click();
  // Mocked stream asks q-term; the real demo API asks demo_focus.
  const fall = LIVE
    ? page.getByRole("button", { name: "Answer: Runway forecast" })
    : page.getByRole("button", { name: "Answer: Fall" });
  await expect(fall).toBeVisible({ timeout: 30000 });

  const answerRequest = page.waitForRequest((req) =>
    req.url().includes("/api/agent/answer"),
  );
  await fall.click();
  const req = await answerRequest;
  const payload = req.postDataJSON() as {
    sessionId?: string;
    questionId?: string;
    answers?: Record<string, unknown>;
  };
  expect(payload.sessionId).toBeTruthy();
  expect(payload.questionId).toBe(LIVE ? "demo_focus" : "q-term");
  expect(payload.answers).toEqual(
    LIVE ? { choice: "Runway forecast" } : { choice: "Fall" },
  );
  // The answered question disappears from the transcript.
  await expect(fall).toBeHidden({ timeout: 10000 });
});

test("form validation blocks bad amount input", async ({ page }) => {
  test.skip(LIVE, "mocked API");
  await page
    .getByRole("button", { name: /scholarship may arrive late/i })
    .click();
  const termAnswer = page.getByRole("button", { name: "Answer: Fall" });
  await expect(termAnswer).toBeVisible({ timeout: 15000 });
  await termAnswer.click();

  const amountInput = page.locator('input[type="number"]').first();
  await expect(amountInput).toBeVisible({ timeout: 15000 });
  await amountInput.fill("-50");
  await page.getByRole("button", { name: "Submit", exact: true }).first().click();
  await expect(page.getByText("Enter a positive number.")).toBeVisible();
  // No answer request should have been sent for the invalid submission.
  await page.waitForTimeout(500);
  // Fix it: valid amount + currency passes validation and posts.
  await amountInput.fill("3000");
  await page.locator("select").first().selectOption("EUR");
  const answerRequest = page.waitForRequest((req) =>
    req.url().includes("/api/agent/answer"),
  );
  await page.getByRole("button", { name: "Submit", exact: true }).first().click();
  const req = await answerRequest;
  const payload = req.postDataJSON() as {
    questionId?: string;
    answers?: Record<string, unknown>;
  };
  expect(payload.questionId).toBe("q-amount");
  expect(payload.answers).toMatchObject({ amount: 3000, currency: "EUR" });
});

test("stop button cancels an in-flight stream", async ({ page }) => {
  test.skip(LIVE, "mocked API");
  await page.getByRole("textbox", { name: /message studyrunway/i }).fill(
    "SLOW-STREAM please take your time",
  );
  await page.getByTestId("send-button").click();
  const stop = page.getByTestId("stop-button");
  await expect(stop).toBeVisible({ timeout: 10000 });
  await stop.click();
  await expect(page.getByText("Stopped.")).toBeVisible({ timeout: 10000 });
  // After stopping, retry is offered.
  await expect(
    page.getByRole("button", { name: "Retry", exact: true }).first(),
  ).toBeVisible();
});

test("composer keyboard behavior: Enter sends, Shift+Enter adds a line", async ({
  page,
}) => {
  test.skip(LIVE, "mocked API");
  const box = page.getByRole("textbox", { name: /message studyrunway/i });
  await box.fill("line one");
  await box.press("Shift+Enter");
  await expect(box).toHaveValue("line one\n");
  await box.press("Enter");
  await expect(page.getByText("line one", { exact: true })).toBeVisible({
    timeout: 10000,
  });
});
