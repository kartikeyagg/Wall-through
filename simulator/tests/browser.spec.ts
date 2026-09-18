import { test, expect, type Page } from "@playwright/test";

async function pausedScene(page: Page) {
  await page.goto("/");
  await expect(page.locator("canvas")).toBeVisible();
  await expect(page.locator(".map-state time")).not.toHaveText("0.0s");
  await page.getByRole("button", { name: "Pause", exact: false }).click();
  await page.getByRole("button", { name: "Reset scene", exact: false }).click();
  await expect(page.locator(".map-state")).toContainText("PAUSED");
}

test("3D scene exposes direct and fused shared sensor tracks", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await pausedScene(page);
  await page.getByRole("button", { name: "Officer glasses", exact: true }).click();
  const contacts = page.locator(".contacts");
  await expect(contacts).toContainText("T1");
  await expect(contacts).toContainText("SHARED");
  await expect(contacts).toContainText("Live sensor reports: P1");
  await page.getByRole("switch", { name: "Shared vision" }).uncheck();
  await expect(contacts).not.toContainText("T1");
  await page.getByRole("switch", { name: "Shared vision" }).check();
  await expect(contacts).toContainText("T1");
  await page.getByRole("button", { name: "Select officer P1", exact: true }).click();
  await expect(contacts).toContainText("DIRECT");
  await expect(page.locator(".three-canvas canvas")).toHaveAttribute("aria-label", /3D simulation/);
  expect(errors).toEqual([]);
});

test("3D controls retain movement, scanning, reset and team sizing", async ({ page }) => {
  await pausedScene(page);
  await page.getByRole("slider", { name: "Police members" }).fill("10");
  await expect(page.getByRole("button", { name: "Select officer P10", exact: true })).toBeVisible();
  await page.getByRole("slider", { name: "Police members" }).fill("5");
  await expect(page.locator(".officers button")).toHaveCount(5);
  const heading = page.getByLabel("Selected officer heading");
  await expect(heading).toHaveText("270°");
  await page.getByRole("button", { name: "Turn selected officer left 15 degrees" }).click();
  await expect(heading).toHaveText("255°");
  await page.getByRole("slider", { name: "Rotation speed" }).fill("90");
  await page.getByRole("button", { name: "Start automatic rotation", exact: true }).click();
  await page.getByRole("button", { name: "Resume", exact: false }).click();
  await expect(heading).not.toHaveText("255°");
  await page.getByRole("button", { name: "Stop automatic rotation", exact: true }).click();
  const stopped = await heading.textContent();
  await page.waitForTimeout(250);
  await expect(heading).toHaveText(stopped!);
  await page.locator("canvas").focus();
  await page.keyboard.press("Space");
  await expect(page.locator(".map-state")).toContainText("PAUSED");
});

test("responsive 3D canvas remains inside the viewport", async ({ page }) => {
  await pausedScene(page);
  for (const width of [375, 760, 1024, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expect(page.locator(".three-canvas canvas")).toBeVisible();
  }
});
