export { LocalArtifactStore } from "./artifacts.js";
export { NodeArtifactTextExtractor } from "./artifact-text-extractor.js";
export {
  NodeMeetingApiKeyLeaseStore,
  type NodeMeetingApiKeyLeaseStoreOptions,
} from "./api-key-leases.js";
export {
  CryptographicIdGenerator,
  isScryptPasswordHash,
  ScryptPasswordHasher,
  Sha256SessionTokenIssuer,
  SystemClock,
} from "./identity.js";
export { createJsonCodec, type JsonCodec } from "./json-codec.js";
export {
  seedSyntheticUsers,
  SqliteIdentityRepository,
  SqliteMeetingRepository,
  SqliteSessionRepository,
  type SyntheticUserSeed,
} from "./repositories.js";
export {
  applySqliteMigrations,
  CURRENT_SQLITE_MIGRATION_COUNT,
  NodeSqliteDatabase,
  sqliteMigrationCount,
  SqliteEventStore,
  SqliteProjectionStore,
} from "./sqlite.js";
export {
  NodeHmacWebhookVerifier,
  type NodeHmacWebhookVerifierOptions,
} from "./webhook-verifier.js";

export const adaptersNodePackage = "@counterpoint/adapters-node";
