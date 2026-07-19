import { describe, expect, it } from "vitest";

import {
  DISPLAY_TOKEN_TTL_MS,
  authorizeDisplayToken,
  issueDisplayToken,
  revokeDisplayToken,
  type DisplayTokenDependencies,
} from "../../../packages/application/src/index.js";
import { userAuthorizationContext } from "../../../packages/application/src/sessions.js";
import {
  nonEmptyText,
  resetRequestId,
  type DomainEvent,
} from "../../../packages/domain/src/index.js";
import {
  DeterministicSessionTokenIssuer,
  MutableClock,
  SequenceIdGenerator,
} from "../../helpers/application-adapters.js";
import { InMemoryEventStore } from "../../helpers/in-memory-ports.js";
import { ids, sharedEvent } from "../domain/fixtures.js";

const NOW = "2026-07-19T12:00:00.000Z";

function facilitatorContext() {
  return userAuthorizationContext({
    meetingId: ids.meeting,
    participantId: ids.facilitator,
    role: "facilitator",
    sessionId: "session-facilitator",
    userId: "user-facilitator",
  });
}

function participantContext() {
  return userAuthorizationContext({
    meetingId: ids.meeting,
    participantId: ids.legal,
    role: "participant",
    sessionId: "session-participant",
    userId: "user-participant",
  });
}

function fixture() {
  const clock = new MutableClock(NOW);
  const events = new InMemoryEventStore<DomainEvent>();
  const tokens = new DeterministicSessionTokenIssuer();
  const dependencies: DisplayTokenDependencies = {
    clock,
    events,
    ids: new SequenceIdGenerator(),
    tokens,
  };
  return { clock, dependencies, events, tokens };
}

describe("display token application boundary", () => {
  it("issues only for a facilitator and stores the digest instead of the raw token", async () => {
    const { dependencies, events } = fixture();
    await expect(
      issueDisplayToken(dependencies, participantContext(), {
        expectedPosition: 0,
        meetingId: ids.meeting,
      }),
    ).resolves.toEqual({ code: "FORBIDDEN", kind: "failed" });

    const result = await issueDisplayToken(dependencies, facilitatorContext(), {
      correlationId: "correlation-display-issue",
      expectedPosition: 0,
      meetingId: ids.meeting,
    });
    expect(result).toMatchObject({
      correlationId: "correlation-display-issue",
      kind: "issued",
      position: 1,
    });
    if (result.kind !== "issued") {
      throw new Error("Expected a display token");
    }
    expect(Date.parse(result.expiresAt) - Date.parse(NOW)).toBe(
      DISPLAY_TOKEN_TTL_MS,
    );
    const serializedEvents = JSON.stringify(await events.load(ids.meeting));
    expect(serializedEvents).toContain(result.displayTokenId);
    expect(serializedEvents).not.toContain(result.displayToken);
    await expect(
      authorizeDisplayToken(dependencies, {
        displayToken: result.displayToken,
        meetingId: ids.meeting,
      }),
    ).resolves.toMatchObject({
      authorization: {
        displayTokenId: result.displayTokenId,
        kind: "display",
        meetingId: ids.meeting,
      },
      expiresAt: result.expiresAt,
      kind: "authorized",
    });
  });

  it("rotates an existing token and rejects the old credential", async () => {
    const { dependencies } = fixture();
    const first = await issueDisplayToken(dependencies, facilitatorContext(), {
      expectedPosition: 0,
      meetingId: ids.meeting,
    });
    if (first.kind !== "issued") {
      throw new Error("Expected the first display token");
    }
    const second = await issueDisplayToken(dependencies, facilitatorContext(), {
      expectedPosition: 1,
      meetingId: ids.meeting,
    });
    expect(second).toMatchObject({ kind: "issued", position: 3 });
    if (second.kind !== "issued") {
      throw new Error("Expected the rotated display token");
    }

    await expect(
      authorizeDisplayToken(dependencies, {
        displayToken: first.displayToken,
        meetingId: ids.meeting,
      }),
    ).resolves.toEqual({
      code: "DISPLAY_TOKEN_EXPIRED",
      kind: "failed",
    });
    await expect(
      authorizeDisplayToken(dependencies, {
        displayToken: second.displayToken,
        meetingId: ids.meeting,
      }),
    ).resolves.toMatchObject({ kind: "authorized" });
  });

  it("revokes an active token and denies wrong-meeting and expired credentials", async () => {
    const { clock, dependencies } = fixture();
    const issued = await issueDisplayToken(dependencies, facilitatorContext(), {
      expectedPosition: 0,
      meetingId: ids.meeting,
    });
    if (issued.kind !== "issued") {
      throw new Error("Expected a display token");
    }

    await expect(
      authorizeDisplayToken(dependencies, {
        displayToken: issued.displayToken,
        meetingId: "meeting-other",
      }),
    ).resolves.toEqual({
      code: "DISPLAY_TOKEN_EXPIRED",
      kind: "failed",
    });
    const revoked = await revokeDisplayToken(
      dependencies,
      facilitatorContext(),
      {
        displayTokenId: issued.displayTokenId,
        expectedPosition: 1,
        meetingId: ids.meeting,
      },
    );
    expect(revoked).toMatchObject({
      displayTokenId: issued.displayTokenId,
      kind: "revoked",
      position: 2,
      revokedAt: NOW,
    });
    await expect(
      authorizeDisplayToken(dependencies, {
        displayToken: issued.displayToken,
        meetingId: ids.meeting,
      }),
    ).resolves.toMatchObject({ code: "DISPLAY_TOKEN_EXPIRED" });

    const expiring = await issueDisplayToken(
      dependencies,
      facilitatorContext(),
      {
        expectedPosition: 2,
        meetingId: ids.meeting,
      },
    );
    if (expiring.kind !== "issued") {
      throw new Error("Expected an expiring display token");
    }
    clock.advance(DISPLAY_TOKEN_TTL_MS);
    await expect(
      authorizeDisplayToken(dependencies, {
        displayToken: expiring.displayToken,
        meetingId: ids.meeting,
      }),
    ).resolves.toMatchObject({ code: "DISPLAY_TOKEN_EXPIRED" });
  });

  it("returns optimistic conflicts without appending a token", async () => {
    const { dependencies, events } = fixture();
    await expect(
      issueDisplayToken(dependencies, facilitatorContext(), {
        expectedPosition: 1,
        meetingId: ids.meeting,
      }),
    ).resolves.toEqual({
      actualPosition: 0,
      code: "CONFLICT",
      expectedPosition: 1,
      kind: "failed",
    });
    await expect(events.position(ids.meeting)).resolves.toBe(0);
  });

  it("invalidates every prior display credential when the staged meeting resets", async () => {
    const { dependencies, events } = fixture();
    const issued = await issueDisplayToken(dependencies, facilitatorContext(), {
      expectedPosition: 0,
      meetingId: ids.meeting,
    });
    if (issued.kind !== "issued") {
      throw new Error("Expected a display token");
    }
    await events.append({
      events: [
        sharedEvent("DemoResetCompleted", 2, {
          resetRequestId: resetRequestId("reset-display-tokens"),
          seedName: nonEmptyText("flagship"),
        }),
      ],
      expectedPosition: 1,
      idempotencyKey: "reset-display-tokens",
      meetingId: ids.meeting,
    });

    await expect(
      authorizeDisplayToken(dependencies, {
        displayToken: issued.displayToken,
        meetingId: ids.meeting,
      }),
    ).resolves.toEqual({
      code: "DISPLAY_TOKEN_EXPIRED",
      kind: "failed",
    });
  });
});
