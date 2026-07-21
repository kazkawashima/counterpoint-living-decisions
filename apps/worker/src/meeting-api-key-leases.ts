import type {
  MeetingApiKeyLease,
  MeetingApiKeyLeaseConfigureResult,
  MeetingApiKeyLeaseMutationResult,
  MeetingApiKeyLeaseStore,
} from "@counterpoint/ports";

interface MeetingCoordinatorStub {
  fetch(input: string | URL | Request, init?: RequestInit): Promise<Response>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const expected = new Set(keys);
  return (
    keys.every((key) => key in value) &&
    Object.keys(value).every((key) => expected.has(key))
  );
}

function nonEmptyTrimmed(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.trim() === value
  );
}

function parseLease(value: unknown): MeetingApiKeyLease | undefined {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      "apiKey",
      "heartbeatAt",
      "meetingId",
      "ownerParticipantId",
      "ownerSessionId",
    ]) ||
    !nonEmptyTrimmed(value.apiKey) ||
    !nonEmptyTrimmed(value.heartbeatAt) ||
    !Number.isFinite(Date.parse(value.heartbeatAt)) ||
    !nonEmptyTrimmed(value.meetingId) ||
    !nonEmptyTrimmed(value.ownerParticipantId) ||
    !nonEmptyTrimmed(value.ownerSessionId)
  ) {
    return undefined;
  }
  return {
    apiKey: value.apiKey,
    heartbeatAt: value.heartbeatAt,
    meetingId: value.meetingId,
    ownerParticipantId: value.ownerParticipantId,
    ownerSessionId: value.ownerSessionId,
  };
}

export class MeetingCoordinatorApiKeyLeaseStore implements MeetingApiKeyLeaseStore {
  readonly #coordinator: MeetingCoordinatorStub;
  readonly #meetingId: string;

  constructor(meetingId: string, coordinator: MeetingCoordinatorStub) {
    if (!nonEmptyTrimmed(meetingId)) {
      throw new TypeError("Meeting API-key lease scope must not be empty");
    }
    this.#meetingId = meetingId;
    this.#coordinator = coordinator;
  }

  async clear(input: {
    readonly meetingId: string;
    readonly ownerParticipantId: string;
    readonly ownerSessionId: string;
  }): Promise<MeetingApiKeyLeaseMutationResult> {
    this.#requireMeeting(input.meetingId);
    const response = await this.#request("/byok/clear", input);
    return this.#mutationResult(response);
  }

  async clearBySession(sessionId: string): Promise<void> {
    if (!nonEmptyTrimmed(sessionId)) {
      throw new TypeError("Meeting API-key lease session must not be empty");
    }
    const response = await this.#request("/sessions/revoke", { sessionId });
    const body = await response.json().catch(() => undefined);
    if (!response.ok || !isRecord(body) || body.kind !== "revoked") {
      throw new Error("Meeting coordinator returned an invalid response");
    }
  }

  async configure(
    lease: MeetingApiKeyLease,
  ): Promise<MeetingApiKeyLeaseConfigureResult> {
    this.#requireMeeting(lease.meetingId);
    const response = await this.#request("/byok/configure", lease);
    const body = await response.json().catch(() => undefined);
    if (response.status === 201 && isRecord(body) && body.kind === "configured") {
      return { kind: "configured" };
    }
    if (
      response.status === 409 &&
      isRecord(body) &&
      body.kind === "owner_mismatch"
    ) {
      return { kind: "owner_mismatch" };
    }
    throw new Error("Meeting coordinator returned an invalid response");
  }

  async findByMeeting(
    meetingId: string,
  ): Promise<MeetingApiKeyLease | undefined> {
    this.#requireMeeting(meetingId);
    const response = await this.#request("/byok/find", { meetingId });
    const body = await response.json().catch(() => undefined);
    if (response.status === 404 && isRecord(body) && body.kind === "missing") {
      return undefined;
    }
    if (response.ok && isRecord(body) && body.kind === "found") {
      const lease = parseLease(body.lease);
      if (lease?.meetingId === this.#meetingId) {
        return lease;
      }
    }
    throw new Error("Meeting coordinator returned an invalid response");
  }

  async heartbeat(input: {
    readonly heartbeatAt: string;
    readonly meetingId: string;
    readonly ownerParticipantId: string;
    readonly ownerSessionId: string;
  }): Promise<MeetingApiKeyLeaseMutationResult> {
    this.#requireMeeting(input.meetingId);
    const response = await this.#request("/byok/heartbeat", input);
    return this.#mutationResult(response);
  }

  #mutationResult(
    response: Response,
  ): Promise<MeetingApiKeyLeaseMutationResult> {
    return response
      .json()
      .catch(() => undefined)
      .then((body: unknown) => {
        if (!isRecord(body)) {
          throw new Error("Meeting coordinator returned an invalid response");
        }
        if (response.ok && body.kind === "applied") {
          return { kind: "applied" } as const;
        }
        if (response.status === 404 && body.kind === "missing") {
          return { kind: "missing" } as const;
        }
        if (response.status === 409 && body.kind === "owner_mismatch") {
          return { kind: "owner_mismatch" } as const;
        }
        throw new Error("Meeting coordinator returned an invalid response");
      });
  }

  #request(path: string, body: unknown): Promise<Response> {
    return this.#coordinator.fetch(`https://meeting-coordinator.internal${path}`, {
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
  }

  #requireMeeting(meetingId: string): void {
    if (meetingId !== this.#meetingId) {
      throw new Error("Meeting API-key lease meeting scope mismatch");
    }
  }
}
