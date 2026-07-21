import {
  CreateManagedRealtimeCallRequestSchema,
  CreateManagedRealtimeCallResponseSchema,
  BeginManagedRealtimeTurnRequestSchema,
  BeginManagedRealtimeTurnResponseSchema,
  AwaitManagedRealtimeTranscriptRequestSchema,
  AwaitManagedRealtimeTranscriptResponseSchema,
  TerminateManagedRealtimeCallRequestSchema,
  TerminateManagedRealtimeCallResponseSchema,
} from "@counterpoint/protocol";
import type { Clock, RealtimeChannel, UsageLimiter } from "@counterpoint/ports";
import type {
  ManagedRealtimeCallOwner,
  ManagedRealtimeCallOwnership,
  ManagedRealtimeStartClaim,
  ManagedRealtimeStartClaimResult,
} from "@counterpoint/adapters-cloudflare";
import { apiErrorResponse, apiJsonResponse } from "@counterpoint/http-api";

import {
  JUDGE_REALTIME_RESERVED_USAGE,
  JUDGE_REALTIME_RESERVATION_TTL_SECONDS,
} from "./judge-realtime-constants.js";
import {
  resolveJudgeManagedAuthorization,
  resolveOwnedJudgeManagedCall,
  type JudgeManagedAuthorizationDependencies,
} from "./judge-managed-realtime-authorization.js";
import type { JudgeIpReservationInput } from "./judge-ip-reservation.js";

export interface JudgeManagedRealtimeOwnershipRepository {
  claimStart(
    claim: ManagedRealtimeStartClaim,
  ): Promise<ManagedRealtimeStartClaimResult>;
  releaseStart(
    claim: ManagedRealtimeStartClaim,
  ): Promise<"released" | "unavailable">;
  create(
    ownership: ManagedRealtimeCallOwnership,
  ): Promise<"created" | "unavailable">;
  findActiveOwned(
    owner: ManagedRealtimeCallOwner,
    nowEpoch: number,
  ): Promise<ManagedRealtimeCallOwnership | undefined>;
  terminateOwned(
    owner: ManagedRealtimeCallOwner,
    terminatedAtEpoch: number,
  ): Promise<"terminated" | "unavailable">;
}

export interface JudgeManagedRealtimeControllerStub {
  fetch(input: string | URL | Request, init?: RequestInit): Promise<Response>;
}

export interface JudgeManagedRealtimeHttpDependencies extends JudgeManagedAuthorizationDependencies {
  readonly controllers: (
    reservationId: string,
  ) => JudgeManagedRealtimeControllerStub;
  readonly ipReservation?: JudgeIpReservationInput | undefined;
  readonly ownerships: JudgeManagedRealtimeOwnershipRepository;
  readonly usage?: UsageLimiter | undefined;
}

type ManagedOperation = "start" | "turn" | "transcript" | "terminate";

interface InternalStartedResponse {
  readonly channel: RealtimeChannel;
  readonly kind: "started";
  readonly model: string;
  readonly sdpAnswer: string;
}

interface InternalBegunResponse {
  readonly kind: "begun";
  readonly replayed: boolean;
}

interface InternalTranscriptResponse {
  readonly kind: "completed" | "pending";
  readonly transcript?: string;
}

