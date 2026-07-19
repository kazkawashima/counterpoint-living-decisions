import { NodeMeetingApiKeyLeaseStore } from "@counterpoint/adapters-node";
import type { MeetingApiKeyLease } from "@counterpoint/ports";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const NOW = new Date("2026-07-19T12:00:00.000Z");
const lease: MeetingApiKeyLease = {
  apiKey: "sk-standard-secret-memory-only",
  heartbeatAt: NOW.toISOString(),
  meetingId: "meeting-a",
  ownerParticipantId: "participant-facilitator",
  ownerSessionId: "session-facilitator",
};

describe("NodeMeetingApiKeyLeaseStore", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("physically removes an abandoned key at the five-minute boundary", async () => {
    const store = new NodeMeetingApiKeyLeaseStore();
    await store.configure(lease);

    await vi.advanceTimersByTimeAsync(5 * 60 * 1_000 - 1);
    await expect(store.findByMeeting(lease.meetingId)).resolves.toEqual(lease);

    await vi.advanceTimersByTimeAsync(1);
    await expect(store.findByMeeting(lease.meetingId)).resolves.toBeUndefined();
    store.close();
  });

  it("renews expiry only for the owning facilitator session", async () => {
    const store = new NodeMeetingApiKeyLeaseStore();
    await store.configure(lease);
    await vi.advanceTimersByTimeAsync(4 * 60 * 1_000);

    await expect(
      store.heartbeat({
        ...lease,
        heartbeatAt: new Date(Date.now()).toISOString(),
        ownerSessionId: "session-other",
      }),
    ).resolves.toEqual({ kind: "owner_mismatch" });
    await expect(
      store.heartbeat({
        ...lease,
        heartbeatAt: new Date(Date.now()).toISOString(),
      }),
    ).resolves.toEqual({ kind: "applied" });

    await vi.advanceTimersByTimeAsync(4 * 60 * 1_000);
    await expect(store.findByMeeting(lease.meetingId)).resolves.toBeDefined();
    await vi.advanceTimersByTimeAsync(60 * 1_000);
    await expect(store.findByMeeting(lease.meetingId)).resolves.toBeUndefined();
    store.close();
  });

  it("prevents session takeover and clears all keys on logout", async () => {
    const store = new NodeMeetingApiKeyLeaseStore();
    await store.configure(lease);
    await expect(
      store.configure({
        ...lease,
        apiKey: "sk-session-takeover-attempt",
        ownerSessionId: "session-other",
      }),
    ).resolves.toEqual({ kind: "owner_mismatch" });

    await store.configure({ ...lease, meetingId: "meeting-b" });
    await store.configure({
      ...lease,
      meetingId: "meeting-c",
      ownerParticipantId: "participant-other",
      ownerSessionId: "session-other",
    });
    await store.clearBySession(lease.ownerSessionId);

    await expect(store.findByMeeting("meeting-a")).resolves.toBeUndefined();
    await expect(store.findByMeeting("meeting-b")).resolves.toBeUndefined();
    await expect(store.findByMeeting("meeting-c")).resolves.toBeDefined();
    store.close();
  });
});
