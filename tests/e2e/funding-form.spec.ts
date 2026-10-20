import { test, expect } from "@playwright/test";

async function openChat(page: import("@playwright/test").Page) {
  await page.goto("/");
  const chat = page.getByRole("button", { name: "Chat", exact: true });
  if ((page.viewportSize()?.width ?? 1280) < 768) {
    await page.getByRole("button", { name: "Open navigation menu", exact: true }).click();
  }
  await chat.click();
}

test("structured funding form submits multiple financial records to the real forecast", async ({ page }) => {
  await openChat(page);
  await page.getByRole("button", { name: "Enter funding details" }).click();

  await page.getByLabel(/Name/).first().fill("Tuition deposit");
  await page.getByLabel(/Amount/).first().fill("1200");
  await page.getByLabel("Payment deadline", { exact: true }).fill("2027-01-10");
  await page.getByLabel(/Name/).nth(1).fill("Savings");
  await page.getByLabel(/Amount/).nth(1).fill("1500");

  await page.getByRole("button", { name: "+ Add cost" }).click();
  await page.getByLabel(/Name/).nth(1).fill("Monthly rent");
  await page.getByLabel(/Amount/).nth(1).fill("700");
  await page.getByLabel("Payment deadline", { exact: true }).nth(1).fill("2027-02-01");
  await page.getByRole("button", { name: "+ Add funding source" }).click();
  await page.getByLabel(/Name/).nth(3).fill("Expected scholarship");
  await page.getByLabel("Type").nth(1).selectOption("scholarship");
  await page.getByLabel(/Amount/).nth(3).fill("500");
  await page.getByLabel("Funding status").nth(1).selectOption("estimated");
  await page.getByLabel("Expected date", { exact: true }).fill("2027-01-01");

  await page.getByRole("button", { name: "Calculate funding readiness" }).click();
  await expect(page.getByRole("region", { name: "Financial outcome" })).toBeVisible();
  await expect(page.getByText("Listed as confirmed and scheduled")).toBeVisible();
  await expect(page.getByText("Expected or unconfirmed")).toBeVisible();
  await expect(page.getByText(/AI explanation unavailable/)).toBeVisible();
});

test("renders a successful hosted-analysis response without replacing deterministic data", async ({ page }) => {
  await page.route("**/api/agent/funding-analysis", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, provider: "gemini", model: "gemini-test", analysis: "### Overall funding situation\nYour deterministic result remains authoritative." }) });
  });
  await openChat(page);
  await page.getByRole("button", { name: "Enter funding details" }).click();
  await page.getByLabel(/Name/).first().fill("Tuition");
  await page.getByLabel(/Amount/).first().fill("1200");
  await page.getByLabel(/Name/).nth(1).fill("Savings");
  await page.getByLabel(/Amount/).nth(1).fill("1500");
  await page.getByRole("button", { name: "Calculate funding readiness" }).click();
  await expect(page.getByRole("region", { name: "Financial outcome" })).toBeVisible();
  await expect(page.getByText("AI Financial Readiness Analysis")).toBeVisible();
  await expect(page.getByText(/Your deterministic result remains authoritative/)).toBeVisible();
  await expect(page.getByText("Costs in this plan")).toBeVisible();
});
