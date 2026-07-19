import {
  acquireSharedFloor,
  captureUtterance,
  getRoleProjection,
  releaseSharedFloor,
  type StoredSession,
} from "../../../apps/web/src/api.js";
import { afterEach, describe, expect, it, vi } from "vitest";

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

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("A7 browser API helpers", () => {
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
});