function internalUrl(path: string): string {
  return `https://judge-realtime.internal${path}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isInternalStartedResponse(
  value: unknown,
): value is InternalStartedResponse {
  return (
    isRecord(value) &&
    value.kind === "started" &&
    (value.channel === "private" || value.channel === "shared") &&
    typeof value.model === "string" &&
    value.model.trim().length > 0 &&
    typeof value.sdpAnswer === "string" &&
    value.sdpAnswer.trim().length > 0
  );
}

function isInternalBegunResponse(
  value: unknown,
): value is InternalBegunResponse {
  return (
    isRecord(value) &&
    value.kind === "begun" &&
    typeof value.replayed === "boolean"
  );
}

function isInternalTranscriptResponse(
  value: unknown,
): value is InternalTranscriptResponse {
  return (
    isRecord(value) &&
    (value.kind === "pending" || value.kind === "completed") &&
    (value.kind === "pending" ||
      (typeof value.transcript === "string" && value.transcript.length > 0))
  );
}

function errorForInternalCode(
  value: unknown,
):
  | "CONFLICT"
  | "REALTIME_UNAVAILABLE"
  | "USAGE_LIMIT_REACHED"
  | "VALIDATION_FAILED" {
  if (!isRecord(value)) {
    return "REALTIME_UNAVAILABLE";
  }
  if (value.code === "USAGE_LIMIT_REACHED") {
    return "USAGE_LIMIT_REACHED";
  }
  if (
    value.code === "CALL_ALREADY_STARTED" ||
    value.code === "TURN_ALREADY_STARTED" ||
    value.code === "TURN_UNAVAILABLE"
  ) {
    return "CONFLICT";
  }
  if (value.code === "INVALID_REQUEST") {
    return "VALIDATION_FAILED";
  }
  return "REALTIME_UNAVAILABLE";
}

async function readInternalBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

function epochSeconds(clock: Clock): number | undefined {
  const milliseconds = Date.parse(clock.now());
  if (!Number.isFinite(milliseconds) || milliseconds < 0) {
    return undefined;
  }
  return Math.floor(milliseconds / 1_000);
}

function ownerFromAuthorization(
  managedCallId: string,
  authorization: {
    readonly meetingId: string;
    readonly participantId: string;
    readonly sessionId: string;
    readonly userId: string;
  },
): ManagedRealtimeCallOwner {
  return {
    managedCallId,
    meetingId: authorization.meetingId,
    participantId: authorization.participantId,
    sessionId: authorization.sessionId,
    userId: authorization.userId,
  };
}

async function sha256Fingerprint(
  dependencies: JudgeManagedRealtimeHttpDependencies,
  value: string,
): Promise<string> {
  return `sha256:${await dependencies.tokens.digest(value)}`;
}

async function cleanupStart(
  dependencies: JudgeManagedRealtimeHttpDependencies,
  owner: ManagedRealtimeCallOwner,
  reservationId: string,
  controller: JudgeManagedRealtimeControllerStub,
  shouldTerminateController: boolean,
  terminatedAtEpoch: number,
): Promise<void> {
  if (shouldTerminateController) {
    await controller
      .fetch(internalUrl("/terminate"), { method: "POST" })
      .catch(() => undefined);
  }
  await dependencies.ownerships
    .terminateOwned(owner, terminatedAtEpoch)
    .catch(() => "unavailable");
  if (dependencies.usage !== undefined) {
    await dependencies.usage.release(reservationId).catch(() => undefined);
  }
}

async function startManagedCall(input: {
  readonly correlationId: string;
  readonly dependencies: JudgeManagedRealtimeHttpDependencies;
  readonly meetingId: string;
  readonly request: Request;
}): Promise<Response> {
  const body = await input.request.json().catch(() => undefined);
  const parsed = CreateManagedRealtimeCallRequestSchema.safeParse(body);
  if (!parsed.success || parsed.data.meetingId !== input.meetingId) {
    return apiErrorResponse("VALIDATION_FAILED", input.correlationId);
  }
  if (input.dependencies.ipReservation === undefined) {
    return apiErrorResponse("REALTIME_UNAVAILABLE", input.correlationId);
  }
  if (input.dependencies.usage === undefined) {
    return apiErrorResponse("REALTIME_UNAVAILABLE", input.correlationId);
  }

  const authorization = await resolveJudgeManagedAuthorization({
    dependencies: input.dependencies,
    meetingId: input.meetingId,
    request: input.request,
  });
  if (authorization.kind === "rejected") {
    return apiErrorResponse(authorization.code, input.correlationId);
  }
  const nowEpoch = epochSeconds(input.dependencies.clock);
  if (nowEpoch === undefined) {
    return apiErrorResponse("REALTIME_UNAVAILABLE", input.correlationId);
  }

  let reservationId: string | undefined;
  let owner: ManagedRealtimeCallOwner | undefined;
  let controller: JudgeManagedRealtimeControllerStub | undefined;
  let controllerRequestStarted = false;
  let claimedStart: ManagedRealtimeStartClaim | undefined;
  try {
    const managedCallId = `managed-${crypto.randomUUID()}`;
    const startKeyHash = await sha256Fingerprint(
      input.dependencies,
      JSON.stringify([
        "counterpoint:managed-realtime-start-key:v1",
        authorization.authorization.userId,
        authorization.authorization.sessionId,
        input.meetingId,
        parsed.data.idempotencyKey,
      ]),
    );
    const sdpFingerprint = await sha256Fingerprint(
      input.dependencies,
      parsed.data.sdpOffer,
    );
    const requestFingerprint = await sha256Fingerprint(
      input.dependencies,
      JSON.stringify([
        "counterpoint:managed-realtime-start-request:v1",
        parsed.data.channel,
        sdpFingerprint,
      ]),
    );
    const startClaim: ManagedRealtimeStartClaim = {
      createdAtEpoch: nowEpoch,
      expiresAtEpoch: nowEpoch + JUDGE_REALTIME_RESERVATION_TTL_SECONDS,
      managedCallId,
      meetingId: input.meetingId,
      participantId: authorization.authorization.participantId,
      requestFingerprint,
      sessionId: authorization.authorization.sessionId,
      startKeyHash,
      userId: authorization.authorization.userId,
    };
    const claim = await input.dependencies.ownerships.claimStart(startClaim);
    if (claim === "replayed") {
      return apiErrorResponse("CONFLICT", input.correlationId, {
        reason: "MANAGED_REALTIME_START_ALREADY_CLAIMED",
      });
    }
    if (claim === "conflict") {
      return apiErrorResponse("CONFLICT", input.correlationId, {
        reason: "IDEMPOTENCY_KEY_REUSED",
      });
    }
    if (claim !== "claimed") {
      return apiErrorResponse("REALTIME_UNAVAILABLE", input.correlationId);
    }
    claimedStart = startClaim;

    const reservation = await input.dependencies.usage.reserve(
      {
        accountId: authorization.authorization.userId,
        ipAddress: input.dependencies.ipReservation.ipAddress,
        meetingId: input.meetingId,
      },
      JUDGE_REALTIME_RESERVED_USAGE,
    );
    if (reservation.kind === "denied") {
      await input.dependencies.ownerships
        .releaseStart(claimedStart)
        .catch(() => "unavailable");
      return apiErrorResponse("USAGE_LIMIT_REACHED", input.correlationId, {
        limit: reservation.limit,
      });
    }
    reservationId = reservation.reservationId;

    owner = ownerFromAuthorization(managedCallId, authorization.authorization);
    const ownership: ManagedRealtimeCallOwnership = {
      accountId: authorization.authorization.userId,
      channel: parsed.data.channel,
      createdAtEpoch: nowEpoch,
      expiresAtEpoch: nowEpoch + JUDGE_REALTIME_RESERVATION_TTL_SECONDS,
      managedCallId,
      meetingId: input.meetingId,
      participantId: authorization.authorization.participantId,
      reservationId,
      sessionId: authorization.authorization.sessionId,
      userId: authorization.authorization.userId,
    };
    if ((await input.dependencies.ownerships.create(ownership)) !== "created") {
      await input.dependencies.usage
        .release(reservationId)
        .catch(() => undefined);
      await input.dependencies.ownerships
        .releaseStart(claimedStart)
        .catch(() => "unavailable");
      return apiErrorResponse("REALTIME_UNAVAILABLE", input.correlationId);
    }

    controller = input.dependencies.controllers(reservationId);
    const safetyIdentifier = `sha256:${await input.dependencies.tokens.digest(
      `counterpoint:realtime-safety:v1:${authorization.authorization.userId}`,
    )}`;
    controllerRequestStarted = true;
    const internalResponse = await controller.fetch(internalUrl("/start"), {
      body: JSON.stringify({
        channel: parsed.data.channel,
        reservationId,
        safetyIdentifier,
        sdpOffer: parsed.data.sdpOffer,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    const internalBody = await readInternalBody(internalResponse);
    if (!internalResponse.ok || !isInternalStartedResponse(internalBody)) {
      await cleanupStart(
        input.dependencies,
        owner,
        reservationId,
        controller,
        internalResponse.status !== 429,
        nowEpoch,
      );
      await input.dependencies.ownerships
        .releaseStart(claimedStart)
        .catch(() => "unavailable");
      return apiErrorResponse(
        errorForInternalCode(internalBody),
        input.correlationId,
      );
    }
    return apiJsonResponse(
      CreateManagedRealtimeCallResponseSchema.parse({
        channel: internalBody.channel,
        correlationId: input.correlationId,
        managedCallId,
        meetingId: input.meetingId,
        model: internalBody.model,
        sdpAnswer: internalBody.sdpAnswer,
      }),
      201,
      input.correlationId,
    );
  } catch {
    if (reservationId !== undefined) {
      if (owner !== undefined && controller !== undefined) {
        const nowEpoch = epochSeconds(input.dependencies.clock);
        await cleanupStart(
          input.dependencies,
          owner,
          reservationId,
          controller,
          controllerRequestStarted,
          nowEpoch ?? 0,
        );
      } else {
        if (owner !== undefined) {
          await input.dependencies.ownerships
            .terminateOwned(owner, epochSeconds(input.dependencies.clock) ?? 0)
            .catch(() => "unavailable");
        }
        await input.dependencies.usage
          .release(reservationId)
          .catch(() => undefined);
      }
    }
    if (claimedStart !== undefined) {
      await input.dependencies.ownerships
        .releaseStart(claimedStart)
        .catch(() => "unavailable");
    }
    return apiErrorResponse("REALTIME_UNAVAILABLE", input.correlationId);
  }
}

async function operateOwnedCall(input: {
  readonly correlationId: string;
  readonly dependencies: JudgeManagedRealtimeHttpDependencies;
  readonly managedCallId: string;
  readonly meetingId: string;
  readonly operation: Exclude<ManagedOperation, "start">;
  readonly request: Request;
}): Promise<Response> {
  const body = await input.request.json().catch(() => undefined);
  const schema =
    input.operation === "turn"
      ? BeginManagedRealtimeTurnRequestSchema
      : input.operation === "transcript"
        ? AwaitManagedRealtimeTranscriptRequestSchema
        : TerminateManagedRealtimeCallRequestSchema;
  const parsed = schema.safeParse(body);
  if (
    !parsed.success ||
    parsed.data.meetingId !== input.meetingId ||
    parsed.data.managedCallId !== input.managedCallId
  ) {
    return apiErrorResponse("VALIDATION_FAILED", input.correlationId);
  }
  const parsedData = parsed.data as {
    readonly managedCallId: string;
    readonly meetingId: string;
    readonly utteranceId?: string;
  };
  if (input.operation !== "terminate" && parsedData.utteranceId === undefined) {
    return apiErrorResponse("VALIDATION_FAILED", input.correlationId);
  }

  const resolved = await resolveOwnedJudgeManagedCall({
    dependencies: input.dependencies,
    managedCallId: input.managedCallId,
    meetingId: input.meetingId,
    ownerships: input.dependencies.ownerships,
    request: input.request,
  });
  if (resolved.kind === "rejected") {
    return apiErrorResponse(resolved.code, input.correlationId);
  }
  const controller = input.dependencies.controllers(
    resolved.ownership.reservationId,
  );
  const path =
    input.operation === "turn"
      ? "/turn"
      : input.operation === "transcript"
        ? "/transcript"
        : "/terminate";
  const internalResponse = await controller.fetch(internalUrl(path), {
    ...(input.operation === "terminate"
      ? {}
      : {
          body: JSON.stringify({ utteranceId: parsedData.utteranceId }),
          headers: { "content-type": "application/json" },
        }),
    method: "POST",
  });
  const internalBody = await readInternalBody(internalResponse);
  if (!internalResponse.ok) {
    return apiErrorResponse(
      errorForInternalCode(internalBody),
      input.correlationId,
    );
  }

  if (input.operation === "turn") {
    if (!isInternalBegunResponse(internalBody)) {
      return apiErrorResponse("REALTIME_UNAVAILABLE", input.correlationId);
    }
    return apiJsonResponse(
      BeginManagedRealtimeTurnResponseSchema.parse({
        correlationId: input.correlationId,
        managedCallId: input.managedCallId,
        meetingId: input.meetingId,
        utteranceId: parsedData.utteranceId,
      }),
      internalBody.replayed ? 200 : 201,
      input.correlationId,
    );
  }

  if (input.operation === "transcript") {
    if (!isInternalTranscriptResponse(internalBody)) {
      return apiErrorResponse("REALTIME_UNAVAILABLE", input.correlationId);
    }
    if (internalBody.kind === "pending") {
      return apiErrorResponse("CONFLICT", input.correlationId, {
        reason: "TRANSCRIPT_PENDING",
      });
    }
    return apiJsonResponse(
      AwaitManagedRealtimeTranscriptResponseSchema.parse({
        correlationId: input.correlationId,
        managedCallId: input.managedCallId,
        meetingId: input.meetingId,
        transcript: internalBody.transcript,
        utteranceId: parsedData.utteranceId,
      }),
      200,
      input.correlationId,
    );
  }

  if (!isRecord(internalBody) || internalBody.kind !== "terminated") {
    return apiErrorResponse("REALTIME_UNAVAILABLE", input.correlationId);
  }
  const nowEpoch = epochSeconds(input.dependencies.clock);
  if (nowEpoch === undefined) {
    return apiErrorResponse("REALTIME_UNAVAILABLE", input.correlationId);
  }
  const owner = ownerFromAuthorization(
    input.managedCallId,
    resolved.authorization,
  );
  try {
    if (
      (await input.dependencies.ownerships.terminateOwned(owner, nowEpoch)) ===
      "unavailable"
    ) {
      return apiErrorResponse("REALTIME_UNAVAILABLE", input.correlationId);
    }
  } catch {
    return apiErrorResponse("REALTIME_UNAVAILABLE", input.correlationId);
  }
  return apiJsonResponse(
    TerminateManagedRealtimeCallResponseSchema.parse({
      correlationId: input.correlationId,
      managedCallId: input.managedCallId,
      meetingId: input.meetingId,
      terminated: true,
    }),
    200,
    input.correlationId,
  );
}

export async function handleJudgeManagedRealtimeHttp(input: {
  readonly correlationId: string;
  readonly dependencies: JudgeManagedRealtimeHttpDependencies;
  readonly managedCallId?: string | undefined;
  readonly meetingId: string;
  readonly operation: ManagedOperation;
  readonly request: Request;
}): Promise<Response> {
  if (input.operation === "start") {
    return startManagedCall(input);
  }
  if (input.managedCallId === undefined) {
    return apiErrorResponse("VALIDATION_FAILED", input.correlationId);
  }
  return operateOwnedCall({
    ...input,
    managedCallId: input.managedCallId,
    operation: input.operation,
  });
}
