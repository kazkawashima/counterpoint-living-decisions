import { expect } from "vitest";

import type {
  SessionRecord,
  SessionRepository,
} from "../../packages/ports/src/index.js";

export async function sessionRepositoryContract(
  createRepository: () => SessionRepository,
): Promise<void> {
  const repository = createRepository();
  const session: SessionRecord = {
    absoluteExpiresAt: "2026-07-19T08:00:00.000Z",
    createdAt: "2026-07-19T00:00:00.000Z",
    lastActivityAt: "2026-07-19T00:00:00.000Z",
    sessionId: "session-a",
    tokenHash: "token-hash-a",
    userId: "user-a",
  };
  await repository.put(session);

  await expect(repository.findById(session.sessionId)).resolves.toEqual(
    session,
  );
  await expect(repository.findByTokenHash(session.tokenHash)).resolves.toEqual(
    session,
  );
  await expect(repository.findById("session-missing")).resolves.toBeUndefined();

  const touchedAt = "2026-07-19T01:00:00.000Z";
  await repository.touch(session.sessionId, touchedAt);
  await expect(repository.findById(session.sessionId)).resolves.toMatchObject({
    lastActivityAt: touchedAt,
  });

  const revokedAt = "2026-07-19T02:00:00.000Z";
  await repository.revoke(session.sessionId, revokedAt);
  await expect(repository.findById(session.sessionId)).resolves.toMatchObject({
    revokedAt,
  });
}
