import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const FLAGSHIP_MEETING_ID = "meeting-global-ai-rollout";
const DEFAULT_PASSWORD = "counterpoint-product";
const MAX_RESPONSE_BYTES = 1024 * 1024;
const TIMEOUT_MS = 15_000;
const SECRET_PATTERN =
  /(?:\bsk-(?:proj|svcacct)-[A-Za-z0-9_-]{20,}\b|\bBearer\s+[A-Za-z0-9._-]{16,}\b|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/u;

function validatedSmokeOrigin(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError(
      "Flagship smoke origin must be an absolute HTTP(S) origin",
    );
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.pathname !== "/" ||
    url.search.length > 0 ||
    url.hash.length > 0
  ) {
    throw new TypeError(
      "Flagship smoke origin must be an HTTP(S) origin without credentials, path, query, or fragment",
    );
  }
  return url.origin;
}

async function boundedBody(response) {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    throw new Error("Flagship smoke response exceeded 1 MiB");
  }
  if (response.body === null) {
    return "";
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error("Flagship smoke response exceeded 1 MiB");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const text = new TextDecoder().decode(bytes);
  if (SECRET_PATTERN.test(text)) {
    throw new Error("Flagship smoke response contained secret-shaped content");
  }
  return text;
}

function expectValue(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function requestJson(fetch, origin, path, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${origin}${path}`, {
      ...options,
      headers: {
        accept: "application/json",
        ...(options.body === undefined
          ? {}
          : { "content-type": "application/json" }),
        ...(options.headers ?? {}),
      },
      redirect: "error",
      signal: controller.signal,
    });
    const text = await boundedBody(response);
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      throw new Error(`${path} did not return JSON`);
    }
    return { body, response };
  } finally {
    clearTimeout(timeout);
  }
}

function jsonBody(body) {
  return JSON.stringify(body);
}

function authorization(token) {
  return { authorization: `Bearer ${token}` };
}

async function post(fetch, origin, path, token, body, expectedStatus) {
  const result = await requestJson(fetch, origin, path, {
    body: jsonBody(body),
    headers: authorization(token),
    method: "POST",
  });
  expectValue(
    result.response.status === expectedStatus,
    `${path} returned ${String(result.response.status)}, expected ${String(expectedStatus)}`,
  );
  return result.body;
}

async function get(fetch, origin, path, token, expectedStatus = 200) {
  const result = await requestJson(fetch, origin, path, {
    headers: authorization(token),
    method: "GET",
  });
  expectValue(
    result.response.status === expectedStatus,
    `${path} returned ${String(result.response.status)}, expected ${String(expectedStatus)}`,
  );
  return result.body;
}

export async function runCloudflareFlagshipSmoke(input) {
  const origin = validatedSmokeOrigin(input.origin);
  const fetch = input.fetch ?? globalThis.fetch;
  const userId = input.userId ?? "product";
  const password = input.password ?? DEFAULT_PASSWORD;
  const runId = input.runId ?? String(Date.now());
  const meetingId = input.meetingId ?? FLAGSHIP_MEETING_ID;

  const loginResult = await requestJson(fetch, origin, "/api/v1/login", {
    body: jsonBody({ password, userId }),
    method: "POST",
  });
  expectValue(loginResult.response.status === 200, "Flagship login failed");
  expectValue(
    loginResult.body.userId === userId &&
      typeof loginResult.body.bearerToken === "string",
    "Flagship login response did not match the protocol contract",
  );
  const token = loginResult.body.bearerToken;

  const resetKey = `cloudflare-flagship-smoke-reset-${runId}`;
  const reset = await post(
    fetch,
    origin,
    `/api/v1/meetings/${meetingId}/demo/reset`,
    token,
    { expectedPosition: 0, idempotencyKey: resetKey, meetingId },
    200,
  );
  expectValue(
    reset.resetStatus === "completed",
    "Flagship reset did not complete",
  );

  const meetings = await get(fetch, origin, "/api/v1/meetings", token);
  expectValue(
    meetings.meetings?.some(
      (meeting) =>
        meeting.meetingId === meetingId && meeting.role === "facilitator",
    ) === true,
    "Flagship meeting was not assigned to the smoke user",
  );

  const initialProjection = await get(
    fetch,
    origin,
    `/api/v1/meetings/${meetingId}/projection`,
    token,
  );
  expectValue(
    initialProjection.meeting?.purpose?.includes("Work & Productivity") ===
      true && initialProjection.participant?.userId === userId,
    "Flagship projection did not expose the Work & Productivity meeting",
  );

  let position = Number.isSafeInteger(initialProjection.shared?.position)
    ? initialProjection.shared.position
    : reset.position;
  const sourceText = "The rollout needs a staged pilot and an explicit owner.";
  const exactSnippet = "staged pilot";
  const sourceRange = {
    end: sourceText.indexOf(exactSnippet) + exactSnippet.length,
    start: sourceText.indexOf(exactSnippet),
  };
  const source = await post(
    fetch,
    origin,
    "/api/v1/disclosures/sources/text",
    token,
    {
      expectedPosition: position,
      idempotencyKey: `cloudflare-flagship-smoke-source-${runId}`,
      meetingId,
      text: sourceText,
      title: "Flagship smoke rollout note",
    },
    201,
  );
  expectValue(
    source.source?.text === sourceText,
    "Private text source was not stored",
  );
  position = source.position;

  const proposal = await post(
    fetch,
    origin,
    "/api/v1/disclosures/proposals",
    token,
    {
      assistance: "manual",
      exactSnippet,
      expectedPosition: position,
      idempotencyKey: `cloudflare-flagship-smoke-proposal-${runId}`,
      meetingId,
      sourceArtifactId: source.source.sourceArtifactId,
      sourceRange,
    },
    201,
  );
  expectValue(
    proposal.candidate?.state === "proposed",
    "Disclosure proposal did not enter proposed state",
  );
  position = proposal.position;

  const preview = await post(
    fetch,
    origin,
    "/api/v1/disclosures/preview",
    token,
    {
      candidateId: proposal.candidate.candidateId,
      exactSnippet,
      expectedPosition: position,
      idempotencyKey: `cloudflare-flagship-smoke-preview-${runId}`,
      meetingId,
      sourceRange,
    },
    200,
  );
  expectValue(
    typeof preview.previewHash === "string",
    "Disclosure preview did not return a preview hash",
  );
  position = preview.position;

  const approval = await post(
    fetch,
    origin,
    "/api/v1/disclosures/approve",
    token,
    {
      candidateId: proposal.candidate.candidateId,
      expectedPosition: position,
      idempotencyKey: `cloudflare-flagship-smoke-approval-${runId}`,
      meetingId,
      previewHash: preview.previewHash,
    },
    200,
  );
  expectValue(
    approval.evidence?.exactSnippet === exactSnippet,
    "Disclosure approval did not create shared evidence",
  );
  position = approval.position;

  const candidate = await post(
    fetch,
    origin,
    "/api/v1/decisions/candidates",
    token,
    {
      assistance: "manual",
      draft: {
        actions: [
          {
            ownerParticipantId: "participant-product",
            scope: ["Run the staged pilot"],
          },
        ],
        dissent: [],
        monitorCondition: { description: "Review pilot metrics weekly" },
        outcome: "Run the staged pilot with an explicit owner.",
        premises: [
          {
            evidenceReferenceIds: [approval.evidence.evidenceId],
            statement: "A staged pilot limits rollout risk.",
          },
        ],
        title: "Staged rollout pilot",
      },
      expectedPosition: position,
      idempotencyKey: `cloudflare-flagship-smoke-candidate-${runId}`,
      meetingId,
    },
    201,
  );
  const premiseCandidate = candidate.candidate?.draft?.premiseCandidates?.[0];
  const actionCandidate = candidate.candidate?.draft?.actionCandidates?.[0];
  expectValue(
    premiseCandidate !== undefined && actionCandidate !== undefined,
    "Manual decision candidate did not contain premise and action candidates",
  );
  position = candidate.position;

  const disposition = await post(
    fetch,
    origin,
    "/api/v1/decisions/candidates/disposition",
    token,
    {
      actions: [
        {
          ownerParticipantId: actionCandidate.ownerParticipantId,
          scope: actionCandidate.scope,
        },
      ],
      candidateId: candidate.candidate.candidateId,
      dissent: [],
      expectedPosition: position,
      idempotencyKey: `cloudflare-flagship-smoke-disposition-${runId}`,
      meetingId,
      monitorCondition: { description: "Review pilot metrics weekly" },
      outcome: "Run the staged pilot with an explicit owner.",
      premiseDispositions: [
        {
          candidateId: premiseCandidate.candidateId,
          disposition: "confirmed",
          premise: {
            evidenceReferenceIds: [approval.evidence.evidenceId],
            statement: premiseCandidate.statement,
          },
        },
      ],
      reason: "Facilitator confirmed the staged pilot path.",
      title: "Staged rollout pilot",
    },
    200,
  );
  const premise = disposition.premises?.[0];
  const action = disposition.actions?.[0];
  expectValue(
    premise !== undefined && action !== undefined,
    "Decision disposition did not materialize premise and action",
  );
  position = disposition.position;

  const draft = await post(
    fetch,
    origin,
    "/api/v1/decisions/drafts",
    token,
    {
      actionIds: [action.actionId],
      changeReason: "Initial facilitator draft",
      dissentIds: [],
      evidenceIds: [approval.evidence.evidenceId],
      expectedPosition: position,
      idempotencyKey: `cloudflare-flagship-smoke-draft-${runId}`,
      meetingId,
      monitorCondition: { description: "Review pilot metrics weekly" },
      outcome: "Run the staged pilot with an explicit owner.",
      premiseIds: [premise.premiseId],
      title: "Staged rollout pilot",
    },
    201,
  );
  expectValue(
    draft.decision?.status === "DRAFT",
    "Decision draft was not saved",
  );
  position = draft.position;

  const ready = await post(
    fetch,
    origin,
    "/api/v1/decisions/ready",
    token,
    {
      decisionId: draft.decision.decisionId,
      expectedPosition: position,
      idempotencyKey: `cloudflare-flagship-smoke-ready-${runId}`,
      meetingId,
    },
    200,
  );
  expectValue(
    ready.decision?.status === "DECISION_READY",
    "Decision did not become ready",
  );
  position = ready.position;

  const commit = await post(
    fetch,
    origin,
    "/api/v1/decisions/commit",
    token,
    {
      decisionId: ready.decision.decisionId,
      expectedPosition: position,
      idempotencyKey: `cloudflare-flagship-smoke-commit-${runId}`,
      meetingId,
    },
    200,
  );
  expectValue(
    commit.decision?.status === "COMMITTED",
    "Decision did not commit",
  );
  position = commit.position;

  const monitoring = await post(
    fetch,
    origin,
    "/api/v1/decisions/monitoring",
    token,
    {
      decisionId: commit.decision.decisionId,
      expectedPosition: position,
      idempotencyKey: `cloudflare-flagship-smoke-monitoring-${runId}`,
      meetingId,
    },
    200,
  );
  expectValue(
    monitoring.decision?.status === "MONITORING" &&
      typeof monitoring.monitorRegistrationId === "string",
    "Decision did not enter monitoring",
  );

  const externalEvent = await post(
    fetch,
    origin,
    `/api/v1/meetings/${meetingId}/demo/regulatory-changes`,
    token,
    { idempotencyKey: `cloudflare-flagship-smoke-regulatory-${runId}` },
    202,
  );
  expectValue(
    externalEvent.receiptStatus === "received" &&
      externalEvent.event?.monitorRegistrationId ===
        monitoring.monitorRegistrationId,
    "Demo regulatory change was not received by the monitor",
  );

  const externalEvents = await get(
    fetch,
    origin,
    `/api/v1/meetings/${meetingId}/external-events`,
    token,
  );
  const evaluations = await get(
    fetch,
    origin,
    `/api/v1/meetings/${meetingId}/invalidation-evaluations`,
    token,
  );
  expectValue(
    externalEvents.events?.some(
      (event) => event.eventId === externalEvent.event.eventId,
    ) === true,
    "Received regulatory change was not listed",
  );

  const requireInvalidation = input.requireInvalidation === true;
  if (requireInvalidation) {
    expectValue(
      evaluations.evaluations?.length === 1 &&
        evaluations.evaluations[0]?.decision?.status === "AT_RISK",
      "Deterministic invalidation evaluation did not reach AT_RISK",
    );
    const review = await post(
      fetch,
      origin,
      "/api/v1/decisions/invalidation-review",
      token,
      {
        decisionId: commit.decision.decisionId,
        disposition: "confirm_invalidation",
        expectedPosition: evaluations.position,
        idempotencyKey: `cloudflare-flagship-smoke-review-${runId}`,
        meetingId,
        reason: "The staged regulatory change invalidates the rollout premise.",
        suggestionId: evaluations.evaluations[0].suggestionId,
      },
      200,
    );
    expectValue(
      review.decision?.status === "REVIEW_REQUIRED" &&
        review.reconsiderationTask?.state === "open",
      "Invalidation review did not create an open reconsideration task",
    );
  }

  const finalReset = await post(
    fetch,
    origin,
    `/api/v1/meetings/${meetingId}/demo/reset`,
    token,
    {
      expectedPosition: evaluations.position,
      idempotencyKey: `cloudflare-flagship-smoke-final-reset-${runId}`,
      meetingId,
    },
    200,
  );
  const resetReplay = await post(
    fetch,
    origin,
    `/api/v1/meetings/${meetingId}/demo/reset`,
    token,
    {
      expectedPosition: finalReset.position,
      idempotencyKey: `cloudflare-flagship-smoke-final-reset-${runId}`,
      meetingId,
    },
    200,
  );
  expectValue(
    resetReplay.resetRequestId === finalReset.resetRequestId,
    "Demo reset replay did not return the original receipt",
  );

  const clearedProjection = await get(
    fetch,
    origin,
    `/api/v1/meetings/${meetingId}/projection`,
    token,
  );
  expectValue(
    clearedProjection.privateWorkspace?.sources?.length === 0 &&
      clearedProjection.shared?.evidence?.length === 0 &&
      clearedProjection.shared?.decisions?.length === 0,
    "Demo reset did not clear the private/shared read model",
  );

  return {
    committedDecisionId: commit.decision.decisionId,
    host: new URL(origin).host,
    invalidationEvaluations: evaluations.evaluations?.length ?? 0,
    meetingId,
    resetRequestId: finalReset.resetRequestId,
    status: "passed",
  };
}

const invokedAsScript =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (invokedAsScript) {
  const origin = process.argv[2];
  if (origin === undefined) {
    throw new Error(
      "Usage: node scripts/cloudflare-flagship-smoke.mjs <origin>",
    );
  }
  const summary = await runCloudflareFlagshipSmoke({
    origin,
    password: process.env.CLOUDFLARE_FLAGSHIP_PASSWORD,
    requireInvalidation:
      process.env.CLOUDFLARE_FLAGSHIP_REQUIRE_INVALIDATION === "true",
  });
  console.log(JSON.stringify(summary));
}
