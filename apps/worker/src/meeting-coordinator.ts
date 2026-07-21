import { DurableObject } from "cloudflare:workers";

import { MEETING_API_KEY_LEASE_TTL_MS } from "@counterpoint/application";
import type { MeetingApiKeyLease } from "@counterpoint/ports";

const JSON_HEADERS = {
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
} as const;
const MAX_TICKET_TTL_MS = 30_000;

type RealtimeRole = "display" | "facilitator" | "participant";

interface TicketClaims {
  readonly correlationId: string;
  readonly digest: string;
  readonly expiresAt: string;
  readonly issuedAt: string;
  readonly lastSeenPosition: number;
  readonly meetingId: string;
  readonly participantId?: string;
  readonly role: RealtimeRole;
  readonly sessionId: string;
  readonly userId: string;
}

interface Publication {
  readonly correlationId: string;
  readonly kind: "projection" | "reset";
  readonly publicationId: string;
  readonly sourcePosition: number;
  readonly visibility:
    | { readonly kind: "shared" }
    | {
        readonly kind: "owner_private";
        readonly ownerParticipantId: string;
      };
}

function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, { headers: JSON_HEADERS, status });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const allowed = new Set([...required, ...optional]);
  return (
    required.every((key) => key in value) &&
    Object.keys(value).every((key) => allowed.has(key))
  );
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function position(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function timestampMs(value: string): number | undefined {
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) ? milliseconds : undefined;
}

function parseByokLease(input: unknown): MeetingApiKeyLease | undefined {
  if (
    !isRecord(input) ||
    !exactKeys(input, [
      "apiKey",
      "heartbeatAt",
      "meetingId",
      "ownerParticipantId",
      "ownerSessionId",
    ]) ||
    !nonEmptyString(input.apiKey) ||
    input.apiKey.trim() !== input.apiKey ||
    !nonEmptyString(input.heartbeatAt) ||
    timestampMs(input.heartbeatAt) === undefined ||
    !nonEmptyString(input.meetingId) ||
    !nonEmptyString(input.ownerParticipantId) ||
    !nonEmptyString(input.ownerSessionId)
  ) {
    return undefined;
  }
  return {
    apiKey: input.apiKey,
    heartbeatAt: input.heartbeatAt,
    meetingId: input.meetingId,
    ownerParticipantId: input.ownerParticipantId,
    ownerSessionId: input.ownerSessionId,
  };
}

function parseByokOwner(input: unknown):
  | {
      readonly meetingId: string;
      readonly ownerParticipantId: string;
      readonly ownerSessionId: string;
    }
  | undefined {
  if (
    !isRecord(input) ||
    !exactKeys(input, [
      "meetingId",
      "ownerParticipantId",
      "ownerSessionId",
    ]) ||
    !nonEmptyString(input.meetingId) ||
    !nonEmptyString(input.ownerParticipantId) ||
    !nonEmptyString(input.ownerSessionId)
  ) {
    return undefined;
  }
  return {
    meetingId: input.meetingId,
    ownerParticipantId: input.ownerParticipantId,
    ownerSessionId: input.ownerSessionId,
  };
}

function sameByokOwner(
  lease: MeetingApiKeyLease,
  owner: {
    readonly ownerParticipantId: string;
    readonly ownerSessionId: string;
  },
): boolean {
  return (
    lease.ownerParticipantId === owner.ownerParticipantId &&
    lease.ownerSessionId === owner.ownerSessionId
  );
}

function parseTicketClaims(input: unknown): TicketClaims | undefined {
  if (
    !isRecord(input) ||
    !exactKeys(
      input,
      [
        "correlationId",
        "digest",
        "expiresAt",
        "issuedAt",
        "lastSeenPosition",
        "meetingId",
        "role",
        "sessionId",
        "userId",
      ],
      ["participantId"],
    ) ||
    !nonEmptyString(input.correlationId) ||
    !nonEmptyString(input.digest) ||
    !nonEmptyString(input.expiresAt) ||
    !nonEmptyString(input.issuedAt) ||
    !position(input.lastSeenPosition) ||
    !nonEmptyString(input.meetingId) ||
    (input.role !== "display" &&
      input.role !== "facilitator" &&
      input.role !== "participant") ||
    !nonEmptyString(input.sessionId) ||
    !nonEmptyString(input.userId)
  ) {
    return undefined;
  }
  let participantId: string | undefined;
  if (input.role === "display") {
    if (input.participantId !== undefined) {
      return undefined;
    }
  } else if (nonEmptyString(input.participantId)) {
    participantId = input.participantId;
  } else {
    return undefined;
  }
  const issuedAt = timestampMs(input.issuedAt);
  const expiresAt = timestampMs(input.expiresAt);
  if (
    issuedAt === undefined ||
    expiresAt === undefined ||
    expiresAt <= issuedAt ||
    expiresAt - issuedAt > MAX_TICKET_TTL_MS
  ) {
    return undefined;
  }
  return {
    correlationId: input.correlationId,
    digest: input.digest,
    expiresAt: input.expiresAt,
    issuedAt: input.issuedAt,
    lastSeenPosition: input.lastSeenPosition,
    meetingId: input.meetingId,
    ...(participantId === undefined ? {} : { participantId }),
    role: input.role,
    sessionId: input.sessionId,
    userId: input.userId,
  };
}

