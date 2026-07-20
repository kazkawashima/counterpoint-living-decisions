import { expect, test, type Page } from "@playwright/test";
import {
  createErrorEnvelope,
  CreateMeetingResponseSchema,
  GetRoleProjectionResponseSchema,
  InjectDemoRegulatoryChangeResponseSchema,
  ListInvalidationEvaluationsResponseSchema,
  ListSharedDecisionsResponseSchema,
  ListSharedExternalEventsResponseSchema,
  LoginResponseSchema,
} from "@counterpoint/protocol";

async function signIn(page: Page) {
  await page.getByRole("button", { name: "Product" }).click();
  await page.getByLabel("Demo password").fill("counterpoint-product");
  await page.getByRole("button", { name: "Continue to meetings" }).click();
  await expect(
    page.getByRole("heading", { name: "Your assigned meetings" }),
  ).toBeVisible();
}

async function openMeeting(page: Page, purpose: string) {
  const meetingCard = page.getByRole("article").filter({
    has: page.getByRole("heading", { exact: true, name: purpose }),
  });
  await expect(meetingCard).toHaveCount(1);
  await meetingCard.getByRole("button", { name: "Open workspace" }).click();
  await expect(
    page.getByRole("heading", { name: "product workspace" }),
  ).toBeVisible();
}

