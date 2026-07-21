import { mkdir } from "node:fs/promises";

import { expect, test, type Page } from "@playwright/test";
import {
  ApproveDisclosureResponseSchema,
  createErrorEnvelope,
  CreateMeetingResponseSchema,
  LoginResponseSchema,
} from "@counterpoint/protocol";
import { evidenceDirectory } from "../helpers/evidence-paths.js";
import { uploadAndUsePrivateMarkdown } from "../helpers/private-source.js";

const screenshotDirectory = evidenceDirectory("screenshots/login-meeting");
const clipDirectory = evidenceDirectory("clips/login-meeting");
const disclosureScreenshotDirectory = evidenceDirectory(
  "screenshots/permission-disclosure",
);
const disclosureClipDirectory = evidenceDirectory(
  "clips/permission-disclosure",
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
  await expect(page).toHaveTitle(/Descant/u);
  expect(new URL(page.url()).hostname).not.toBe("localhost");
  await expect(
    page.getByRole("heading", { name: /Independent minds/u }),
  ).toBeVisible();
  await expect(
    page.getByRole("complementary", { name: "Demo path" }),
  ).toContainText("Product → Global AI Product Rollout → Open workspace");
  await page.screenshot({
    animations: "disabled",
    fullPage: true,
    path: `${screenshotDirectory}/2026-07-19-login-desktop.png`,
  });

  await signIn(page, "Safety", "counterpoint-safety");
  await expect(
    page.getByRole("heading", {
      name: "Global AI Product Rollout",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "Work & Productivity — Global AI Product Rollout",
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(page.getByText("Open the seeded room first")).toBeVisible();
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
    .getByRole("button", { name: "Prepare grounded sharing preview" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Review the exact payload" }),
  ).toBeVisible();
  await expect(page.getByText("Nothing has been shared yet.")).toBeVisible();
  await expect(page.getByText("AI suggestion · owner only")).toBeVisible();
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
    "Descant could not reach the decision service",
  );
  const approvalResponsePromise = page.waitForResponse(
    (response) =>
      response.url().includes("/api/v1/disclosures/approve") &&
      response.status() === 200,
  );
  await page.getByRole("button", { name: "Approve exact excerpt" }).click();
  const approved = ApproveDisclosureResponseSchema.parse(
    await (await approvalResponsePromise).json(),
  );
  await expect(page.getByText("Permission recorded")).toBeVisible();
  const sharedEvidence = page.locator(".shared-evidence");
  await expect(sharedEvidence).toContainText("Shared scope");
  await expect(sharedEvidence).toContainText("Source origin");
  await expect(sharedEvidence).toContainText("Human confirmed");
  await expect(sharedEvidence).toContainText("Approved exact excerpt");
  await expect(sharedEvidence).toContainText("Source ref");
  const sourceReference = sharedEvidence.locator("details.source-reference");
  await expect(sourceReference).toHaveAttribute(
    "aria-label",
    `Source reference ${approved.evidence.sourceArtifactId}`,
  );
  await sourceReference.locator("summary").click();
  await expect(
    sourceReference.getByText(approved.evidence.sourceArtifactId, {
      exact: true,
    }),
  ).toBeVisible();
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
  await otherPage
    .getByRole("article")
    .filter({ hasText: "Global AI Product Rollout" })
    .getByRole("button", { name: "Open workspace" })
    .click();
  await expect(otherPage.getByText("Permission recorded")).toBeVisible();
  await expect(otherPage.locator(".shared-evidence blockquote")).toHaveText(
    "Regional launch requires a documented approval gate.",
  );

  const facilitatorContext = await browser.newContext();
  const facilitatorPage = await facilitatorContext.newPage();
  await facilitatorPage.goto(baseURL ?? "/");
  await signIn(facilitatorPage, "Product", "counterpoint-product");
  await facilitatorPage
    .getByRole("article")
    .filter({ hasText: "Global AI Product Rollout" })
    .getByRole("button", { name: "Open workspace" })
    .click();
  await expect(
    facilitatorPage.getByRole("heading", { name: "product workspace" }),
  ).toBeVisible();
  await expect(
    facilitatorPage.locator(".shared-evidence blockquote"),
  ).toHaveText("Regional launch requires a documented approval gate.");

  await Promise.all([otherContext.close(), facilitatorContext.close()]);
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

test("AI dependency failure preserves an explicit manual excerpt fallback", async ({
  page,
}) => {
  await page.goto("/");
  const facilitatorLogin = await page.request.post("/api/v1/login", {
    data: {
      password: "counterpoint-product",
      userId: "product",
    },
  });
  const facilitator = LoginResponseSchema.parse(await facilitatorLogin.json());
  const createdResponse = await page.request.post("/api/v1/meetings", {
    data: {
      idempotencyKey: "ai-fallback-isolated-meeting",
      purpose: "AI fallback isolation check",
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
  await uploadAndUsePrivateMarkdown(page, {
    filename: "ai-fallback-source.md",
    text: "Regional launch requires a documented approval gate.",
  });
  await page.route("**/api/v1/disclosures/proposals", async (route) => {
    const request = route.request().postDataJSON() as {
      assistance?: string;
    };
    if (request.assistance === "ai_preferred") {
      await route.fulfill({
        body: JSON.stringify(
          createErrorEnvelope({
            code: "OPENAI_UNAVAILABLE",
            correlationId: "correlation_e2e_ai_unavailable",
          }),
        ),
        contentType: "application/json",
        status: 503,
      });
      return;
    }
    await route.continue();
  });

  await page
    .getByRole("button", { name: "Prepare grounded sharing preview" })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Private assistant is temporarily unavailable",
  );
  await expect(
    page.getByRole("button", { name: "Continue with manual excerpt" }),
  ).toBeVisible();
  await page.screenshot({
    animations: "disabled",
    fullPage: true,
    path: `${disclosureScreenshotDirectory}/2026-07-19-ai-degraded-manual-fallback-desktop.png`,
  });

  await page
    .getByRole("button", { name: "Continue with manual excerpt" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Review the exact payload" }),
  ).toBeVisible();
  await expect(page.getByText("Human-selected source excerpt")).toBeVisible();
});

test("mobile and reduced-motion views preserve the permission boundary", async ({
  page,
}) => {
  await page.setViewportSize({ height: 844, width: 390 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.getByLabel("Descant permission flow")).toBeVisible();
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
  await uploadAndUsePrivateMarkdown(page, {
    filename: "mobile-private-source.md",
    text: "Regional launch requires a documented approval gate.",
  });
  await expect(page.getByText("Permission gate")).toBeVisible();
  await page.screenshot({
    animations: "disabled",
    fullPage: true,
    path: `${screenshotDirectory}/2026-07-19-permission-workspace-mobile.png`,
  });
  await page
    .getByRole("button", { name: "Prepare grounded sharing preview" })
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
  await expect(page.getByLabel("Descant permission flow")).toBeVisible();
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
    .getByRole("button", { name: "Prepare grounded sharing preview" })
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
