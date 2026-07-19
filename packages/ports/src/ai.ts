export interface AiRequest<TInput> {
  readonly input: TInput;
  readonly meetingId: string;
  readonly model: string;
  readonly ownerParticipantId?: string;
  readonly promptVersion: string;
  readonly visibility: "private" | "shared";
}

export interface AiResult<TCandidate> {
  readonly candidate: TCandidate;
  readonly model: string;
  readonly promptVersion: string;
  readonly references: readonly string[];
  readonly usage: {
    readonly inputTokens: number;
    readonly outputTokens: number;
  };
}

export interface AiGateway<TInput = unknown, TCandidate = unknown> {
  generateCandidate(request: AiRequest<TInput>): Promise<AiResult<TCandidate>>;
}

export type RealtimeChannel = "private" | "shared";

export interface RealtimeSecret {
  readonly channel: RealtimeChannel;
  readonly expiresAt: string;
  readonly model: string;
  readonly value: string;
}

export interface RealtimeSecretIssuer {
  issue(input: {
    readonly apiKey: string;
    readonly channel: RealtimeChannel;
    readonly meetingId: string;
    readonly ownerParticipantId?: string | undefined;
    readonly safetyIdentifier: string;
    readonly sessionId: string;
  }): Promise<RealtimeSecret>;
}

export interface ManagedRealtimeSecretIssuer {
  issue(input: {
    readonly channel: RealtimeChannel;
    readonly meetingId: string;
    readonly ownerParticipantId?: string | undefined;
    readonly safetyIdentifier: string;
    readonly sessionId: string;
  }): Promise<RealtimeSecret>;
}

export interface ManagedRealtimeCall {
  readonly callId: string;
  readonly channel: RealtimeChannel;
  readonly model: string;
  readonly sdpAnswer: string;
}

/**
 * Server-owned Realtime WebRTC initialization boundary.
 *
 * The standard provider key and provider call identifier stay behind this
 * interface. Product identifiers are deliberately absent so an adapter cannot
 * forward meeting, participant, or application-session identifiers upstream.
 */
export interface ManagedRealtimeCallConnector {
  connect(
    input: {
      readonly channel: RealtimeChannel;
      readonly safetyIdentifier: string;
      readonly sdpOffer: string;
    },
    onAccepted?: (callId: string) => Promise<void> | void,
  ): Promise<ManagedRealtimeCall>;
}

/**
 * Server-owned Realtime call termination boundary.
 *
 * Provider call identifiers must remain server-side. Implementations must use
 * the provider's authenticated call-control endpoint and must not serialize
 * provider credentials or response bodies into errors.
 */
export interface ManagedRealtimeCallTerminator {
  hangup(callId: string): Promise<void>;
}

export interface ManagedRealtimeSidebandDisconnect {
  readonly clean: boolean;
  readonly initiatedByServer: boolean;
}

export interface ManagedRealtimeSidebandObserver {
  onDisconnect(event: ManagedRealtimeSidebandDisconnect): Promise<void>;
  onProviderEvent(event: unknown): Promise<void>;
}

export interface ManagedRealtimeSidebandConnection {
  cancelResponse(): void;
  close(): void;
  createResponse(): void;
  isHealthy(): boolean;
}

/**
 * Server-owned observer for an accepted provider Realtime call.
 *
 * Implementations must authenticate directly to the fixed provider origin,
 * retain the provider key and raw frames only transiently, preserve message
 * order, and project frames into content-free accounting state.
 */
export interface ManagedRealtimeSidebandConnector {
  connect(
    callId: string,
    observer: ManagedRealtimeSidebandObserver,
  ): Promise<ManagedRealtimeSidebandConnection>;
}

export interface MeetingApiKeyLease {
  readonly apiKey: string;
  readonly heartbeatAt: string;
  readonly meetingId: string;
  readonly ownerParticipantId: string;
  readonly ownerSessionId: string;
}

export type MeetingApiKeyLeaseConfigureResult =
  | {
      readonly kind: "configured";
    }
  | {
      readonly kind: "owner_mismatch";
    };

export type MeetingApiKeyLeaseMutationResult =
  | {
      readonly kind: "applied";
    }
  | {
      readonly kind: "missing" | "owner_mismatch";
    };

/**
 * Transient-memory boundary for standard BYOK credentials.
 *
 * Implementations must not persist, log, publish, or serialize leases. An
 * active lease may only be replaced, renewed, or cleared by its owning
 * facilitator session.
 */
export interface MeetingApiKeyLeaseStore {
  clear(input: {
    readonly meetingId: string;
    readonly ownerParticipantId: string;
    readonly ownerSessionId: string;
  }): Promise<MeetingApiKeyLeaseMutationResult>;

  clearBySession(sessionId: string): Promise<void>;

  configure(
    lease: MeetingApiKeyLease,
  ): Promise<MeetingApiKeyLeaseConfigureResult>;

  findByMeeting(meetingId: string): Promise<MeetingApiKeyLease | undefined>;

  heartbeat(input: {
    readonly heartbeatAt: string;
    readonly meetingId: string;
    readonly ownerParticipantId: string;
    readonly ownerSessionId: string;
  }): Promise<MeetingApiKeyLeaseMutationResult>;
}
