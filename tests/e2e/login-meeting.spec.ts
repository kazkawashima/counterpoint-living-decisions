import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

import { expect, test, type Page } from "@playwright/test";
import {
  CreateMeetingResponseSchema,
  LoginResponseSchema,
} from "@counterpoint/protocol";

const screenshotDirectory = resolve("docs/media/screenshots/login-meeting");
const clipDirectory = resolve("docs/media/clips/login-meeting");
const disclosureScreenshotDirectory = resolve(
  "docs/media/screenshots/permission-disclosure",
);
const disclosureClipDirectory = resolve(
  "docs/media/clips/permission-disclosure",
);

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
  await mkdir(disclosureScreenshotDirectory, { recursive: true });
  await mkdir(disclosureClipDirectory, { recursive: true });
});

test("login, assigned meeting, and private/shared workspace shell", async ({
  browser,
  baseURL,
  page,
}) => {
  const apiRequests: URL[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/")) {
      apiRequests.push(new URL(request.url()));
    }
  });
  await page.goto("/");
  await expect(page).toHaveTitle(/Counterpoint/u);
  expect(new URL(page.url()).hostname).not.toBe("localhost");
  await expect(
    page.getByRole("heading", { name: /Independent minds/u }),
  ).toBeVisible();
  await page.screenshot({
    animations: "disabled",
    fullPage: true,
    path: `${screenshotDirectory}/2026-07-19-login-desktop.png`,
  });

  await signIn(page, "Safety", "counterpoint-safety");
  await expect(
    page.getByRole("heading", { name: "Global AI Product Rollout" }),
  ).toBeVisible();
  await expect(page.getByText("participant", { exact: true })).toBeVisible();
  expect(apiRequests.length).toBeGreaterThanOrEqual(2);
  expect(
    apiRequests.every(
      ({ hostname }) => hostname === new URL(page.url()).hostname,
    ),
  ).toBe(true);
  await page.screenshot({
    animations: "disabled",
    fullPage: true,
    path: `${screenshotDirectory}/2026-07-19-meeting-list-desktop.png`,
  });

  await page.getByRole("button", { name: "Open workspace" }).click();
  await expect(
    page.getByRole("heading", { name: "safety workspace" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "No evidence has crossed the boundary" }),
  ).toBeVisible();
  await expect(page.getByText("Staged synthetic demo story")).toBeVisible();
  await page.screenshot({
    animations: "disabled",
    fullPage: true,
    path: `${screenshotDirectory}/2026-07-19-permission-workspace-desktop.png`,
  });

  await page
    .getByRole("button", { name: "Prepare exact sharing preview" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Review the exact payload" }),
  ).toBeVisible();
  await expect(page.getByText("Nothing has been shared yet.")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "No evidence has crossed the boundary" }),
  ).toBeVisible();
  await page.screenshot({
    animations: "disabled",
    fullPage: true,
    path: `${disclosureScreenshotDirectory}/2026-07-19-exact-preview-desktop.png`,
  });

  let dropFirstApprovalResponse = true;
  await page.route("**/api/v1/disclosures/approve", async (route) => {
    if (dropFirstApprovalResponse) {
      dropFirstApprovalResponse = false;
      await route.fetch();
      await route.abort("failed");
      return;
    }
    await route.continue();
  });
  await page.getByRole("button", { name: "Approve exact excerpt" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "could not reach the local decision service",
  );
  await page.getByRole("button", { name: "Approve exact excerpt" }).click();
  await expect(page.getByText("Permission recorded")).toBeVisible();
  await expect(page.getByText("1 of 5 conditions assembled")).toBeVisible();
  await page.screenshot({
    animations: "disabled",
    fullPage: true,
    path: `${disclosureScreenshotDirectory}/2026-07-19-approved-evidence-desktop.png`,
  });

  await page.reload();
  await page.getByRole("button", { name: "Open workspace" }).click();
  await expect(page.getByText("Permission recorded")).toBeVisible();

  const otherContext = await browser.newContext();
  const otherPage = await otherContext.newPage();
  await otherPage.goto(baseURL ?? "/");
  await signIn(otherPage, "Engineering", "counterpoint-engineering");
  await otherPage.getByRole("button", { name: "Open workspace" }).click();
  await expect(otherPage.getByText("Permission recorded")).toBeVisible();
  await expect(otherPage.locator(".shared-evidence blockquote")).toHaveText(
    "Regional launch requires a documented approval gate.",
  );
  await otherContext.close();
});

