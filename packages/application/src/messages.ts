import type { AuthorizationContext } from "./authorization.js";

export interface Command<TName extends string, TPayload> {
  readonly authorization: AuthorizationContext;
  readonly correlationId: string;
  readonly expectedPosition?: number;
  readonly idempotencyKey?: string;
  readonly meetingId: string;
  readonly name: TName;
  readonly payload: TPayload;
}

export interface Query<TName extends string, TParameters> {
  readonly authorization: AuthorizationContext;
  readonly correlationId: string;
  readonly meetingId: string;
  readonly name: TName;
  readonly parameters: TParameters;
}

export type CommandResult<TValue> =
  | {
      readonly kind: "accepted";
      readonly position: number;
      readonly value: TValue;
    }
  | {
      readonly code:
        | "CONFLICT"
        | "FORBIDDEN"
        | "IDEMPOTENCY_CONFLICT"
        | "INVALID_STATE_TRANSITION"
        | "VALIDATION_FAILED";
      readonly kind: "rejected";
      readonly retryable: boolean;
    };

export type QueryResult<TValue> =
  | {
      readonly kind: "found";
      readonly value: TValue;
    }
  | {
      readonly code: "FORBIDDEN" | "MEETING_NOT_FOUND";
      readonly kind: "not_found";
    };

export interface CommandHandler<TName extends string, TPayload, TValue> {
  execute(command: Command<TName, TPayload>): Promise<CommandResult<TValue>>;
}

export interface QueryHandler<TName extends string, TParameters, TValue> {
  execute(query: Query<TName, TParameters>): Promise<QueryResult<TValue>>;
}
