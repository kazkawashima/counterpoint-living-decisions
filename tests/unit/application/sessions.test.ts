import { describe, expect, it } from "vitest";

import {
  SESSION_ABSOLUTE_MS,
  SESSION_INACTIVITY_MS,
  authenticateSession,
  authenticateSessionById,
  login,
  logout,
} from "../../../packages/application/src/index.js";
import {
  DeterministicSessionTokenIssuer,
  InMemoryIdentityRepository,
  InMemorySessionRepository,
  MutableClock,
  PlaintextFixturePasswordVerifier,
  SequenceIdGenerator,
} from "../../helpers/application-adapters.js";

function dependencies() {
  return {
    clock: new MutableClock("2026-07-19T00:00:00.000Z"),
    identities: new InMemoryIdentityRepository([
      {
        active: true,
        passwordHash: "fixture:facilitator-password",
        userId: "user-facilitator",
      },
      {
        active: false,
        passwordHash: "fixture:disabled-password",
        userId: "user-disabled",
      },
    ]),
    ids: new SequenceIdGenerator(),
    passwords: new PlaintextFixturePasswordVerifier(),
    sessions: new InMemorySessionRepository(),
    tokens: new DeterministicSessionTokenIssuer(),
  };
}

async function loginFixture(ports: ReturnType<typeof dependencies>) {
  const result = await login(ports, {
    password: "facilitator-password",
    userId: "user-facilitator",
  });
  if (result.kind !== "authenticated") {
    throw new Error("Fixture login failed");
  }
  const session = await ports.sessions.findByTokenHash(
    await ports.tokens.digest(result.bearerToken),
  );
  if (session === undefined) {
    throw new Error("Fixture session was not persisted");
  }
  return { result, session };
}

describe("fixed-user session lifecycle", () => {
  it("issues a hashed, non-exclusive Bearer session for valid credentials", async () => {
    const ports = dependencies();
    const first = await login(ports, {
      password: "facilitator-password",
      userId: "user-facilitator",
    });
    const second = await login(ports, {
      password: "facilitator-password",
      userId: "user-facilitator",
    });

    expect(first.kind).toBe("authenticated");
    expect(second.kind).toBe("authenticated");
    if (first.kind === "authenticated" && second.kind === "authenticated") {
      expect(first.bearerToken).not.toBe(second.bearerToken);
      const stored = await ports.sessions.findByTokenHash(
        await ports.tokens.digest(first.bearerToken),
      );
      expect(stored).toMatchObject({
        userId: "user-facilitator",
      });
      expect(stored?.tokenHash).not.toBe(first.bearerToken);
      expect(JSON.stringify(stored)).not.toContain(first.bearerToken);
    }
  });

  it("returns the same non-disclosing failure for bad, unknown, and disabled users", async () => {
    const ports = dependencies();

    await expect(
      login(ports, {
        password: "wrong",
        userId: "user-facilitator",
      }),
    ).resolves.toEqual({
      code: "AUTHENTICATION_REQUIRED",
      kind: "rejected",
    });
    await expect(
      login(ports, { password: "anything", userId: "user-unknown" }),
    ).resolves.toEqual({
      code: "AUTHENTICATION_REQUIRED",
      kind: "rejected",
    });
    await expect(
      login(ports, {
        password: "disabled-password",
        userId: "user-disabled",
      }),
    ).resolves.toEqual({
      code: "AUTHENTICATION_REQUIRED",
      kind: "rejected",
    });
  });

  it("expires after two hours of inactivity and revokes the session", async () => {
    const ports = dependencies();
    const result = await login(ports, {
      password: "facilitator-password",
      userId: "user-facilitator",
    });
    if (result.kind !== "authenticated") {
      throw new Error("Fixture login failed");
    }

    ports.clock.advance(SESSION_INACTIVITY_MS);
    await expect(
      authenticateSession(ports, result.bearerToken),
    ).resolves.toEqual({
      code: "SESSION_EXPIRED",
      kind: "rejected",
    });
    const stored = await ports.sessions.findByTokenHash(
      await ports.tokens.digest(result.bearerToken),
    );
    expect(stored?.revokedAt).toBeDefined();
  });

  it("touches activity but still enforces the eight-hour absolute expiry", async () => {
    const ports = dependencies();
    const result = await login(ports, {
      password: "facilitator-password",
      userId: "user-facilitator",
    });
    if (result.kind !== "authenticated") {
      throw new Error("Fixture login failed");
    }

    for (
      let elapsed = SESSION_INACTIVITY_MS / 2;
      elapsed < SESSION_ABSOLUTE_MS;
      elapsed += SESSION_INACTIVITY_MS / 2
    ) {
      ports.clock.advance(SESSION_INACTIVITY_MS / 2);
      const auth = await authenticateSession(ports, result.bearerToken);
      if (elapsed < SESSION_ABSOLUTE_MS) {
        expect(auth.kind).toBe("authenticated");
      }
    }
    ports.clock.advance(SESSION_INACTIVITY_MS / 2);

    await expect(
      authenticateSession(ports, result.bearerToken),
    ).resolves.toEqual({
      code: "SESSION_EXPIRED",
      kind: "rejected",
    });
  });

  it("revokes on logout without revealing whether an unknown token existed", async () => {
    const ports = dependencies();
    const result = await login(ports, {
      password: "facilitator-password",
      userId: "user-facilitator",
    });
    if (result.kind !== "authenticated") {
      throw new Error("Fixture login failed");
    }

    await logout(ports, result.bearerToken);
    await logout(ports, "unknown-token");

    await expect(
      authenticateSession(ports, result.bearerToken),
    ).resolves.toEqual({
      code: "AUTHENTICATION_REQUIRED",
      kind: "rejected",
    });
  });
});

