/// <reference types="@cloudflare/workers-types" />

export type ManagedRealtimeCallChannel = "private" | "shared";

export interface ManagedRealtimeCallOwnership {
  readonly accountId: string;
  readonly channel: ManagedRealtimeCallChannel;
  readonly createdAtEpoch: number;
  readonly expiresAtEpoch: number;
  readonly managedCallId: string;
  readonly meetingId: string;
  readonly participantId: string;
  readonly reservationId: string;
  readonly sessionId: string;
  readonly userId: string;
}

export interface ManagedRealtimeCallOwner {
  readonly managedCallId: string;
  readonly meetingId: string;
  readonly participantId: string;
  readonly sessionId: string;
  readonly userId: string;
}

export interface ManagedRealtimeStartClaim {
  readonly createdAtEpoch: number;
  readonly expiresAtEpoch: number;
  readonly managedCallId: string;
  readonly meetingId: string;
  readonly participantId: string;
  readonly requestFingerprint: string;
  readonly sessionId: string;
  readonly startKeyHash: string;
  readonly userId: string;
}

export type ManagedRealtimeStartClaimResult =
  "claimed" | "conflict" | "replayed" | "unavailable";

interface ManagedRealtimeCallRow {
  readonly account_id: string;
  readonly channel: ManagedRealtimeCallChannel;
  readonly created_at_epoch: number;
  readonly expires_at_epoch: number;
  readonly managed_call_id: string;
  readonly meeting_id: string;
  readonly participant_id: string;
  readonly reservation_id: string;
  readonly session_id: string;
  readonly user_id: string;
}

interface ManagedRealtimeStartClaimRow {
  readonly expires_at_epoch: number;
  readonly managed_call_id: string;
  readonly meeting_id: string;
  readonly participant_id: string;
  readonly request_fingerprint: string;
  readonly session_id: string;
  readonly user_id: string;
}

const SHA256_FINGERPRINT_PATTERN = /^sha256:[a-f0-9]{64}$/u;

const CLAIM_START_SQL = `
  INSERT INTO judge_managed_realtime_start_claims (
    start_key_hash,
    request_fingerprint,
    managed_call_id,
    meeting_id,
    user_id,
    session_id,
    participant_id,
    created_at_epoch,
    expires_at_epoch
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(start_key_hash) DO UPDATE SET
    request_fingerprint = excluded.request_fingerprint,
    managed_call_id = excluded.managed_call_id,
    meeting_id = excluded.meeting_id,
    user_id = excluded.user_id,
    session_id = excluded.session_id,
    participant_id = excluded.participant_id,
    created_at_epoch = excluded.created_at_epoch,
    expires_at_epoch = excluded.expires_at_epoch
  WHERE judge_managed_realtime_start_claims.expires_at_epoch
    < excluded.created_at_epoch
`;

const INSERT_OWNERSHIP_SQL = `
  INSERT INTO judge_managed_realtime_calls (
    managed_call_id,
    reservation_id,
    account_id,
    meeting_id,
    user_id,
    session_id,
    participant_id,
    channel,
    status,
    created_at_epoch,
    expires_at_epoch,
    terminated_at_epoch
  )
  SELECT
    ?,
    reservation_id,
    account_id,
    meeting_id,
    ?,
    ?,
    ?,
    ?,
    'active',
    ?,
    ?,
    NULL
  FROM judge_usage_reservations
  WHERE reservation_id = ?
    AND account_id = ?
    AND meeting_id = ?
    AND status = 'reserved'
    AND reserved_at_epoch <= ?
    AND active_until_epoch >= ?
  ON CONFLICT DO NOTHING
`;

function requireOpaque(value: string, label: string): void {
  if (
    value.length === 0 ||
    value.length > 256 ||
    Array.from(value).some((character) => {
      const codePoint = character.codePointAt(0);
      return (
        /\s/u.test(character) ||
        (codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f))
      );
    })
  ) {
    throw new TypeError(`${label} must be an opaque identifier`);
  }
}

