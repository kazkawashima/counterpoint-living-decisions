import { AxeBuilder } from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { evidenceDirectory } from "../helpers/evidence-paths.js";

const FLAGSHIP_PURPOSE = "Work & Productivity — Global AI Product Rollout";
const screenshotDirectory = evidenceDirectory("screenshots/accessibility");

test.beforeAll(async () => {
  await mkdir(screenshotDirectory, { recursive: true });
});

async function expectNoSeriousAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  const violations = results.violations
    .filter(({ impact }) => impact === "serious" || impact === "critical")
    .map(({ id, impact, nodes }) => ({
      id,
      impact,
      targets: nodes.map(({ target }) => target),
    }));
  expect(violations).toEqual([]);
}

function cssTimeSeconds(value: string): number {
  const normalized = value.trim();
  const magnitude = Number.parseFloat(normalized);
  return normalized.endsWith("ms") ? magnitude / 1_000 : magnitude;
}

test("meeting list exposes its loading state until assigned meetings arrive", async ({
  page,
}) => {
  let releaseMeetings: () => void = () => undefined;
  const meetingsReleased = new Promise<void>((resolve) => {
    releaseMeetings = resolve;
  });

  await page.route("**/api/v1/meetings", async (route) => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }
    await meetingsReleased;
    await route.continue();
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Product" }).click();
  await page.getByLabel("Demo password").fill("counterpoint-product");
  await page.getByRole("button", { name: "Continue to meetings" }).click();

  try {
    const meetingList = page.locator(".meeting-list");
    await expect(meetingList).toHaveAttribute("aria-busy", "true");
    await expect(page.getByLabel("Loading meetings")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: FLAGSHIP_PURPOSE }),
    ).toHaveCount(0);

    releaseMeetings();
    await expect(meetingList).toHaveAttribute("aria-busy", "false");
    await expect(page.getByLabel("Loading meetings")).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: FLAGSHIP_PURPOSE }),
    ).toBeVisible();
  } finally {
    releaseMeetings();
    await page.unroute("**/api/v1/meetings");
  }
});

test("reduced motion shortens representative animation and transition behavior", async ({
  page,
}) => {
  await page.goto("/");

  const privateSignal = page.locator(".private-card");
  const identityOption = page.getByRole("button", { name: "Product" });
  await expect(privateSignal).toHaveCSS("animation-name", "private-breathe");
  await expect(privateSignal).toHaveCSS("animation-duration", "5s");
  await expect(privateSignal).toHaveCSS(
    "animation-iteration-count",
    "infinite",
  );
  await expect(identityOption).toHaveCSS("transition-duration", "0.18s");

  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(
    cssTimeSeconds(
      await privateSignal.evaluate(
        (element) => getComputedStyle(element).animationDuration,
      ),
    ),
  ).toBeLessThanOrEqual(0.000_01);
  await expect(privateSignal).toHaveCSS("animation-iteration-count", "1");
  expect(
    cssTimeSeconds(
      await identityOption.evaluate(
        (element) => getComputedStyle(element).transitionDuration,
      ),
    ),
  ).toBeLessThanOrEqual(0.000_01);
});

test("meeting list controls meet the WCAG 2.2 target-size rule", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Product" }).click();
  await page.getByLabel("Demo password").fill("counterpoint-product");
  await page.getByRole("button", { name: "Continue to meetings" }).click();
  await expect(
    page.getByRole("heading", { name: FLAGSHIP_PURPOSE }),
  ).toBeVisible();

  const results = await new AxeBuilder({ page })
    .withRules(["target-size"])
    .analyze();
  expect(
    results.violations.map(({ id, nodes }) => ({
      id,
      targets: nodes.map(({ target }) => target),
    })),
  ).toEqual([]);
  expect(results.passes.some(({ id }) => id === "target-size")).toBe(true);
});

test("durable projection exposes offline state and successful recovery", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Product" }).click();
  await page.getByLabel("Demo password").fill("counterpoint-product");
  await page.getByRole("button", { name: "Continue to meetings" }).click();
  await page
    .getByRole("heading", { name: FLAGSHIP_PURPOSE })
    .locator("..")
    .locator("..")
    .getByRole("button", { name: "Open workspace" })
    .click();

  const continuity = page.getByRole("complementary", {
    name: "Continuity status",
  });
  await expect(
    continuity.getByText("Meeting state stays online"),
  ).toBeVisible();
  await page.route(
    "**/api/v1/meetings/meeting-global-ai-rollout/projection",
    async (route) => {
      await route.fulfill({
        body: JSON.stringify({
          code: "DEPENDENCY_UNAVAILABLE",
          correlationId: "correlation_e2e_projection_offline",
          message: "Durable projection is temporarily unavailable.",
          retryable: true,
        }),
        contentType: "application/json",
        status: 503,
      });
    },
  );

  await expect(
    continuity.getByText("Meeting state needs reconnection"),
  ).toBeVisible();
  await expect(continuity.getByText("Offline", { exact: true })).toBeVisible();

  await page.unroute("**/api/v1/meetings/meeting-global-ai-rollout/projection");
  await expect(
    continuity.getByText("Meeting state stays online"),
  ).toBeVisible();
  await expect(continuity.getByText("Live", { exact: true })).toBeVisible();
});

test("flagship entry is keyboard operable with visible focus and named controls", async ({
  page,
}) => {
  await page.goto("/");
  await expectNoSeriousAxeViolations(page);

  const product = page.getByRole("button", { name: "Product" });
  const safety = page.getByRole("button", { name: "Safety" });
  await page.keyboard.press("Tab");
  await expect(product).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(safety).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(product).toBeFocused();
  await expect(product).toHaveCSS("outline-style", "solid");
  await page.keyboard.press("Enter");

  const password = page.getByLabel("Demo password");
  await password.focus();
  await password.fill("counterpoint-product");
  const continueButton = page.getByRole("button", {
    name: "Continue to meetings",
  });
  await continueButton.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Your assigned meetings" }),
  ).toBeVisible();
  await expectNoSeriousAxeViolations(page);

  await expect(
    page.getByRole("heading", { name: FLAGSHIP_PURPOSE }),
  ).toBeVisible();
  await page.getByLabel("Meeting code").fill("GLOBAL-AI-2026");
  const verifyMembership = page.getByRole("button", {
    name: "Verify membership",
  });
  await verifyMembership.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "product workspace" }),
  ).toBeVisible();
  await expectNoSeriousAxeViolations(page);

  const buttons = page.getByRole("button");
  for (let index = 0; index < (await buttons.count()); index += 1) {
    const button = buttons.nth(index);
    if (await button.isVisible()) {
      await expect(button).toHaveAccessibleName(/\S/u);
    }
  }

  const preparePreview = page.getByRole("button", {
    name: "Prepare grounded sharing preview",
  });
  await preparePreview.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Review the exact payload" }),
  ).toBeVisible();

  const keepPrivate = page.getByRole("button", { name: "Keep private" });
  await keepPrivate.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("Kept private", { exact: true })).toBeVisible();

  await page.setViewportSize({ height: 844, width: 390 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expectNoSeriousAxeViolations(page);
  const progress = page.getByRole("navigation", {
    name: "Flagship progress",
  });
  await progress.focus();
  await expect(progress).toHaveCSS("outline-style", "solid");
  await progress.screenshot({
    animations: "disabled",
    path: `${screenshotDirectory}/2026-07-20-flagship-progress-mobile-reduced-motion.png`,
  });
});
