import { copyFile, mkdir } from "node:fs/promises";

import { AxeBuilder } from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  createErrorEnvelope,
  CreateMeetingResponseSchema,
  DecisionAuditResponseSchema,
  DecisionJsonExportResponseSchema,
  GetRoleProjectionResponseSchema,
  ListSharedDecisionsResponseSchema,
  LoginResponseSchema,
} from "@counterpoint/protocol";
import { evidenceDirectory } from "../helpers/evidence-paths.js";
import { activateByKeyboard } from "../helpers/keyboard.js";
import { uploadAndUsePrivateMarkdown } from "../helpers/private-source.js";

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
const FLAGSHIP_PURPOSE = "Global AI Product Rollout";

async function signIn(page: Page, identity: string, password: string) {
  await activateByKeyboard(
    page,
    page.getByRole("button", { name: new RegExp(identity, "iu") }),
  );
  await page.getByLabel("Demo password").fill(password);
  await activateByKeyboard(
    page,
    page.getByRole("button", { name: "Continue to meetings" }),
  );
  await expect(
    page.getByRole("heading", { name: "Your assigned meetings" }),
  ).toBeVisible();
}

async function expectAccessibleDecisionState(
  page: Page,
  stateText: string,
  focusTarget?: Locator,
) {
  const decisionForge = page.getByRole("region", {
    name: "Turn evidence into commitment",
  });
  await expect(focusTarget ?? decisionForge).toBeFocused();
  await expect(
    decisionForge
      .locator('[role="status"], [aria-live]')
      .filter({ hasText: stateText })
      .first(),
  ).toBeVisible();

  await expectAccessibleSurface(page, `Decision state: ${stateText}`);
}

async function expectAccessibleSurface(page: Page, stateLabel: string) {
  const surface = page.locator(".workspace-shell");
  const wcag = await new AxeBuilder({ page })
    .include(".workspace-shell")
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(
    wcag.violations.map(({ id, nodes }) => ({
      id,
      targets: nodes.map(({ target }) => target),
    })),
    `WCAG violations in ${stateLabel}`,
  ).toEqual([]);

  const targets = await new AxeBuilder({ page })
    .include(".workspace-shell")
    .withRules(["target-size"])
    .analyze();
  expect(
    targets.violations.map(({ id, nodes }) => ({
      id,
      targets: nodes.map(({ target }) => target),
    })),
    `Target-size violations in ${stateLabel}`,
  ).toEqual([]);
  expect(
    targets.passes.some(({ id }) => id === "target-size"),
    `Expected target-size to run in ${stateLabel}`,
  ).toBe(true);

  const controls = surface.locator("button, a[href], input, textarea, select");
  for (let index = 0; index < (await controls.count()); index += 1) {
    const control = controls.nth(index);
    if (await control.isVisible()) {
      await expect(control).toHaveAccessibleName(/\S/u);
    }
  }
}

async function expectMinimumControlHeight(control: Locator) {
  const bounds = await control.boundingBox();
  expect(
    bounds,
    "Expected control to have a rendered bounding box",
  ).not.toBeNull();
  expect(bounds?.height).toBeGreaterThanOrEqual(44);
}

async function expectReducedMotionStyles(target: Locator) {
  const styles = await target.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      animationDuration: Number.parseFloat(style.animationDuration),
      animationIterationCount: style.animationIterationCount,
      transitionDuration: Number.parseFloat(style.transitionDuration),
    };
  });
  expect(styles.animationDuration).toBeLessThanOrEqual(0.000_01);
  expect(styles.animationIterationCount).toBe("1");
  expect(styles.transitionDuration).toBeLessThanOrEqual(0.000_01);
}

async function expectAssociatedFieldError(page: Page, field: Locator) {
  await expect(field).toBeFocused();
  await expect(field).toHaveAttribute("aria-invalid", "true");
  const errorId = await field.getAttribute("aria-describedby");
  expect(errorId).toBeTruthy();
  await expect(page.locator(`#${errorId}`)).toHaveAttribute("role", "alert");
}

