import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const TIMEOUT_MS = 120_000;

export function composeSmokeEnvironment(baseEnvironment, input) {
  if (!/^counterpoint-smoke-[a-z0-9-]+$/u.test(input.projectName)) {
    throw new TypeError(
      "Compose smoke requires an isolated counterpoint-smoke- project name",
    );
  }
  if (
    !Number.isSafeInteger(input.port) ||
    input.port < 1024 ||
    input.port > 65_535
  ) {
    throw new TypeError(
      "Compose smoke port must be an integer from 1024 to 65535",
    );
  }
  return {
    ...baseEnvironment,
    COMPOSE_PORT: String(input.port),
    COMPOSE_PROJECT_NAME: input.projectName,
    JUDGE_IP_HMAC_SECRET: "",
    OPENAI_API_KEY: "",
    OPENAI_API_KEY_JUDGE: "",
    PUBLIC_HOST: "127.0.0.2",
    REGULATORY_WEBHOOK_SECRET: "",
  };
}

export function assertPersistedComposeProjection(
  projection,
  sourceArtifactId,
  expected,
) {
  const persisted =
    projection.privateWorkspace?.sources?.some(
      (source) => source.sourceArtifactId === sourceArtifactId,
    ) === true;
  if (!persisted) {
    throw new Error(
      "Compose private source did not survive container recreation",
    );
  }
  if (expected === undefined) {
    return;
  }
  if (
    projection.meeting?.meetingId !== expected.meetingId ||
    projection.meeting?.purpose !== expected.purpose
  ) {
    throw new Error(
      "Compose created meeting did not survive container recreation",
    );
  }
  const persistedArtifact = projection.privateWorkspace?.artifacts?.find(
    (artifact) => artifact.sourceArtifactId === expected.artifactId,
  );
  if (persistedArtifact === undefined) {
    throw new Error(
      "Compose uploaded artifact did not survive container recreation",
    );
  }
  if (
    persistedArtifact.derivedArtifactId !== expected.derivedArtifactId ||
    persistedArtifact.filename !== expected.filename ||
    persistedArtifact.processingState !== expected.processingState
  ) {
    throw new Error(
      "Compose uploaded artifact metadata did not survive container recreation",
    );
  }
  const decisionPersisted =
    projection.shared?.decisions?.some(
      (decision) =>
        decision.decisionId === expected.decisionId &&
        decision.activeRevision === expected.revision &&
        decision.status === "COMMITTED",
    ) === true;
  if (!decisionPersisted) {
    throw new Error(
      "Compose committed Decision did not survive container recreation",
    );
  }
}

function composeFailureDetail(cause) {
  if (
    typeof cause === "object" &&
    cause !== null &&
    "stderr" in cause &&
    typeof cause.stderr === "string" &&
    cause.stderr.trim().length > 0
  ) {
    return cause.stderr.trim().slice(-4_000);
  }
  return cause instanceof Error ? cause.message : String(cause);
}

async function dockerCompose(input, args, options = {}) {
  try {
    await input.execFile(
      "docker",
      ["compose", "--project-name", input.projectName, ...args],
      {
        cwd: input.root,
        encoding: "utf8",
        env: input.environment,
        maxBuffer: 16 * 1024 * 1024,
        ...(options.ignoreAbort === true ? {} : { signal: input.signal }),
        timeout: TIMEOUT_MS,
      },
    );
  } catch (cause) {
    throw new Error(
      `Compose smoke phase failed: ${args.join(" ")}: ${composeFailureDetail(
        cause,
      )}`,
      { cause },
    );
  }
}

async function requestJson(fetch, origin, path, options = {}) {
  const response = await fetch(`${origin}${path}`, {
    ...options,
    headers: {
      accept: "application/json",
      ...(options.body === undefined
        ? {}
        : { "content-type": "application/json" }),
      ...(options.headers ?? {}),
    },
  });
  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error(`${path} did not return JSON`);
  }
  return { body, response };
}

