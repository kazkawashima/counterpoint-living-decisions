import { mkdir } from "node:fs/promises";

import { expect, test } from "@playwright/test";
import { evidenceDirectory } from "../helpers/evidence-paths.js";

const MEETING_ID = "meeting-global-ai-rollout";
const recoveryScreenshotDirectory = evidenceDirectory(
  "screenshots/decision-review",
);

test.beforeAll(async () => {
  await mkdir(recoveryScreenshotDirectory, { recursive: true });
});

test("Worker SPA serves the hosted flagship through one external-style origin", async ({
  page,
}) => {
  const apiRequests: URL[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/")) {
      apiRequests.push(new URL(request.url()));
    }
  });

  const loginResponse = await page.request.post("/api/v1/login", {
    data: { password: "counterpoint-product", userId: "product" },
  });
  expect(loginResponse.ok()).toBe(true);
  const loginBody = (await loginResponse.json()) as {
    bearerToken?: string;
  };
  expect(loginBody.bearerToken).toEqual(expect.any(String));

  const resetResponse = await page.request.post(
    `/api/v1/meetings/${MEETING_ID}/demo/reset`,
    {
      data: {
        expectedPosition: 0,
        idempotencyKey: `cloudflare-browser-reset-${String(Date.now())}`,
        meetingId: MEETING_ID,
      },
      headers: { authorization: `Bearer ${loginBody.bearerToken}` },
    },
  );
  expect(resetResponse.ok()).toBe(true);

  await page.goto("/");
  await expect(page).toHaveTitle(/Descant/u);
  const pageHost = new URL(page.url()).hostname;
  expect(["localhost", "127.0.0.1", "0.0.0.0"]).not.toContain(pageHost);
  await expect(
    page.getByRole("heading", { name: /Independent minds/u }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Product" }).click();
  await page.getByLabel("Demo password").fill("counterpoint-product");
  await page.getByRole("button", { name: "Continue to meetings" }).click();
  await expect(
    page.getByRole("heading", { name: "Your assigned meetings" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: /Work & Productivity/u }),
  ).toBeVisible();

  await page
    .getByRole("article")
    .filter({ hasText: "Work & Productivity — Global AI Product Rollout" })
    .getByRole("button", { name: "Open workspace" })
    .click();
  await expect(
    page.getByRole("heading", { name: "product workspace" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "No evidence has crossed the boundary" }),
  ).toBeVisible();

  await page
    .getByRole("button", { name: "Prepare grounded sharing preview" })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    /Private assistant is temporarily unavailable|This action is unavailable in judge mode/,
  );
  await expect(
    page.getByRole("button", { name: "Continue with manual excerpt" }),
  ).toBeVisible();
  if (process.env.CAPTURE_EVIDENCE === "1") {
    await page.screenshot({
      animations: "disabled",
      fullPage: true,
      path: `${recoveryScreenshotDirectory}/2026-07-21-ordinary-production-manual-fallback.png`,
    });
  }
  await page
    .getByRole("button", { name: "Continue with manual excerpt" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Review the exact payload" }),
  ).toBeVisible();
  await expect(page.getByText("Human-selected source excerpt")).toBeVisible();

  expect(apiRequests.length).toBeGreaterThanOrEqual(3);
  expect(apiRequests.every(({ hostname }) => hostname === pageHost)).toBe(true);
});