async function driveFlagshipToAtRisk(page: Page) {
  await signIn(page, "Product", "counterpoint-product");
  const meeting = page
    .getByRole("article")
    .filter({ hasText: FLAGSHIP_PURPOSE });
  await activateByKeyboard(
    page,
    meeting.getByRole("button", { name: "Open workspace" }),
  );
  await activateByKeyboard(
    page,
    page.getByRole("button", { name: "Reset staged demo" }),
  );
  await activateByKeyboard(
    page,
    page.getByRole("button", { name: "Confirm meeting reset" }),
  );
  const privateWorkspace = page.locator(".private-zone");
  await activateByKeyboard(
    page,
    privateWorkspace.getByRole("button", {
      name: "Prepare grounded sharing preview",
    }),
  );
  await activateByKeyboard(
    page,
    privateWorkspace
      .getByRole("region", { name: "Review the exact payload" })
      .getByRole("button", { name: "Approve exact excerpt" }),
  );
  const sharedEvidence = page.locator(".shared-evidence");
  await expect(sharedEvidence.locator(".evidence-id")).toHaveText(
    "Approved shared Evidence",
  );
  const sharedEvidenceReference = sharedEvidence.locator(
    "details.evidence-reference",
  );
  await expect(sharedEvidenceReference).not.toHaveAttribute("open", "");
  await sharedEvidenceReference.locator("summary").click();
  await expect(sharedEvidenceReference.locator("span")).toHaveText(
    /^evidence[_-][0-9a-z-]+$/iu,
  );
  const decisionForge = page.getByRole("region", {
    name: "Turn evidence into commitment",
  });
  await activateByKeyboard(
    page,
    decisionForge.getByRole("button", {
      name: "Generate Decision candidate",
    }),
  );
  await expect(
    decisionForge.getByText("OpenAI suggestion · grounded in shared Evidence", {
      exact: true,
    }),
  ).toBeVisible();
  await activateByKeyboard(
    page,
    decisionForge.getByRole("button", { name: "Confirm premise" }),
  );
  await activateByKeyboard(
    page,
    decisionForge.getByRole("button", { name: "Save Decision draft" }),
  );
  await activateByKeyboard(
    page,
    decisionForge.getByRole("button", { name: "Validate and mark ready" }),
  );
  await activateByKeyboard(
    page,
    decisionForge.getByRole("button", { name: "Commit Decision" }),
  );
  const committedDecision = decisionForge.locator(".committed-decision");
  await expect(committedDecision).toContainText("Revision 2 · COMMITTED");
  await activateByKeyboard(
    page,
    committedDecision.getByRole("button", { name: "Start Decision monitor" }),
  );
  await activateByKeyboard(
    page,
    committedDecision.getByRole("button", {
      name: "Inject staged regulatory event",
    }),
  );
  await expect(committedDecision).toContainText("AT_RISK · AI suggestion");
  return {
    committedDecision,
    decisionForge,
    review: page.getByRole("region", { name: "Facilitator risk review" }),
  };
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

test("keeps AI provenance separate from candidate and committed prose", async ({
  baseURL,
  page,
}) => {
  await page.goto(baseURL ?? "/");
  const { committedDecision, decisionForge } =
    await driveFlagshipToAtRisk(page);
  const workflowStatusCopy =
    /AI[-\u2010\u2011 ]proposed|pending facilitator confirmation/iu;

  await expect(
    decisionForge.getByText("OpenAI suggestion · grounded in shared Evidence", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByLabel("Decision title")).toHaveValue(
    "Establish Regional Launch Approval Gate",
  );
  await expect(page.getByLabel("Outcome")).toHaveValue(
    "Regional launch proceeds only through a documented approval gate.",
  );
  await expect(page.getByLabel("Decision title")).not.toHaveValue(
    workflowStatusCopy,
  );
  await expect(page.getByLabel("Outcome")).not.toHaveValue(workflowStatusCopy);
  await expect(committedDecision.locator("h3")).toHaveText(
    "Establish Regional Launch Approval Gate",
  );
  await expect(committedDecision.locator("h3 + p")).toHaveText(
    "Regional launch proceeds only through a documented approval gate.",
  );
  await expect(committedDecision).not.toContainText(workflowStatusCopy);
  await expect(decisionForge.locator(".risk-reference-chain")).toContainText(
    "Confirmed premise",
  );
  await expect(decisionForge.locator(".risk-reference-chain")).toContainText(
    "Linked Action",
  );
  await expect(
    decisionForge.locator(".risk-reference-chain"),
  ).not.toContainText(/premise-[0-9a-f-]+|action-[0-9a-f-]+/iu);
});

test("presentation labels separate authority, provenance, and commit copy", async ({
  page,
}) => {
  await page.goto("/");
  await signIn(page, "Product", "counterpoint-product");
  const meeting = page
    .getByRole("article")
    .filter({ hasText: FLAGSHIP_PURPOSE });
  await activateByKeyboard(
    page,
    meeting.getByRole("button", { name: "Open workspace" }),
  );
  await activateByKeyboard(
    page,
    page.getByRole("button", { name: "Reset staged demo" }),
  );
  await activateByKeyboard(
    page,
    page.getByRole("button", { name: "Confirm meeting reset" }),
  );

  const privateWorkspace = page.locator(".private-zone");
  await activateByKeyboard(
    page,
    privateWorkspace.getByRole("button", {
      name: "Prepare grounded sharing preview",
    }),
  );
  await activateByKeyboard(
    page,
    privateWorkspace
      .getByRole("region", { name: "Review the exact payload" })
      .getByRole("button", { name: "Approve exact excerpt" }),
  );
  const presentationSharedEvidence = page.locator(".shared-evidence");
  await expect(presentationSharedEvidence.locator(".evidence-id")).toHaveText(
    "Approved shared Evidence",
  );
  const presentationEvidenceReference = presentationSharedEvidence.locator(
    "details.evidence-reference",
  );
  await expect(presentationEvidenceReference).not.toHaveAttribute("open", "");
  await presentationEvidenceReference.locator("summary").click();
  await expect(presentationEvidenceReference.locator("span")).toHaveText(
    /^evidence[_-][0-9a-z-]+$/iu,
  );

  const decisionForge = page.getByRole("region", {
    name: "Turn evidence into commitment",
  });
  await activateByKeyboard(
    page,
    decisionForge.getByRole("button", {
      name: "Generate Decision candidate",
    }),
  );
  const provenance = decisionForge.locator(".candidate-provenance-primary");
  await expect(provenance).toContainText(
    "OpenAI suggestion · grounded in shared Evidence",
  );
  await expect(
    decisionForge.getByText(/gpt-5\.6-sol|deterministic-shared-decision/iu),
  ).not.toBeVisible();
  await expect(decisionForge.locator(".source-link-primary")).toHaveText(
    "↳ Grounded in approved shared Evidence",
  );
  const candidateEvidenceReference = decisionForge.locator(
    "details.candidate-evidence-reference",
  );
  await expect(candidateEvidenceReference).not.toHaveAttribute("open", "");
  await candidateEvidenceReference.locator("summary").click();
  await expect(candidateEvidenceReference.locator("span")).toHaveText(
    /^evidence[_-][0-9a-z-]+$/iu,
  );

  const premise = page.getByLabel("Candidate premise");
  await expect(
    decisionForge.getByRole("button", { name: "Confirm premise" }),
  ).toBeVisible();
  await premise.fill(
    "Regional launch requires a documented approval gate confirmed by the facilitator.",
  );
  await expect(
    decisionForge.getByRole("button", { name: "Confirm edited premise" }),
  ).toBeVisible();
  await activateByKeyboard(
    page,
    decisionForge.getByRole("button", { name: "Confirm edited premise" }),
  );
  await activateByKeyboard(
    page,
    decisionForge.getByRole("button", { name: "Save Decision draft" }),
  );
  await activateByKeyboard(
    page,
    decisionForge.getByRole("button", { name: "Validate and mark ready" }),
  );

  const commitCopy = decisionForge.locator(".commit-gate-copy");
  await expect(commitCopy).toBeVisible();
  const layout = await commitCopy.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      display: style.display,
      flexDirection: style.flexDirection,
      rowGap: Number.parseFloat(style.rowGap),
    };
  });
  expect(layout).toMatchObject({
    display: "flex",
    flexDirection: "column",
  });
  expect(layout.rowGap).toBeGreaterThan(0);
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

  const sourceText = "Regional launch requires a documented approval gate.";
  await uploadAndUsePrivateMarkdown(page, {
    filename: "manual-continuity-source.md",
    text: sourceText,
  });
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
            code: "USAGE_LIMIT_REACHED",
            correlationId: "correlation_e2e_decision_usage_limit",
            details: { limit: "meeting" },
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
    page.getByText("The meeting usage limit has been reached."),
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
  await expect(page.locator(".candidate-provenance")).toContainText(
    "Manual draft · Proposed · Not submitted",
  );
  await expect(page.getByLabel("Decision title")).toHaveValue(
    "Untitled Decision",
  );
  await expect(page.getByLabel("Bounded Action")).toHaveValue(
    "Record the next accountable action.",
  );
  await expect(page.getByLabel("Monitor condition")).toHaveValue(
    "Review when the recorded condition changes.",
  );
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
  await page.getByRole("button", { name: "Confirm premise" }).click();
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
  await activateByKeyboard(
    page,
    committedDecision.getByRole("button", { name: "Start Decision monitor" }),
  );
  await expect(committedDecision).toContainText("Monitoring active");
  await expect(
    committedDecision.getByRole("button", {
      name: "Inject staged regulatory event",
    }),
  ).toHaveCount(0);
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
  test.setTimeout(240_000);
  const facilitatorContext = await browser.newContext({
    recordVideo: {
      dir: "test-results/reel-video",
      size: { height: 720, width: 1280 },
    },
    viewport: { height: 900, width: 1440 },
  });
  const facilitatorPage = await facilitatorContext.newPage();
  await facilitatorPage.goto(baseURL ?? "/");

  await signIn(facilitatorPage, "Product", "counterpoint-product");
  const facilitatorMeeting = facilitatorPage
    .getByRole("article")
    .filter({ hasText: FLAGSHIP_PURPOSE });
  await activateByKeyboard(
    facilitatorPage,
    facilitatorMeeting.getByRole("button", { name: "Open workspace" }),
  );
  await activateByKeyboard(
    facilitatorPage,
    facilitatorPage.getByRole("button", { name: "Reset staged demo" }),
  );
  await activateByKeyboard(
    facilitatorPage,
    facilitatorPage.getByRole("button", { name: "Confirm meeting reset" }),
  );
  await expect(
    facilitatorPage.getByRole("navigation", { name: "Flagship progress" }),
  ).toBeVisible();

  const privateWorkspace = facilitatorPage.locator(".private-zone");
  await activateByKeyboard(
    facilitatorPage,
    privateWorkspace.getByRole("button", {
      name: "Prepare grounded sharing preview",
    }),
  );
  await expect(
    facilitatorPage.getByRole("heading", { name: "Review the exact payload" }),
  ).toBeVisible();
  const disclosurePreview = privateWorkspace.getByRole("region", {
    name: "Review the exact payload",
  });
  await activateByKeyboard(
    facilitatorPage,
    disclosurePreview.getByRole("button", { name: "Approve exact excerpt" }),
  );
  await expect(disclosurePreview.getByRole("status")).toContainText(
    "Exact excerpt approved and recorded.",
  );
  await expect(
    facilitatorPage.locator(".shared-zone").locator(".shared-evidence"),
  ).toContainText("Permission recorded");

  const decisionForge = facilitatorPage.getByRole("region", {
    name: "Turn evidence into commitment",
  });
  await expect(decisionForge.locator(".forge-state")).toContainText(
    "No Decision yet",
  );
  await activateByKeyboard(
    facilitatorPage,
    decisionForge.getByRole("button", {
      name: "Generate Decision candidate",
    }),
  );
  await expect(
    facilitatorPage.getByText(
      "OpenAI suggestion · grounded in shared Evidence",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(decisionForge).toBeFocused();
  await expect(
    facilitatorPage.getByText("deterministic-shared-decision"),
  ).not.toBeVisible();
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
  await activateByKeyboard(
    facilitatorPage,
    decisionForge.getByRole("button", { name: "Confirm edited premise" }),
  );
  await expect(
    decisionForge.getByRole("status").filter({ hasText: "Human confirmed" }),
  ).toContainText("Premise, dissent, and Action are now canonical.");
  await activateByKeyboard(
    facilitatorPage,
    decisionForge.getByRole("button", { name: "Save Decision draft" }),
  );
  await expect(
    facilitatorPage.getByText("Revision 1 · immutable DRAFT"),
  ).toBeVisible();
  await expectAccessibleDecisionState(
    facilitatorPage,
    "Revision 1 · immutable DRAFT",
  );
  await activateByKeyboard(
    facilitatorPage,
    decisionForge.getByRole("button", { name: "Validate and mark ready" }),
  );
  await expect(
    facilitatorPage.locator(".commit-gate").getByText("DECISION_READY"),
  ).toBeVisible();
  await expectAccessibleDecisionState(facilitatorPage, "DECISION_READY");
  await facilitatorPage.emulateMedia({ reducedMotion: "reduce" });
  await expectReducedMotionStyles(facilitatorPage.locator(".commit-lock"));
  await facilitatorPage.screenshot({
    animations: "disabled",
    fullPage: true,
    path: `${screenshotDirectory}/2026-07-19-human-ready-desktop.png`,
  });

  await activateByKeyboard(
    facilitatorPage,
    decisionForge.getByRole("button", { name: "Commit Decision" }),
  );
  const committedDecision = decisionForge.locator(".committed-decision");
  await expect(
    facilitatorPage.getByRole("heading", {
      name: "Establish Regional Launch Approval Gate",
    }),
  ).toBeVisible();
  await expect(committedDecision).toContainText("Revision 2 · COMMITTED");
  await expectAccessibleDecisionState(facilitatorPage, "Human committed");
  await expect(committedDecision).not.toHaveAttribute("aria-live", /.+/u);
  await expectMinimumControlHeight(
    committedDecision.getByRole("button", {
      name: "Prepare Decision JSON export",
    }),
  );
  await expectReducedMotionStyles(committedDecision);
  await facilitatorPage.emulateMedia({ reducedMotion: "no-preference" });
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

  await activateByKeyboard(
    facilitatorPage,
    committedDecision.getByRole("button", { name: "Start Decision monitor" }),
  );
  await expect(committedDecision).toContainText("Monitoring active");
  await expectAccessibleDecisionState(facilitatorPage, "Monitoring active");
  await expect(
    facilitatorPage.locator(".audit-line").getByText("MonitoringStarted"),
  ).toBeVisible();
  await facilitatorPage.screenshot({
    animations: "disabled",
    fullPage: true,
    path: `${screenshotDirectory}/2026-07-19-monitoring-active-desktop.png`,
  });

  await facilitatorPage.emulateMedia({ reducedMotion: "reduce" });
  await activateByKeyboard(
    facilitatorPage,
    committedDecision.getByRole("button", {
      name: "Inject staged regulatory event",
    }),
  );
  await expect(
    committedDecision
      .getByRole("status")
      .filter({ hasText: "External event received" }),
  ).toContainText("Evaluation recorded · Human review still required");
  await expect(committedDecision).toContainText("AT_RISK · AI suggestion");
  const invalidationReviewStatus = committedDecision
    .getByRole("status")
    .filter({ hasText: "Human review required" });
  await expect(invalidationReviewStatus).toBeVisible();
  await expect(invalidationReviewStatus).toContainText("OpenAI suggestion");
  await expect(
    facilitatorPage.getByText("REVIEW_REQUIRED has not been confirmed"),
  ).toBeVisible();
  await facilitatorPage.screenshot({
    animations: "disabled",
    fullPage: true,
    path: `${invalidationScreenshotDirectory}/2026-07-19-at-risk-facilitator-desktop.png`,
  });

  const facilitatorReview = facilitatorPage.getByRole("region", {
    name: "Facilitator risk review",
  });
  const reviewReason = facilitatorReview.getByLabel(
    "Facilitator review reason",
  );
  await expectAccessibleDecisionState(
    facilitatorPage,
    "AT_RISK · AI suggestion",
    reviewReason,
  );
  await facilitatorPage.emulateMedia({ reducedMotion: "reduce" });
  await expectReducedMotionStyles(facilitatorPage.locator(".risk-pulse-orbit"));
  await expectReducedMotionStyles(
    facilitatorPage.locator(".invalidation-risk-pulse"),
  );
  await facilitatorPage.emulateMedia({ reducedMotion: "no-preference" });
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
  const confirmImpact = facilitatorReview.getByRole("button", {
    name: "Confirm impact and open review",
  });
  await activateByKeyboard(facilitatorPage, confirmImpact);
  await expect(
    facilitatorPage.getByText(
      "Enter a facilitator review reason before choosing an outcome.",
    ),
  ).toBeVisible();
  await expectAssociatedFieldError(facilitatorPage, reviewReason);
  await expect(reviewReason).toHaveAttribute("maxlength", "4096");
  await activateByKeyboard(
    facilitatorPage,
    facilitatorReview.getByRole("button", {
      name: "Reject AI suggestion",
    }),
  );
  await expectAssociatedFieldError(facilitatorPage, reviewReason);
  await facilitatorPage.screenshot({
    animations: "disabled",
    fullPage: true,
    path: `${reviewScreenshotDirectory}/2026-07-19-reason-required-desktop.png`,
  });
  await reviewReason.fill(
    "The staged regulatory evidence materially affects the launch premise.",
  );
  await facilitatorPage.emulateMedia({ reducedMotion: "reduce" });
  await activateByKeyboard(facilitatorPage, confirmImpact);
  await expect(committedDecision).toContainText(
    "REVIEW_REQUIRED · Human confirmed",
  );
  await expect(
    facilitatorPage.locator(".flagship-cue").getByText("Current stage 5 of 5"),
  ).toBeVisible();
  await expect(
    facilitatorPage.locator(".flagship-cue").getByText("Flagship arc complete"),
  ).toHaveCount(0);
  const resolutionWorkbench = facilitatorPage.getByRole("region", {
    name: "Resolve Decision review",
  });
  const recommitChoice = resolutionWorkbench.getByRole("radio", {
    name: /Commit revised Decision/u,
  });
  await expectAccessibleDecisionState(
    facilitatorPage,
    "REVIEW_REQUIRED · Human confirmed",
    recommitChoice,
  );
  await expectReducedMotionStyles(facilitatorPage.locator(".review-workbench"));
  await expectReducedMotionStyles(resolutionWorkbench);
  await facilitatorPage.emulateMedia({ reducedMotion: "no-preference" });
  await expect(
    committedDecision
      .getByRole("status")
      .filter({ hasText: "Human reviewed · Impact confirmed" }),
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
  await facilitatorPage.screenshot({
    animations: "disabled",
    fullPage: true,
    path: `${reviewScreenshotDirectory}/2026-07-19-review-required-desktop.png`,
  });

  await facilitatorPage.reload();
  const persistedReviewMeeting = facilitatorPage
    .getByRole("article")
    .filter({ hasText: FLAGSHIP_PURPOSE });
  await activateByKeyboard(
    facilitatorPage,
    persistedReviewMeeting.getByRole("button", { name: "Open workspace" }),
  );
  await expect(recommitChoice).toBeFocused();
  await expect(resolutionWorkbench).toContainText("Commit revised Decision");
  await expect(resolutionWorkbench).toContainText("Close without replacement");
  const revisedTitle = resolutionWorkbench.getByLabel("Revised Decision title");
  const revisedOutcome = resolutionWorkbench.getByLabel("Revised outcome");
  const revisedMonitor = resolutionWorkbench.getByLabel(
    "Revised monitor condition",
  );
  const changeReason = resolutionWorkbench.getByLabel("Revision change reason");
  const resolutionSubmit = resolutionWorkbench.getByRole("button", {
    name: "Commit revision 3",
  });
  await facilitatorPage.keyboard.press("Tab");
  await expect(revisedTitle).toBeFocused();
  await facilitatorPage.keyboard.press("Tab");
  await expect(revisedOutcome).toBeFocused();
  await facilitatorPage.keyboard.press("Tab");
  await expect(revisedMonitor).toBeFocused();
  await facilitatorPage.keyboard.press("Tab");
  await expect(changeReason).toBeFocused();
  await facilitatorPage.keyboard.press("Tab");
  await expect(resolutionSubmit).toBeFocused();
  await facilitatorPage.keyboard.press("Shift+Tab");
  await expect(changeReason).toBeFocused();
  await recommitChoice.focus();
  await recommitChoice.press("ArrowRight");
  const replaceChoice = resolutionWorkbench.getByRole("radio", {
    name: /Replace this Decision/u,
  });
  await expect(replaceChoice).toBeChecked();
  await activateByKeyboard(
    facilitatorPage,
    resolutionWorkbench.getByRole("button", {
      name: "Replace this Decision",
    }),
  );
  const replacementDecisionId = resolutionWorkbench.getByLabel(
    "Replacement Decision ID",
  );
  await expectAssociatedFieldError(facilitatorPage, replacementDecisionId);
  await expect(replacementDecisionId).toHaveAttribute("maxlength", "256");
  await facilitatorPage.screenshot({
    animations: "disabled",
    fullPage: true,
    path: `${resolutionScreenshotDirectory}/2026-07-20-replacement-id-required-desktop.png`,
  });
  await replacementDecisionId.fill("not a valid opaque id");
  await activateByKeyboard(
    facilitatorPage,
    resolutionWorkbench.getByRole("button", {
      name: "Replace this Decision",
    }),
  );
  await expectAssociatedFieldError(facilitatorPage, replacementDecisionId);
  await expect(facilitatorPage.getByRole("alert")).toContainText(
    "Enter a different valid Decision ID without spaces.",
  );
  await replacementDecisionId.fill("decision-does-not-exist");
  await activateByKeyboard(
    facilitatorPage,
    resolutionWorkbench.getByRole("button", {
      name: "Replace this Decision",
    }),
  );
  await expectAssociatedFieldError(facilitatorPage, replacementDecisionId);
  await expect(facilitatorPage.getByRole("alert")).toContainText(
    "Choose an existing active replacement Decision in this meeting.",
  );
  await replaceChoice.press("ArrowRight");
  const rejectChoice = resolutionWorkbench.getByRole("radio", {
    name: /Close without replacement/u,
  });
  await expect(rejectChoice).toBeChecked();
  const rejectionReason = resolutionWorkbench.getByLabel(
    "Decision rejection reason",
  );
  await rejectionReason.fill("");
  await activateByKeyboard(
    facilitatorPage,
    resolutionWorkbench.getByRole("button", {
      name: "Close Decision as rejected",
    }),
  );
  await expectAssociatedFieldError(facilitatorPage, rejectionReason);
  await expect(rejectionReason).toHaveAttribute("maxlength", "4096");
  await facilitatorPage.screenshot({
    animations: "disabled",
    fullPage: true,
    path: `${resolutionScreenshotDirectory}/2026-07-20-rejection-reason-required-desktop.png`,
  });
  await rejectChoice.press("ArrowRight");
  await expect(recommitChoice).toBeChecked();
  await expectMinimumControlHeight(
    resolutionWorkbench.locator(".resolution-option").first(),
  );
  await expectMinimumControlHeight(resolutionSubmit);
  await facilitatorPage.screenshot({
    animations: "disabled",
    fullPage: true,
    path: `${resolutionScreenshotDirectory}/2026-07-19-resolution-options-desktop.png`,
  });
  await revisedTitle.fill("");
  await activateByKeyboard(facilitatorPage, resolutionSubmit);
  await expectAssociatedFieldError(facilitatorPage, revisedTitle);
  await expect(revisedTitle).toHaveAttribute("maxlength", "256");
  await facilitatorPage.screenshot({
    animations: "disabled",
    fullPage: true,
    path: `${resolutionScreenshotDirectory}/2026-07-20-recommit-title-required-desktop.png`,
  });
  await revisedTitle.fill("Regulation-aware regional launch");
  await revisedOutcome.fill("");
  await activateByKeyboard(facilitatorPage, resolutionSubmit);
  await expectAssociatedFieldError(facilitatorPage, revisedOutcome);
  await revisedOutcome.fill(
    "Pause regional launch until the revised regulatory approval gate is satisfied.",
  );
  await revisedMonitor.fill("");
  await activateByKeyboard(facilitatorPage, resolutionSubmit);
  await expectAssociatedFieldError(facilitatorPage, revisedMonitor);
  await revisedMonitor.fill(
    "Monitor the revised approval gate before resuming regional launch.",
  );
  await changeReason.fill("");
  await activateByKeyboard(facilitatorPage, resolutionSubmit);
  await expectAssociatedFieldError(facilitatorPage, changeReason);
  await expect(changeReason).toHaveAttribute("maxlength", "4096");
  await changeReason.fill(
    "The staged regulation requires a documented revised approval gate.",
  );
  await expect(
    resolutionWorkbench.locator(".revision-comparison"),
  ).toContainText("Proposed revision 3");
  await facilitatorPage.screenshot({
    animations: "disabled",
    fullPage: true,
    path: `${resolutionScreenshotDirectory}/2026-07-19-recommit-comparison-desktop.png`,
  });
  await activateByKeyboard(facilitatorPage, resolutionSubmit);
  const resolutionStatus = resolutionWorkbench.getByRole("status");
  await expect(resolutionStatus).toContainText("Revision 3 is now active");
  await expect(
    facilitatorPage.locator(".flagship-cue").getByText("Flagship arc complete"),
  ).toBeVisible();
  await expect(
    facilitatorPage.locator(".audit-line").getByText("RevisionCommitted"),
  ).toBeVisible();
  await activateByKeyboard(
    facilitatorPage,
    resolutionStatus.getByRole("button", {
      name: "Prepare Decision JSON export",
    }),
  );
  await expect(
    resolutionStatus.getByRole("link", { name: /Download JSON/u }),
  ).toContainText("3 revisions");
  await facilitatorPage.screenshot({
    animations: "disabled",
    fullPage: true,
    path: `${resolutionScreenshotDirectory}/2026-07-19-recommit-success-history-desktop.png`,
  });

  await facilitatorPage.reload();
  const reloadedMeeting = facilitatorPage
    .getByRole("article")
    .filter({ hasText: FLAGSHIP_PURPOSE });
  await activateByKeyboard(
    facilitatorPage,
    reloadedMeeting.getByRole("button", { name: "Open workspace" }),
  );
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

  const participantContext = await browser.newContext({
    viewport: { height: 900, width: 1440 },
  });
  const participantPage = await participantContext.newPage();
  await participantPage.goto(baseURL ?? "/");
  await signIn(participantPage, "Legal", "counterpoint-legal");
  const participantMeeting = participantPage
    .getByRole("article")
    .filter({ hasText: FLAGSHIP_PURPOSE });
  await activateByKeyboard(
    participantPage,
    participantMeeting.getByRole("button", { name: "Open workspace" }),
  );
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
    participantPage.locator(".shared-regulatory-event"),
  ).toHaveAttribute("role", "status");
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
  await expectAccessibleSurface(
    participantPage,
    "participant recommitted desktop",
  );
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
  await expectReducedMotionStyles(
    participantPage.locator(".shared-decision-card"),
  );
  await expectReducedMotionStyles(
    participantPage.locator(".shared-risk-suggestion"),
  );
  await expectAccessibleSurface(
    participantPage,
    "participant recommitted mobile reduced motion",
  );
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
  await activateByKeyboard(
    facilitatorPage,
    facilitatorPage.getByRole("button", { name: "Reset staged demo" }),
  );
  await activateByKeyboard(
    facilitatorPage,
    facilitatorPage.getByRole("button", { name: "Confirm meeting reset" }),
  );
  await facilitatorContext.close();
  await saveVideo;
  await copyFile(
    clipPath,
    `${resolutionClipDirectory}/2026-07-19-review-required-to-recommit.webm`,
  );
});

test("facilitator can reject an AI invalidation and resume monitoring", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.goto("/");
  const { committedDecision, decisionForge, review } =
    await driveFlagshipToAtRisk(page);
  await review
    .getByLabel("Facilitator review reason")
    .fill("The staged evidence does not change the bounded launch Decision.");
  await activateByKeyboard(
    page,
    review.getByRole("button", { name: "Reject AI suggestion" }),
  );
  await expect(committedDecision).toContainText(
    "Monitoring · AI suggestion rejected",
  );
  await expectAccessibleDecisionState(
    page,
    "Monitoring · AI suggestion rejected",
    decisionForge,
  );
  await expect(review).toContainText("No Action held");
  await page.screenshot({
    animations: "disabled",
    fullPage: true,
    path: `${reviewScreenshotDirectory}/2026-07-20-review-rejected-desktop.png`,
  });
});

