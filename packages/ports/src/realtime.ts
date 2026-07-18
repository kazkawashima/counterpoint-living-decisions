export interface RealtimeMessage<TPayload = unknown> {
  readonly correlationId: string;
  readonly meetingId: string;
  readonly payload: TPayload;
  readonly position: number;
  readonly schemaVersion: string;
  readonly type: string;
  readonly visibility:
    | {
        readonly kind: "shared";
      }
    | {
        readonly kind: "owner_private";
        readonly ownerParticipantId: string;
      };
}

export interface RealtimePublisher {
  publish<TPayload>(message: RealtimeMessage<TPayload>): Promise<void>;
}
