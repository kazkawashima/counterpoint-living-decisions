import { describe, expect, it, vi } from "vitest";

import { MeetingCoordinatorApiKeyLeaseStore } from "../../../apps/worker/src/meeting-api-key-leases.js";

const lease = {
  apiKey: "sk-synthetic-worker-lease-canary",
  heartbeatAt: "2026-07-22T00:00:00.000Z",
  meetingId: "meeting-worker-lease",
  ownerParticipantId: "participant-worker-lease",
  ownerSessionId: "session-worker-lease",
};

function stubWith(responses: Response[]) {
  return {
    fetch: vi.fn((input: string | URL | Request) => {
      void input;
      const response = responses.shift();
      if (response === undefined) {
        throw new Error("Unexpected coordinator request");
      }
      return Promise.resolve(response);
    }),
  };
}

describe("MeetingCoordinatorApiKeyLeaseStore", () => {
  it("maps the complete lease lifecycle to fixed internal routes", async () => {
    const coordinator = stubWith([
      Response.json({ kind: "configured" }, { status: 201 }),
      Response.json({ kind: "found", lease }),
      Response.json({ kind: "applied" }),
      Response.json({ kind: "applied" }),
      Response.json({ discardedTickets: 0, kind: "revoked" }),
    ]);
    const store = new MeetingCoordinatorApiKeyLeaseStore(
      lease.meetingId,
      coordinator,
    );

    await expect(store.configure(lease)).resolves.toEqual({
      kind: "configured",
    });
    await expect(store.findByMeeting(lease.meetingId)).resolves.toEqual(lease);
    await expect(
      store.heartbeat({
        heartbeatAt: "2026-07-22T00:01:00.000Z",
        meetingId: lease.meetingId,
        ownerParticipantId: lease.ownerParticipantId,
        ownerSessionId: lease.ownerSessionId,
      }),
    ).resolves.toEqual({ kind: "applied" });
    await expect(
      store.clear({
        meetingId: lease.meetingId,
        ownerParticipantId: lease.ownerParticipantId,
        ownerSessionId: lease.ownerSessionId,
      }),
    ).resolves.toEqual({ kind: "applied" });
    await expect(store.clearBySession(lease.ownerSessionId)).resolves.toBe(
      undefined,
    );

    expect(
      coordinator.fetch.mock.calls.map(
        ([input]) =>
          new URL(
            input instanceof Request
              ? input.url
              : input instanceof URL
                ? input.href
                : input,
          ).pathname,
      ),
    ).toEqual([
      "/byok/configure",
      "/byok/find",
      "/byok/heartbeat",
      "/byok/clear",
      "/sessions/revoke",
    ]);
  });

  it("fails closed for cross-meeting calls and malformed coordinator data", async () => {
    const coordinator = stubWith([
      Response.json({ kind: "found", lease: { ...lease, apiKey: "" } }),
    ]);
    const store = new MeetingCoordinatorApiKeyLeaseStore(
      lease.meetingId,
      coordinator,
    );

    await expect(store.findByMeeting("meeting-other")).rejects.toThrow(
      "meeting scope",
    );
    await expect(store.findByMeeting(lease.meetingId)).rejects.toThrow(
      "invalid response",
    );
  });

  it("maps owner conflicts and missing leases without throwing", async () => {
    const coordinator = stubWith([
      Response.json({ kind: "owner_mismatch" }, { status: 409 }),
      Response.json({ kind: "missing" }, { status: 404 }),
      Response.json({ kind: "owner_mismatch" }, { status: 409 }),
    ]);
    const store = new MeetingCoordinatorApiKeyLeaseStore(
      lease.meetingId,
      coordinator,
    );

    await expect(store.configure(lease)).resolves.toEqual({
      kind: "owner_mismatch",
    });
    await expect(store.findByMeeting(lease.meetingId)).resolves.toBeUndefined();
    await expect(
      store.clear({
        meetingId: lease.meetingId,
        ownerParticipantId: lease.ownerParticipantId,
        ownerSessionId: lease.ownerSessionId,
      }),
    ).resolves.toEqual({ kind: "owner_mismatch" });
  });
});