test("prevents a content-free revision 3 after reload", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("/");
  const { review } = await driveFlagshipToAtRisk(page);
  await review
    .getByLabel("Facilitator review reason")
    .fill("The staged regulatory evidence requires a revised approval gate.");
  await activateByKeyboard(
    page,
    review.getByRole("button", { name: "Confirm impact and open review" }),
  );
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "REVIEW_REQUIRED · Human confirmed" }),
  ).toBeVisible();

  await page.reload();
  const meeting = page
    .getByRole("article")
    .filter({ hasText: FLAGSHIP_PURPOSE });
  await activateByKeyboard(
    page,
    meeting.getByRole("button", { name: "Open workspace" }),
  );

  const resolution = page.getByRole("region", {
    name: "Resolve Decision review",
  });
  const title = resolution.getByLabel("Revised Decision title");
  const outcome = resolution.getByLabel("Revised outcome");
  const monitorCondition = resolution.getByLabel("Revised monitor condition");
  const commitRevision = resolution.getByRole("button", {
    name: "Commit revision 3",
  });
  const revisionTwo = {
    monitorCondition:
      "Reopen if the approval gate, staffing plan, or applicable regulation changes.",
    outcome:
      "Regional launch proceeds only through a documented approval gate.",
    title: "Establish Regional Launch Approval Gate",
  };

  await expect(title).toHaveValue("Revised conditional regional launch");
  await expect(title).not.toHaveValue(revisionTwo.title);
  await expect(outcome).toHaveValue(
    "Pause regional launch until the revised approval gate is satisfied.",
  );
  await expect(outcome).not.toHaveValue(revisionTwo.outcome);
  await expect(monitorCondition).toHaveValue(
    "Monitor the revised approval gate before resuming launch.",
  );
  await expect(monitorCondition).not.toHaveValue(revisionTwo.monitorCondition);

  let resolutionRequests = 0;
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      new URL(request.url()).pathname === "/api/v1/decisions/review-resolution"
    ) {
      resolutionRequests += 1;
    }
  });
  await title.fill(revisionTwo.title);
  await outcome.fill(revisionTwo.outcome);
  await monitorCondition.fill(revisionTwo.monitorCondition);
  await activateByKeyboard(page, commitRevision);
  await expect(page.getByRole("alert")).toContainText(
    "Change the title, outcome, or monitor condition before committing a new revision.",
  );
  expect(resolutionRequests).toBe(0);

  const revisedOutcome =
    "Pause regional launch until the updated approval gate is satisfied.";
  await outcome.fill(revisedOutcome);
  await activateByKeyboard(page, commitRevision);
  await expect(resolution.getByRole("status")).toContainText(
    "Revision 3 is now active",
  );
  expect(resolutionRequests).toBe(1);

  await page.reload();
  const reloadedMeeting = page
    .getByRole("article")
    .filter({ hasText: FLAGSHIP_PURPOSE });
  await activateByKeyboard(
    page,
    reloadedMeeting.getByRole("button", { name: "Open workspace" }),
  );
  const persistedDecision = page.locator(".committed-decision");
  await expect(
    persistedDecision.getByText("Revision 3 · COMMITTED", { exact: true }),
  ).toBeVisible();
  await expect(persistedDecision.locator("h3 + p")).toHaveText(revisedOutcome);
});

