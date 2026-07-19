import { createHash } from "node:crypto";

import {
  CryptographicIdGenerator,
  CURRENT_SQLITE_MIGRATION_COUNT,
  createJsonCodec,
  LocalArtifactStore,
  NodeSqliteDatabase,
  NodeHmacWebhookVerifier,
  ScryptPasswordHasher,
  seedSyntheticUsers,
  Sha256SessionTokenIssuer,
  sqliteMigrationCount,
  SqliteIdentityRepository,
  SqliteEventStore,
  SqliteMeetingRepository,
  SqliteProjectionStore,
  SqliteSessionRepository,
  SystemClock,
} from "@counterpoint/adapters-node";
import {
  createOpenAiAssumptionInvalidationEvaluator,
  createOpenAiPrivateDisclosureProposer,
  createOpenAiSharedDecisionSynthesizer,
  DeterministicAssumptionInvalidationModel,
  DeterministicPrivateDisclosureModel,
  DeterministicSharedDecisionModel,
  OpenAiPrivateDisclosureProposer,
  OpenAiAssumptionInvalidationEvaluator,
  OpenAiSharedDecisionSynthesizer,
} from "@counterpoint/adapters-openai";
import type {
  DecisionCandidateDependencies,
  DecisionDependencies,
  DisclosureDependencies,
  ExternalEventDependencies,
  InvalidationEvaluationDependencies,
} from "@counterpoint/application";
import {
  domainEventTypes,
  type DomainEvent,
  type MeetingProjection,
} from "@counterpoint/domain";
import type {
  Clock,
  IdGenerator,
  IdentityRepository,
  MeetingRepository,
  PasswordVerifier,
  SessionRepository,
  SessionTokenIssuer,
  WebhookVerifier,
} from "@counterpoint/ports";

import type { ServerConfiguration } from "./config.js";
import {
  NodeMeetingRealtimeHub,
  RealtimeNotifyingEventStore,
} from "./realtime.js";

export interface ServerRuntime {
  readonly artifactStorageAvailable: boolean;
  readonly clock: Clock;
  readonly decisionCandidates: DecisionCandidateDependencies;
  readonly decisions: DecisionDependencies;
  readonly disclosures: DisclosureDependencies;
  readonly externalEvents: ExternalEventDependencies;
  readonly invalidationEvaluations: InvalidationEvaluationDependencies;
  readonly facilitatorUserIds: ReadonlySet<string>;
  readonly ids: IdGenerator;
  readonly identities: IdentityRepository;
  readonly meetings: MeetingRepository;
  readonly migrationsCurrent: boolean;
  readonly openAiConfigured: boolean;
  readonly passwords: PasswordVerifier;
  readonly realtime: NodeMeetingRealtimeHub;
  readonly sessions: SessionRepository;
  readonly tokens: SessionTokenIssuer;
  readonly webhookVerifier: WebhookVerifier | undefined;
}

export interface LocalServerRuntime extends ServerRuntime {
  close(): void;
}

const FLAGSHIP_MEETING_ID = "meeting-global-ai-rollout";
const FLAGSHIP_MEETING_CODE = "GLOBAL-AI-2026";
const domainEventTypeSet = new Set<string>(domainEventTypes);

function candidateProposer(configuration: ServerConfiguration) {
  if (configuration.openAiMode === "disabled") {
    return undefined;
  }
  if (configuration.openAiMode === "deterministic") {
    return new OpenAiPrivateDisclosureProposer({
      model: configuration.openAiModel,
      modelAdapter: new DeterministicPrivateDisclosureModel({
        ...(configuration.openAiFakeExactSnippet === undefined
          ? {}
          : { exactSnippet: configuration.openAiFakeExactSnippet }),
      }),
    });
  }
  if (configuration.openAiApiKey === undefined) {
    throw new Error("Live OpenAI mode requires a server-side API key");
  }
  return createOpenAiPrivateDisclosureProposer({
    apiKey: configuration.openAiApiKey,
    logger: {
      log(entry) {
        console.info(JSON.stringify(entry));
      },
    },
    model: configuration.openAiModel,
  });
}

