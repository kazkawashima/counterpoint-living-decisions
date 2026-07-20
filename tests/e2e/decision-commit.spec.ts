import { copyFile, mkdir } from "node:fs/promises";

import { expect, test, type Page } from "@playwright/test";
import {
  createErrorEnvelope,
  CreateMeetingResponseSchema,
  DecisionAuditResponseSchema,
  DecisionJsonExportResponseSchema,
  GetRoleProjectionResponseSchema,
  LoginResponseSchema,
} from "@counterpoint/protocol";
import { evidenceDirectory } from "../helpers/evidence-paths.js";

const screenshotDirectory = evidenceDirectory("screenshots/decision-commit");
const clipDirectory = evidenceDirectory("clips/decision-commit");
const regulatoryScreenshotDirectory = evidenceDirectory(
  "screenshots/regulatory-event",
);
const invalidationScreenshotDirectory = evidenceDirectory(
  "screenshots/assumption-invalidation",
);
const reviewScreenshotDirectory = evidenceDirectory(
  "screenshots/decision-review",
);
const reviewClipDirectory = evidenceDirectory("clips/decision-review");
const resolutionScreenshotDirectory = evidenceDirectory(
  "screenshots/decision-resolution",
);
const resolutionClipDirectory = evidenceDirectory("clips/decision-resolution");
const degradedScreenshotDirectory = evidenceDirectory(
  "screenshots/degraded-mode",
);
const degradedClipDirectory = evidenceDirectory("clips/degraded-mode");

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
  await mkdir(regulatoryScreenshotDirectory, { recursive: true });
  await mkdir(invalidationScreenshotDirectory, { recursive: true });
  await mkdir(reviewScreenshotDirectory, { recursive: true });
  await mkdir(reviewClipDirectory, { recursive: true });
  await mkdir(resolutionScreenshotDirectory, { recursive: true });
  await mkdir(resolutionClipDirectory, { recursive: true });
  await mkdir(degradedScreenshotDirectory, { recursive: true });
  await mkdir(degradedClipDirectory, { recursive: true });
});

