export const capabilities = [
  "meeting:read",
  "private:read-own",
  "artifact:create-own",
  "disclosure:propose-own",
  "disclosure:approve-own",
  "decision:commit",
  "decision:review-confirm",
  "demo:event-inject",
  "demo:reset",
  "byok:configure",
  "judge:managed-ai",
] as const;

export type Capability = (typeof capabilities)[number];

export interface UserAuthorizationContext {
  readonly capabilities: ReadonlySet<Capability>;
  readonly kind: "user";
  readonly meetingId: string;
  readonly participantId: string;
  readonly role: "facilitator" | "participant";
  readonly sessionId: string;
  readonly userId: string;
}

export interface DisplayAuthorizationContext {
  readonly capabilities: ReadonlySet<"meeting:read">;
  readonly displayTokenId: string;
  readonly kind: "display";
  readonly meetingId: string;
}

export type AuthorizationContext =
  DisplayAuthorizationContext | UserAuthorizationContext;

export type AuthorizationFailure =
  | {
      readonly kind: "forbidden";
    }
  | {
      readonly kind: "meeting_scope_mismatch";
    }
  | {
      readonly kind: "owner_scope_mismatch";
    };

export function authorize(
  context: AuthorizationContext,
  request: {
    readonly capability: Capability | "meeting:read";
    readonly meetingId: string;
    readonly ownerParticipantId?: string;
  },
): AuthorizationFailure | { readonly kind: "authorized" } {
  if (context.meetingId !== request.meetingId) {
    return { kind: "meeting_scope_mismatch" };
  }

  if (
    request.ownerParticipantId !== undefined &&
    (context.kind !== "user" ||
      context.participantId !== request.ownerParticipantId)
  ) {
    return { kind: "owner_scope_mismatch" };
  }

  if (!context.capabilities.has(request.capability as "meeting:read")) {
    return { kind: "forbidden" };
  }

  return { kind: "authorized" };
}
