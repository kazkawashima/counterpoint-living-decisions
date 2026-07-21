import { mkdir } from "node:fs/promises";

import { expect, test, type Page } from "@playwright/test";
import { evidenceDirectory } from "../helpers/evidence-paths.js";
import { activateByKeyboard } from "../helpers/keyboard.js";

const screenshotDirectory = evidenceDirectory("screenshots/guided-flagship");
const exactSnippet = "Regional launch requires a documented approval gate.";
const flagshipPurpose = "Global AI Product Rollout";

async function signIn(page: Page, identity: string, password: string) {
  await page.getByRole("button", { name: new RegExp(identity, "iu") }).click();
  await page.getByLabel("Demo password").fill(password);
  await page.getByRole("button", { name: "Continue to meetings" }).click();
  await expect(
    page.getByRole("heading", { name: "Your assigned meetings" }),
  ).toBeVisible();
}

async function expectCurrentStage(page: Page, label: string, stage: number) {
  const progress = page.getByRole("navigation", {
    name: "Flagship progress",
  });
  await expect(progress.getByText(label, { exact: true })).toHaveAttribute(
    "aria-current",
    "step",
  );
  await expect(page.getByText(`Current stage ${stage} of 5`)).toBeVisible();
}

test.beforeAll(async () => {
  await mkdir(screenshotDirectory, { recursive: true });
});

test("facilitator can reset the guided flagship while participants cannot", async ({
  baseURL,
  browser,
  page,
}) => {
  await page.setViewportSize({ height: 900, width: 1440 });
  await page.goto("/");

  await signIn(page, "Product", "counterpoint-product");
  const facilitatorMeeting = page
    .getByRole("article")
    .filter({ hasText: flagshipPurpose });
  await facilitatorMeeting
    .getByRole("button", { name: "Open workspace" })
    .click();

  await page.getByRole("button", { name: "Reset staged demo" }).click();
  await page.getByRole("button", { name: "Confirm meeting reset" }).click();
  await expectCurrentStage(page, "01 Context", 1);
  await expect(
    page.getByText(
      "Capture independent context. Nothing crosses into the shared room.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "No evidence has crossed the boundary" }),
  ).toBeVisible();

  await page
    .getByRole("button", { name: "Prepare grounded sharing preview" })
    .click();
  const exactPreview = page.getByRole("region", {
    name: "Review the exact payload",
  });
  await expect(exactPreview).toBeVisible();
  await expect(
    exactPreview.getByText(exactSnippet, { exact: true }),
  ).toBeVisible();
  await expectCurrentStage(page, "02 Permission", 2);
  await expect(
    page.getByText(
      "Preview the exact excerpt. Owner approval is required before sharing.",
    ),
  ).toBeVisible();

  await exactPreview
    .getByRole("button", { name: "Approve exact excerpt" })
    .click();
  await expect(page.getByText("Permission recorded")).toBeVisible();
  await expect(page.locator(".shared-evidence blockquote")).toHaveText(
    exactSnippet,
  );
  await expectCurrentStage(page, "03 Commitment", 3);
  await expect(
    page.getByText(
      "Assemble a grounded Decision, then require an explicit human commit.",
    ),
  ).toBeVisible();

  const resetRequest = page.getByRole("button", {
    name: "Reset staged demo",
  });
  await activateByKeyboard(page, resetRequest, "Space");
  const resetConfirmation = page.locator(".reset-confirmation");
  await expect(resetConfirmation).toContainText(
    "Only this staged meeting will be cleared.",
  );
  await expect(resetConfirmation).toBeFocused();
  await expect(resetConfirmation).toHaveCSS("outline-style", "solid");
  await expect(
    resetConfirmation.getByRole("button", {
      name: "Confirm meeting reset",
    }),
  ).toBeVisible();
  await activateByKeyboard(
    page,
    resetConfirmation.getByRole("button", { name: "Cancel", exact: true }),
    "Space",
  );
  await expect(resetConfirmation).toHaveCount(0);
  await expect(resetRequest).toBeFocused();
  await activateByKeyboard(page, resetRequest, "Space");
  await expect(resetConfirmation).toContainText(
    "Only this staged meeting will be cleared.",
  );
  await expect(resetConfirmation).toBeFocused();
  await page.screenshot({
    animations: "disabled",
    fullPage: true,
    path: `${screenshotDirectory}/2026-07-19-reset-confirmation-desktop.png`,
  });

  await activateByKeyboard(
    page,
    resetConfirmation.getByRole("button", { name: "Confirm meeting reset" }),
    "Space",
  );
  await expect(
    page.getByText("Meeting reset complete · synthetic Context restored"),
  ).toBeVisible();
  await expectCurrentStage(page, "01 Context", 1);
  await expect(
    page.getByRole("heading", { name: "No evidence has crossed the boundary" }),
  ).toBeVisible();
  await expect(page.locator(".shared-evidence")).toHaveCount(0);
  await expect(page.getByText("Permission recorded")).toHaveCount(0);
  await expect(page.getByText("0 of 5 conditions assembled")).toBeVisible();
  await page.screenshot({
    animations: "disabled",
    fullPage: true,
    path: `${screenshotDirectory}/2026-07-19-post-reset-desktop.png`,
  });

  await page.setViewportSize({ height: 844, width: 390 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expectCurrentStage(page, "01 Context", 1);
  await page.screenshot({
    animations: "disabled",
    fullPage: true,
    path: `${screenshotDirectory}/2026-07-19-post-reset-mobile-reduced-motion.png`,
  });

  const participantContext = await browser.newContext({
    viewport: { height: 900, width: 1440 },
  });
  const participantPage = await participantContext.newPage();
  await participantPage.goto(baseURL ?? "/");
  await signIn(participantPage, "Legal", "counterpoint-legal");
  const participantMeeting = participantPage
    .getByRole("article")
    .filter({ hasText: flagshipPurpose });
  await participantMeeting
    .getByRole("button", { name: "Open workspace" })
    .click();
  await expect(
    participantPage.getByRole("heading", { name: "legal workspace" }),
  ).toBeVisible();
  await expectCurrentStage(participantPage, "01 Context", 1);
  await expect(
    participantPage.getByRole("heading", {
      name: "No evidence has crossed the boundary",
    }),
  ).toBeVisible();
  await expect(participantPage.locator(".shared-evidence")).toHaveCount(0);
  await expect(
    participantPage.getByRole("button", { name: "Reset staged demo" }),
  ).toHaveCount(0);
  await expect(
    participantPage.getByRole("button", { name: "Confirm meeting reset" }),
  ).toHaveCount(0);
  await participantContext.close();
});