function parsePublication(input: unknown): Publication | undefined {
  if (
    !isRecord(input) ||
    !exactKeys(input, [
      "correlationId",
      "kind",
      "publicationId",
      "sourcePosition",
      "visibility",
    ]) ||
    !nonEmptyString(input.correlationId) ||
    (input.kind !== "projection" && input.kind !== "reset") ||
    !nonEmptyString(input.publicationId) ||
    !position(input.sourcePosition) ||
    input.sourcePosition === 0 ||
    !isRecord(input.visibility)
  ) {
    return undefined;
  }
  const visibility =
    exactKeys(input.visibility, ["kind"]) && input.visibility.kind === "shared"
      ? ({ kind: "shared" } as const)
      : exactKeys(input.visibility, ["kind", "ownerParticipantId"]) &&
          input.visibility.kind === "owner_private" &&
          nonEmptyString(input.visibility.ownerParticipantId)
        ? ({
            kind: "owner_private",
            ownerParticipantId: input.visibility.ownerParticipantId,
          } as const)
        : undefined;
  if (
    visibility === undefined ||
    (input.kind === "reset" && visibility.kind !== "shared")
  ) {
    return undefined;
  }
  return {
    correlationId: input.correlationId,
    kind: input.kind,
    publicationId: input.publicationId,
    sourcePosition: input.sourcePosition,
    visibility,
  };
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export class MeetingCoordinator extends DurableObject<WorkerBindings> {
  #byokExpiryTimer: ReturnType<typeof setTimeout> | undefined;
  #byokLease: MeetingApiKeyLease | undefined;
  readonly #publications: Publication[] = [];
  readonly #revokedSessions = new Set<string>();
  readonly #tickets = new Map<string, TicketClaims>();
  #meetingId: string | undefined;

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return jsonResponse({
        durableTruth: "d1",
        publications: this.#publications.length,
        status: "ok",
        tickets: this.#tickets.size,
      });
    }
    if (request.method !== "POST") {
      return jsonResponse({ code: "NOT_FOUND" }, 404);
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ code: "INVALID_REQUEST" }, 400);
    }
    if (url.pathname === "/tickets/issue") {
      return this.#issueTicket(body);
    }
    if (url.pathname === "/tickets/consume") {
      return this.#consumeTicket(body);
    }
    if (url.pathname === "/publications") {
      return this.#publish(body);
    }
    if (url.pathname === "/resume") {
      return this.#resume(body);
    }
    if (url.pathname === "/sessions/revoke") {
      return this.#revokeSession(body);
    }
    if (url.pathname === "/byok/configure") {
      return this.#configureByok(body);
    }
    if (url.pathname === "/byok/find") {
      return this.#findByok(body);
    }
    if (url.pathname === "/byok/heartbeat") {
      return this.#heartbeatByok(body);
    }
    if (url.pathname === "/byok/clear") {
      return this.#clearByokOwner(body);
    }
    return jsonResponse({ code: "NOT_FOUND" }, 404);
  }

  #bindMeeting(meetingId: string): boolean {
    this.#meetingId ??= meetingId;
    return this.#meetingId === meetingId;
  }

  #consumeTicket(input: unknown): Response {
    if (
      !isRecord(input) ||
      !exactKeys(input, ["digest", "now"]) ||
      !nonEmptyString(input.digest) ||
      !nonEmptyString(input.now)
    ) {
      return jsonResponse({ code: "INVALID_REQUEST" }, 400);
    }
    const now = timestampMs(input.now);
    if (now === undefined) {
      return jsonResponse({ code: "INVALID_REQUEST" }, 400);
    }
    const claims = this.#tickets.get(input.digest);
    if (claims === undefined) {
      return jsonResponse({ kind: "unavailable" }, 404);
    }
    this.#tickets.delete(input.digest);
    if (
      timestampMs(claims.expiresAt)! <= now ||
      this.#revokedSessions.has(claims.sessionId)
    ) {
      return jsonResponse({ kind: "unavailable" }, 404);
    }
    return jsonResponse({ claims, kind: "consumed" });
  }

  #activeByokLease(): MeetingApiKeyLease | undefined {
    const lease = this.#byokLease;
    if (lease === undefined) {
      return undefined;
    }
    const heartbeatAt = timestampMs(lease.heartbeatAt);
    if (
      heartbeatAt === undefined ||
      Date.now() >= heartbeatAt + MEETING_API_KEY_LEASE_TTL_MS
    ) {
      this.#removeByokLease();
      return undefined;
    }
    return lease;
  }

  #clearByokOwner(input: unknown): Response {
    const owner = parseByokOwner(input);
    if (owner === undefined || !this.#bindMeeting(owner.meetingId)) {
      return jsonResponse({ code: "INVALID_REQUEST" }, 400);
    }
    const lease = this.#activeByokLease();
    if (lease === undefined) {
      return jsonResponse({ kind: "missing" }, 404);
    }
    if (!sameByokOwner(lease, owner)) {
      return jsonResponse({ kind: "owner_mismatch" }, 409);
    }
    this.#removeByokLease();
    return jsonResponse({ kind: "applied" });
  }

  #configureByok(input: unknown): Response {
    const lease = parseByokLease(input);
    if (lease === undefined) {
      return jsonResponse({ code: "INVALID_REQUEST" }, 400);
    }
    if (!this.#bindMeeting(lease.meetingId)) {
      return jsonResponse({ code: "MEETING_SCOPE_CONFLICT" }, 409);
    }
    const current = this.#activeByokLease();
    if (current !== undefined && !sameByokOwner(current, lease)) {
      return jsonResponse({ kind: "owner_mismatch" }, 409);
    }
    this.#byokLease = lease;
    this.#scheduleByokExpiry(lease);
    return jsonResponse({ kind: "configured" }, 201);
  }

  #findByok(input: unknown): Response {
    if (
      !isRecord(input) ||
      !exactKeys(input, ["meetingId"]) ||
      !nonEmptyString(input.meetingId) ||
      !this.#bindMeeting(input.meetingId)
    ) {
      return jsonResponse({ code: "INVALID_REQUEST" }, 400);
    }
    const lease = this.#activeByokLease();
    return lease === undefined
      ? jsonResponse({ kind: "missing" }, 404)
      : jsonResponse({ kind: "found", lease });
  }

  #heartbeatByok(input: unknown): Response {
    if (
      !isRecord(input) ||
      !exactKeys(input, [
        "heartbeatAt",
        "meetingId",
        "ownerParticipantId",
        "ownerSessionId",
      ]) ||
      !nonEmptyString(input.heartbeatAt) ||
      timestampMs(input.heartbeatAt) === undefined
    ) {
      return jsonResponse({ code: "INVALID_REQUEST" }, 400);
    }
    const owner = parseByokOwner({
      meetingId: input.meetingId,
      ownerParticipantId: input.ownerParticipantId,
      ownerSessionId: input.ownerSessionId,
    });
    if (owner === undefined || !this.#bindMeeting(owner.meetingId)) {
      return jsonResponse({ code: "INVALID_REQUEST" }, 400);
    }
    const lease = this.#activeByokLease();
    if (lease === undefined) {
      return jsonResponse({ kind: "missing" }, 404);
    }
    if (!sameByokOwner(lease, owner)) {
      return jsonResponse({ kind: "owner_mismatch" }, 409);
    }
    const renewed = { ...lease, heartbeatAt: input.heartbeatAt };
    this.#byokLease = renewed;
    this.#scheduleByokExpiry(renewed);
    return jsonResponse({ kind: "applied" });
  }

  #removeByokLease(): void {
    if (this.#byokExpiryTimer !== undefined) {
      clearTimeout(this.#byokExpiryTimer);
      this.#byokExpiryTimer = undefined;
    }
    this.#byokLease = undefined;
  }

  #scheduleByokExpiry(lease: MeetingApiKeyLease): void {
    if (this.#byokExpiryTimer !== undefined) {
      clearTimeout(this.#byokExpiryTimer);
    }
    const heartbeatAt = timestampMs(lease.heartbeatAt) ?? Date.now();
    const delay = Math.max(
      0,
      heartbeatAt + MEETING_API_KEY_LEASE_TTL_MS - Date.now(),
    );
    this.#byokExpiryTimer = setTimeout(() => {
      if (this.#byokLease === lease) {
        this.#byokLease = undefined;
        this.#byokExpiryTimer = undefined;
      }
    }, delay);
  }

  #issueTicket(input: unknown): Response {
    const claims = parseTicketClaims(input);
    if (claims === undefined) {
      return jsonResponse({ code: "INVALID_REQUEST" }, 400);
    }
    if (!this.#bindMeeting(claims.meetingId)) {
      return jsonResponse({ code: "MEETING_SCOPE_CONFLICT" }, 409);
    }
    if (this.#revokedSessions.has(claims.sessionId)) {
      return jsonResponse({ code: "SESSION_REVOKED" }, 409);
    }
    const prior = this.#tickets.get(claims.digest);
    if (prior !== undefined) {
      return sameValue(prior, claims)
        ? jsonResponse({ kind: "issued", replayed: true })
        : jsonResponse({ code: "IDEMPOTENCY_CONFLICT" }, 409);
    }
    this.#tickets.set(claims.digest, claims);
    return jsonResponse({ kind: "issued", replayed: false }, 201);
  }

  #publish(input: unknown): Response {
    const publication = parsePublication(input);
    if (publication === undefined) {
      return jsonResponse({ code: "INVALID_REQUEST" }, 400);
    }
    const prior = this.#publications.find(
      ({ publicationId }) => publicationId === publication.publicationId,
    );
    if (prior !== undefined) {
      return sameValue(prior, publication)
        ? jsonResponse({
            coordinationPosition: this.#publications.indexOf(prior) + 1,
            kind: "published",
            replayed: true,
          })
        : jsonResponse({ code: "IDEMPOTENCY_CONFLICT" }, 409);
    }
    const priorSourcePosition = this.#publications.at(-1)?.sourcePosition ?? 0;
    if (publication.sourcePosition <= priorSourcePosition) {
      return jsonResponse(
        {
          actualPosition: priorSourcePosition,
          code: "POSITION_CONFLICT",
        },
        409,
      );
    }
    this.#publications.push(publication);
    return jsonResponse(
      {
        coordinationPosition: this.#publications.length,
        kind: "published",
        replayed: false,
      },
      201,
    );
  }

  #resume(input: unknown): Response {
    if (
      !isRecord(input) ||
      !exactKeys(input, ["afterVisiblePosition", "audience"]) ||
      !position(input.afterVisiblePosition) ||
      !isRecord(input.audience)
    ) {
      return jsonResponse({ code: "INVALID_REQUEST" }, 400);
    }
    const afterVisiblePosition = input.afterVisiblePosition;
    let participantId: string | undefined;
    if (!(
      exactKeys(input.audience, ["kind"]) && input.audience.kind === "display"
    )) {
      if (
        !exactKeys(input.audience, ["kind", "participantId"]) ||
        input.audience.kind !== "participant" ||
        !nonEmptyString(input.audience.participantId)
      ) {
        return jsonResponse({ code: "INVALID_REQUEST" }, 400);
      }
      participantId = input.audience.participantId;
    }
    const visible = this.#publications.filter(
      ({ visibility }) =>
        visibility.kind === "shared" ||
        visibility.ownerParticipantId === participantId,
    );
    return jsonResponse({
      durableTruth: "d1",
      publications: visible
        .map((publication, index) => ({
          correlationId: publication.correlationId,
          kind: publication.kind,
          publicationId: publication.publicationId,
          sourcePosition: publication.sourcePosition,
          visiblePosition: index + 1,
        }))
        .filter(
          ({ visiblePosition }) => visiblePosition > afterVisiblePosition,
        ),
      requiresSnapshot: afterVisiblePosition > visible.length,
      visiblePosition: visible.length,
    });
  }

  #revokeSession(input: unknown): Response {
    if (
      !isRecord(input) ||
      !exactKeys(input, ["sessionId"]) ||
      !nonEmptyString(input.sessionId)
    ) {
      return jsonResponse({ code: "INVALID_REQUEST" }, 400);
    }
    this.#revokedSessions.add(input.sessionId);
    if (this.#byokLease?.ownerSessionId === input.sessionId) {
      this.#removeByokLease();
    }
    let discardedTickets = 0;
    for (const [digest, claims] of this.#tickets) {
      if (claims.sessionId === input.sessionId) {
        this.#tickets.delete(digest);
        discardedTickets += 1;
      }
    }
    return jsonResponse({
      discardedTickets,
      kind: "revoked",
    });
  }
}
