import type {
  Clock,
  ManagedRealtimeSecretIssuer,
  MeetingApiKeyLease,
  MeetingApiKeyLeaseStore,
  RealtimeChannel,
  RealtimeSecretIssuer,
} from "@counterpoint/ports";

import { authorize, type UserAuthorizationContext } from "./authorization.js";

export const MEETING_API_KEY_LEASE_TTL_MS = 5 * 60 * 1_000;

export type SafetyIdentifierHash =
  | ((value: string) => Promise<string> | string)
  | {
      hash(value: string): Promise<string> | string;
    };

export interface RealtimeSecretDependencies {
  readonly clock: Clock;
  readonly hashSafetyIdentifier: SafetyIdentifierHash;
  readonly issuer: RealtimeSecretIssuer;
  readonly judgeManagedIssuer?: ManagedRealtimeSecretIssuer;
  readonly leases: MeetingApiKeyLeaseStore;
}

export interface ConfigureMeetingByokInput {
  readonly apiKey: string;
  readonly meetingId: string;
}

export interface MeetingByokInput {
  readonly meetingId: string;
}

export interface IssueRealtimeClientSecretInput {
  readonly channel: RealtimeChannel;
  readonly meetingId: string;
}

export interface RealtimeSecretFailure {
  readonly code:
    | "API_KEY_REQUIRED"
    | "FORBIDDEN"
    | "JUDGE_MODE_FORBIDDEN"
    | "REALTIME_UNAVAILABLE";
  readonly kind: "failed";
}

export type ConfigureMeetingByokResult =
  | {
      readonly expiresAt: string;
      readonly kind: "configured";
      readonly meetingId: string;
    }
  | RealtimeSecretFailure;

export type HeartbeatMeetingByokResult =
  | {
      readonly expiresAt: string;
      readonly kind: "active";
      readonly meetingId: string;
    }
  | RealtimeSecretFailure;

export type ClearMeetingByokResult =
  | {
      readonly kind: "cleared";
      readonly meetingId: string;
    }
  | RealtimeSecretFailure;

export type IssueRealtimeClientSecretResult =
  | {
      readonly channel: RealtimeChannel;
      readonly clientSecret: string;
      readonly expiresAt: string;
      readonly keySource: "facilitatorProvided" | "judgeManaged";
      readonly kind: "issued";
      readonly meetingId: string;
      readonly model: string;
    }
  | RealtimeSecretFailure;

function failed(code: RealtimeSecretFailure["code"]): RealtimeSecretFailure {
  return { code, kind: "failed" };
}

function milliseconds(value: string, source: "clock" | "lease"): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(
      source === "clock"
        ? "Clock returned a non-ISO timestamp"
        : "Meeting API-key lease contained a non-ISO heartbeat",
    );
  }
  return parsed;
}

function expiresAt(heartbeatAt: string): string {
  return new Date(
    milliseconds(heartbeatAt, "lease") + MEETING_API_KEY_LEASE_TTL_MS,
  ).toISOString();
}

function facilitatorAuthorized(
  context: UserAuthorizationContext,
  meetingScope: string,
): boolean {
  return (
    context.role === "facilitator" &&
    authorize(context, {
      capability: "byok:configure",
      meetingId: meetingScope,
    }).kind === "authorized"
  );
}

function judgeManaged(context: UserAuthorizationContext): boolean {
  return context.capabilities.has("judge:managed-ai");
}

function meetingReadAuthorized(
  context: UserAuthorizationContext,
  meetingScope: string,
): boolean {
  return (
    authorize(context, {
      capability: "meeting:read",
      meetingId: meetingScope,
    }).kind === "authorized"
  );
}

function ownedBy(
  lease: MeetingApiKeyLease,
  context: UserAuthorizationContext,
): boolean {
  return (
    lease.ownerParticipantId === context.participantId &&
    lease.ownerSessionId === context.sessionId
  );
}

