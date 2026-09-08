import { test, expect, type Page } from "@playwright/test";

async function pausedScene(page: Page) {
  await page.goto("/");
  await expect(page.locator(".map-state time")).not.toHaveText("0.0s");
  await page.getByRole("button", { name: "Pause", exact: false }).click();
  await expect(page.locator(".map-state")).toContainText("PAUSED");
  await page.getByRole("button", { name: "Reset scene", exact: false }).click();
  await expect(page.locator(".map-state")).toContainText("PAUSED");
  await expect(page.locator(".map-state time")).toHaveText("0.0s");
}

test("live shared observations, view selection, settings, and keyboard controls", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await pausedScene(page);
  await page
    .getByRole("button", { name: "Officer glasses", exact: true })
    .click();
  const contacts = page.locator(".contacts");
  await expect(contacts).toContainText("T1");
  await expect(contacts).toContainText("SHARED");
  await expect(contacts).toContainText("P1");
  await page.getByRole("switch", { name: "Shared vision" }).uncheck();
  await expect(contacts).not.toContainText("T1");
  await page.getByRole("switch", { name: "Shared vision" }).check();
  await expect(contacts).toContainText("T1");

  await page
    .getByRole("button", { name: "Select officer P1", exact: true })
    .click();
  await expect(contacts).toContainText("T1");
  await expect(contacts).toContainText("DIRECT");
  await page.getByRole("slider", { name: "Police members" }).fill("10");
  await expect(
    page.getByRole("button", { name: "Select officer P10", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Select officer P10", exact: true })
    .click();
  await expect(page.locator(".chip")).toHaveText("P10");
  await page.getByRole("slider", { name: "Police members" }).fill("5");
  await expect(page.locator(".officers button")).toHaveCount(5);
  await expect(page.locator(".chip")).toHaveText("P2");
  await page.getByRole("slider", { name: "Camera range" }).fill("100");
  await expect(contacts).not.toContainText("T1");
  await page.getByRole("slider", { name: "Camera range" }).fill("420");
  await expect(contacts).toContainText("T1");
  await page.getByRole("slider", { name: "Camera field of view" }).fill("40");
  await expect(page.locator("output").filter({ hasText: "40°" })).toBeVisible();
  await page.getByRole("slider", { name: "Camera field of view" }).fill("117");
  await page.getByLabel("Automatic police patrol").check();
  await expect(page.getByLabel("Automatic police patrol")).toBeChecked();
  await page.getByLabel("Automatic police patrol").uncheck();
  await page
    .getByRole("combobox", { name: "Simulation speed" })
    .selectOption("2");
  await expect(
    page.getByRole("combobox", { name: "Simulation speed" }),
  ).toHaveValue("2");
  await page
    .getByRole("combobox", { name: "Simulation speed" })
    .selectOption("1");

  // Observe the selected officer's actual canvas pixels, not a test-only state hook.
  const canvas = page.locator("canvas");
  const centerPixel = () =>
    canvas.evaluate((element: HTMLCanvasElement) =>
      Array.from(element.getContext("2d")!.getImageData(380, 450, 1, 1).data),
    );
  await expect.poll(centerPixel).toEqual([188, 245, 116, 255]);
  await canvas.focus();
  await page.keyboard.press("Space");
  await page.keyboard.down("s");
  await page.waitForTimeout(450);
  await page.keyboard.up("s");
  await page.keyboard.press("Space");
  await expect(page.locator(".map-state")).toContainText("PAUSED");
  await expect.poll(centerPixel).not.toEqual([188, 245, 116, 255]);

  await page.getByRole("button", { name: "Reset scene", exact: false }).click();
  await page
    .getByRole("button", { name: "Select officer P1", exact: true })
    .click();
  await page.getByRole("switch", { name: "Shared vision" }).uncheck();
  await expect(contacts).toContainText("T1");
  await canvas.focus();
  await page.keyboard.press("Space");
  await page.keyboard.down("q");
  await page.waitForTimeout(1000);
  await page.keyboard.up("q");
  await page.keyboard.press("Space");
  await expect(contacts).not.toContainText("T1");
  expect(errors).toEqual([]);
});

test("desktop and narrow layouts stay within the viewport", async ({
  page,
}) => {
  await pausedScene(page);
  await page
    .getByRole("button", { name: "Officer glasses", exact: true })
    .click();
  await expect(page.locator(".contacts")).toContainText("T1");
  await page.screenshot({
    path: "/tmp/wall-through-desktop.png",
    fullPage: true,
  });
  for (const width of [375, 760, 1024, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      )
      .toBe(true);
    await expect(page.locator("canvas")).toBeVisible();
  }
  await page.setViewportSize({ width: 375, height: 900 });
  await page.screenshot({
    path: "/tmp/wall-through-mobile.png",
    fullPage: true,
  });
});