test("human review remains recorded when shared refresh fails", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.goto("/");
  const { committedDecision, review } = await driveFlagshipToAtRisk(page);
  await page.route(
    "**/api/v1/meetings/meeting-global-ai-rollout/invalidation-evaluations",
    async (route) => {
      await route.fulfill({
        body: JSON.stringify(
          createErrorEnvelope({
            code: "REALTIME_UNAVAILABLE",
            correlationId: "correlation-e2e-review-refresh",
          }),
        ),
        contentType: "application/json",
        status: 503,
      });
    },
  );
  const reviewReason = "The staged evidence requires a human Decision review.";
  await review.getByLabel("Facilitator review reason").fill(reviewReason);
  await activateByKeyboard(
    page,
    review.getByRole("button", { name: "Confirm impact and open review" }),
  );
  const resolution = page.getByRole("region", {
    name: "Resolve Decision review",
  });
  const recommit = resolution.getByRole("radio", {
    name: /Commit revised Decision/u,
  });
  await expect(committedDecision).toContainText(
    "REVIEW_REQUIRED · Human confirmed",
  );
  await expect(review).toContainText(reviewReason);
  await expect(review).toContainText("Reconsideration task");
  await expect(page.getByRole("alert")).toContainText(
    "Review recorded, but shared state and audit refresh are temporarily unavailable.",
  );
  await expectAccessibleDecisionState(
    page,
    "REVIEW_REQUIRED · Human confirmed",
    recommit,
  );
  await page.screenshot({
    animations: "disabled",
    fullPage: true,
    path: `${reviewScreenshotDirectory}/2026-07-20-review-refresh-unavailable-desktop.png`,
  });
});

