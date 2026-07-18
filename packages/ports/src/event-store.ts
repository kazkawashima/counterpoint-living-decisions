export interface EventRecord<TEvent> {
  readonly event: TEvent;
  readonly position: number;
}

export interface AppendEventsRequest<TEvent> {
  readonly events: readonly TEvent[];
  readonly expectedPosition?: number;
  readonly idempotencyKey?: string;
  readonly meetingId: string;
  readonly payloadFingerprint?: string;
}

export type AppendEventsResult<TEvent> =
  | {
      readonly kind: "appended";
      readonly records: readonly EventRecord<TEvent>[];
    }
  | {
      readonly kind: "replayed";
      readonly records: readonly EventRecord<TEvent>[];
    };

export type AppendEventsFailure =
  | {
      readonly actualPosition: number;
      readonly expectedPosition: number;
      readonly kind: "position_conflict";
    }
  | {
      readonly idempotencyKey: string;
      readonly kind: "idempotency_conflict";
    };

export interface EventStore<TEvent> {
  append(
    request: AppendEventsRequest<TEvent>,
  ): Promise<AppendEventsFailure | AppendEventsResult<TEvent>>;

  load(
    meetingId: string,
    options?: {
      readonly afterPosition?: number;
    },
  ): Promise<readonly EventRecord<TEvent>[]>;

  position(meetingId: string): Promise<number>;
}