async function activeLease(
  dependencies: Pick<RealtimeSecretDependencies, "clock" | "leases">,
  meetingScope: string,
): Promise<MeetingApiKeyLease | undefined> {
  const lease = await dependencies.leases.findByMeeting(meetingScope);
  if (lease?.meetingId !== meetingScope) {
    return undefined;
  }

  const now = milliseconds(dependencies.clock.now(), "clock");
  const expires = milliseconds(expiresAt(lease.heartbeatAt), "lease");
  if (now < expires) {
    return lease;
  }

  await dependencies.leases.clear({
    meetingId: lease.meetingId,
    ownerParticipantId: lease.ownerParticipantId,
    ownerSessionId: lease.ownerSessionId,
  });
  return undefined;
}

async function safetyIdentifier(
  hash: SafetyIdentifierHash,
  userId: string,
): Promise<string> {
  const input = `counterpoint:realtime-safety:v1:${userId}`;
  const value =
    typeof hash === "function" ? await hash(input) : await hash.hash(input);
  if (
    value.length === 0 ||
    value.length > 512 ||
    value.trim() !== value ||
    /\s/u.test(value) ||
    value === userId
  ) {
    throw new Error("Safety identifier hash returned an invalid value");
  }
  return value;
}

export async function configureMeetingByok(
  dependencies: Pick<RealtimeSecretDependencies, "clock" | "leases">,
  context: UserAuthorizationContext,
  input: ConfigureMeetingByokInput,
): Promise<ConfigureMeetingByokResult> {
  if (judgeManaged(context)) {
    return failed("JUDGE_MODE_FORBIDDEN");
  }
  if (!facilitatorAuthorized(context, input.meetingId)) {
    return failed("FORBIDDEN");
  }
  if (input.apiKey.length === 0 || input.apiKey.trim() !== input.apiKey) {
    return failed("API_KEY_REQUIRED");
  }

  const current = await activeLease(dependencies, input.meetingId);
  if (current !== undefined && !ownedBy(current, context)) {
    return failed("FORBIDDEN");
  }

  const heartbeatAt = dependencies.clock.now();
  milliseconds(heartbeatAt, "clock");
  const result = await dependencies.leases.configure({
    apiKey: input.apiKey,
    heartbeatAt,
    meetingId: input.meetingId,
    ownerParticipantId: context.participantId,
    ownerSessionId: context.sessionId,
  });
  if (result.kind === "owner_mismatch") {
    return failed("FORBIDDEN");
  }
  return {
    expiresAt: expiresAt(heartbeatAt),
    kind: "configured",
    meetingId: input.meetingId,
  };
}

export async function heartbeatMeetingByok(
  dependencies: Pick<RealtimeSecretDependencies, "clock" | "leases">,
  context: UserAuthorizationContext,
  input: MeetingByokInput,
): Promise<HeartbeatMeetingByokResult> {
  if (judgeManaged(context)) {
    return failed("JUDGE_MODE_FORBIDDEN");
  }
  if (!facilitatorAuthorized(context, input.meetingId)) {
    return failed("FORBIDDEN");
  }

  const lease = await activeLease(dependencies, input.meetingId);
  if (lease === undefined) {
    return failed("API_KEY_REQUIRED");
  }
  if (!ownedBy(lease, context)) {
    return failed("FORBIDDEN");
  }

  const heartbeatAt = dependencies.clock.now();
  milliseconds(heartbeatAt, "clock");
  const result = await dependencies.leases.heartbeat({
    heartbeatAt,
    meetingId: input.meetingId,
    ownerParticipantId: context.participantId,
    ownerSessionId: context.sessionId,
  });
  if (result.kind === "missing") {
    return failed("API_KEY_REQUIRED");
  }
  if (result.kind === "owner_mismatch") {
    return failed("FORBIDDEN");
  }
  return {
    expiresAt: expiresAt(heartbeatAt),
    kind: "active",
    meetingId: input.meetingId,
  };
}