describe("session-id revalidation", () => {
  it("authenticates an active session without its Bearer token", async () => {
    const ports = dependencies();
    const { session } = await loginFixture(ports);

    ports.clock.advance(SESSION_INACTIVITY_MS / 2);
    await expect(
      authenticateSessionById(ports, session.sessionId),
    ).resolves.toMatchObject({
      kind: "authenticated",
      session: {
        sessionId: session.sessionId,
        userId: session.userId,
      },
    });
  });

  it("rejects a revoked session without touching it", async () => {
    const ports = dependencies();
    const { session } = await loginFixture(ports);
    const revokedAt = ports.clock.now();
    await ports.sessions.revoke(session.sessionId, revokedAt);

    ports.clock.advance(1_000);
    await expect(
      authenticateSessionById(ports, session.sessionId),
    ).resolves.toEqual({
      code: "AUTHENTICATION_REQUIRED",
      kind: "rejected",
    });
    await expect(
      ports.sessions.findById(session.sessionId),
    ).resolves.toMatchObject({
      lastActivityAt: session.lastActivityAt,
      revokedAt,
    });
  });

  it("revokes a session at its absolute expiry", async () => {
    const ports = dependencies();
    const { session } = await loginFixture(ports);

    for (
      let elapsed = SESSION_INACTIVITY_MS / 2;
      elapsed < SESSION_ABSOLUTE_MS;
      elapsed += SESSION_INACTIVITY_MS / 2
    ) {
      ports.clock.advance(SESSION_INACTIVITY_MS / 2);
      await expect(
        authenticateSessionById(ports, session.sessionId),
      ).resolves.toMatchObject({ kind: "authenticated" });
    }

    ports.clock.advance(SESSION_INACTIVITY_MS / 2);
    await expect(
      authenticateSessionById(ports, session.sessionId),
    ).resolves.toEqual({
      code: "SESSION_EXPIRED",
      kind: "rejected",
    });
    await expect(
      ports.sessions.findById(session.sessionId),
    ).resolves.toMatchObject({
      revokedAt: ports.clock.now(),
    });
  });

  it("revokes a session at its inactivity expiry", async () => {
    const ports = dependencies();
    const { session } = await loginFixture(ports);

    ports.clock.advance(SESSION_INACTIVITY_MS);
    await expect(
      authenticateSessionById(ports, session.sessionId),
    ).resolves.toEqual({
      code: "SESSION_EXPIRED",
      kind: "rejected",
    });
    await expect(
      ports.sessions.findById(session.sessionId),
    ).resolves.toMatchObject({
      revokedAt: ports.clock.now(),
    });
  });

  it("touches successful revalidation and extends inactivity", async () => {
    const ports = dependencies();
    const { session } = await loginFixture(ports);

    ports.clock.advance(SESSION_INACTIVITY_MS / 2);
    const touchedAt = ports.clock.now();
    await authenticateSessionById(ports, session.sessionId);
    await expect(
      ports.sessions.findById(session.sessionId),
    ).resolves.toMatchObject({
      lastActivityAt: touchedAt,
    });

    ports.clock.advance((SESSION_INACTIVITY_MS * 3) / 4);
    await expect(
      authenticateSessionById(ports, session.sessionId),
    ).resolves.toMatchObject({ kind: "authenticated" });
  });

  it("supports passive revalidation without extending inactivity", async () => {
    const ports = dependencies();
    const { session } = await loginFixture(ports);

    ports.clock.advance(SESSION_INACTIVITY_MS / 2);
    await expect(
      authenticateSessionById(ports, session.sessionId, {
        touchActivity: false,
      }),
    ).resolves.toMatchObject({
      kind: "authenticated",
      session: { lastActivityAt: session.lastActivityAt },
    });
    await expect(
      ports.sessions.findById(session.sessionId),
    ).resolves.toMatchObject({
      lastActivityAt: session.lastActivityAt,
    });

    ports.clock.advance(SESSION_INACTIVITY_MS / 2);
    await expect(
      authenticateSessionById(ports, session.sessionId, {
        touchActivity: false,
      }),
    ).resolves.toEqual({
      code: "SESSION_EXPIRED",
      kind: "rejected",
    });
  });
});
