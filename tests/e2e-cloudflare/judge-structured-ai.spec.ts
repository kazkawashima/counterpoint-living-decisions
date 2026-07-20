import { mkdir } from "node:fs/promises";

import { expect, test, type Page } from "@playwright/test";
import {
  LoginResponseSchema,
  ReadinessResponseSchema,
} from "@counterpoint/protocol";
import { evidenceDirectory } from "../helpers/evidence-paths.js";

const MEETING_ID = "meeting-global-ai-rollout";
const MEETING_PURPOSE = "Work & Productivity — Global AI Product Rollout";
const reviewScreenshotDirectory = evidenceDirectory(
  "screenshots/decision-review",
);

test.beforeAll(async () => {
  await mkdir(reviewScreenshotDirectory, { recursive: true });
});

async function signIn(page: Page) {
  await page.getByRole("button", { name: "Product" }).click();
  await page.getByLabel("Demo password").fill("counterpoint-product");
  await page.getByRole("button", { name: "Continue to meetings" }).click();
  await expect(
    page.getByRole("heading", { name: "Your assigned meetings" }),
  ).toBeVisible();
}

async function openFlagship(page: Page) {
  await page
    .getByRole("article")
    .filter({ hasText: MEETING_PURPOSE })
    .getByRole("button", { name: "Open workspace" })
    .click();
  await expect(
    page.getByRole("heading", { name: "product workspace" }),
  ).toBeVisible();
}

function manualTextControls(page: Page) {
  const speech = page.getByRole("region", {
    name: "Explicit speech controls",
  });
  return {
    input: speech.getByLabel("Equivalent text command"),
    send: speech.getByRole("button", { name: "Send privately" }),
    speech,
  };
}

async function sendPrivateText(page: Page, text: string) {
  const { input, send, speech } = manualTextControls(page);
  await expect(input).toBeEnabled();
  await input.fill(text);
  await expect(send).toBeEnabled();
  await send.click();
  await expect(
    speech.getByText(`Sent privately · ${text} · text-only`),
  ).toBeVisible();
  await expect(
    speech
      .getByRole("complementary", { name: "Recent utterances" })
      .getByText(text, { exact: true }),
  ).toBeVisible();
}

async function expectManualContinuity(page: Page) {
  const continuity = page.getByRole("complementary", {
    name: "Continuity status",
  });
  await expect(
    continuity.getByText("Meeting state stays online"),
  ).toBeVisible();
  await expect(continuity.getByText("Manual text")).toBeVisible();
  await expect(
    continuity.getByText("Available", { exact: true }),
  ).toBeVisible();
  await expect(manualTextControls(page).input).toBeEnabled();
}

