import { mkdir } from "node:fs/promises";

import { expect, test, type Page } from "@playwright/test";
import { evidenceDirectory } from "../helpers/evidence-paths.js";

const screenshotDirectory = evidenceDirectory("screenshots/meeting-creation");

async function signIn(page: Page, identity: string, password: string) {
  await page.goto("/");
  await page.getByRole("button", { name: new RegExp(identity, "iu") }).click();
  await page.getByLabel("Demo password").fill(password);
  await page.getByRole("button", { name: "Continue to meetings" }).click();
  await expect(
    page.getByRole("heading", { name: "Your assigned meetings" }),
  ).toBeVisible();
}

test.beforeAll(async () => {
  await mkdir(screenshotDirectory, { recursive: true });
});

test("facilitator creates a 3-person decision room from the browser", async ({
  browser,
  baseURL,
  page,
}) => {
  expect(baseURL).toBeDefined();
  if (baseURL === undefined) {
    throw new Error("Playwright baseURL is required for assignment contexts.");
  }
  await signIn(page, "Product", "counterpoint-product");

  const creator = page.getByRole("region", {
    name: "Create a decision room",
  });
  await expect(creator).toBeVisible();
  await creator
    .getByLabel("Decision purpose")
    .fill("Work & Productivity — Browser-created launch review");
  await creator.getByLabel("Safety").check();
  await creator.getByLabel("Legal").check();

  await page.screenshot({
    animations: "disabled",
    fullPage: true,
    path: `${screenshotDirectory}/2026-07-20-create-room-ready-desktop.png`,
  });

  let dropFirstCreationResponse = true;
  await page.route("**/api/v1/meetings", async (route) => {
    if (dropFirstCreationResponse && route.request().method() === "POST") {
      dropFirstCreationResponse = false;
      await route.fetch();
      await route.abort("failed");
      return;
    }
    await route.continue();
  });
  const createButton = creator.getByRole("button", {
    name: "Create decision room",
  });
  await createButton.click();
  await expect(page.getByRole("alert")).toContainText(
    "Descant could not reach the decision service",
  );
  await createButton.click();

  await expect(
    page.getByText("Work & Productivity — Browser-created launch review", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "product workspace" }),
  ).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Flagship progress" }),
  ).toHaveCount(0);
  await expect(page.getByText("Staged synthetic demo story")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Reset staged demo" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "No private source selected" }),
  ).toBeVisible();
  await expect(page.getByText("Regional launch readiness note")).toHaveCount(0);
  await expect(page.getByText("Synthetic launch decision")).toHaveCount(0);
  const preparePreview = page.getByRole("button", {
    name: "Prepare grounded sharing preview",
  });
  await expect(preparePreview).toBeDisabled();
  await expect(preparePreview).toHaveAttribute(
    "aria-describedby",
    "prepare-preview-hint",
  );
  await expect(
    page.getByText(
      "Add a private source first · upload a file or import a URL.",
    ),
  ).toBeVisible();
  await page.screenshot({
    animations: "disabled",
    fullPage: true,
    path: `${screenshotDirectory}/2026-07-20-generic-room-empty-desktop.png`,
  });

  await page.getByRole("button", { name: "Meetings" }).click();
  await page.reload();
  const createdMeeting = page.getByRole("article").filter({
    hasText: "Work & Productivity — Browser-created launch review",
  });
  await expect(createdMeeting).toHaveCount(1);
  await expect(createdMeeting).not.toContainText("Synthetic launch decision");
  await expect(createdMeeting).not.toContainText("Five perspectives");
  await expect(createdMeeting).not.toContainText("Living monitor");

  const safetyContext = await browser.newContext({ baseURL });
  const legalContext = await browser.newContext({ baseURL });
  const safetyPage = await safetyContext.newPage();
  const legalPage = await legalContext.newPage();
  await signIn(safetyPage, "Safety", "counterpoint-safety");
  await signIn(legalPage, "Legal", "counterpoint-legal");
  await expect(
    safetyPage.getByRole("article").filter({
      hasText: "Work & Productivity — Browser-created launch review",
    }),
  ).toBeVisible();
  await expect(
    legalPage.getByRole("article").filter({
      hasText: "Work & Productivity — Browser-created launch review",
    }),
  ).toBeVisible();
  await Promise.all([safetyContext.close(), legalContext.close()]);
});

test("participant cannot see facilitator meeting creation controls", async ({
  page,
}) => {
  await signIn(page, "Safety", "counterpoint-safety");
  await expect(
    page.getByRole("region", { name: "Create a decision room" }),
  ).toHaveCount(0);
});