export async function clearMeetingByok(
  dependencies: Pick<RealtimeSecretDependencies, "clock" | "leases">,
  context: UserAuthorizationContext,
  input: MeetingByokInput,
): Promise<ClearMeetingByokResult> {
  if (judgeManaged(context)) {
    return failed("JUDGE_MODE_FORBIDDEN");
  }
  if (!facilitatorAuthorized(context, input.meetingId)) {
    return failed("FORBIDDEN");
  }

  const lease = await activeLease(dependencies, input.meetingId);
  if (lease === undefined) {
    return failed("API_KEY_REQUIRED");
  }
  if (!ownedBy(lease, context)) {
    return failed("FORBIDDEN");
  }

  const result = await dependencies.leases.clear({
    meetingId: input.meetingId,
    ownerParticipantId: context.participantId,
    ownerSessionId: context.sessionId,
  });
  if (result.kind === "missing") {
    return failed("API_KEY_REQUIRED");
  }
  if (result.kind === "owner_mismatch") {
    return failed("FORBIDDEN");
  }
  return {
    kind: "cleared",
    meetingId: input.meetingId,
  };
}

export async function clearMeetingByokLeasesBySession(
  dependencies: Pick<RealtimeSecretDependencies, "leases">,
  sessionId: string,
): Promise<void> {
  await dependencies.leases.clearBySession(sessionId);
}

export async function issueRealtimeClientSecret(
  dependencies: RealtimeSecretDependencies,
  context: UserAuthorizationContext,
  input: IssueRealtimeClientSecretInput,
): Promise<IssueRealtimeClientSecretResult> {
  if (!meetingReadAuthorized(context, input.meetingId)) {
    return failed("FORBIDDEN");
  }

  const usesJudgeManaged = judgeManaged(context);
  const judgeManagedIssuer = dependencies.judgeManagedIssuer;
  const lease = usesJudgeManaged
    ? undefined
    : await activeLease(dependencies, input.meetingId);
  if (!usesJudgeManaged && lease === undefined) {
    return failed("API_KEY_REQUIRED");
  }
  if (usesJudgeManaged && judgeManagedIssuer === undefined) {
    return failed("REALTIME_UNAVAILABLE");
  }

  try {
    const issuerInput = {
      channel: input.channel,
      meetingId: input.meetingId,
      ...(input.channel === "private"
        ? { ownerParticipantId: context.participantId }
        : {}),
      safetyIdentifier: await safetyIdentifier(
        dependencies.hashSafetyIdentifier,
        context.userId,
      ),
      sessionId: context.sessionId,
    };
    const secret =
      usesJudgeManaged && judgeManagedIssuer !== undefined
        ? await judgeManagedIssuer.issue(issuerInput)
        : lease === undefined
          ? undefined
          : await dependencies.issuer.issue({
              ...issuerInput,
              apiKey: lease.apiKey,
            });
    if (secret === undefined) {
      return failed("REALTIME_UNAVAILABLE");
    }
    const secretExpiresAt = Date.parse(secret.expiresAt);
    if (
      secret.channel !== input.channel ||
      secret.value.length === 0 ||
      secret.value.trim() !== secret.value ||
      secret.value === lease?.apiKey ||
      secret.model.length === 0 ||
      secret.model.trim() !== secret.model ||
      !Number.isFinite(secretExpiresAt) ||
      secretExpiresAt <= milliseconds(dependencies.clock.now(), "clock")
    ) {
      return failed("REALTIME_UNAVAILABLE");
    }
    return {
      channel: secret.channel,
      clientSecret: secret.value,
      expiresAt: secret.expiresAt,
      keySource: usesJudgeManaged ? "judgeManaged" : "facilitatorProvided",
      kind: "issued",
      meetingId: input.meetingId,
      model: secret.model,
    };
  } catch {
    return failed("REALTIME_UNAVAILABLE");
  }
}
