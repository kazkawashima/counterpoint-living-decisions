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
