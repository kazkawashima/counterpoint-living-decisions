import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

import { expect, test, type Page } from "@playwright/test";
import {
  CreateMeetingResponseSchema,
  LoginResponseSchema,
} from "@counterpoint/protocol";

const screenshotDirectory = resolve(
  "docs/media/screenshots/artifact-ingestion",
);
const clipDirectory = resolve("docs/media/clips/artifact-ingestion");
const filename = "synthetic-regional-readiness.md";
const exactSnippet = "Regional launch requires a documented approval gate.";
const syntheticDocument = [
  "# Synthetic regional readiness",
  "",
  "This is staged demo material, not a real customer record.",
  exactSnippet,
  "Keep the fallback staffing owner private until explicit review.",
].join("\n");

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

test("owner uploads, derives, and privately uses an artifact without leaking its existence", async ({
  baseURL,
  browser,
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

  const facilitatorLogin = await page.request.post("/api/v1/login", {
    data: {
      password: "counterpoint-product",
      userId: "product",
    },
  });
  const facilitator = LoginResponseSchema.parse(await facilitatorLogin.json());
  const createdResponse = await page.request.post("/api/v1/meetings", {
    data: {
      idempotencyKey: "artifact-ingestion-e2e-meeting",
      purpose: "Synthetic artifact boundary check",
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
  const meeting = CreateMeetingResponseSchema.parse(
    await createdResponse.json(),
  );

  await signIn(page, "Legal", "counterpoint-legal");
  await page
    .getByRole("article")
    .filter({ hasText: meeting.purpose })
    .getByRole("button", { name: "Open workspace" })
    .click();

  const vault = page.getByRole("region", {
    name: "Bring evidence in. Nothing goes out.",
  });
  await expect(vault.getByText("No uploaded artifacts")).toBeVisible();
  await vault.locator('input[type="file"]').setInputFiles({
    buffer: Buffer.from(syntheticDocument),
    mimeType: "text/markdown",
    name: filename,
  });
  await expect(vault.getByText(filename, { exact: true })).toBeVisible();
  await vault
    .getByRole("button", { name: "Store and process privately" })
    .click();

  const artifact = vault
    .locator(".artifact-item")
    .filter({ hasText: filename });
  await expect(artifact.getByText("Derived text ready")).toBeVisible();
  await vault.screenshot({
    animations: "disabled",
    path: `${screenshotDirectory}/2026-07-19-private-vault-processed-desktop.png`,
  });

  const sourceDownloadPromise = page.waitForEvent("download");
  await artifact.getByRole("button", { name: "Source", exact: true }).click();
  expect((await sourceDownloadPromise).suggestedFilename()).toBe(filename);
  const derivedDownloadPromise = page.waitForEvent("download");
  await artifact.getByRole("button", { name: "Derived", exact: true }).click();
  expect((await derivedDownloadPromise).suggestedFilename()).toBe(
    `${filename}.txt`,
  );

  await artifact.getByRole("button", { name: "Use privately" }).click();
  await expect(
    page.getByLabel("Active private source · derived text"),
  ).toHaveValue(syntheticDocument);
  await expect(page.getByLabel("Exact excerpt to preview")).toHaveValue(
    syntheticDocument,
  );
  await page
    .getByRole("button", { name: "Prepare grounded sharing preview" })
    .click();
  const preview = page.getByRole("region", {
    name: "Review the exact payload",
  });
  await expect(preview).toBeVisible();
  await expect(preview.getByText(exactSnippet, { exact: true })).toBeVisible();
  await expect(page.getByText("Nothing has been shared yet.")).toBeVisible();
  await page.screenshot({
    animations: "disabled",
    fullPage: true,
    path: `${screenshotDirectory}/2026-07-19-uploaded-source-preview-desktop.png`,
  });

  const otherContext = await browser.newContext({
    viewport: { height: 844, width: 390 },
  });
  const otherPage = await otherContext.newPage();
  await otherPage.emulateMedia({ reducedMotion: "reduce" });
  await otherPage.goto(baseURL ?? "/");
  await signIn(otherPage, "Engineering", "counterpoint-engineering");
  await otherPage
    .getByRole("article")
    .filter({ hasText: meeting.purpose })
    .getByRole("button", { name: "Open workspace" })
    .click();
  await expect(otherPage.getByText(filename, { exact: true })).toHaveCount(0);
  await expect(
    otherPage.getByText("No uploaded artifacts in your boundary."),
  ).toBeVisible();
  await otherPage.screenshot({
    animations: "disabled",
    fullPage: true,
    path: `${screenshotDirectory}/2026-07-19-other-owner-empty-mobile-reduced-motion.png`,
  });
  await otherContext.close();

  await page.waitForTimeout(900);
  const video = page.video();
  const saveVideo = video?.saveAs(
    `${clipDirectory}/2026-07-19-upload-to-private-preview.webm`,
  );
  await context.close();
  await saveVideo;
});

test("owner fetches a public URL through the safety-gated private workflow", async ({
  baseURL,
  browser,
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
  const facilitatorLogin = await page.request.post("/api/v1/login", {
    data: {
      password: "counterpoint-product",
      userId: "product",
    },
  });
  const facilitator = LoginResponseSchema.parse(await facilitatorLogin.json());
  const createdResponse = await page.request.post("/api/v1/meetings", {
    data: {
      idempotencyKey: "url-ingestion-e2e-meeting",
      purpose: "Synthetic URL boundary check",
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
  const meeting = CreateMeetingResponseSchema.parse(
    await createdResponse.json(),
  );
  const publicUrl =
    "https://public.example/synthetic-regional-url-readiness.md";

  await signIn(page, "Legal", "counterpoint-legal");
  await page
    .getByRole("article")
    .filter({ hasText: meeting.purpose })
    .getByRole("button", { name: "Open workspace" })
    .click();
  await page.route("**/api/v1/artifacts/url", async (route) => {
    const request = route.request();
    const body = request.postDataJSON() as {
      idempotencyKey: string;
      meetingId: string;
      url: string;
    };
    expect(body.url).toBe(publicUrl);
    const uploaded = await page.request.post("/api/v1/artifacts", {
      headers: {
        authorization: request.headers().authorization ?? "",
      },
      multipart: {
        file: {
          buffer: Buffer.from(syntheticDocument),
          mimeType: "text/markdown",
          name: "synthetic-regional-url-readiness.md",
        },
        idempotencyKey: body.idempotencyKey,
        meetingId: body.meetingId,
      },
    });
    const responseBody = (await uploaded.json()) as {
      artifact: Record<string, unknown>;
    };
    await route.fulfill({
      json: {
        ...responseBody,
        artifact: {
          ...responseBody.artifact,
          ingestionMethod: "url",
        },
      },
      status: uploaded.status(),
    });
  });

  const vault = page.getByRole("region", {
    name: "Bring evidence in. Nothing goes out.",
  });
  await vault.getByLabel("Or fetch a public document URL").fill(publicUrl);
  await vault
    .getByRole("button", { name: "Fetch through safety gate" })
    .click();
  const artifact = vault
    .locator(".artifact-item")
    .filter({ hasText: "synthetic-regional-url-readiness.md" });
  await expect(artifact.getByText("URL", { exact: true })).toBeVisible();
  await expect(artifact.getByText("Derived text ready")).toBeVisible();
  await vault.screenshot({
    animations: "disabled",
    path: `${screenshotDirectory}/2026-07-19-public-url-processed-desktop.png`,
  });

  await artifact.getByRole("button", { name: "Use privately" }).click();
  await expect(
    page.getByLabel("Active private source · derived text"),
  ).toHaveValue(syntheticDocument);
  await page
    .getByRole("button", { name: "Prepare grounded sharing preview" })
    .click();
  await expect(
    page.getByRole("region", { name: "Review the exact payload" }),
  ).toContainText(exactSnippet);
  await expect(page.getByText("Nothing has been shared yet.")).toBeVisible();
  await page.screenshot({
    animations: "disabled",
    fullPage: true,
    path: `${screenshotDirectory}/2026-07-19-public-url-private-preview-desktop.png`,
  });

  await page.waitForTimeout(900);
  const video = page.video();
  const saveVideo = video?.saveAs(
    `${clipDirectory}/2026-07-19-public-url-to-private-preview.webm`,
  );
  await context.close();
  await saveVideo;
});