function requireEpoch(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative epoch second`);
  }
}

function validateOwner(owner: ManagedRealtimeCallOwner): void {
  requireOpaque(owner.managedCallId, "managedCallId");
  requireOpaque(owner.meetingId, "meetingId");
  requireOpaque(owner.participantId, "participantId");
  requireOpaque(owner.sessionId, "sessionId");
  requireOpaque(owner.userId, "userId");
}

function requireSha256Fingerprint(value: string, label: string): void {
  if (!SHA256_FINGERPRINT_PATTERN.test(value)) {
    throw new TypeError(`${label} must be a sha256 fingerprint`);
  }
}

function ownershipFromRow(
  row: ManagedRealtimeCallRow,
): ManagedRealtimeCallOwnership {
  return {
    accountId: row.account_id,
    channel: row.channel,
    createdAtEpoch: row.created_at_epoch,
    expiresAtEpoch: row.expires_at_epoch,
    managedCallId: row.managed_call_id,
    meetingId: row.meeting_id,
    participantId: row.participant_id,
    reservationId: row.reservation_id,
    sessionId: row.session_id,
    userId: row.user_id,
  };
}

export class D1ManagedRealtimeCallOwnershipRepository {
  readonly #database: D1Database;

  constructor(database: D1Database) {
    this.#database = database;
  }

  async claimStart(
    claim: ManagedRealtimeStartClaim,
  ): Promise<ManagedRealtimeStartClaimResult> {
    requireSha256Fingerprint(claim.startKeyHash, "startKeyHash");
    requireSha256Fingerprint(claim.requestFingerprint, "requestFingerprint");
    requireOpaque(claim.managedCallId, "managedCallId");
    requireOpaque(claim.meetingId, "meetingId");
    requireOpaque(claim.participantId, "participantId");
    requireOpaque(claim.sessionId, "sessionId");
    requireOpaque(claim.userId, "userId");
    requireEpoch(claim.createdAtEpoch, "createdAtEpoch");
    requireEpoch(claim.expiresAtEpoch, "expiresAtEpoch");
    if (claim.expiresAtEpoch < claim.createdAtEpoch) {
      throw new TypeError("expiresAtEpoch must not precede createdAtEpoch");
    }

    const session = this.#database.withSession("first-primary");
    const result = await session
      .prepare(CLAIM_START_SQL)
      .bind(
        claim.startKeyHash,
        claim.requestFingerprint,
        claim.managedCallId,
        claim.meetingId,
        claim.userId,
        claim.sessionId,
        claim.participantId,
        claim.createdAtEpoch,
        claim.expiresAtEpoch,
      )
      .run();
    if (result.meta.changes === 1) {
      return "claimed";
    }
    if (result.meta.changes !== 0) {
      throw new Error(
        "Managed Realtime start claim changed an unexpected row count",
      );
    }

    const existing = await session
      .prepare(
        `
          SELECT
            request_fingerprint,
            managed_call_id,
            meeting_id,
            user_id,
            session_id,
            participant_id,
            expires_at_epoch
          FROM judge_managed_realtime_start_claims
          WHERE start_key_hash = ?
        `,
      )
      .bind(claim.startKeyHash)
      .first<ManagedRealtimeStartClaimRow>();
    if (existing === null) {
      return "unavailable";
    }
    const sameOwner =
      existing.meeting_id === claim.meetingId &&
      existing.user_id === claim.userId &&
      existing.session_id === claim.sessionId &&
      existing.participant_id === claim.participantId;
    return sameOwner &&
      existing.request_fingerprint === claim.requestFingerprint &&
      existing.expires_at_epoch >= claim.createdAtEpoch
      ? "replayed"
      : "conflict";
  }

  async releaseStart(
    claim: ManagedRealtimeStartClaim,
  ): Promise<"released" | "unavailable"> {
    requireSha256Fingerprint(claim.startKeyHash, "startKeyHash");
    requireSha256Fingerprint(claim.requestFingerprint, "requestFingerprint");
    requireOpaque(claim.managedCallId, "managedCallId");
    requireEpoch(claim.createdAtEpoch, "createdAtEpoch");
    const result = await this.#database
      .withSession("first-primary")
      .prepare(
        `
          DELETE FROM judge_managed_realtime_start_claims
          WHERE start_key_hash = ?
            AND request_fingerprint = ?
            AND managed_call_id = ?
            AND created_at_epoch = ?
            AND NOT EXISTS (
              SELECT 1
              FROM judge_managed_realtime_calls
              WHERE managed_call_id = ?
                AND status = 'active'
            )
        `,
      )
      .bind(
        claim.startKeyHash,
        claim.requestFingerprint,
        claim.managedCallId,
        claim.createdAtEpoch,
        claim.managedCallId,
      )
      .run();
    if (result.meta.changes === 1) {
      return "released";
    }
    if (result.meta.changes === 0) {
      return "unavailable";
    }
    throw new Error(
      "Managed Realtime start release changed an unexpected row count",
    );
  }

  async create(
    ownership: ManagedRealtimeCallOwnership,
  ): Promise<"created" | "unavailable"> {
    validateOwner(ownership);
    requireOpaque(ownership.accountId, "accountId");
    requireOpaque(ownership.reservationId, "reservationId");
    if (ownership.accountId !== ownership.userId) {
      throw new TypeError("accountId must match the authenticated user");
    }
    requireEpoch(ownership.createdAtEpoch, "createdAtEpoch");
    requireEpoch(ownership.expiresAtEpoch, "expiresAtEpoch");
    if (ownership.expiresAtEpoch < ownership.createdAtEpoch) {
      throw new TypeError("expiresAtEpoch must not precede createdAtEpoch");
    }
    if (ownership.channel !== "private" && ownership.channel !== "shared") {
      throw new TypeError("channel must be private or shared");
    }

    const result = await this.#database
      .withSession("first-primary")
      .prepare(INSERT_OWNERSHIP_SQL)
      .bind(
        ownership.managedCallId,
        ownership.userId,
        ownership.sessionId,
        ownership.participantId,
        ownership.channel,
        ownership.createdAtEpoch,
        ownership.expiresAtEpoch,
        ownership.reservationId,
        ownership.accountId,
        ownership.meetingId,
        ownership.createdAtEpoch,
        ownership.expiresAtEpoch,
      )
      .run();
    if (result.meta.changes === 1) {
      return "created";
    }
    if (result.meta.changes === 0) {
      return "unavailable";
    }
    throw new Error(
      "Managed Realtime ownership changed an unexpected row count",
    );
  }

  async findActiveOwned(
    owner: ManagedRealtimeCallOwner,
    nowEpoch: number,
  ): Promise<ManagedRealtimeCallOwnership | undefined> {
    validateOwner(owner);
    requireEpoch(nowEpoch, "nowEpoch");
    const row = await this.#database
      .withSession("first-primary")
      .prepare(
        `
          SELECT
            managed_call_id,
            reservation_id,
            account_id,
            meeting_id,
            user_id,
            session_id,
            participant_id,
            channel,
            created_at_epoch,
            expires_at_epoch
          FROM judge_managed_realtime_calls
          WHERE managed_call_id = ?
            AND meeting_id = ?
            AND participant_id = ?
            AND session_id = ?
            AND user_id = ?
            AND status = 'active'
            AND expires_at_epoch >= ?
        `,
      )
      .bind(
        owner.managedCallId,
        owner.meetingId,
        owner.participantId,
        owner.sessionId,
        owner.userId,
        nowEpoch,
      )
      .first<ManagedRealtimeCallRow>();
    return row === null ? undefined : ownershipFromRow(row);
  }

  async terminateOwned(
    owner: ManagedRealtimeCallOwner,
    terminatedAtEpoch: number,
  ): Promise<"terminated" | "unavailable"> {
    validateOwner(owner);
    requireEpoch(terminatedAtEpoch, "terminatedAtEpoch");
    const session = this.#database.withSession("first-primary");
    const result = await session
      .prepare(
        `
          UPDATE judge_managed_realtime_calls
          SET status = 'terminated', terminated_at_epoch = ?
          WHERE managed_call_id = ?
            AND meeting_id = ?
            AND participant_id = ?
            AND session_id = ?
            AND user_id = ?
            AND status = 'active'
            AND created_at_epoch <= ?
        `,
      )
      .bind(
        terminatedAtEpoch,
        owner.managedCallId,
        owner.meetingId,
        owner.participantId,
        owner.sessionId,
        owner.userId,
        terminatedAtEpoch,
      )
      .run();
    if (result.meta.changes === 1) {
      return "terminated";
    }
    if (result.meta.changes !== 0) {
      throw new Error(
        "Managed Realtime termination changed an unexpected row count",
      );
    }
    const existing = await session
      .prepare(
        `
          SELECT terminated_at_epoch
          FROM judge_managed_realtime_calls
          WHERE managed_call_id = ?
            AND meeting_id = ?
            AND participant_id = ?
            AND session_id = ?
            AND user_id = ?
            AND status = 'terminated'
        `,
      )
      .bind(
        owner.managedCallId,
        owner.meetingId,
        owner.participantId,
        owner.sessionId,
        owner.userId,
      )
      .first<{ readonly terminated_at_epoch: number }>();
    return existing === null ? "unavailable" : "terminated";
  }
}