test("Worker keeps ordinary, judge, and shared-display browser contexts separate", async ({
  browser,
  page,
}) => {
  await page.goto("/");
  const origin = new URL(page.url()).origin;
  const productContext = await browser.newContext({ baseURL: origin });
  const ordinaryContext = await browser.newContext({ baseURL: origin });
  const displayContext = await browser.newContext({ baseURL: origin });
  try {
    const product = await productContext.request.post("/api/v1/login", {
      data: { password: "counterpoint-product", userId: "product" },
    });
    expect(product.status()).toBe(200);
    const productBody = (await product.json()) as { bearerToken: string };
    const productAuthorization = {
      authorization: `Bearer ${productBody.bearerToken}`,
    };

    const reset = await productContext.request.post(
      `/api/v1/meetings/${MEETING_ID}/demo/reset`,
      {
        data: {
          expectedPosition: 0,
          idempotencyKey: `cloudflare-browser-role-reset-${String(Date.now())}`,
          meetingId: MEETING_ID,
        },
        headers: productAuthorization,
      },
    );
    expect(reset.status()).toBe(200);

    const privateText =
      "Remote hosted private boundary canary; never shared with legal.";
    const sourceResponse = await productContext.request.post(
      "/api/v1/disclosures/sources/text",
      {
        data: {
          expectedPosition: 0,
          idempotencyKey: `cloudflare-browser-private-source-${String(Date.now())}`,
          meetingId: MEETING_ID,
          text: privateText,
          title: "Hosted private boundary canary",
        },
        headers: productAuthorization,
      },
    );
    expect(sourceResponse.status()).toBe(201);
    const sourceBody = (await sourceResponse.json()) as {
      position: number;
      source: { sourceArtifactId: string };
    };

    const projection = await productContext.request.get(
      `/api/v1/meetings/${MEETING_ID}/projection`,
      { headers: productAuthorization },
    );
    expect(projection.status()).toBe(200);
    const projectionBody = (await projection.json()) as {
      shared: { position: number };
    };
    const issue = await productContext.request.post(
      `/api/v1/meetings/${MEETING_ID}/display-tokens`,
      {
        data: {
          expectedPosition: projectionBody.shared.position,
          meetingId: MEETING_ID,
        },
        headers: productAuthorization,
      },
    );
    expect(issue.status()).toBe(201);
    const issueBody = (await issue.json()) as {
      displayToken: string;
      displayTokenId: string;
      position: number;
    };

    const ordinary = await ordinaryContext.request.post("/api/v1/login", {
      data: { password: "counterpoint-legal", userId: "legal" },
    });
    expect(ordinary.status()).toBe(200);
    const ordinaryBody = (await ordinary.json()) as { bearerToken: string };
    const ordinaryAuthorization = {
      authorization: `Bearer ${ordinaryBody.bearerToken}`,
    };
    const ordinaryProjection = await ordinaryContext.request.get(
      `/api/v1/meetings/${MEETING_ID}/projection`,
      { headers: ordinaryAuthorization },
    );
    expect(ordinaryProjection.status()).toBe(200);
    const ordinaryProjectionBody = (await ordinaryProjection.json()) as {
      privateWorkspace?: { sources?: unknown[] };
    };
    expect(JSON.stringify(ordinaryProjectionBody)).not.toContain(privateText);
    expect(ordinaryProjectionBody).toMatchObject({
      privateWorkspace: { sources: [] },
    });
    const forbiddenProposal = await ordinaryContext.request.post(
      "/api/v1/disclosures/proposals",
      {
        data: {
          assistance: "manual",
          exactSnippet: privateText,
          expectedPosition: sourceBody.position,
          idempotencyKey: `cloudflare-browser-cross-owner-proposal-${String(Date.now())}`,
          meetingId: MEETING_ID,
          sourceArtifactId: sourceBody.source.sourceArtifactId,
          sourceRange: { end: privateText.length, start: 0 },
        },
        headers: ordinaryAuthorization,
      },
    );
    expect(forbiddenProposal.status()).toBe(403);
    await expect(forbiddenProposal.json()).resolves.toMatchObject({
      code: "FORBIDDEN",
    });
    const ordinaryJudgeUsage = await ordinaryContext.request.get(
      `/api/v1/meetings/${MEETING_ID}/judge/usage`,
      { headers: ordinaryAuthorization },
    );
    expect([403, 503]).toContain(ordinaryJudgeUsage.status());
    await expect(ordinaryJudgeUsage.json()).resolves.toMatchObject({
      code:
        ordinaryJudgeUsage.status() === 403
          ? "JUDGE_MODE_FORBIDDEN"
          : "REALTIME_UNAVAILABLE",
    });

    const displayPage = await displayContext.newPage();
    await displayPage.goto(
      `/?displayMeetingId=${encodeURIComponent(MEETING_ID)}&displayToken=${encodeURIComponent(issueBody.displayToken)}`,
    );
    await expect(
      displayPage.getByText("Read-only shared display", { exact: true }),
    ).toBeVisible();
    await expect(displayPage.getByText("Private workspace")).toHaveCount(0);
    await expect(displayPage.getByText("counterpoint-product")).toHaveCount(0);

    const revoke = await productContext.request.post(
      `/api/v1/meetings/${MEETING_ID}/display-tokens/revoke`,
      {
        data: {
          displayTokenId: issueBody.displayTokenId,
          expectedPosition: issueBody.position,
          meetingId: MEETING_ID,
        },
        headers: productAuthorization,
      },
    );
    expect(revoke.status()).toBe(200);
    await displayPage.reload();
    await expect(
      displayPage
        .getByRole("alert")
        .filter({ hasText: "expired or was revoked" }),
    ).toBeVisible();
  } finally {
    await Promise.all([
      productContext.close(),
      ordinaryContext.close(),
      displayContext.close(),
    ]);
  }
});
