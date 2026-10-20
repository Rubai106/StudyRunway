/**
 * StudyRunway UI/interaction E2E.
 *
 * Covers: empty/loading/error/recovery states, quick-reply task routing,
 * assumption-correction flow, localStorage persistence + safe deletion,
 * keyboard operation, 390px mobile readability, and reduced-motion behaviour.
 *
 * The 3D visualizer's own honesty guarantees (nodes = real execution events,
 * reduced-motion fallback, dead-WebGL fallback) are already covered in
 * tests/e2e/visualizer.spec.ts — this file references that suite and does
 * not duplicate it.
 *
 * All API traffic is mocked with SSE shaped exactly to the agent event
 * contract; the demo provider indicator is asserted against the real
 * /api/agent/status shape.
 */
import { createHash } from "node:crypto";
import { test, expect, type Page, type Route } from "@playwright/test";

interface AnswerPayload {
  sessionId?: string;
  questionId?: string;
  answers?: Record<string, unknown>;
}

async function installMocks(
  page: Page,
  options: { sessionActive?: boolean } = {},
) {
  const answerRequests: AnswerPayload[] = [];
  let chatRequests = 0;

  await page.route("**/api/agent/session-status**", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        active: options.sessionActive ?? true,
        status: "clarifying",
      }),
    });
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
    answerRequests.push(route.request().postDataJSON() as AnswerPayload);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true }),
    });
  });

  await page.route("**/api/agent/chat", async (route: Route) => {
    chatRequests += 1;
    const body = route.request().postDataJSON() as { message?: string };
    const msg = body.message ?? "";
    let events: string[];
    if (msg.includes("ERROR-STREAM")) {
      if (chatRequests === 1) {
        // First attempt fails; retry (chatRequests === 2) succeeds.
        events = [
          `data: {"type":"status","phase":"planning"}`,
          `data: {"type":"error","message":"Simulated outage — please retry.","recoverable":true}`,
        ];
      } else {
        events = [
          `data: {"type":"status","phase":"planning"}`,
          `data: {"type":"assistant_text","text":"Recovered after the retry."}`,
          `data: {"type":"status","phase":"done"}`,
        ];
      }
    } else if (msg.includes("ASSUMPTION-RESULT")) {
      events = [
        `data: {"type":"status","phase":"planning"}`,
        `data: {"type":"assistant_text","text":"Here is your runway analysis."}`,
        `data: {"type":"result","component":"financial_outcome","data":{"verdict":"You are on track.","currency":"GBP","assumptions":[{"name":"FX rate BDT→GBP","value":"0.0058 (sample assumption)"}]}}`,
        `data: {"type":"status","phase":"done"}`,
      ];
    } else if (msg.includes("TWO-QUESTIONS")) {
      events = [
        `data: {"type":"status","phase":"clarifying"}`,
        `data: {"type":"clarify","questions":[{"id":"q-first","kind":"quick_replies","prompt":"Pick a term","options":["Fall","Spring"]},{"id":"q-second","kind":"quick_replies","prompt":"Pick a priority","options":["Cost","Speed"]}]}`,
      ];
    } else {
      events = [
        `data: {"type":"status","phase":"planning"}`,
        `data: {"type":"assistant_text","text":"Here's what I found."}`,
        `data: {"type":"status","phase":"done"}`,
      ];
    }
    // Small delay so the inline "working" status is observable.
    await new Promise((r) => setTimeout(r, 400));
    await route.fulfill({
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
      body: events.join("\n\n") + "\n\n",
    });
  });

  return {
    answerRequests,
    chatRequestCount: () => chatRequests,
  };
}

async function sendMessage(page: Page, text: string) {
  await page.getByRole("textbox", { name: /message studyrunway/i }).fill(text);
  await page.getByTestId("send-button").click();
}

/** Open responsive navigation before selecting Chat on narrow screens. */
/** Open responsive navigation before selecting Chat on narrow screens. */
async function clickChatNavigation(page: Page) {
  if ((page.viewportSize()?.width ?? 1280) < 1024) {
    const menuButton = page.getByRole("button", { name: "Open navigation menu" });
    await expect(menuButton).toBeVisible({ timeout: 15_000 });
    if ((await menuButton.getAttribute("aria-expanded")) !== "true") {
      await menuButton.click();
    }
  }
  const chatButton = page.getByRole("button", { name: "Chat", exact: true });
  await expect(chatButton).toBeVisible({ timeout: 15_000 });
  await chatButton.click();
}


async function openChat(page: Page) {
  await page.goto("/");
  await clickChatNavigation(page);
}

