import { test, expect, type Page } from "@playwright/test";

async function pausedScene(page: Page) {
  await page.goto("/");
  await expect(page.locator(".three-canvas canvas")).toBeVisible();
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
  await page.locator(".three-canvas canvas").focus();
  await page.keyboard.press("Space");
  await expect(page.locator(".map-state")).toContainText("PAUSED");
});

test("stereo rig telemetry reacts to the baseline and range controls", async ({ page }) => {
  await pausedScene(page);
  // Self localization uses the same readout layout, so scope to this panel.
  const readout = page.locator(".panel", { hasText: "Stereo rig telemetry" }).locator(".vision-readout");
  await expect(readout).toContainText("BASELINE");
  await expect(readout).toContainText("DISPARITY");
  await expect(readout).toContainText("DEPTH σ");
  const baseline = page.getByRole("slider", { name: "Stereo baseline" });
  await expect(readout.locator("div", { hasText: "BASELINE" }).first()).toContainText("8.0");
  await baseline.fill("24");
  await expect(readout.locator("div", { hasText: "BASELINE" }).first()).toContainText("24.0");
  // A wider baseline triangulates further, so the reported reach must not shrink.
  const reach = async () => Number((await readout.locator("div", { hasText: "REACH" }).first().innerText()).replace(/[^\d.]/g, ""));
  const wide = await reach();
  await page.getByRole("slider", { name: "Camera range" }).fill("150");
  await expect.poll(reach).toBeLessThan(wide);
});

test("movement marking exposes live speed, heading and motion toggles", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".three-canvas canvas")).toBeVisible();
  await page.getByRole("switch", { name: "Shared vision" }).check();
  const motion = page.locator(".contact .motion").first();
  await expect(motion).toBeVisible();
  await expect(motion).toContainText("m/s");
  await expect(motion).toContainText("°");
  for (const label of ["Movement trails", "Velocity vectors"]) {
    const toggle = page.getByRole("checkbox", { name: label });
    await expect(toggle).toBeChecked();
    await toggle.uncheck();
    await expect(toggle).not.toBeChecked();
    await toggle.check();
  }
});

test("responsive 3D canvas remains inside the viewport", async ({ page }) => {
  await pausedScene(page);
  for (const width of [375, 760, 1024, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expect(page.locator(".three-canvas canvas")).toBeVisible();
  }
});

test("published poses and teammate overlays are reported and adjustable", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await pausedScene(page);
  const readout = page.locator(".overlay-readout");
  await expect(readout).toContainText("PUBLISHED");
  await expect(readout).toContainText("RECEIVED");
  await expect(readout).toContainText("BYPASSED");
  // A paused scene still has live frames, so the selected officer must be receiving teammate poses.
  await expect(readout.locator("div").nth(0).locator("strong")).not.toHaveText("0");
  await expect(readout.locator("div").nth(1).locator("strong")).not.toHaveText("0");
  await expect(page.locator(".contacts")).toContainText("POSE");
  const opacity = page.getByRole("slider", { name: "Overlay opacity" });
  await opacity.fill("80");
  await expect(page.locator(".panel .tiny", { hasText: "ALPHA" })).toHaveText("80% ALPHA");
  await opacity.fill("0");
  await expect(page.locator(".panel .tiny", { hasText: "ALPHA" })).toHaveText("0% ALPHA");
  expect(errors).toEqual([]);
});

test("the skeleton overlay toggle stops layers reaching the receiving officer", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await pausedScene(page);
  const received = page.locator(".overlay-readout div").nth(1).locator("strong");
  await expect(received).not.toHaveText("0");
  await page.getByRole("checkbox", { name: "Skeleton overlay" }).uncheck();
  await expect(received).toHaveText("0");
  await page.getByRole("checkbox", { name: "Skeleton overlay" }).check();
  await expect(received).not.toHaveText("0");
  expect(errors).toEqual([]);
});

test("direction arrows toggle in the officer glasses view", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await pausedScene(page);
  await page.getByRole("button", { name: "Officer glasses", exact: true }).click();
  await expect(page.locator(".contacts")).toContainText("T1");
  const arrows = page.getByRole("checkbox", { name: "Direction arrows" });
  await expect(arrows).toBeChecked();
  await page.locator(".three-canvas").screenshot({ path: test.info().outputPath("glasses-arrows.png") });
  await arrows.uncheck();
  await expect(arrows).not.toBeChecked();
  await page.locator(".three-canvas").screenshot({ path: test.info().outputPath("glasses-no-arrows.png") });
  expect(errors).toEqual([]);
});

