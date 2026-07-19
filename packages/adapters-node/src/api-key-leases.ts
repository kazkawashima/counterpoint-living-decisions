import { MEETING_API_KEY_LEASE_TTL_MS } from "@counterpoint/application";
import type {
  MeetingApiKeyLease,
  MeetingApiKeyLeaseConfigureResult,
  MeetingApiKeyLeaseMutationResult,
  MeetingApiKeyLeaseStore,
} from "@counterpoint/ports";

export interface NodeMeetingApiKeyLeaseStoreOptions {
  readonly leaseTtlMs?: number;
  readonly now?: () => number;
}

/**
 * Process-memory-only storage for facilitator-provided standard API keys.
 *
 * The expiry timer is deliberate: an abandoned key is physically removed even
 * when no later request arrives to discover that its lease expired.
 */
export class NodeMeetingApiKeyLeaseStore implements MeetingApiKeyLeaseStore {
  readonly #leases = new Map<string, MeetingApiKeyLease>();
  readonly #leaseTtlMs: number;
  readonly #now: () => number;
  readonly #timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(options: NodeMeetingApiKeyLeaseStoreOptions = {}) {
    this.#leaseTtlMs = options.leaseTtlMs ?? MEETING_API_KEY_LEASE_TTL_MS;
    this.#now = options.now ?? Date.now;
  }

  clear(input: {
    readonly meetingId: string;
    readonly ownerParticipantId: string;
    readonly ownerSessionId: string;
  }): Promise<MeetingApiKeyLeaseMutationResult> {
    const lease = this.#leases.get(input.meetingId);
    if (lease === undefined) {
      return Promise.resolve({ kind: "missing" });
    }
    if (!this.#isOwner(lease, input)) {
      return Promise.resolve({ kind: "owner_mismatch" });
    }
    this.#delete(input.meetingId);
    return Promise.resolve({ kind: "applied" });
  }

  clearBySession(sessionId: string): Promise<void> {
    for (const [meetingId, lease] of this.#leases) {
      if (lease.ownerSessionId === sessionId) {
        this.#delete(meetingId);
      }
    }
    return Promise.resolve();
  }

  close(): void {
    for (const timer of this.#timers.values()) {
      clearTimeout(timer);
    }
    this.#timers.clear();
    this.#leases.clear();
  }

  configure(
    lease: MeetingApiKeyLease,
  ): Promise<MeetingApiKeyLeaseConfigureResult> {
    const existing = this.#leases.get(lease.meetingId);
    if (existing !== undefined && !this.#isOwner(existing, lease)) {
      return Promise.resolve({ kind: "owner_mismatch" });
    }
    this.#leases.set(lease.meetingId, lease);
    this.#scheduleExpiry(lease);
    return Promise.resolve({ kind: "configured" });
  }

  findByMeeting(meetingId: string): Promise<MeetingApiKeyLease | undefined> {
    return Promise.resolve(this.#leases.get(meetingId));
  }

  heartbeat(input: {
    readonly heartbeatAt: string;
    readonly meetingId: string;
    readonly ownerParticipantId: string;
    readonly ownerSessionId: string;
  }): Promise<MeetingApiKeyLeaseMutationResult> {
    const lease = this.#leases.get(input.meetingId);
    if (lease === undefined) {
      return Promise.resolve({ kind: "missing" });
    }
    if (!this.#isOwner(lease, input)) {
      return Promise.resolve({ kind: "owner_mismatch" });
    }
    const renewed = { ...lease, heartbeatAt: input.heartbeatAt };
    this.#leases.set(input.meetingId, renewed);
    this.#scheduleExpiry(renewed);
    return Promise.resolve({ kind: "applied" });
  }

  #delete(meetingId: string): void {
    const timer = this.#timers.get(meetingId);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.#timers.delete(meetingId);
    }
    this.#leases.delete(meetingId);
  }

  #isOwner(
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

  #scheduleExpiry(lease: MeetingApiKeyLease): void {
    const heartbeatMs = Date.parse(lease.heartbeatAt);
    if (!Number.isFinite(heartbeatMs)) {
      throw new TypeError("Meeting API-key lease heartbeat must be ISO-8601");
    }
    const previous = this.#timers.get(lease.meetingId);
    if (previous !== undefined) {
      clearTimeout(previous);
    }
    const delay = Math.max(0, heartbeatMs + this.#leaseTtlMs - this.#now());
    const timer = setTimeout(() => {
      const current = this.#leases.get(lease.meetingId);
      if (
        current?.heartbeatAt === lease.heartbeatAt &&
        this.#isOwner(current, lease)
      ) {
        this.#leases.delete(lease.meetingId);
        this.#timers.delete(lease.meetingId);
      }
    }, delay);
    timer.unref();
    this.#timers.set(lease.meetingId, timer);
  }
}