test("invalid credential is safe and visually explicit", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Demo password").fill("synthetic-but-wrong");
  await page.getByRole("button", { name: "Continue to meetings" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "Authentication is required.",
  );
  await expect(page.getByRole("alert")).not.toContainText(
    "synthetic-but-wrong",
  );
  await page.screenshot({
    animations: "disabled",
    fullPage: true,
    path: `${screenshotDirectory}/2026-07-19-login-error-desktop.png`,
  });
});

test("mobile and reduced-motion views preserve the permission boundary", async ({
  page,
}) => {
  await page.setViewportSize({ height: 844, width: 390 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.getByLabel("Counterpoint permission flow")).toBeVisible();
  await page.screenshot({
    animations: "disabled",
    fullPage: true,
    path: `${screenshotDirectory}/2026-07-19-login-mobile-reduced-motion.png`,
  });

  const facilitatorLogin = await page.request.post("/api/v1/login", {
    data: {
      password: "counterpoint-product",
      userId: "product",
    },
  });
  const facilitator = LoginResponseSchema.parse(await facilitatorLogin.json());
  const createdResponse = await page.request.post("/api/v1/meetings", {
    data: {
      idempotencyKey: "mobile-private-rejection-meeting",
      purpose: "Mobile private disclosure check",
      users: [
        { role: "facilitator", userId: "product" },
        { role: "participant", userId: "legal" },
        { role: "participant", userId: "engineering" },
      ],
    },
    headers: {
      authorization: `Bearer ${facilitator.bearerToken}`,
    },
  });
  const created = CreateMeetingResponseSchema.parse(
    await createdResponse.json(),
  );
  await signIn(page, "Legal", "counterpoint-legal");
  const privateMeeting = page
    .getByRole("article")
    .filter({ hasText: created.purpose });
  await privateMeeting.getByRole("button", { name: "Open workspace" }).click();
  await expect(page.getByText("Permission gate")).toBeVisible();
  await page.screenshot({
    animations: "disabled",
    fullPage: true,
    path: `${screenshotDirectory}/2026-07-19-permission-workspace-mobile.png`,
  });
  await page
    .getByRole("button", { name: "Prepare exact sharing preview" })
    .click();
  await page.getByRole("button", { name: "Keep private" }).click();
  await expect(page.getByText("Kept private")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "No evidence has crossed the boundary" }),
  ).toBeVisible();
  await page.screenshot({
    animations: "disabled",
    fullPage: true,
    path: `${disclosureScreenshotDirectory}/2026-07-19-kept-private-mobile-reduced-motion.png`,
  });
});

test("records the explanatory boundary motion for the reel", async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({
    recordVideo: {
      dir: "test-results/reel-video",
      size: { height: 720, width: 1280 },
    },
    viewport: { height: 720, width: 1280 },
  });
  const page = await context.newPage();
  await page.goto(baseURL ?? "/");
  await expect(page.getByLabel("Counterpoint permission flow")).toBeVisible();
  await page.waitForTimeout(1_200);
  const video = page.video();
  await context.close();
  await video?.saveAs(
    `${clipDirectory}/2026-07-19-permission-boundary-motion.webm`,
  );
});

test("records explicit preview-to-approved evidence motion for the reel", async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({
    recordVideo: {
      dir: "test-results/reel-video",
      size: { height: 720, width: 1280 },
    },
    viewport: { height: 720, width: 1280 },
  });
  const page = await context.newPage();
  await page.goto(baseURL ?? "/");
  await signIn(page, "Sales", "counterpoint-sales");
  await page.getByRole("button", { name: "Open workspace" }).click();
  await page
    .getByRole("button", { name: "Prepare exact sharing preview" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Review the exact payload" }),
  ).toBeVisible();
  await page.waitForTimeout(700);
  await page.getByRole("button", { name: "Approve exact excerpt" }).click();
  await expect(page.getByText("Permission recorded")).toBeVisible();
  await page.waitForTimeout(1_000);
  const video = page.video();
  await context.close();
  await video?.saveAs(
    `${disclosureClipDirectory}/2026-07-19-preview-to-approved.webm`,
  );
});
