import { copyFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

import { expect, test, type Page } from "@playwright/test";
import {
  CreateMeetingResponseSchema,
  LoginResponseSchema,
} from "@counterpoint/protocol";

const screenshotDirectory = resolve("docs/media/screenshots/decision-commit");
const clipDirectory = resolve("docs/media/clips/decision-commit");
const regulatoryScreenshotDirectory = resolve(
  "docs/media/screenshots/regulatory-event",
);
const invalidationScreenshotDirectory = resolve(
  "docs/media/screenshots/assumption-invalidation",
);
const reviewScreenshotDirectory = resolve(
  "docs/media/screenshots/decision-review",
);
const reviewClipDirectory = resolve("docs/media/clips/decision-review");
const resolutionScreenshotDirectory = resolve(
  "docs/media/screenshots/decision-resolution",
);
const resolutionClipDirectory = resolve("docs/media/clips/decision-resolution");

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
});

test("facilitator commits a grounded Decision that participants can revisit", async ({
  baseURL,
  browser,
}) => {
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
