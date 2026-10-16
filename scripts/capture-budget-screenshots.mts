/**
 * Captures genuine screenshots of the Destination Budget Planner from the
 * actually running app (dev server on :3200). Run AFTER the E2E suite.
 * Output: docs/screenshots/01..05-budget-*.png
 */
import { chromium } from "@playwright/test";
import { mkdirSync } from "fs";

const OUT = new URL("../docs/screenshots/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto("http://localhost:3200/", { waitUntil: "networkidle" });

// 1. Welcome screen with the sample-budget entry point.
await page.screenshot({ path: OUT + "00-welcome.png" });

// 2. Run the sample demo (real engine, demo mode).
await page.getByRole("button", { name: /Try the sample student budget/ }).click();
await page.getByText("Shortfall — typical costs are above your budget").waitFor({ timeout: 60_000 });
await page.waitForTimeout(800);
await page.screenshot({ path: OUT + "01-budget-demo.png", fullPage: true });

// 3. Adjust accommodation -> compare view.
await page.getByLabel("Accommodation").selectOption({ label: "student residence (on-campus, UL)" });
await page.getByText("Original vs adjusted").waitFor({ timeout: 15_000 });
await page.waitForTimeout(500);
await page.screenshot({ path: OUT + "02-budget-adjusted.png", fullPage: true });

// 4. Sources + freshness.
await page.getByRole("button", { name: /Sources \(/ }).click();
await page.getByText("educationinireland.com").first().waitFor({ timeout: 10_000 });
await page.waitForTimeout(500);
await page.screenshot({ path: OUT + "03-budget-sources.png", fullPage: true });

// 5. Apply with explicit FX rate -> applied view.
await page.getByRole("button", { name: "Apply to my financial plan", exact: true }).click();
await page.getByRole("group", { name: "Confirm applying the budget" }).waitFor();
await page.getByLabel("Planning currency per 1 EUR").fill("0.86");
await page.getByLabel("Rate date").fill("2026-10-15");
await page.getByLabel(/Rate source/).fill("ECB reference rate (test)");
await page.getByRole("button", { name: "Confirm — apply budget" }).click();
await page.getByText(/Applied 9 obligation\(s\) for Limerick, Ireland/).waitFor({ timeout: 30_000 });
await page.waitForTimeout(500);
await page.screenshot({ path: OUT + "04-budget-applied.png", fullPage: true });
await page.close();

// 6. Mobile viewport demo.
const mob = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
await mob.goto("http://localhost:3200/", { waitUntil: "networkidle" });
await mob.getByRole("button", { name: /Try the sample student budget/ }).click();
await mob.getByText("Shortfall — typical costs are above your budget").waitFor({ timeout: 60_000 });
await mob.waitForTimeout(800);
await mob.screenshot({ path: OUT + "05-budget-demo-mobile.png", fullPage: true });
await mob.close();

await browser.close();
console.log("screenshots written to", OUT);