test("facilitator can close a reviewed Decision without replacement", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.goto("/");
  const { committedDecision, decisionForge, review } =
    await driveFlagshipToAtRisk(page);
  await review
    .getByLabel("Facilitator review reason")
    .fill("The staged evidence requires a human Decision review.");
  await activateByKeyboard(
    page,
    review.getByRole("button", { name: "Confirm impact and open review" }),
  );
  const resolution = page.getByRole("region", {
    name: "Resolve Decision review",
  });
  const recommit = resolution.getByRole("radio", {
    name: /Commit revised Decision/u,
  });
  await expect(recommit).toBeFocused();
  await recommit.press("ArrowLeft");
  await expect(
    resolution.getByRole("radio", {
      name: /Close without replacement/u,
    }),
  ).toBeChecked();
  await activateByKeyboard(
    page,
    resolution.getByRole("button", {
      name: "Close Decision as rejected",
    }),
  );
  await expect(committedDecision).toContainText("REJECTED · Human resolved");
  await expectAccessibleDecisionState(
    page,
    "REJECTED · Human resolved",
    decisionForge,
  );
  await expect(resolution.getByRole("status")).toContainText(
    "Decision closed without replacement",
  );
  await page.screenshot({
    animations: "disabled",
    fullPage: true,
    path: `${resolutionScreenshotDirectory}/2026-07-20-decision-rejected-desktop.png`,
  });
});