async function prepareMonitoredMeeting(page: Page, purpose: string) {
  await page.goto("/");
  const loginResponse = await page.request.post("/api/v1/login", {
    data: {
      password: "counterpoint-product",
      userId: "product",
    },
  });
  const facilitator = LoginResponseSchema.parse(await loginResponse.json());
  const meetingResponse = await page.request.post("/api/v1/meetings", {
    data: {
      idempotencyKey: `judge-structured-ai-${crypto.randomUUID()}`,
      purpose,
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

  await signIn(page);
  await openMeeting(page, purpose);
  await page
    .getByRole("button", { name: "Prepare grounded sharing preview" })
    .click();
  await page.getByRole("button", { name: "Approve exact excerpt" }).click();
  await expect(page.getByText("Permission recorded")).toBeVisible();

  await page
    .getByRole("button", { name: "Generate Decision candidate" })
    .click();
  await expect(page.getByText("AI proposed")).toBeVisible();
  await page.getByRole("button", { name: "Confirm edited premise" }).click();
  await page.getByRole("button", { name: "Save Decision draft" }).click();
  await page.getByRole("button", { name: "Validate and mark ready" }).click();
  await page.getByRole("button", { name: "Commit Decision" }).click();
  await page.getByRole("button", { name: "Start Decision monitor" }).click();
  await expect(page.getByText("Monitoring active")).toBeVisible();

  return { bearerToken: facilitator.bearerToken, meeting };
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
  const { input } = manualTextControls(page);
  await expect(input).toBeEnabled();
}

test("invalidation 429 preserves durable text and manual controls", async ({
  page,
}) => {
  const purpose = `Judge invalidation limit UI contract ${crypto.randomUUID()}`;
  const { meeting } = await prepareMonitoredMeeting(page, purpose);
  const beforeLimit = "Durable text recorded before the invalidation limit.";
  const afterLimit = "Manual text continues after the invalidation limit.";
  await sendPrivateText(page, beforeLimit);

  let intercepted = 0;
  await page.route(
    `**/api/v1/meetings/${meeting.meetingId}/demo/regulatory-changes`,
    async (route) => {
      intercepted += 1;
      await route.fulfill({
        body: JSON.stringify(
          createErrorEnvelope({
            code: "USAGE_LIMIT_REACHED",
            correlationId: "correlation_e2e_invalidation_limit",
            details: { limit: "daily_usd" },
          }),
        ),
        contentType: "application/json",
        status: 429,
      });
    },
  );

  await page
    .getByRole("button", { name: "Inject staged regulatory event" })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "The meeting usage limit has been reached.",
  );
  await expect(page.locator(".regulatory-event-receipt")).toHaveCount(0);
  await expect(page.getByText(beforeLimit, { exact: true })).toBeVisible();
  await expectManualContinuity(page);
  await sendPrivateText(page, afterLimit);
  expect(intercepted).toBe(1);

  await page.reload();
  await openMeeting(page, purpose);
  await expect(page.getByText(beforeLimit, { exact: true })).toBeVisible();
  await expect(page.getByText(afterLimit, { exact: true })).toBeVisible();
  await expectManualContinuity(page);
});

test("invalidation 202 pending preserves its receipt, durable text, and manual controls", async ({
  page,
}) => {
  const purpose = `Judge invalidation pending UI contract ${crypto.randomUUID()}`;
  const { bearerToken, meeting } = await prepareMonitoredMeeting(page, purpose);
  const beforePending = "Durable text recorded before pending evaluation.";
  const afterPending = "Manual text continues while evaluation is pending.";
  await sendPrivateText(page, beforePending);

  const authorization = {
    authorization: `Bearer ${bearerToken}`,
  };
  const projectionResponse = await page.request.get(
    `/api/v1/meetings/${meeting.meetingId}/projection`,
    { headers: authorization },
  );
  expect(projectionResponse.status()).toBe(200);
  const projection = GetRoleProjectionResponseSchema.parse(
    await projectionResponse.json(),
  );
  const pendingCorrelationId = "correlation_e2e_invalidation_pending";
  const pendingPosition = projection.shared.position + 1;
  const pendingReceipt = InjectDemoRegulatoryChangeResponseSchema.parse({
    correlationId: pendingCorrelationId,
    evaluationStatus: "pending",
    event: {
      description:
        "Synthetic UI-contract event: evaluation remains pending without backend mutation.",
      effectiveAt: "2026-08-01T00:00:00.000Z",
      eventId: `external-event-e2e-${crypto.randomUUID()}`,
      eventType: "regulatory_change",
      jurisdiction: "European Union",
      meetingId: meeting.meetingId,
      monitorRegistrationId: `monitor-registration-e2e-${crypto.randomUUID()}`,
      payloadHash: "sha256:c3ludGhldGljLWUyZS1wZW5kaW5nLXJlZ3VsYXRvcnktZXZlbnQ",
      receivedAt: "2026-07-20T12:00:00.000Z",
      schemaVersion: 1,
      source: "Counterpoint synthetic E2E contract",
      sourceReference: "e2e://judge-structured-ai/pending",
    },
    position: pendingPosition,
    receiptStatus: "received",
    replayed: false,
  });
  const pendingEvaluations = ListInvalidationEvaluationsResponseSchema.parse({
    correlationId: pendingCorrelationId,
    evaluations: [],
    meetingId: meeting.meetingId,
    position: pendingPosition,
  });
  let intercepted = 0;
  const regulatoryRoute = `**/api/v1/meetings/${meeting.meetingId}/demo/regulatory-changes`;
  const evaluationsRoute = `**/api/v1/meetings/${meeting.meetingId}/invalidation-evaluations`;
  await page.route(regulatoryRoute, async (route) => {
    intercepted += 1;
    await route.fulfill({
      body: JSON.stringify(pendingReceipt),
      contentType: "application/json",
      status: 202,
    });
  });
  await page.route(evaluationsRoute, async (route) => {
    await route.fulfill({
      body: JSON.stringify(pendingEvaluations),
      contentType: "application/json",
      status: 200,
    });
  });

  await page
    .getByRole("button", { name: "Inject staged regulatory event" })
    .click();
  const receipt = page.locator(".regulatory-event-receipt");
  await expect(receipt).toContainText("External event received");
  await expect(receipt).toContainText(
    "Evaluation pending · Decision remains MONITORING",
  );
  await expect(page.locator(".invalidation-risk-pulse")).toHaveCount(0);
  await expect(page.getByText(beforePending, { exact: true })).toBeVisible();
  await expectManualContinuity(page);
  await sendPrivateText(page, afterPending);
  expect(intercepted).toBe(1);

  const [externalEventsResponse, evaluationsResponse, decisionsResponse] =
    await Promise.all([
      page.request.get(
        `/api/v1/meetings/${meeting.meetingId}/external-events`,
        { headers: authorization },
      ),
      page.request.get(
        `/api/v1/meetings/${meeting.meetingId}/invalidation-evaluations`,
        { headers: authorization },
      ),
      page.request.get(`/api/v1/meetings/${meeting.meetingId}/decisions`, {
        headers: authorization,
      }),
    ]);
  expect(externalEventsResponse.status()).toBe(200);
  expect(evaluationsResponse.status()).toBe(200);
  expect(decisionsResponse.status()).toBe(200);
  expect(
    ListSharedExternalEventsResponseSchema.parse(
      await externalEventsResponse.json(),
    ).events,
  ).toEqual([]);
  expect(
    ListInvalidationEvaluationsResponseSchema.parse(
      await evaluationsResponse.json(),
    ).evaluations,
  ).toEqual([]);
  expect(
    ListSharedDecisionsResponseSchema.parse(
      await decisionsResponse.json(),
    ).decisions.at(-1)?.status,
  ).toBe("MONITORING");

  await page.unroute(regulatoryRoute);
  await page.unroute(evaluationsRoute);
  await page.reload();
  await openMeeting(page, purpose);
  await expect(page.locator(".regulatory-event-receipt")).toHaveCount(0);
  await expect(page.locator(".invalidation-risk-pulse")).toHaveCount(0);
  await expect(
    page
      .getByRole("region", { name: "Turn evidence into commitment" })
      .getByText("MONITORING", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(beforePending, { exact: true })).toBeVisible();
  await expect(page.getByText(afterPending, { exact: true })).toBeVisible();
  await expectManualContinuity(page);
});