test("real Wrangler replays the provider-free staged rule and manual review arc with managed provider disabled", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const apiRequests: URL[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/")) {
      apiRequests.push(new URL(request.url()));
    }
  });

  const readinessResponse = await page.request.get("/ready");
  expect([200, 503]).toContain(readinessResponse.status());
  const readiness = ReadinessResponseSchema.parse(
    await readinessResponse.json(),
  );
  expect(readiness.dependencies.find(({ name }) => name === "openai")).toEqual({
    name: "openai",
    status: "not_configured",
  });

  const loginResponse = await page.request.post("/api/v1/login", {
    data: {
      password: "counterpoint-product",
      userId: "product",
    },
  });
  expect(loginResponse.status()).toBe(200);
  const facilitator = LoginResponseSchema.parse(await loginResponse.json());
  const resetResponse = await page.request.post(
    `/api/v1/meetings/${MEETING_ID}/demo/reset`,
    {
      data: {
        expectedPosition: 0,
        idempotencyKey: `cloudflare-judge-ai-reset-${crypto.randomUUID()}`,
        meetingId: MEETING_ID,
      },
      headers: {
        authorization: `Bearer ${facilitator.bearerToken}`,
      },
    },
  );
  expect(resetResponse.status()).toBe(200);

  await page.goto("/");
  await expect(page).toHaveTitle(/Descant/u);
  const pageHost = new URL(page.url()).hostname;
  expect(["localhost", "127.0.0.1", "0.0.0.0"]).not.toContain(pageHost);
  await signIn(page);
  await openFlagship(page);

  const beforeRule =
    "Worker durable text recorded before the staged demo rule.";
  const afterRule =
    "Worker manual text continues after the staged rule evaluation.";
  const privateMeetingText =
    "Private context: the regional team is ready to launch. Regional launch requires a documented approval gate. Keep the fallback owner private until the staffing review.";
  const sharedMeetingText =
    "Regional launch requires a documented approval gate.";
  await expect(page.getByLabel("Staged private note")).toHaveValue(
    privateMeetingText,
  );
  await sendPrivateText(page, beforeRule);

  await page
    .getByRole("button", { name: "Prepare grounded sharing preview" })
    .click();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Private assistant is temporarily unavailable" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Continue with manual excerpt" })
    .click();
  await page.getByRole("button", { name: "Approve exact excerpt" }).click();
  await expect(page.getByText("Permission recorded")).toBeVisible();

  await page
    .getByRole("button", { name: "Generate Decision candidate" })
    .click();
  await expect(
    page.getByText("Decision synthesis is temporarily unavailable"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Edit manual draft" }).click();
  await expect(page.getByText("Manual fallback")).toBeVisible();
  await page
    .getByRole("button", { name: "Create human-authored candidate" })
    .click();
  await expect(page.getByText("Human authored")).toBeVisible();
  await page.getByRole("button", { name: "Confirm edited premise" }).click();
  await page.getByRole("button", { name: "Save Decision draft" }).click();
  await expect(page.getByText("Revision 1 · immutable DRAFT")).toBeVisible();
  await page.getByRole("button", { name: "Validate and mark ready" }).click();
  await expect(
    page.locator(".commit-gate").getByText("DECISION_READY"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Commit Decision" }).click();
  await expect(
    page
      .getByRole("region", { name: "Turn evidence into commitment" })
      .getByText("COMMITTED", { exact: true }),
  ).toBeVisible();

  await page.reload();
  await openFlagship(page);
  await expect(page.getByText(beforeRule, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Start Decision monitor" }).click();
  await expect(
    page
      .getByRole("region", { name: "Turn evidence into commitment" })
      .getByText("MONITORING", { exact: true }),
  ).toBeVisible();

  await page.reload();
  await openFlagship(page);
  await expect(
    page.getByRole("button", { name: "Inject staged regulatory event" }),
  ).toBeVisible();

  const regulatoryResponse = page.waitForResponse(
    (response) =>
      response
        .url()
        .endsWith(`/api/v1/meetings/${MEETING_ID}/demo/regulatory-changes`) &&
      response.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Inject staged regulatory event" })
    .click();
  expect((await regulatoryResponse).status()).toBe(202);

  const receipt = page.locator(".regulatory-event-receipt");
  await expect(receipt).toContainText("External event received");
  await expect(receipt).toContainText("European Union");
  await expect(receipt).toContainText(
    "Staged demo event: a synthetic regional regulation changes the approval gate.",
  );
  await expect(receipt).toContainText(
    "Evaluation recorded · Human review still required",
  );
  await expect(page.locator(".invalidation-risk-pulse")).toContainText(
    "Staged demo rule · Human review required",
  );
  await expect(
    page.getByRole("region", { name: "Facilitator risk review" }),
  ).toBeVisible();
  await page.screenshot({
    animations: "disabled",
    fullPage: true,
    path: `${reviewScreenshotDirectory}/2026-07-21-staged-demo-rule-at-risk-desktop.png`,
  });
  await expect(page.getByLabel("Staged private note")).toHaveValue(
    privateMeetingText,
  );
  await expect(page.locator(".shared-evidence blockquote")).toHaveText(
    sharedMeetingText,
  );
  await expect(page.getByText(beforeRule, { exact: true })).toBeVisible();
  await expectManualContinuity(page);
  await page
    .getByRole("textbox", { name: "Facilitator review reason" })
    .fill("The synthetic regulation changes the monitored premise.");
  await page
    .getByRole("button", { name: "Confirm impact and open review" })
    .click();
  await expect(
    page.getByText("REVIEW_REQUIRED · Human confirmed").first(),
  ).toBeVisible();
  await expect(page.getByText("1 affected Action held")).toBeVisible();
  await page.screenshot({
    animations: "disabled",
    fullPage: true,
    path: `${reviewScreenshotDirectory}/2026-07-21-staged-demo-rule-review-required-desktop.png`,
  });
  await sendPrivateText(page, afterRule);

  await page.reload();
  await openFlagship(page);
  const durableReceipt = page.locator(".regulatory-event-receipt");
  await expect(durableReceipt).toContainText(
    "Evaluation recorded · Human review still required",
  );
  await expect(page.locator(".invalidation-risk-pulse")).toContainText(
    "Human reviewed · Impact confirmed",
  );
  await expect(
    page.getByText("REVIEW_REQUIRED · Human confirmed").first(),
  ).toBeVisible();
  await expect(page.getByLabel("Staged private note")).toHaveValue(
    privateMeetingText,
  );
  await expect(page.locator(".shared-evidence blockquote")).toHaveText(
    sharedMeetingText,
  );
  await expect(page.getByText(beforeRule, { exact: true })).toBeVisible();
  await expect(page.getByText(afterRule, { exact: true })).toBeVisible();
  await expectManualContinuity(page);

  expect(apiRequests.length).toBeGreaterThanOrEqual(8);
  expect(apiRequests.every(({ hostname }) => hostname === pageHost)).toBe(true);
});