test("self localization reports stereo and compass with an optional IMU", async ({ page }) => {
  await pausedScene(page);
  const panel = page.locator(".panel", { hasText: "Self localization" });
  await expect(panel).toContainText("STEREO + COMPASS + IMU");
  await expect(panel).toContainText("LOCAL X");
  await expect(panel).toContainText("COMPASS");
  const imu = page.getByRole("checkbox", { name: "IMU integration" });
  await expect(imu).toBeChecked();
  await imu.uncheck();
  await expect(panel).toContainText("STEREO + COMPASS");
  await expect(imu).not.toBeChecked();
});

test("a thrown puck is tagged by the cameras and reported by the sensor net", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.locator(".three-canvas canvas")).toBeVisible();
  const panel = page.locator(".panel", { hasText: "mmWave sensor net" });
  await expect(panel).toContainText("No pucks deployed");
  await page.getByRole("button", { name: "Throw mmWave sensor" }).click();
  const puck = panel.locator(".puck").first();
  await expect(puck).toContainText("M1");
  // It has to land before anyone can fix it, and be fixed before it is useful.
  await expect(puck).toContainText("LOCATED", { timeout: 20_000 });
  await expect(panel.locator(".tiny")).toContainText("1/1 ACTIVE");
  await expect(panel).toContainText("RADAR REACH");
  await page.getByRole("button", { name: "Recall sensor M1" }).click();
  await expect(panel).toContainText("No pucks deployed");
  expect(errors).toEqual([]);
});

test("an officer can clear a false positive and put the flag back", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await pausedScene(page);
  const tracks = page.locator(".panel", { hasText: "Live vision tracks" });
  await expect(tracks.locator(".contact").first()).toBeVisible();
  const id = (await tracks.locator(".contact strong").first().innerText()).split(" ")[0];
  // Key on the id: the list reorders as tracks come and go.
  const contact = tracks.locator(".contact", { hasText: id });
  await expect(tracks.locator(".tiny")).toContainText("0 CLEARED");
  await contact.getByRole("button", { name: `Clear ${id} as a false positive` }).click();
  await expect(contact).toContainText("CLEARED");
  await expect(contact).toContainText("cleared by");
  await expect(tracks.locator(".tiny")).toContainText("1 CLEARED");
  // The correction is the team's, so another officer's view carries it too.
  await page.getByRole("button", { name: "Select officer P1", exact: true }).click();
  await expect(tracks.locator(".contact.cleared")).toHaveCount(1);
  await contact.getByRole("button", { name: `Re-flag ${id} as a threat` }).click();
  await expect(tracks.locator(".tiny")).toContainText("0 CLEARED");
  await expect(tracks.locator(".contact.cleared")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("the controls guide lists the keyboard and mouse bindings", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.locator(".three-canvas canvas")).toBeVisible();
  const trigger = page.getByRole("button", { name: "Show keyboard and mouse controls" });
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await trigger.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  // Every context an operator drives the sim from has to be represented.
  for (const group of ["Movement", "Looking around", "Sensors", "World overview camera", "Minimap", "Simulation"])
    await expect(dialog).toContainText(group);
  await expect(dialog).toContainText("Throw an mmWave sensor puck");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  // The guide is also reachable without hunting for the button.
  await page.keyboard.press("?");
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(errors).toEqual([]);
});

test("the minimap plots self-localized officers and detected tracks", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await pausedScene(page);
  const minimap = page.locator(".minimap");
  await expect(minimap.locator("canvas")).toBeVisible();
  // It reports what the team knows, so officers and live tracks must both reach it.
  await expect(minimap).toContainText(/OFFICER/i);
  const headingUp = page.getByRole("button", { name: "Toggle heading-up map" });
  await expect(headingUp).toHaveAttribute("aria-pressed", "true");
  await headingUp.click();
  await expect(headingUp).toHaveAttribute("aria-pressed", "false");
  const expand = page.getByRole("button", { name: "Expand tactical minimap" });
  await expand.click();
  await expect(minimap).toHaveClass(/minimap--expanded/);
  await page.getByRole("button", { name: "Collapse tactical minimap" }).click();
  await expect(minimap).not.toHaveClass(/minimap--expanded/);
  expect(errors).toEqual([]);
});

test("mouse look can be switched off so clicks keep selecting", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await pausedScene(page);
  const mouseLook = page.getByRole("checkbox", { name: "Mouse look (glasses)" });
  await expect(mouseLook).toBeChecked();
  await mouseLook.uncheck();
  await page.getByRole("button", { name: "Officer glasses" }).click();
  const canvas = page.locator(".three-canvas canvas");
  await expect(canvas).toBeVisible();
  // Clear of the minimap, which deliberately overlays the top-left corner.
  const box = (await canvas.boundingBox())!;
  // With the toggle off nothing may capture the pointer, so a click stays a click.
  await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } });
  expect(await page.evaluate(() => document.pointerLockElement !== null)).toBe(false);
  await expect(page.locator(".look-hint")).toBeHidden();
  expect(errors).toEqual([]);
});