test("superseded Decision response renders the terminal accessible state", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.goto("/");
  const { committedDecision, decisionForge, review } =
    await driveFlagshipToAtRisk(page);
  await review
    .getByLabel("Facilitator review reason")
    .fill("The staged evidence requires a human Decision review.");
  await activateByKeyboard(
    page,
    review.getByRole("button", { name: "Confirm impact and open review" }),
  );

  const storedSession = await page.evaluate(() =>
    window.sessionStorage.getItem("counterpoint.session"),
  );
  expect(storedSession).toBeTruthy();
  const bearerToken = (
    JSON.parse(storedSession ?? "{}") as { bearerToken?: string }
  ).bearerToken;
  expect(bearerToken).toBeTruthy();
  const decisionResponse = await page.request.get(
    "/api/v1/meetings/meeting-global-ai-rollout/decisions",
    {
      headers: { authorization: `Bearer ${bearerToken}` },
    },
  );
  const listed = ListSharedDecisionsResponseSchema.parse(
    await decisionResponse.json(),
  );
  const reviewedDecision = listed.decisions.at(-1);
  if (reviewedDecision === undefined) {
    throw new Error("Expected the reviewed flagship Decision.");
  }
  const replacementDecisionId = "decision-replacement-e2e";
  let transportUnavailable = true;

  await page.route("**/api/v1/decisions/review-resolution", async (route) => {
    if (transportUnavailable) {
      await route.abort("connectionfailed");
      return;
    }
    const request = route.request().postDataJSON() as {
      replacementDecisionId?: string;
      resolution?: string;
    };
    expect(request).toMatchObject({
      replacementDecisionId,
      resolution: "supersede_decision",
    });
    await route.fulfill({
      body: JSON.stringify({
        correlationId: "correlation-e2e-supersede-ui",
        decision: {
          ...reviewedDecision,
          snapshot: {
            ...reviewedDecision.snapshot,
            status: "SUPERSEDED",
          },
          status: "SUPERSEDED",
          supersededByDecisionId: replacementDecisionId,
        },
        meetingId: "meeting-global-ai-rollout",
        position: listed.position + 1,
        replacementDecisionId,
        resolution: "supersede_decision",
      }),
      contentType: "application/json",
      status: 200,
    });
  });

  const resolution = page.getByRole("region", {
    name: "Resolve Decision review",
  });
  const replaceChoice = resolution.getByRole("radio", {
    name: /Replace this Decision/u,
  });
  await replaceChoice.focus();
  await replaceChoice.press("Space");
  await expect(replaceChoice).toBeChecked();
  const replacementField = resolution.getByLabel("Replacement Decision ID");
  await replacementField.fill(replacementDecisionId);
  await activateByKeyboard(
    page,
    resolution.getByRole("button", { name: "Replace this Decision" }),
  );
  await expect(page.getByRole("alert")).toContainText(
    "Descant could not reach the decision service.",
  );
  await expect(replacementField).not.toHaveAttribute("aria-invalid", "true");
  await expect(replaceChoice).toBeFocused();
  await page.screenshot({
    animations: "disabled",
    fullPage: true,
    path: `${resolutionScreenshotDirectory}/2026-07-20-supersede-transport-unavailable-desktop.png`,
  });
  transportUnavailable = false;
  await activateByKeyboard(
    page,
    resolution.getByRole("button", { name: "Replace this Decision" }),
  );
  await expect(committedDecision).toContainText("SUPERSEDED · Human resolved");
  await expectAccessibleDecisionState(
    page,
    "SUPERSEDED · Human resolved",
    decisionForge,
  );
  await expect(resolution.getByRole("status")).toContainText(
    `Replaced by ${replacementDecisionId}`,
  );
  await page.screenshot({
    animations: "disabled",
    fullPage: true,
    path: `${resolutionScreenshotDirectory}/2026-07-20-decision-superseded-desktop.png`,
  });
});

