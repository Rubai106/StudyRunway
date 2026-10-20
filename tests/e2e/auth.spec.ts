import { test, expect } from "@playwright/test";

test("unauthenticated visitors see sign-in and protected APIs reject access", async ({
  browser,
}) => {
  // Create a deliberately unauthenticated context; the default E2E context
  // receives a short-lived signed test session from global setup.
  const context = await browser.newContext({
    storageState: { cookies: [], origins: [] },
  });

  try {
    const page = await context.newPage();
    await page.goto("http://localhost:3100/");

    await expect(
      page.getByRole("heading", {
        name: "Sign in to your finance workspace",
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Continue with Google" }),
    ).toBeEnabled();

    const response = await context.request.get(
      "http://localhost:3100/api/agent/status",
    );
    expect(response.status()).toBe(401);
    const body = await response.json();
    expect(body).toMatchObject({
      error: "Sign in with Google to use StudyRunway.",
    });
  } finally {
    await context.close();
  }
});
