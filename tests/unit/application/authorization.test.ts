import { describe, expect, it } from "vitest";

import {
  authorize,
  type UserAuthorizationContext,
} from "../../../packages/application/src/index.js";

function participantContext(
  overrides: Partial<UserAuthorizationContext> = {},
): UserAuthorizationContext {
  return {
    capabilities: new Set([
      "meeting:read",
      "private:read-own",
      "artifact:create-own",
      "disclosure:propose-own",
      "disclosure:approve-own",
    ]),
    kind: "user",
    meetingId: "meeting-a",
    participantId: "participant-a",
    role: "participant",
    sessionId: "session-a",
    userId: "user-a",
    ...overrides,
  };
}

describe("authorization boundaries", () => {
  it("authorizes an owned private operation", () => {
    expect(
      authorize(participantContext(), {
        capability: "private:read-own",
        meetingId: "meeting-a",
        ownerParticipantId: "participant-a",
      }),
    ).toEqual({ kind: "authorized" });
  });

  it("rejects cross-meeting access before domain validation", () => {
    expect(
      authorize(participantContext(), {
        capability: "meeting:read",
        meetingId: "meeting-b",
      }),
    ).toEqual({ kind: "meeting_scope_mismatch" });
  });

  it("rejects cross-owner private access", () => {
    expect(
      authorize(participantContext(), {
        capability: "private:read-own",
        meetingId: "meeting-a",
        ownerParticipantId: "participant-b",
      }),
    ).toEqual({ kind: "owner_scope_mismatch" });
  });

  it("rejects participant-only missing capabilities", () => {
    expect(
      authorize(participantContext(), {
        capability: "decision:commit",
        meetingId: "meeting-a",
      }),
    ).toEqual({ kind: "forbidden" });
  });
});
