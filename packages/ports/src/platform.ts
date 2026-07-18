export interface Clock {
  now(): string;
}

export interface IdGenerator {
  next(namespace: string): string;
}

export interface PasswordVerifier {
  verify(password: string, encodedHash: string): Promise<boolean>;
}

export interface SessionToken {
  readonly hash: string;
  readonly value: string;
}

export interface SessionTokenIssuer {
  digest(value: string): Promise<string>;
  issue(): Promise<SessionToken>;
}

export interface UsageSubject {
  readonly accountId: string;
  readonly ipAddress: string;
  readonly meetingId: string;
}

export interface UsageRequest {
  readonly estimatedCostUsd: number;
  readonly estimatedInputTokens: number;
  readonly estimatedOutputTokens: number;
  readonly generationCount: number;
  readonly realtimeSeconds: number;
}

export type UsageDecision =
  | {
      readonly kind: "allowed";
      readonly reservationId: string;
    }
  | {
      readonly kind: "denied";
      readonly limit:
        | "account"
        | "concurrency"
        | "cost"
        | "generation"
        | "ip"
        | "meeting"
        | "realtime"
        | "tokens";
    };

export interface UsageLimiter {
  finalize(reservationId: string, actual: UsageRequest): Promise<void>;

  release(reservationId: string): Promise<void>;

  reserve(subject: UsageSubject, request: UsageRequest): Promise<UsageDecision>;
}

export interface StructuredLogEntry {
  readonly correlationId?: string;
  readonly event: string;
  readonly level: "debug" | "info" | "warn" | "error";
  readonly meetingId?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface StructuredLogger {
  log(entry: StructuredLogEntry): void;
}

export interface WebhookVerificationInput {
  readonly rawBody: Uint8Array;
  readonly signature: string;
  readonly timestamp: string;
}

export type WebhookVerificationResult =
  | {
      readonly kind: "valid";
      readonly payloadHash: string;
    }
  | {
      readonly kind: "invalid";
      readonly reason: "expired" | "malformed" | "mismatch" | "replay";
    };

export interface WebhookVerifier {
  verify(input: WebhookVerificationInput): Promise<WebhookVerificationResult>;
}