test("OpenAI failure preserves manual Decision, audit, and export paths", async ({
  baseURL,
  browser,
}) => {
  const context = await browser.newContext({
    recordVideo: {
      dir: "test-results/reel-video",
      size: { height: 720, width: 1280 },
    },
    viewport: { height: 900, width: 1440 },
  });
  const page = await context.newPage();
  await page.goto(baseURL ?? "/");

  const loginResponse = await page.request.post("/api/v1/login", {
    data: {
      password: "counterpoint-product",
      userId: "product",
    },
  });
  const facilitator = LoginResponseSchema.parse(await loginResponse.json());
  const meetingResponse = await page.request.post("/api/v1/meetings", {
    data: {
      idempotencyKey: "a8-manual-decision-e2e-meeting",
      purpose: "A8 durable manual Decision check",
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
    await meetingResponse.json(),
  );

  await signIn(page, "Product", "counterpoint-product");
  const meetingCard = page
    .getByRole("article")
    .filter({ hasText: meeting.purpose });
  await meetingCard.getByRole("button", { name: "Open workspace" }).click();
  await expect(
    page
      .getByRole("complementary", { name: "Continuity status" })
      .getByText("Meeting state stays online"),
  ).toBeVisible();

  await page
    .getByRole("button", { name: "Prepare grounded sharing preview" })
    .click();
  await page.getByRole("button", { name: "Approve exact excerpt" }).click();
  await expect(page.getByText("Permission recorded")).toBeVisible();

  await page.route("**/api/v1/decisions/candidates", async (route) => {
    const request = route.request().postDataJSON() as {
      assistance?: string;
    };
    if (request.assistance === "ai_preferred") {
      await route.fulfill({
        body: JSON.stringify(
          createErrorEnvelope({
            code: "OPENAI_UNAVAILABLE",
            correlationId: "correlation_e2e_a8_openai_unavailable",
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
    .getByRole("button", { name: "Generate Decision candidate" })
    .click();
  await expect(
    page.getByText("Decision synthesis is temporarily unavailable"),
  ).toBeVisible();
  await expect(
    page.getByText("Approved Evidence remains intact"),
  ).toBeVisible();
  await page.screenshot({
    animations: "disabled",
    fullPage: true,
    path: `${degradedScreenshotDirectory}/2026-07-19-openai-unavailable-manual-decision-desktop.png`,
  });

  await page.getByRole("button", { name: "Edit manual draft" }).click();
  await page
    .getByLabel("Decision title")
    .fill("Human-authored continuity launch");
  await page
    .getByLabel("Outcome")
    .fill("Continue with a bounded launch after the approval gate.");
  await page
    .getByLabel("Candidate premise")
    .fill(
      "Regional launch requires the documented approval gate retained by the facilitator.",
    );
  await page
    .getByRole("button", { name: "Create human-authored candidate" })
    .click();
  await expect(page.getByText("Human authored")).toBeVisible();
  await page.getByRole("button", { name: "Confirm edited premise" }).click();
  await page.getByRole("button", { name: "Save Decision draft" }).click();
  await page.getByRole("button", { name: "Validate and mark ready" }).click();
  await page.getByRole("button", { name: "Commit Decision" }).click();

  await expect(
    page.getByRole("heading", { name: "Human-authored continuity launch" }),
  ).toBeVisible();
  await expect(page.locator(".audit-line").getByText("Drafted")).toBeVisible();
  await expect(
    page.locator(".audit-line").getByText("MarkedReady"),
  ).toBeVisible();
  await expect(
    page.locator(".audit-line").getByText("Committed"),
  ).toBeVisible();
  const committedDecision = page.locator(".committed-decision");
  await committedDecision
    .getByRole("button", { name: "Prepare Decision JSON export" })
    .click();
  await expect(
    committedDecision.getByRole("link", { name: /Download JSON/u }),
  ).toContainText("2 revisions");

  const authorization = {
    authorization: `Bearer ${facilitator.bearerToken}`,
  };
  const projectionResponse = await page.request.get(
    `/api/v1/meetings/${meeting.meetingId}/projection`,
    { headers: authorization },
  );
  expect(projectionResponse.status()).toBe(200);
  const projection = GetRoleProjectionResponseSchema.parse(
    await projectionResponse.json(),
  );
  const decision = projection.shared.decisions[0];
  expect(decision?.snapshot.title).toBe("Human-authored continuity launch");
  expect(decision?.status).toBe("COMMITTED");
  expect(decision).toBeDefined();

  const auditResponse = await page.request.get(
    `/api/v1/meetings/${meeting.meetingId}/decisions/audit?decisionId=${decision?.decisionId ?? ""}`,
    { headers: authorization },
  );
  expect(auditResponse.status()).toBe(200);
  const audit = DecisionAuditResponseSchema.parse(await auditResponse.json());
  expect(audit.entries.map(({ eventType }) => eventType)).toEqual(
    expect.arrayContaining([
      "DecisionDrafted",
      "DecisionMarkedReady",
      "DecisionCommitted",
    ]),
  );

  const exportResponse = await page.request.get(
    `/api/v1/meetings/${meeting.meetingId}/decisions/${decision?.decisionId ?? ""}/export`,
    { headers: authorization },
  );
  expect(exportResponse.status()).toBe(200);
  const exported = DecisionJsonExportResponseSchema.parse(
    await exportResponse.json(),
  );
  expect(exported.decision.snapshot.title).toBe(
    "Human-authored continuity launch",
  );
  expect(exported.revisions).toHaveLength(2);
  expect(exported.auditEntries.length).toBeGreaterThanOrEqual(3);

  await page.screenshot({
    animations: "disabled",
    fullPage: true,
    path: `${degradedScreenshotDirectory}/2026-07-19-manual-decision-audit-export-desktop.png`,
  });
  const video = page.video();
  const saveVideo = video?.saveAs(
    `${degradedClipDirectory}/2026-07-19-openai-failure-to-manual-decision.webm`,
  );
  await context.close();
  await saveVideo;
});

test("facilitator commits a grounded Decision that participants can revisit", async ({
  baseURL,
  browser,
}) => {
  test.setTimeout(120_000);
  const facilitatorContext = await browser.newContext({
    recordVideo: {
      dir: "test-results/reel-video",
      size: { height: 720, width: 1280 },
    },
    viewport: { height: 900, width: 1440 },
  });
  const facilitatorPage = await facilitatorContext.newPage();
  await facilitatorPage.goto(baseURL ?? "/");

  const loginResponse = await facilitatorPage.request.post("/api/v1/login", {
    data: {
      password: "counterpoint-product",
      userId: "product",
    },
  });
  const facilitator = LoginResponseSchema.parse(await loginResponse.json());
  const meetingResponse = await facilitatorPage.request.post(
    "/api/v1/meetings",
    {
      data: {
        idempotencyKey: "decision-commit-e2e-meeting",
        purpose: "Grounded Decision commitment check",
        users: [
          { role: "facilitator", userId: "product" },
          { role: "participant", userId: "legal" },
          { role: "participant", userId: "engineering" },
        ],
      },
      headers: {
        authorization: `Bearer ${facilitator.bearerToken}`,
      },
    },
  );
  const meeting = CreateMeetingResponseSchema.parse(
    await meetingResponse.json(),
  );

  await signIn(facilitatorPage, "Product", "counterpoint-product");
  const facilitatorMeeting = facilitatorPage
    .getByRole("article")
    .filter({ hasText: meeting.purpose });
  await facilitatorMeeting
    .getByRole("button", { name: "Open workspace" })
    .click();
  await expect(
    facilitatorPage
      .getByRole("navigation", { name: "Flagship progress" })
      .getByText("01 Context"),
  ).toHaveAttribute("aria-current", "step");
  await expect(facilitatorPage.getByText("Current stage 1 of 5")).toBeVisible();

  await facilitatorPage
    .getByRole("button", { name: "Prepare grounded sharing preview" })
    .click();
  await expect(
    facilitatorPage.getByRole("heading", { name: "Review the exact payload" }),
  ).toBeVisible();
  await expect(facilitatorPage.getByText("Current stage 2 of 5")).toBeVisible();
  await facilitatorPage
    .getByRole("button", { name: "Approve exact excerpt" })
    .click();
  await expect(facilitatorPage.getByText("Permission recorded")).toBeVisible();
  await expect(facilitatorPage.getByText("Current stage 3 of 5")).toBeVisible();

  await facilitatorPage
    .getByRole("button", { name: "Generate Decision candidate" })
    .click();
  await expect(facilitatorPage.getByText("AI proposed")).toBeVisible();
  await expect(
    facilitatorPage.getByText("deterministic-shared-decision"),
  ).toBeVisible();
  await expect(facilitatorPage.getByLabel("Candidate premise")).toHaveValue(
    "Regional launch requires a documented approval gate.",
  );
  await facilitatorPage.screenshot({
    animations: "disabled",
    fullPage: true,
    path: `${screenshotDirectory}/2026-07-19-ai-candidate-desktop.png`,
  });

  await facilitatorPage
    .getByLabel("Candidate premise")
    .fill(
      "Regional launch requires a documented approval gate confirmed by the facilitator.",
    );
  await facilitatorPage
    .getByRole("button", { name: "Confirm edited premise" })
    .click();
  await expect(
    facilitatorPage
      .locator(".confirmation-stripe")
      .getByText("Human confirmed"),
  ).toBeVisible();
  await facilitatorPage
    .getByRole("button", { name: "Save Decision draft" })
    .click();
  await expect(
    facilitatorPage.getByText("Revision 1 · immutable DRAFT"),
  ).toBeVisible();
  await facilitatorPage
    .getByRole("button", { name: "Validate and mark ready" })
    .click();
  await expect(
    facilitatorPage.locator(".commit-gate").getByText("DECISION_READY"),
  ).toBeVisible();
  await facilitatorPage.screenshot({
    animations: "disabled",
    fullPage: true,
    path: `${screenshotDirectory}/2026-07-19-human-ready-desktop.png`,
  });

  await facilitatorPage
    .getByRole("button", { name: "Commit Decision" })
    .click();
  await expect(
    facilitatorPage.getByRole("heading", {
      name: "Conditional regional launch",
    }),
  ).toBeVisible();
  await expect(
    facilitatorPage.getByText("Revision 2 · COMMITTED"),
  ).toBeVisible();
  await expect(
    facilitatorPage.locator(".audit-line").getByText("Drafted"),
  ).toBeVisible();
  await expect(
    facilitatorPage.locator(".audit-line").getByText("MarkedReady"),
  ).toBeVisible();
  await expect(
    facilitatorPage.locator(".audit-line").getByText("Committed"),
  ).toBeVisible();
  await facilitatorPage.screenshot({
    animations: "disabled",
    fullPage: true,
    path: `${screenshotDirectory}/2026-07-19-committed-decision-desktop.png`,
  });

  await facilitatorPage
    .getByRole("button", { name: "Start Decision monitor" })
    .click();
  await expect(facilitatorPage.getByText("Monitoring active")).toBeVisible();
  await expect(facilitatorPage.getByText("Current stage 4 of 5")).toBeVisible();
  await expect(
    facilitatorPage.locator(".audit-line").getByText("MonitoringStarted"),
  ).toBeVisible();
  await facilitatorPage.screenshot({
    animations: "disabled",
    fullPage: true,
    path: `${screenshotDirectory}/2026-07-19-monitoring-active-desktop.png`,
  });

  await facilitatorPage
    .getByRole("button", { name: "Inject staged regulatory event" })
    .click();
  await expect(
    facilitatorPage
      .locator(".regulatory-event-receipt")
      .getByText("External event received", { exact: false }),
  ).toBeVisible();
  await expect(
    facilitatorPage.getByText("AT_RISK · AI suggestion"),
  ).toBeVisible();
  await expect(
    facilitatorPage.getByText("AI inferred · Human review required"),
  ).toBeVisible();
  await expect(
    facilitatorPage.getByText("REVIEW_REQUIRED has not been confirmed"),
  ).toBeVisible();
  await expect(facilitatorPage.getByText("Current stage 5 of 5")).toBeVisible();
  await facilitatorPage.screenshot({
    animations: "disabled",
    fullPage: true,
    path: `${invalidationScreenshotDirectory}/2026-07-19-at-risk-facilitator-desktop.png`,
  });

  const facilitatorReview = facilitatorPage.getByRole("region", {
    name: "Facilitator risk review",
  });
  await expect(facilitatorReview).toContainText("External event");
  await expect(
    facilitatorReview.getByTestId("review-affected-premise"),
  ).toContainText("Regional launch requires a documented approval gate");
  await expect(facilitatorReview.getByTestId("review-evidence")).toBeVisible();
  await expect(
    facilitatorReview.getByTestId("review-affected-action"),
  ).toBeVisible();
  await facilitatorPage.screenshot({
    animations: "disabled",
    fullPage: true,
    path: `${reviewScreenshotDirectory}/2026-07-19-facilitator-review-workbench-desktop.png`,
  });
  await facilitatorReview
    .getByRole("button", { name: "Confirm impact and open review" })
    .click();
  await expect(
    facilitatorPage.getByText(
      "Enter a facilitator review reason before choosing an outcome.",
    ),
  ).toBeVisible();
  await facilitatorPage.screenshot({
    animations: "disabled",
    fullPage: true,
    path: `${reviewScreenshotDirectory}/2026-07-19-reason-required-desktop.png`,
  });
  await facilitatorReview
    .getByLabel("Facilitator review reason")
    .fill(
      "The staged regulatory evidence materially affects the launch premise.",
    );
  await facilitatorReview
    .getByRole("button", { name: "Confirm impact and open review" })
    .click();
  await expect(
    facilitatorPage
      .locator(".committed-decision")
      .getByText("REVIEW_REQUIRED · Human confirmed")
      .first(),
  ).toBeVisible();
  await expect(
    facilitatorPage.getByTestId("reconsideration-task"),
  ).toContainText("open");
  await expect(
    facilitatorPage.locator(".audit-line").getByText("ReviewRequired"),
  ).toBeVisible();
  await expect(
    facilitatorPage.locator(".audit-line").getByText("FacilitatorReviewed"),
  ).toBeVisible();
  await expect(
    facilitatorPage.locator(".audit-line").getByText("ActionHeld"),
  ).toBeVisible();
  await expect(
    facilitatorPage
      .locator(".audit-line")
      .getByText("ReconsiderationTaskCreated"),
  ).toBeVisible();
  await expect(
    facilitatorPage.getByText("Flagship arc complete"),
  ).toBeVisible();
  await facilitatorPage.screenshot({
    animations: "disabled",
    fullPage: true,
    path: `${reviewScreenshotDirectory}/2026-07-19-review-required-desktop.png`,
  });

  const resolutionWorkbench = facilitatorPage.getByRole("region", {
    name: "Resolve Decision review",
  });
  await expect(resolutionWorkbench).toContainText("Commit revised Decision");
  await expect(resolutionWorkbench).toContainText("Close without replacement");
  await facilitatorPage.screenshot({
    animations: "disabled",
    fullPage: true,
    path: `${resolutionScreenshotDirectory}/2026-07-19-resolution-options-desktop.png`,
  });
  await resolutionWorkbench
    .getByLabel("Revised Decision title")
    .fill("Regulation-aware regional launch");
  await resolutionWorkbench
    .getByLabel("Revised outcome")
    .fill(
      "Pause regional launch until the revised regulatory approval gate is satisfied.",
    );
  await resolutionWorkbench
    .getByLabel("Revised monitor condition")
    .fill("Monitor the revised approval gate before resuming regional launch.");
  await expect(
    resolutionWorkbench.locator(".revision-comparison"),
  ).toContainText("Proposed revision 3");
  await facilitatorPage.screenshot({
    animations: "disabled",
    fullPage: true,
    path: `${resolutionScreenshotDirectory}/2026-07-19-recommit-comparison-desktop.png`,
  });
  await resolutionWorkbench
    .getByRole("button", { name: "Commit revision 3" })
    .click();
  await expect(
    facilitatorPage.getByText("Revision 3 is now active"),
  ).toBeVisible();
  await expect(
    facilitatorPage.getByText(
      "Human review is resolved. Revision history and current state remain exportable.",
    ),
  ).toBeVisible();
  await expect(
    facilitatorPage.locator(".audit-line").getByText("RevisionCommitted"),
  ).toBeVisible();
  await resolutionWorkbench
    .getByRole("button", { name: "Prepare Decision JSON export" })
    .click();
  await expect(
    resolutionWorkbench.getByRole("link", { name: /Download JSON/u }),
  ).toContainText("3 revisions");
  await facilitatorPage.screenshot({
    animations: "disabled",
    fullPage: true,
    path: `${resolutionScreenshotDirectory}/2026-07-19-recommit-success-history-desktop.png`,
  });

  await facilitatorPage.reload();
  const reloadedMeeting = facilitatorPage
    .getByRole("article")
    .filter({ hasText: meeting.purpose });
  await reloadedMeeting.getByRole("button", { name: "Open workspace" }).click();
  await expect(
    facilitatorPage.getByText("Revision 3 · COMMITTED"),
  ).toBeVisible();
  await expect(
    facilitatorPage
      .locator(".committed-decision")
      .getByText("COMMITTED · Revision 3")
      .first(),
  ).toBeVisible();
  await expect(
    facilitatorPage.locator(".regulatory-event-receipt"),
  ).toContainText("External event received");

  const video = facilitatorPage.video();
  const clipPath = `${clipDirectory}/2026-07-19-candidate-to-commit.webm`;
  const saveVideo = video?.saveAs(clipPath);
  await facilitatorContext.close();
  await saveVideo;
  await copyFile(
    clipPath,
    `${resolutionClipDirectory}/2026-07-19-review-required-to-recommit.webm`,
  );

  const participantContext = await browser.newContext({
    viewport: { height: 900, width: 1440 },
  });
  const participantPage = await participantContext.newPage();
  await participantPage.goto(baseURL ?? "/");
  await signIn(participantPage, "Legal", "counterpoint-legal");
  const participantMeeting = participantPage
    .getByRole("article")
    .filter({ hasText: meeting.purpose });
  await participantMeeting
    .getByRole("button", { name: "Open workspace" })
    .click();
  await expect(
    participantPage.getByRole("heading", {
      name: "Regulation-aware regional launch",
    }),
  ).toBeVisible();
  await expect(
    participantPage.getByText("Shared · Human recommitted"),
  ).toBeVisible();
  await expect(
    participantPage.getByText("2 / 5 readiness checks"),
  ).not.toBeVisible();
  await expect(
    participantPage.getByText("5 / 5 readiness checks"),
  ).toBeVisible();
  await expect(
    participantPage.getByText("COMMITTED", { exact: true }),
  ).toBeVisible();
  await expect(
    participantPage.getByText("Revision 3", { exact: true }),
  ).toBeVisible();
  await expect(
    participantPage.locator(".shared-regulatory-event"),
  ).toContainText("External event received");
  await expect(
    participantPage.locator(".shared-risk-suggestion"),
  ).toContainText("Facilitator reason");
  await expect(
    participantPage.locator(".shared-risk-suggestion"),
  ).toContainText("Reconsideration task open");
  await expect(
    participantPage.getByLabel("Facilitator review reason"),
  ).not.toBeVisible();
  await expect(
    participantPage.getByRole("button", {
      name: "Confirm impact and open review",
    }),
  ).not.toBeVisible();
  await expect(
    participantPage.getByRole("region", {
      name: "Resolve Decision review",
    }),
  ).not.toBeVisible();
  await expect(
    participantPage.getByRole("button", {
      name: "Generate Decision candidate",
    }),
  ).not.toBeVisible();
  await expect(
    participantPage.getByRole("button", {
      name: "Inject staged regulatory event",
    }),
  ).not.toBeVisible();
  await participantPage.screenshot({
    animations: "disabled",
    fullPage: true,
    path: `${screenshotDirectory}/2026-07-19-participant-committed-shared.png`,
  });
  await participantPage.screenshot({
    animations: "disabled",
    fullPage: true,
    path: `${regulatoryScreenshotDirectory}/2026-07-19-participant-event-received-desktop.png`,
  });
  await participantPage.screenshot({
    animations: "disabled",
    fullPage: true,
    path: `${resolutionScreenshotDirectory}/2026-07-19-participant-recommitted-desktop.png`,
  });

  await participantPage.setViewportSize({ height: 844, width: 390 });
  await participantPage.emulateMedia({ reducedMotion: "reduce" });
  await participantPage.screenshot({
    animations: "disabled",
    fullPage: true,
    path: `${screenshotDirectory}/2026-07-19-committed-mobile-reduced-motion.png`,
  });
  await participantPage.screenshot({
    animations: "disabled",
    fullPage: true,
    path: `${resolutionScreenshotDirectory}/2026-07-19-participant-terminal-mobile-reduced-motion.png`,
  });
  await participantContext.close();
});
