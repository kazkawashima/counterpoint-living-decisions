import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

import { expect, test, type Page } from "@playwright/test";
import {
  CreateMeetingResponseSchema,
  LoginResponseSchema,
} from "@counterpoint/protocol";

const screenshotDirectory = resolve("docs/media/screenshots/shared-display");
const clipDirectory = resolve("docs/media/clips/shared-display");
const exactSnippet = "Regional launch requires a documented approval gate.";

async function signIn(page: Page, identity: string, password: string) {
  await page.getByRole("button", { name: new RegExp(identity, "iu") }).click();
  await page.getByLabel("Demo password").fill(password);
  await page.getByRole("button", { name: "Continue to meetings" }).click();
  await expect(
    page.getByRole("heading", { name: "Your assigned meetings" }),
  ).toBeVisible();
}

test.beforeAll(async () => {
  await mkdir(screenshotDirectory, { recursive: true });
  await mkdir(clipDirectory, { recursive: true });
});

test("facilitator opens and revokes a privacy-safe shared display", async ({
  baseURL,
  browser,
  page,
}) => {
  test.slow();
  await page.setViewportSize({ height: 900, width: 1440 });
  await page.goto(baseURL ?? "/");

  const facilitatorLogin = await page.request.post("/api/v1/login", {
    data: {
      password: "counterpoint-product",
      userId: "product",
    },
  });
  const facilitator = LoginResponseSchema.parse(await facilitatorLogin.json());
  const meetingResponse = await page.request.post("/api/v1/meetings", {
    data: {
      idempotencyKey: "shared-display-e2e-meeting",
      purpose: "Shared display privacy check",
      users: [
        { role: "facilitator", userId: "product" },
        { role: "participant", userId: "safety" },
        { role: "participant", userId: "legal" },
      ],
    },
    headers: {
      authorization: `Bearer ${facilitator.bearerToken}`,
    },
  });
  expect(meetingResponse.status()).toBe(201);
  const meeting = CreateMeetingResponseSchema.parse(
    await meetingResponse.json(),
  );

  await signIn(page, "Product", "counterpoint-product");
  const meetingCard = page
    .getByRole("article")
    .filter({ hasText: meeting.purpose });
  await meetingCard.getByRole("button", { name: "Open workspace" }).click();
  await page.getByRole("button", { name: "Create shared display" }).click();
  const activeDisplay = page.getByRole("group", {
    name: "Read-only display active",
  });
  await expect(activeDisplay).toBeVisible();
  const displayHref = await activeDisplay
    .getByRole("link", { name: "Open display" })
    .getAttribute("href");
  if (displayHref === null) {
    throw new Error("Shared display link was not issued");
  }
  expect(new URL(displayHref).hostname).toBe(
    new URL(baseURL ?? page.url()).hostname,
  );
  expect(displayHref).not.toContain("localhost");

  const displayContext = await browser.newContext({
    recordVideo: {
      dir: "test-results/reel-video",
      size: { height: 720, width: 1280 },
    },
    viewport: { height: 720, width: 1280 },
  });
  const displayPage = await displayContext.newPage();
  await displayPage.goto(displayHref);
  await expect(
    displayPage.getByRole("heading", { name: meeting.purpose }),
  ).toBeVisible();
  await expect(
    displayPage.getByText("No approved evidence yet."),
  ).toBeVisible();
  await expect(
    displayPage.getByRole("button", { name: /commit|reset|display/iu }),
  ).toHaveCount(0);
  await expect(displayPage.getByText("participant-product")).toHaveCount(0);
  await displayPage.screenshot({
    animations: "disabled",
    fullPage: true,
    path: `${screenshotDirectory}/2026-07-19-shared-display-empty-desktop.png`,
  });

  await page
    .getByRole("button", { name: "Prepare grounded sharing preview" })
    .click();
  await page.getByRole("button", { name: "Approve exact excerpt" }).click();
  await expect(page.getByText("Permission recorded")).toBeVisible();
  await expect(
    displayPage.locator(".display-evidence blockquote"),
  ).toContainText(exactSnippet, { timeout: 8_000 });
  await expect(
    displayPage.getByText("Regional launch readiness note"),
  ).toHaveCount(0);
  await displayPage.screenshot({
    animations: "disabled",
    fullPage: true,
    path: `${screenshotDirectory}/2026-07-19-shared-display-evidence-desktop.png`,
  });

  const mobileContext = await browser.newContext({
    reducedMotion: "reduce",
    viewport: { height: 844, width: 390 },
  });
  const mobilePage = await mobileContext.newPage();
  await mobilePage.goto(displayHref);
  await expect(
    mobilePage.getByRole("heading", { name: meeting.purpose }),
  ).toBeVisible();
  await expect(
    mobilePage.locator(".display-evidence blockquote"),
  ).toContainText(exactSnippet);
  await mobilePage.screenshot({
    animations: "disabled",
    fullPage: true,
    path: `${screenshotDirectory}/2026-07-19-shared-display-mobile-reduced-motion.png`,
  });
  await mobileContext.close();

  await activeDisplay.getByRole("button", { name: "End access" }).click();
  await expect(
    displayPage.getByRole("heading", {
      name: "Shared content is no longer available",
    }),
  ).toBeVisible({ timeout: 8_000 });
  await expect(displayPage.locator(".display-evidence")).toHaveCount(0);
  await displayPage.screenshot({
    animations: "disabled",
    fullPage: true,
    path: `${screenshotDirectory}/2026-07-19-shared-display-revoked-desktop.png`,
  });

  const video = displayPage.video();
  const saveVideo = video?.saveAs(
    `${clipDirectory}/2026-07-19-shared-evidence-to-revoked.webm`,
  );
  await displayContext.close();
  await saveVideo;
});