function decisionSynthesizer(configuration: ServerConfiguration) {
  if (configuration.openAiMode === "disabled") {
    return undefined;
  }
  if (configuration.openAiMode === "deterministic") {
    return new OpenAiSharedDecisionSynthesizer({
      model: configuration.openAiModel,
      modelAdapter: new DeterministicSharedDecisionModel(),
    });
  }
  if (configuration.openAiApiKey === undefined) {
    throw new Error("Live OpenAI mode requires a server-side API key");
  }
  return createOpenAiSharedDecisionSynthesizer({
    apiKey: configuration.openAiApiKey,
    logger: {
      log(entry) {
        console.info(JSON.stringify(entry));
      },
    },
    model: configuration.openAiModel,
  });
}

function invalidationEvaluator(configuration: ServerConfiguration) {
  if (configuration.openAiMode === "disabled") {
    return undefined;
  }
  if (configuration.openAiMode === "deterministic") {
    return new OpenAiAssumptionInvalidationEvaluator({
      model: configuration.openAiModel,
      modelAdapter: new DeterministicAssumptionInvalidationModel(),
    });
  }
  if (configuration.openAiApiKey === undefined) {
    throw new Error("Live OpenAI mode requires a server-side API key");
  }
  return createOpenAiAssumptionInvalidationEvaluator({
    apiKey: configuration.openAiApiKey,
    logger: {
      log(entry) {
        console.info(JSON.stringify(entry));
      },
    },
    model: configuration.openAiModel,
  });
}

function parseStoredDomainEvent(input: unknown): DomainEvent {
  if (
    typeof input !== "object" ||
    input === null ||
    !("eventType" in input) ||
    typeof input.eventType !== "string" ||
    !domainEventTypeSet.has(input.eventType) ||
    !("eventId" in input) ||
    typeof input.eventId !== "string" ||
    !("meetingId" in input) ||
    typeof input.meetingId !== "string" ||
    !("position" in input) ||
    typeof input.position !== "number" ||
    !("schemaVersion" in input) ||
    typeof input.schemaVersion !== "number" ||
    !("visibility" in input) ||
    (input.visibility !== "private" && input.visibility !== "shared") ||
    !("payload" in input) ||
    typeof input.payload !== "object" ||
    input.payload === null
  ) {
    throw new TypeError("Stored domain event is invalid");
  }
  if (
    (input.visibility === "private" &&
      (!("ownerParticipantId" in input) ||
        typeof input.ownerParticipantId !== "string")) ||
    (input.visibility === "shared" && "ownerParticipantId" in input)
  ) {
    throw new TypeError("Stored domain event visibility scope is invalid");
  }
  return input as DomainEvent;
}

const sha256 = {
  hash(value: string): string {
    return `sha256:${createHash("sha256").update(value, "utf8").digest("base64url")}`;
  },
};

async function seedFlagshipMeeting(
  meetings: MeetingRepository,
  configuration: ServerConfiguration,
): Promise<void> {
  if ((await meetings.findById(FLAGSHIP_MEETING_ID)) !== undefined) {
    return;
  }
  const facilitator = configuration.demoUsers.find(
    ({ role }) => role === "facilitator",
  );
  if (facilitator === undefined) {
    throw new Error("Flagship seed requires one facilitator");
  }

  const assignments = configuration.demoUsers.map(({ role, userId }) => ({
    active: true,
    meetingId: FLAGSHIP_MEETING_ID,
    participantId: `participant-${userId}`,
    role,
    userId,
  }));
  await meetings.createWithAssignments(
    {
      active: true,
      code: FLAGSHIP_MEETING_CODE,
      createdByUserId: facilitator.userId,
      facilitatorParticipantId: `participant-${facilitator.userId}`,
      meetingId: FLAGSHIP_MEETING_ID,
      purpose: "Global AI Product Rollout",
    },
    assignments,
  );
}