async function waitUntilReady(fetch, origin) {
  const deadline = Date.now() + TIMEOUT_MS;
  let lastStatus = "unreachable";
  while (Date.now() < deadline) {
    try {
      const { body, response } = await requestJson(fetch, origin, "/ready");
      lastStatus = String(response.status);
      if (response.status === 200 && body.status === "ready") {
        return;
      }
    } catch {
      lastStatus = "unreachable";
    }
    await new Promise((resolvePromise) => {
      setTimeout(resolvePromise, 500);
    });
  }
  throw new Error(`Compose readiness timed out (${lastStatus})`);
}

async function verifyPersistedComposeBrowser(input) {
  const { chromium } = await import("@playwright/test");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(input.origin);
    await page.getByRole("button", { name: "Product" }).click();
    await page.getByLabel("Demo password").fill("counterpoint-product");
    await page.getByRole("button", { name: "Continue to meetings" }).click();
    const meetingCard = page.getByRole("article").filter({
      has: page.getByRole("heading", {
        exact: true,
        name: input.meetingPurpose,
      }),
    });
    await meetingCard.waitFor({ state: "visible" });
    await meetingCard.getByRole("button", { name: "Open workspace" }).click();
    await page
      .getByRole("heading", { exact: true, name: "product workspace" })
      .waitFor({ state: "visible" });
    await page
      .getByText(input.artifactFilename, { exact: true })
      .waitFor({ state: "visible" });
    await page
      .getByText("Derived text ready", { exact: false })
      .waitFor({ state: "visible" });
    await page
      .locator(".shared-evidence blockquote")
      .filter({ hasText: input.exactSnippet })
      .waitFor({ state: "visible" });
    await page
      .getByRole("heading", { exact: true, name: input.decisionTitle })
      .waitFor({ state: "visible" });
    await page
      .getByText("Revision 2 · COMMITTED", { exact: true })
      .waitFor({ state: "visible" });
  } catch (cause) {
    throw new Error(
      "Compose browser did not render persisted meeting, artifact, Evidence, and Decision",
      { cause },
    );
  } finally {
    await browser.close();
  }
}

export function composeSmokeTerminalFailure(
  primaryFailure,
  interruptionFailure,
  cleanupFailure,
) {
  const effectivePrimaryFailure = primaryFailure ?? interruptionFailure;
  if (cleanupFailure !== undefined) {
    return effectivePrimaryFailure === undefined
      ? cleanupFailure
      : new AggregateError(
          [effectivePrimaryFailure, cleanupFailure],
          "Compose smoke failed and isolated cleanup also failed",
        );
  }
  return primaryFailure === undefined ? interruptionFailure : undefined;
}

