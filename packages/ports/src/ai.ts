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

export interface RealtimeSecret {
  readonly channel: "private" | "shared";
  readonly expiresAt: string;
  readonly value: string;
}

export interface RealtimeSecretIssuer {
  issue(input: {
    readonly channel: "private" | "shared";
    readonly meetingId: string;
    readonly ownerParticipantId?: string;
    readonly sessionId: string;
  }): Promise<RealtimeSecret>;
}