test.describe("interaction states", () => {
  test.beforeEach(async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => consoleErrors.push(String(err)));
    (page as unknown as { __consoleErrors?: string[] }).__consoleErrors =
      consoleErrors;
  });

  test.afterEach(async ({ page }) => {
    const errors =
      (page as unknown as { __consoleErrors?: string[] }).__consoleErrors ?? [];
    expect(errors, `browser console errors: ${errors.join(" | ")}`).toEqual([]);
  });

  test("empty state shows the intro with example prompts", async ({ page }) => {
    await installMocks(page);
    await openChat(page);
    await expect(
      page.getByRole("button", { name: /scholarship may arrive late/i })
    ).toBeVisible();
    // No messages yet and nothing persisted.
    const keys: string[] = await page.evaluate(() =>
      Object.keys(localStorage).filter((k) => k.startsWith("studyrunway.chat."))
    );
    expect(keys).toEqual([]);
  });

  test("loading state: inline working status while the stream starts", async ({
    page,
  }) => {
    await installMocks(page);
    await openChat(page);
    await sendMessage(page, "hello world");
    await expect(page.getByText(/Reading your request…|Planning…/)).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByText("Here's what I found.")).toBeVisible({
      timeout: 15000,
    });
  });

  test("error state shows an alert and Retry recovers", async ({ page }) => {
    const mocks = await installMocks(page);
    await openChat(page);
    await sendMessage(page, "ERROR-STREAM trigger please");

    const alert = page
      .getByRole("alert")
      .filter({ hasText: /Simulated outage/ });
    await expect(alert).toContainText("Simulated outage — please retry.", {
      timeout: 15000,
    });
    const retry = alert.getByRole("button", { name: "Retry", exact: true });
    await expect(retry).toBeVisible();
    await retry.click();

    await expect(page.getByText("Recovered after the retry.")).toBeVisible({
      timeout: 15000,
    });
    expect(mocks.chatRequestCount()).toBe(2);
  });

  test("quick replies answer the correct question when several are pending", async ({
    page,
  }) => {
    const mocks = await installMocks(page);
    await openChat(page);
    await sendMessage(page, "TWO-QUESTIONS please");

    const fall = page.getByRole("button", { name: "Answer: Fall" });
    const cost = page.getByRole("button", { name: "Answer: Cost" });
    await expect(fall).toBeVisible({ timeout: 15000 });
    await expect(cost).toHaveCount(0);

    await fall.click();
    await expect(fall).toBeHidden({ timeout: 10000 });
    // One-question-at-a-time UX: the second question appears after the first is answered.
    await expect(cost).toBeVisible({ timeout: 15000 });
    await cost.click();
    await expect(cost).toBeHidden({ timeout: 10000 });

    expect(mocks.answerRequests).toHaveLength(2);
    expect(mocks.answerRequests[0]?.questionId).toBe("q-first");
    expect(mocks.answerRequests[0]?.answers).toEqual({ choice: "Fall" });
    expect(mocks.answerRequests[1]?.questionId).toBe("q-second");
    expect(mocks.answerRequests[1]?.answers).toEqual({ choice: "Cost" });
  });

  test("quick replies are keyboard-operable", async ({ page }) => {
    await installMocks(page);
    await openChat(page);
    await sendMessage(page, "TWO-QUESTIONS please");
    const fall = page.getByRole("button", { name: "Answer: Fall" });
    await expect(fall).toBeVisible({ timeout: 15000 });
    await fall.focus();
    await page.keyboard.press("Enter");
    await expect(fall).toBeHidden({ timeout: 10000 });
  });

  test("composer is reachable by keyboard: Tab lands on it, Enter sends", async ({
    page,
  }) => {
    await installMocks(page);
    await openChat(page);
    // Tab through the header controls until the composer has focus.
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press("Tab");
      if (
        await page
          .getByRole("textbox", { name: /message studyrunway/i })
          .evaluate((el) => el === document.activeElement)
      ) {
        break;
      }
    }
    await expect(
      page.getByRole("textbox", { name: /message studyrunway/i })
    ).toBeFocused();
    await page.keyboard.type("keyboard hello");
    await page.keyboard.press("Enter");
    await expect(page.getByText("keyboard hello", { exact: true })).toBeVisible({
      timeout: 10000,
    });
  });

  test("assumption correction: validation, then a follow-up message is posted", async ({
    page,
  }) => {
    const mocks = await installMocks(page);
    await openChat(page);
    await sendMessage(page, "ASSUMPTION-RESULT run it");

    await expect(page.getByText("You are on track.")).toBeVisible({
      timeout: 15000,
    });
    const disclosure = page.getByRole("button", { name: /Assumptions \(1\)/ });
    await expect(disclosure).toBeVisible();
    await disclosure.click();
    await page.getByRole("button", { name: "Correct", exact: true }).click();

    const input = page.getByLabel(/Corrected value for/);
    await expect(input).toBeVisible();
    const correctionForm = page.locator("form", { has: input });
    const sendCorrection = correctionForm.getByRole("button", {
      name: "Send",
      exact: true,
    });
    // Empty submit is rejected client-side and stays on screen.
    await sendCorrection.click();
    await expect(
      page.getByText("Enter the corrected value first.")
    ).toBeVisible();
    expect(mocks.chatRequestCount()).toBe(1);

    await input.fill("0.0062 (bank quote)");
    await sendCorrection.click();
    // The correction becomes a real follow-up user message that recalculates.
    await expect(
      page.getByText(/I want to correct an assumption/, { exact: false }).first()
    ).toBeVisible({ timeout: 15000 });
    expect(mocks.chatRequestCount()).toBe(2);
  });

  test("conversation persists across reload and deletes safely", async ({
    page,
  }) => {
    await installMocks(page);
    await openChat(page);
    await sendMessage(page, "remember this message xyz");
    await expect(page.getByText("Here's what I found.")).toBeVisible({
      timeout: 15000,
    });

    const keys: string[] = await page.evaluate(() =>
      Object.keys(localStorage).filter((k) => k.startsWith("studyrunway."))
    );
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.some((k) => k.startsWith("studyrunway.chat."))).toBe(true);

    // Reload: the transcript is restored.
    await page.reload();
    await clickChatNavigation(page);
    await expect(
      page.getByText("remember this message xyz", { exact: true })
    ).toBeVisible({ timeout: 15000 });
    await expect(page.getByText("Here's what I found.")).toBeVisible();

    // Delete my data: confirm wipes every StudyRunway-owned key…
    page.on("dialog", (dialog) => dialog.accept());
    await page
      .getByRole("button", { name: "Delete my data" })
      .first()
      .click();
    await expect(
      page.getByRole("button", { name: /scholarship may arrive late/i })
    ).toBeVisible({ timeout: 10000 });
    const keysAfter: string[] = await page.evaluate(() =>
      Object.keys(localStorage).filter((k) => k.startsWith("studyrunway."))
    );
    expect(keysAfter).toEqual([]);
    // …and the conversation is cleared (intro returns, the message is gone).
    await expect(
      page.getByText("remember this message xyz", { exact: true })
    ).toBeHidden();
  });

  test("expired persisted transcript starts a fresh conversation after server restart", async ({ page }) => {
    const storageSuffix = `.__user_${createHash("sha256").update("studyrunway-e2e-user").digest("hex").slice(0, 32)}`;
    const lastSessionKey = `studyrunway.last-session${storageSuffix}`;
    const transcriptKey = `studyrunway.chat.expired-session-123${storageSuffix}`;
    await installMocks(page, { sessionActive: false });
    await page.addInitScript((keys) => {
      const sessionId = "expired-session-123";
      const stored = {
        sessionId,
        savedAt: Date.now(),
        messages: [
          {
            id: "old-assistant",
            role: "assistant",
            text: "Old session assistant message",
            results: [],
            pendingClarifications: [
              {
                id: "old-question",
                kind: "quick_replies",
                prompt: "Old pending question",
                options: ["Try old action"],
              },
            ],
            answeredQuestionIds: [],
          },
        ],
      };
      localStorage.setItem(keys.lastSessionKey, sessionId);
      localStorage.setItem(keys.transcriptKey, JSON.stringify(stored));
    }, { lastSessionKey, transcriptKey });

    await openChat(page);
    await expect(
      page.getByText(/Your previous conversation expired when the server restarted/),
    ).toBeVisible();
    await expect(
      page.getByText("Old session assistant message", { exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /scholarship may arrive late/i }),
    ).toBeVisible();
    expect(
      await page.evaluate((key) => localStorage.getItem(key), lastSessionKey),
    ).toBeNull();
  });

  test("no horizontal overflow at 390px with a result on screen", async ({
    page,
  }) => {
    await installMocks(page);
    await openChat(page);
    await sendMessage(page, "ASSUMPTION-RESULT run it");
    await expect(page.getByText("You are on track.")).toBeVisible({
      timeout: 15000,
    });
    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(
      overflow.scrollWidth,
      `horizontal overflow: scrollWidth ${overflow.scrollWidth} > clientWidth ${overflow.clientWidth}`
    ).toBeLessThanOrEqual(overflow.clientWidth + 1);
    // Key controls remain visible and tappable at 390px.
    await expect(page.getByTestId("send-button")).toBeVisible();
    await expect(
      page.getByRole("textbox", { name: /message studyrunway/i })
    ).toBeVisible();
  });

  test("provider indicator honestly shows Demo mode when unconfigured", async ({
    page,
  }) => {
    await installMocks(page);
    await openChat(page);
    await expect(page.getByText("Demo mode", { exact: true })).toBeVisible();
  });
});

test.describe("reduced motion", () => {
  test("chat still works end to end with reduced motion", async ({ page }) => {
    await installMocks(page);
    await openChat(page);
    await page.emulateMedia({ reducedMotion: "reduce" });
    // The media query is honored by the page…
    expect(
      await page.evaluate(() =>
        window.matchMedia("(prefers-reduced-motion: reduce)").matches
      )
    ).toBe(true);
    await sendMessage(page, "hello reduced motion");
    await expect(page.getByText("Here's what I found.")).toBeVisible({
      timeout: 15000,
    });
    // No 3D canvas is required for the core chat flow.
    expect(await page.locator("canvas").count()).toBe(0);
  });
});
