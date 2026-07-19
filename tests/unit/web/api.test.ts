import {
  acquireSharedFloor,
  captureUtterance,
  getJudgeUsage,
  getRoleProjection,
  registerPrivateUrlArtifact,
  releaseSharedFloor,
  type JudgeUsageSummaryResponse,
  type StoredSession,
} from "../../../apps/web/src/api.js";
import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";

const session: StoredSession = {
  bearerToken: "synthetic-bearer-token",
  expiresAt: "2026-07-19T13:00:00.000Z",
  userId: "user-synthetic",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}

function fetchMockFor(body: unknown, status = 200) {
  const fetchMock = vi.fn<typeof fetch>(() =>
    Promise.resolve(jsonResponse(body, status)),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function requestBody(fetchMock: ReturnType<typeof fetchMockFor>): unknown {
  const options = fetchMock.mock.calls[0]?.[1];
  if (typeof options?.body !== "string") {
    throw new Error("Expected a serialized JSON request body.");
  }
  return JSON.parse(options.body);
}

function expectAuthenticatedJsonRequest(
  fetchMock: ReturnType<typeof fetchMockFor>,
  method: "DELETE" | "POST",
): void {
  const options = fetchMock.mock.calls[0]?.[1];
  const headers = new Headers(options?.headers);
  expect(options?.method).toBe(method);
  expect(headers.get("authorization")).toBe(`Bearer ${session.bearerToken}`);
  expect(headers.get("content-type")).toBe("application/json");
}

function judgeUsageResponse() {
  return {
    correlationId: "correlation-judge-usage",
    dimensions: {
      account: { limit: 10, remaining: 9, used: 1 },
      concurrency: { limit: 1, remaining: 0, used: 1 },
      costMicroUsd: { limit: 25_000_000, remaining: 0, used: 25_000_000 },
      generation: { limit: 3, remaining: 0, used: 3 },
      ip: { limit: 10, remaining: 9, used: 1 },
      meeting: { limit: 10, remaining: 9, used: 1 },
      realtimeSeconds: { limit: 30, remaining: 0, used: 30 },
      tokens: { limit: 1_200_000, remaining: 0, used: 1_200_000 },
    },
    rollingWindowSeconds: 86_400,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("A7 browser API helpers", () => {
  it("gets the strict judge usage summary from the authenticated same-origin route", async () => {
    const response = judgeUsageResponse();
    const fetchMock = fetchMockFor(response);

    const result = await getJudgeUsage(session, "meeting/synthetic");

    expect(result).toEqual(response);
    expectTypeOf(result).toEqualTypeOf<JudgeUsageSummaryResponse>();

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/meetings/meeting%2Fsynthetic/judge/usage",
      expect.any(Object),
    );
    const options = fetchMock.mock.calls[0]?.[1];
    expect(options?.method).toBe("GET");
    expect(new Headers(options?.headers).get("authorization")).toBe(
      `Bearer ${session.bearerToken}`,
    );
  });

  it.each([
    [
      "a malformed dimension",
      {
        ...judgeUsageResponse(),
        dimensions: {
          ...judgeUsageResponse().dimensions,
          tokens: { limit: 1_200_000, remaining: 0, used: -1 },
        },
      },
    ],
    [
      "an account identifier",
      { ...judgeUsageResponse(), accountId: "private-account" },
    ],
    [
      "an IP hash",
      { ...judgeUsageResponse(), ipHash: `hmac-sha256:${"a".repeat(64)}` },
    ],
    [
      "a reservation identifier",
      { ...judgeUsageResponse(), reservationId: "private-reservation" },
    ],
  ])("rejects judge usage containing %s", async (_label, response) => {
    fetchMockFor(response);

    await expect(getJudgeUsage(session, "meeting-1")).rejects.toThrow();
  });

  it("gets the caller-specific role projection for an encoded meeting scope", async () => {
    const response = {
      capabilities: ["meeting:read"],
      correlationId: "correlation-projection",
      meeting: {
        meetingId: "meeting/synthetic",
        phase: "deliberating",
        purpose: "Synthetic planning meeting",
      },
      participant: {
        participantId: "participant-server-derived",
        role: "participant",
        userId: "user-synthetic",
      },
      privateWorkspace: {
        artifacts: [],
        disclosureCandidates: [],
        inferenceSuggestions: [],
        sources: [],
        utterances: [],
      },
      shared: {
        actions: [],
        decisions: [],
        dissent: [],
        evidence: [],
        participants: [],
        position: 0,
        premises: [],
        sharedFloor: null,
        utterances: [],
      },
    } as const;
    const fetchMock = fetchMockFor(response);
    const controller = new AbortController();

    await expect(
      getRoleProjection(
        session,
        { meetingId: "meeting/synthetic" },
        controller.signal,
      ),
    ).resolves.toEqual(response);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/meetings/meeting%2Fsynthetic/projection",
      expect.objectContaining({ signal: controller.signal }),
    );
    const options = fetchMock.mock.calls[0]?.[1];
    expect(new Headers(options?.headers).get("authorization")).toBe(
      `Bearer ${session.bearerToken}`,
    );
  });

  it("acquires the shared floor without accepting caller-selected ownership", async () => {
    const response = {
      correlationId: "correlation-acquire",
      leaseExpiresAt: "2026-07-19T12:00:15.000Z",
      meetingId: "meeting-1",
      participantId: "participant-server-derived",
      utteranceId: "utterance-1",
    } as const;
    const fetchMock = fetchMockFor(response, 201);

    await expect(
      acquireSharedFloor(session, {
        meetingId: "meeting-1",
        utteranceId: "utterance-1",
      }),
    ).resolves.toEqual(response);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/meetings/meeting-1/realtime/shared-floor",
      expect.any(Object),
    );
    expectAuthenticatedJsonRequest(fetchMock, "POST");
    expect(requestBody(fetchMock)).toEqual({
      meetingId: "meeting-1",
      utteranceId: "utterance-1",
    });

    fetchMock.mockClear();
    await expect(
      acquireSharedFloor(session, {
        meetingId: "meeting-1",
        participantId: "participant-client-selected",
        utteranceId: "utterance-1",
      } as never),
    ).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("releases only the meeting-scoped utterance floor", async () => {
    const response = {
      correlationId: "correlation-release",
      meetingId: "meeting-1",
      releasedAt: "2026-07-19T12:00:10.000Z",
      utteranceId: "utterance-1",
    } as const;
    const fetchMock = fetchMockFor(response);

    await expect(
      releaseSharedFloor(session, {
        meetingId: "meeting-1",
        utteranceId: "utterance-1",
      }),
    ).resolves.toEqual(response);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/meetings/meeting-1/realtime/shared-floor",
      expect.any(Object),
    );
    expectAuthenticatedJsonRequest(fetchMock, "DELETE");
    expect(requestBody(fetchMock)).toEqual({
      meetingId: "meeting-1",
      utteranceId: "utterance-1",
    });
  });

  it("captures a strict meeting-scoped utterance and derives its participant from the response", async () => {
    const input = {
      capturedAt: "2026-07-19T12:00:00.000Z",
      channel: "shared",
      meetingId: "meeting-1",
      text: "Synthetic shared transcript.",
      utteranceId: "utterance-1",
    } as const;
    const response = {
      correlationId: "correlation-capture",
      meetingId: "meeting-1",
      position: 4,
      replayed: false,
      utterance: {
        capturedAt: input.capturedAt,
        channel: input.channel,
        participantId: "participant-server-derived",
        text: input.text,
        utteranceId: input.utteranceId,
      },
    } as const;
    const fetchMock = fetchMockFor(response, 201);

    await expect(captureUtterance(session, input)).resolves.toEqual(response);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/meetings/meeting-1/utterances",
      expect.any(Object),
    );
    expectAuthenticatedJsonRequest(fetchMock, "POST");
    expect(requestBody(fetchMock)).toEqual(input);
    expect(requestBody(fetchMock)).not.toHaveProperty("participantId");

    fetchMock.mockClear();
    await expect(
      captureUtterance(session, {
        ...input,
        participantId: "participant-client-selected",
      } as never),
    ).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a successful HTTP response that violates the protocol schema", async () => {
    fetchMockFor({
      correlationId: "correlation-release",
      meetingId: "meeting-1",
      participantId: "participant-unexpected",
      releasedAt: "2026-07-19T12:00:10.000Z",
      utteranceId: "utterance-1",
    });

    await expect(
      releaseSharedFloor(session, {
        meetingId: "meeting-1",
        utteranceId: "utterance-1",
      }),
    ).rejects.toThrow();
  });

  it("registers a public document URL without client-selected authority", async () => {
    const input = {
      idempotencyKey: "url-ingestion-1",
      meetingId: "meeting-1",
      url: "https://public.example/synthetic-note.md",
    } as const;
    const response = {
      artifact: {
        contentType: "text/markdown",
        createdAt: "2026-07-19T12:00:00.000Z",
        derivedArtifactId: "artifact-derived-1",
        derivedContentHash: `sha256:${"2".repeat(64)}`,
        derivedSizeBytes: 48,
        filename: "synthetic-note.md",
        ingestionMethod: "url",
        processingState: "processed",
        sizeBytes: 52,
        sourceArtifactId: "artifact-source-1",
        sourceContentHash: `sha256:${"1".repeat(64)}`,
      },
      correlationId: "correlation-url-1",
      meetingId: "meeting-1",
      position: 2,
    } as const;
    const fetchMock = fetchMockFor(response, 201);

    await expect(registerPrivateUrlArtifact(session, input)).resolves.toEqual(
      response,
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/artifacts/url",
      expect.any(Object),
    );
    expectAuthenticatedJsonRequest(fetchMock, "POST");
    expect(requestBody(fetchMock)).toEqual(input);
    expect(requestBody(fetchMock)).not.toHaveProperty("participantId");
  });
});