export async function createLocalServerRuntime(
  configuration: ServerConfiguration,
): Promise<LocalServerRuntime> {
  const database = new NodeSqliteDatabase(configuration.databasePath);
  try {
    seedSyntheticUsers(
      database,
      configuration.demoUsers.map(({ passwordHash, userId }) => ({
        passwordHash,
        userId,
      })),
    );
    const meetings = new SqliteMeetingRepository(database);
    await seedFlagshipMeeting(meetings, configuration);
    const clock = new SystemClock();
    const ids = new CryptographicIdGenerator();
    const artifacts = new LocalArtifactStore(configuration.storagePath);
    let artifactStorageAvailable = true;
    const probeScope = {
      artifactId: "runtime-probe",
      meetingId: "runtime-probe",
      ownerParticipantId: "runtime-probe",
      visibility: "private" as const,
    };
    try {
      await artifacts.put({
        bytes: new Uint8Array(),
        contentType: "application/octet-stream",
        hash: "runtime-probe",
        scope: probeScope,
      });
      await artifacts.delete(probeScope);
    } catch {
      artifactStorageAvailable = false;
    }
    const configuredCandidateProposer = candidateProposer(configuration);
    const configuredDecisionSynthesizer = decisionSynthesizer(configuration);
    const configuredInvalidationEvaluator =
      invalidationEvaluator(configuration);
    const realtime = new NodeMeetingRealtimeHub(clock, ids);
    const events = new RealtimeNotifyingEventStore(
      new SqliteEventStore(database, createJsonCodec(parseStoredDomainEvent)),
      (records) => realtime.publish(records),
    );
    const projections = new SqliteProjectionStore<MeetingProjection>(
      database,
      createJsonCodec((input) => input as MeetingProjection),
    );
    const decisions: DecisionDependencies = {
      clock,
      events,
      hash: sha256,
      ids,
      projections,
    };
    const decisionCandidates: DecisionCandidateDependencies = {
      ...decisions,
      listParticipantIds: async (meetingId) =>
        (await meetings.listAssignments(meetingId))
          .filter(({ active }) => active)
          .map(({ participantId }) => participantId),
      ...(configuredDecisionSynthesizer === undefined
        ? {}
        : { synthesizer: configuredDecisionSynthesizer }),
    };
    const disclosures: DisclosureDependencies = {
      artifacts,
      ...(configuredCandidateProposer === undefined
        ? {}
        : { candidateProposer: configuredCandidateProposer }),
      ...decisions,
    };
    const webhookVerifier =
      configuration.regulatoryWebhookSecret === undefined
        ? undefined
        : new NodeHmacWebhookVerifier({
            clock,
            maxAgeSeconds: configuration.regulatoryWebhookMaxAgeSeconds,
            secret: configuration.regulatoryWebhookSecret,
          });

    return {
      artifactStorageAvailable,
      clock,
      close: () => {
        realtime.close();
        database.close();
      },
      decisionCandidates,
      decisions,
      disclosures,
      externalEvents: {
        clock,
        events,
        ids,
        projections,
      },
      invalidationEvaluations: {
        clock,
        ...(configuredInvalidationEvaluator === undefined
          ? {}
          : { evaluator: configuredInvalidationEvaluator }),
        events,
        hash: sha256,
        ids,
        projections,
      },
      facilitatorUserIds: new Set(
        configuration.demoUsers
          .filter(({ role }) => role === "facilitator")
          .map(({ userId }) => userId),
      ),
      ids,
      identities: new SqliteIdentityRepository(database),
      meetings,
      migrationsCurrent:
        sqliteMigrationCount(database.database) ===
        CURRENT_SQLITE_MIGRATION_COUNT,
      openAiConfigured: configuration.openAiConfigured,
      passwords: new ScryptPasswordHasher(),
      realtime,
      sessions: new SqliteSessionRepository(database),
      tokens: new Sha256SessionTokenIssuer(),
      webhookVerifier,
    };
  } catch (error) {
    database.close();
    throw error;
  }
}