export async function runComposePersistenceSmoke(input) {
  const abortController = new AbortController();
  let interruptionFailure;
  const signalHandlers = (input.signals ?? []).map((signal) => {
    const handler = () => {
      interruptionFailure ??= new Error(
        `Compose smoke interrupted by ${String(signal)}`,
      );
      abortController.abort(interruptionFailure);
    };
    process.once(signal, handler);
    return { handler, signal };
  });
  const environment = composeSmokeEnvironment(
    input.environment ?? process.env,
    input,
  );
  const runtime = {
    environment,
    execFile: input.execFile ?? execFileAsync,
    projectName: input.projectName,
    root: input.root,
    signal: abortController.signal,
  };
  const fetch = input.fetch ?? globalThis.fetch;
  const origin = `http://127.0.0.2:${String(input.port)}`;
  let attemptedStart = false;
  let cleanupFailure;
  let primaryFailure;
  let result;

  try {
    attemptedStart = true;
    await dockerCompose(runtime, ["up", "--build", "--detach"]);
    await waitUntilReady(fetch, origin);

    const login = await requestJson(fetch, origin, "/api/v1/login", {
      body: JSON.stringify({
        password: "counterpoint-product",
        userId: "product",
      }),
      method: "POST",
    });
    if (
      login.response.status !== 200 ||
      typeof login.body.bearerToken !== "string"
    ) {
      throw new Error("Compose login failed");
    }
    const authorization = {
      authorization: `Bearer ${login.body.bearerToken}`,
    };
    const runId = `${String(Date.now())}-${String(process.pid)}`;
    const meetingPurpose = `Compose restart survival ${runId}`;
    const createdMeeting = await requestJson(
      fetch,
      origin,
      "/api/v1/meetings",
      {
        body: JSON.stringify({
          idempotencyKey: `compose-meeting-${runId}`,
          purpose: meetingPurpose,
          users: [
            { role: "facilitator", userId: "product" },
            { role: "participant", userId: "legal" },
            { role: "participant", userId: "engineering" },
          ],
        }),
        headers: authorization,
        method: "POST",
      },
    );
    const facilitatorAssignment = createdMeeting.body.assignments?.find(
      ({ userId }) => userId === "product",
    );
    if (
      createdMeeting.response.status !== 201 ||
      typeof createdMeeting.body.meetingId !== "string" ||
      createdMeeting.body.purpose !== meetingPurpose ||
      facilitatorAssignment?.role !== "facilitator" ||
      typeof facilitatorAssignment.participantId !== "string"
    ) {
      throw new Error("Compose meeting creation failed");
    }
    const meetingId = createdMeeting.body.meetingId;
    const before = await requestJson(
      fetch,
      origin,
      `/api/v1/meetings/${meetingId}/projection`,
      { headers: authorization },
    );
    if (
      before.response.status !== 200 ||
      before.body.meeting?.purpose !== meetingPurpose
    ) {
      throw new Error("Compose created meeting projection is inconsistent");
    }

    const derivedArtifactText =
      "# Synthetic Compose persistence artifact\n\nThis file must survive app recreation.";
    const uploadedSourceText = `\uFEFF${derivedArtifactText}`;
    const artifactFilename = `compose-persistence-${runId}.md`;
    const decisionTitle = `Compose persisted Decision ${runId}`;
    const uploadForm = new FormData();
    uploadForm.set("idempotencyKey", `compose-upload-${runId}`);
    uploadForm.set("meetingId", meetingId);
    uploadForm.set(
      "file",
      new File([uploadedSourceText], artifactFilename, {
        type: "text/markdown",
      }),
    );
    const uploadResponse = await fetch(`${origin}/api/v1/artifacts`, {
      body: uploadForm,
      headers: authorization,
      method: "POST",
    });
    const uploadBody = await uploadResponse.json();
    if (
      uploadResponse.status !== 201 ||
      typeof uploadBody.artifact?.sourceArtifactId !== "string" ||
      typeof uploadBody.artifact?.derivedArtifactId !== "string" ||
      uploadBody.artifact?.processingState !== "processed" ||
      typeof uploadBody.position !== "number"
    ) {
      throw new Error("Compose private artifact upload failed");
    }

    const exactSnippet =
      "Synthetic shared fact: Compose restart preserves this committed premise.";
    const source = await requestJson(
      fetch,
      origin,
      "/api/v1/disclosures/sources/text",
      {
        body: JSON.stringify({
          expectedPosition: uploadBody.position,
          idempotencyKey: `compose-source-${runId}`,
          meetingId,
          text: exactSnippet,
          title: `Compose persistence ${runId}`,
        }),
        headers: authorization,
        method: "POST",
      },
    );
    if (
      source.response.status !== 201 ||
      typeof source.body.source?.sourceArtifactId !== "string"
    ) {
      throw new Error("Compose persistence marker creation failed");
    }
    const proposal = await requestJson(
      fetch,
      origin,
      "/api/v1/disclosures/proposals",
      {
        body: JSON.stringify({
          assistance: "manual",
          exactSnippet,
          expectedPosition: source.body.position,
          idempotencyKey: `compose-proposal-${runId}`,
          meetingId,
          sourceArtifactId: source.body.source.sourceArtifactId,
          sourceRange: { end: exactSnippet.length, start: 0 },
        }),
        headers: authorization,
        method: "POST",
      },
    );
    if (
      proposal.response.status !== 201 ||
      typeof proposal.body.candidate?.candidateId !== "string"
    ) {
      throw new Error("Compose disclosure proposal failed");
    }
    const preview = await requestJson(
      fetch,
      origin,
      "/api/v1/disclosures/preview",
      {
        body: JSON.stringify({
          candidateId: proposal.body.candidate.candidateId,
          exactSnippet,
          expectedPosition: proposal.body.position,
          idempotencyKey: `compose-preview-${runId}`,
          meetingId,
          sourceRange: { end: exactSnippet.length, start: 0 },
        }),
        headers: authorization,
        method: "POST",
      },
    );
    if (
      preview.response.status !== 200 ||
      typeof preview.body.previewHash !== "string"
    ) {
      throw new Error("Compose disclosure preview failed");
    }
    const approval = await requestJson(
      fetch,
      origin,
      "/api/v1/disclosures/approve",
      {
        body: JSON.stringify({
          candidateId: preview.body.candidateId,
          expectedPosition: preview.body.position,
          idempotencyKey: `compose-approval-${runId}`,
          meetingId,
          previewHash: preview.body.previewHash,
        }),
        headers: authorization,
        method: "POST",
      },
    );
    if (
      approval.response.status !== 200 ||
      typeof approval.body.evidence?.evidenceId !== "string"
    ) {
      throw new Error("Compose disclosure approval failed");
    }

    const candidate = await requestJson(
      fetch,
      origin,
      "/api/v1/decisions/candidates",
      {
        body: JSON.stringify({
          assistance: "manual",
          draft: {
            actions: [
              {
                ownerParticipantId: facilitatorAssignment.participantId,
                scope: ["Synthetic Compose restart scope"],
              },
            ],
            dissent: [
              {
                reason: "Synthetic dissent retained through restart.",
                retained: true,
              },
            ],
            monitorCondition: {
              description: "Revisit if the synthetic Compose premise changes.",
            },
            outcome: "Proceed with the synthetic Compose persistence check.",
            premises: [
              {
                evidenceReferenceIds: [approval.body.evidence.evidenceId],
                statement: exactSnippet,
              },
            ],
            title: decisionTitle,
          },
          expectedPosition: approval.body.position,
          idempotencyKey: `compose-candidate-${runId}`,
          meetingId,
        }),
        headers: authorization,
        method: "POST",
      },
    );
    const premiseCandidate =
      candidate.body.candidate?.draft?.premiseCandidates?.[0];
    if (
      candidate.response.status !== 201 ||
      typeof candidate.body.candidate?.candidateId !== "string" ||
      typeof premiseCandidate?.candidateId !== "string"
    ) {
      throw new Error("Compose manual Decision candidate failed");
    }
    const disposition = await requestJson(
      fetch,
      origin,
      "/api/v1/decisions/candidates/disposition",
      {
        body: JSON.stringify({
          actions: candidate.body.candidate.draft.actionCandidates.map(
            ({ ownerParticipantId, scope }) => ({
              ownerParticipantId,
              scope,
            }),
          ),
          candidateId: candidate.body.candidate.candidateId,
          dissent: candidate.body.candidate.draft.dissentCandidates.map(
            ({ reason, retained }) => ({ reason, retained }),
          ),
          expectedPosition: candidate.body.position,
          idempotencyKey: `compose-disposition-${runId}`,
          meetingId,
          monitorCondition: candidate.body.candidate.draft.monitorCondition,
          outcome: candidate.body.candidate.draft.outcome,
          premiseDispositions: [
            {
              candidateId: premiseCandidate.candidateId,
              disposition: "confirmed",
              premise: {
                evidenceReferenceIds: premiseCandidate.evidenceReferenceIds,
                statement: premiseCandidate.statement,
              },
            },
          ],
          reason: "Synthetic facilitator Compose persistence confirmation.",
          title: candidate.body.candidate.draft.title,
        }),
        headers: authorization,
        method: "POST",
      },
    );
    if (
      disposition.response.status !== 200 ||
      disposition.body.premises?.length !== 1
    ) {
      throw new Error("Compose Decision candidate disposition failed");
    }
    const draft = await requestJson(fetch, origin, "/api/v1/decisions/drafts", {
      body: JSON.stringify({
        actionIds: disposition.body.actions.map(({ actionId }) => actionId),
        changeReason: "Initial synthetic Compose persistence revision.",
        dissentIds: disposition.body.dissent.map(({ dissentId }) => dissentId),
        evidenceIds: [approval.body.evidence.evidenceId],
        expectedPosition: disposition.body.position,
        idempotencyKey: `compose-draft-${runId}`,
        meetingId,
        monitorCondition: candidate.body.candidate.draft.monitorCondition,
        outcome: candidate.body.candidate.draft.outcome,
        premiseIds: disposition.body.premises.map(({ premiseId }) => premiseId),
        title: candidate.body.candidate.draft.title,
      }),
      headers: authorization,
      method: "POST",
    });
    if (
      draft.response.status !== 201 ||
      typeof draft.body.decision?.decisionId !== "string"
    ) {
      throw new Error("Compose Decision draft failed");
    }
    const ready = await requestJson(fetch, origin, "/api/v1/decisions/ready", {
      body: JSON.stringify({
        decisionId: draft.body.decision.decisionId,
        expectedPosition: draft.body.position,
        idempotencyKey: `compose-ready-${runId}`,
        meetingId,
      }),
      headers: authorization,
      method: "POST",
    });
    if (ready.response.status !== 200) {
      throw new Error("Compose Decision ready transition failed");
    }
    const committed = await requestJson(
      fetch,
      origin,
      "/api/v1/decisions/commit",
      {
        body: JSON.stringify({
          decisionId: draft.body.decision.decisionId,
          expectedPosition: ready.body.position,
          idempotencyKey: `compose-commit-${runId}`,
          meetingId,
        }),
        headers: authorization,
        method: "POST",
      },
    );
    if (
      committed.response.status !== 200 ||
      committed.body.decision?.activeRevision !== 2 ||
      committed.body.decision?.status !== "COMMITTED"
    ) {
      throw new Error("Compose Decision commit failed");
    }

    await dockerCompose(runtime, [
      "up",
      "--detach",
      "--force-recreate",
      "--no-deps",
      "app",
    ]);
    await waitUntilReady(fetch, origin);

    const after = await requestJson(
      fetch,
      origin,
      `/api/v1/meetings/${meetingId}/projection`,
      { headers: authorization },
    );
    if (after.response.status !== 200) {
      throw new Error("Compose session did not survive container recreation");
    }
    assertPersistedComposeProjection(
      after.body,
      source.body.source.sourceArtifactId,
      {
        artifactId: uploadBody.artifact.sourceArtifactId,
        derivedArtifactId: uploadBody.artifact.derivedArtifactId,
        decisionId: draft.body.decision.decisionId,
        filename: artifactFilename,
        meetingId,
        processingState: "processed",
        purpose: meetingPurpose,
        revision: 2,
      },
    );
    const history = await requestJson(
      fetch,
      origin,
      `/api/v1/meetings/${meetingId}/decisions/${draft.body.decision.decisionId}/history`,
      { headers: authorization },
    );
    if (
      history.response.status !== 200 ||
      history.body.revisions?.length !== 2 ||
      history.body.revisions[0]?.snapshot?.status !== "DRAFT" ||
      history.body.revisions[1]?.snapshot?.status !== "COMMITTED"
    ) {
      throw new Error(
        "Compose Decision revision history did not survive container recreation",
      );
    }
    const decisionExport = await requestJson(
      fetch,
      origin,
      `/api/v1/meetings/${meetingId}/decisions/${draft.body.decision.decisionId}/export`,
      { headers: authorization },
    );
    const exportedAuditTypes = decisionExport.body.auditEntries?.map(
      ({ eventType }) => eventType,
    );
    if (
      decisionExport.response.status !== 200 ||
      decisionExport.body.decision?.activeRevision !== 2 ||
      decisionExport.body.revisions?.length !== 2 ||
      !["DecisionDrafted", "DecisionMarkedReady", "DecisionCommitted"].every(
        (eventType) => exportedAuditTypes?.includes(eventType) === true,
      )
    ) {
      throw new Error(
        "Compose Decision export did not survive container recreation",
      );
    }
    const sourceDownload = await fetch(
      `${origin}/api/v1/meetings/${meetingId}/artifacts/${uploadBody.artifact.sourceArtifactId}?representation=source`,
      { headers: authorization },
    );
    const downloadedSourceBytes = new Uint8Array(
      await sourceDownload.arrayBuffer(),
    );
    const expectedSourceBytes = new TextEncoder().encode(uploadedSourceText);
    if (
      sourceDownload.status !== 200 ||
      !sourceDownload.headers.get("content-type")?.includes("text/markdown") ||
      !sourceDownload.headers.get("cache-control")?.includes("no-store") ||
      sourceDownload.headers.get("x-content-type-options") !== "nosniff" ||
      downloadedSourceBytes.length !== expectedSourceBytes.length ||
      !downloadedSourceBytes.every(
        (byte, index) => byte === expectedSourceBytes[index],
      )
    ) {
      throw new Error(
        "Compose source artifact did not survive container recreation",
      );
    }
    const derivedDownload = await fetch(
      `${origin}/api/v1/meetings/${meetingId}/artifacts/${uploadBody.artifact.sourceArtifactId}?representation=derived`,
      { headers: authorization },
    );
    if (
      derivedDownload.status !== 200 ||
      !derivedDownload.headers.get("content-type")?.includes("text/plain") ||
      (await derivedDownload.text()) !== derivedArtifactText
    ) {
      throw new Error(
        "Compose derived artifact did not survive container recreation",
      );
    }
    await verifyPersistedComposeBrowser({
      artifactFilename,
      decisionTitle,
      exactSnippet,
      meetingPurpose,
      origin,
    });
    result = {
      artifactId: uploadBody.artifact.sourceArtifactId,
      decisionId: draft.body.decision.decisionId,
      host: new URL(origin).host,
      meetingId,
      projectName: input.projectName,
      status: "passed",
    };
  } catch (cause) {
    primaryFailure = cause;
  } finally {
    if (attemptedStart) {
      try {
        await dockerCompose(runtime, ["down", "--volumes"], {
          ignoreAbort: true,
        });
      } catch (cause) {
        cleanupFailure = cause;
      }
    }
    for (const { handler, signal } of signalHandlers) {
      process.removeListener(signal, handler);
    }
  }
  const terminalFailure = composeSmokeTerminalFailure(
    primaryFailure,
    interruptionFailure,
    cleanupFailure,
  );
  if (terminalFailure !== undefined) {
    throw terminalFailure;
  }
  if (primaryFailure !== undefined) {
    throw primaryFailure;
  }
  return result;
}

const invokedAsScript =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (invokedAsScript) {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const projectName =
    process.env.COMPOSE_SMOKE_PROJECT_NAME ??
    `counterpoint-smoke-${String(process.pid)}`;
  const port = Number(
    process.env.COMPOSE_SMOKE_PORT ?? 18_000 + (process.pid % 1_000),
  );
  const summary = await runComposePersistenceSmoke({
    port,
    projectName,
    root,
    signals: ["SIGINT", "SIGTERM"],
  });
  console.log(JSON.stringify(summary));
}