test("terminal resolution survives history and export refresh failure", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.goto("/");
  const { committedDecision, decisionForge, review } =
    await driveFlagshipToAtRisk(page);
  await review
    .getByLabel("Facilitator review reason")
    .fill("The staged evidence requires a human Decision review.");
  await activateByKeyboard(
    page,
    review.getByRole("button", { name: "Confirm impact and open review" }),
  );
  const resolution = page.getByRole("region", {
    name: "Resolve Decision review",
  });
  const recommit = resolution.getByRole("radio", {
    name: /Commit revised Decision/u,
  });
  await recommit.press("ArrowLeft");
  await activateByKeyboard(
    page,
    committedDecision.getByRole("button", {
      name: "Prepare Decision JSON export",
    }),
  );
  await expect(
    committedDecision.getByRole("link", { name: /Download JSON/u }),
  ).toBeVisible();
  await page.route(
    "**/api/v1/meetings/meeting-global-ai-rollout/decisions/*/history",
    async (route) => {
      await route.fulfill({
        body: JSON.stringify(
          createErrorEnvelope({
            code: "REALTIME_UNAVAILABLE",
            correlationId: "correlation-e2e-resolution-refresh",
          }),
        ),
        contentType: "application/json",
        status: 503,
      });
    },
  );
  await activateByKeyboard(
    page,
    resolution.getByRole("button", {
      name: "Close Decision as rejected",
    }),
  );
  await expect(committedDecision).toContainText("REJECTED · Human resolved");
  await expect(page.getByRole("alert")).toContainText(
    "Resolution recorded, but history, audit, and export refresh are temporarily unavailable.",
  );
  await expect(
    committedDecision.getByRole("link", { name: /Download JSON/u }),
  ).toHaveCount(0);
  await expectAccessibleDecisionState(
    page,
    "REJECTED · Human resolved",
    decisionForge,
  );
  await expect(resolution.getByRole("status")).toContainText(
    "Decision closed without replacement",
  );
  await page.screenshot({
    animations: "disabled",
    fullPage: true,
    path: `${resolutionScreenshotDirectory}/2026-07-20-resolution-refresh-unavailable-desktop.png`,
  });
});
