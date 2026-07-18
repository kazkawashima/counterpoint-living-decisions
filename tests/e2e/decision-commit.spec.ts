import { mkdir } from "node:fs/promises";
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

  await facilitatorPage
    .getByRole("button", { name: "Prepare grounded sharing preview" })
    .click();
  await expect(
    facilitatorPage.getByRole("heading", { name: "Review the exact payload" }),
  ).toBeVisible();
  await facilitatorPage
    .getByRole("button", { name: "Approve exact excerpt" })
    .click();
  await expect(facilitatorPage.getByText("Permission recorded")).toBeVisible();

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
    facilitatorPage.getByText(
      "Evaluation pending · Decision remains MONITORING",
      { exact: false },
    ),
  ).toBeVisible();
  await facilitatorPage.screenshot({
    animations: "disabled",
    fullPage: true,
    path: `${regulatoryScreenshotDirectory}/2026-07-19-event-received-evaluation-pending-desktop.png`,
  });

  await facilitatorPage.reload();
  const reloadedMeeting = facilitatorPage
    .getByRole("article")
    .filter({ hasText: meeting.purpose });
  await reloadedMeeting.getByRole("button", { name: "Open workspace" }).click();
  await expect(
    facilitatorPage.getByText("Revision 2 · COMMITTED"),
  ).toBeVisible();
  await expect(facilitatorPage.getByText("Monitoring active")).toBeVisible();
  await expect(
    facilitatorPage.locator(".regulatory-event-receipt"),
  ).toContainText("External event received");

  const video = facilitatorPage.video();
  await facilitatorContext.close();
  await video?.saveAs(`${clipDirectory}/2026-07-19-candidate-to-commit.webm`);

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
      name: "Conditional regional launch",
    }),
  ).toBeVisible();
  await expect(
    participantPage.getByText("Shared · Human committed"),
  ).toBeVisible();
  await expect(
    participantPage.getByText("2 / 5 readiness checks"),
  ).not.toBeVisible();
  await expect(
    participantPage.getByText("5 / 5 readiness checks"),
  ).toBeVisible();
  await expect(
    participantPage.getByText("MONITORING", { exact: true }),
  ).toBeVisible();
  await expect(
    participantPage.locator(".shared-regulatory-event"),
  ).toContainText("External event received");
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

  await participantPage.setViewportSize({ height: 844, width: 390 });
  await participantPage.emulateMedia({ reducedMotion: "reduce" });
  await participantPage.screenshot({
    animations: "disabled",
    fullPage: true,
    path: `${screenshotDirectory}/2026-07-19-committed-mobile-reduced-motion.png`,
  });
  await participantContext.close();
});
