import {
  DeterministicPrivateDisclosureModel,
  OpenAiCandidateError,
  OpenAiPrivateDisclosureProposer,
  type PrivateDisclosureModel,
  type PrivateDisclosureModelRequest,
  type PrivateDisclosureModelResult,
} from "@counterpoint/adapters-openai";
import {
  proposeDisclosure,
  registerPrivateTextSource,
  type DisclosureDependencies,
} from "@counterpoint/application";
import type { DomainEvent, MeetingProjection } from "@counterpoint/domain";
import type { StructuredLogEntry } from "@counterpoint/ports";
import { describe, expect, it, vi } from "vitest";

import {
  MutableClock,
  SequenceIdGenerator,
} from "../../helpers/application-adapters.js";
import {
  InMemoryArtifactStore,
  InMemoryEventStore,
  InMemoryProjectionStore,
} from "../../helpers/in-memory-ports.js";
import { userAuthorizationContext } from "../../../packages/application/src/sessions.js";

const privateText =
  "Keep the vendor migration reversible through September.\nDo not publish this whole note.";

function validResult(
  overrides: Partial<PrivateDisclosureModelResult> = {},
): PrivateDisclosureModelResult {
  const exactSnippet = "vendor migration reversible";
  const start = privateText.indexOf(exactSnippet);
  return {
    output: {
      candidates: [
        {
          confidence: 0.9,
          exactSnippet,
          reason: "This constraint may change the shared plan.",
          sourceRange: {
            end: start + exactSnippet.length,
            start,
          },
          sourceReferenceId: "artifact-private-1",
        },
      ],
      confidence: 0.9,
      reason: "One bounded candidate was found.",
    },
    responseModel: "gpt-5.6-2026-07-01",
    usage: {
      inputTokens: 120,
      outputTokens: 40,
      totalTokens: 160,
    },
    ...overrides,
  };
}

class QueueModel implements PrivateDisclosureModel {
  readonly requests: PrivateDisclosureModelRequest[] = [];
  readonly #results: (PrivateDisclosureModelResult | Error)[];

  constructor(results: (PrivateDisclosureModelResult | Error)[]) {
    this.#results = results;
  }

  generate(
    request: PrivateDisclosureModelRequest,
  ): Promise<PrivateDisclosureModelResult> {
    this.requests.push(request);
    const next = this.#results.shift();
    if (next === undefined) {
      throw new Error("No scripted model result remains.");
    }
    if (next instanceof Error) {
      return Promise.reject(next);
    }
    return Promise.resolve(next);
  }
}

describe("OpenAiPrivateDisclosureProposer", () => {
  it("rejects a third provider attempt before any proposal work can start", () => {
    expect(
      () =>
        new OpenAiPrivateDisclosureProposer({
          maxAttempts: 3,
          modelAdapter: new QueueModel([validResult()]),
        }),
    ).toThrowError(/1 to 2/u);
  });

  it("returns an exact owner-private source range with a versioned AI envelope", async () => {
    const logs: StructuredLogEntry[] = [];
    const proposer = new OpenAiPrivateDisclosureProposer({
      clock: () => new Date("2026-07-19T04:00:00.000Z"),
      logger: {
        log(entry) {
          logs.push(entry);
        },
      },
      modelAdapter: new QueueModel([validResult()]),
    });

    const proposal = await proposer.propose({
      meetingId: "meeting-1",
      ownerParticipantId: "participant-owner",
      sourceArtifactId: "artifact-private-1",
      text: privateText,
    });

    expect(
      privateText.slice(proposal.sourceRange.start, proposal.sourceRange.end),
    ).toBe(proposal.exactSnippet);
    expect(proposal.ai).toMatchObject({
      generatedAt: "2026-07-19T04:00:00.000Z",
      inputReferenceIds: ["artifact-private-1"],
      model: "gpt-5.6-2026-07-01",
      operation: "private_evidence_disclosure",
      promptVersion: "private-evidence-v1",
      schemaVersion: "1",
    });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      event: "openai.private_disclosure",
    });
    expect(logs[0]?.metadata).toMatchObject({
      inputTokens: 120,
      outcome: "success",
      outputTokens: 40,
      retryCount: 0,
      totalTokens: 160,
    });
    expect(JSON.stringify(logs)).not.toContain(privateText);
  });

  it("does not send meeting or owner identifiers to the model", async () => {
    const model = new QueueModel([validResult()]);
    const proposer = new OpenAiPrivateDisclosureProposer({
      modelAdapter: model,
    });

    await proposer.propose({
      meetingId: "meeting-private-value",
      ownerParticipantId: "participant-private-value",
      sourceArtifactId: "artifact-private-1",
      text: privateText,
    });

    expect(model.requests).toEqual([
      {
        model: "gpt-5.6",
        sourceReferenceId: "artifact-private-1",
        sourceText: privateText,
      },
    ]);
    expect(JSON.stringify(model.requests)).not.toContain(
      "meeting-private-value",
    );
    expect(JSON.stringify(model.requests)).not.toContain(
      "participant-private-value",
    );
  });

  it("retries one invalid reference and then accepts an exact source match", async () => {
    const invalid = validResult();
    const invalidOutput = structuredClone(invalid.output) as {
      candidates: { sourceReferenceId: string }[];
    };
    invalidOutput.candidates[0]!.sourceReferenceId = "artifact-someone-else";
    const model = new QueueModel([
      { ...invalid, output: invalidOutput },
      validResult(),
    ]);
    const delay = vi.fn(() => Promise.resolve());
    const logs: StructuredLogEntry[] = [];
    const proposer = new OpenAiPrivateDisclosureProposer({
      delay,
      logger: {
        log(entry) {
          logs.push(entry);
        },
      },
      modelAdapter: model,
    });

    const proposal = await proposer.propose({
      meetingId: "meeting-1",
      ownerParticipantId: "participant-owner",
      sourceArtifactId: "artifact-private-1",
      text: privateText,
    });

    expect(proposal.exactSnippet).toBe("vendor migration reversible");
    expect(model.requests).toHaveLength(2);
    expect(delay).toHaveBeenCalledTimes(1);
    expect(logs[0]?.metadata).toMatchObject({
      inputTokens: 240,
      retryCount: 1,
      totalTokens: 320,
    });
    expect(proposal.billing).toEqual({
      attemptCount: 2,
      attempts: [
        { inputTokens: 120, outputTokens: 40 },
        { inputTokens: 120, outputTokens: 40 },
      ],
      inputTokens: 240,
      outputTokens: 80,
    });
  });

  it("keeps concrete billing metering out of the public proposal DTO and domain event", async () => {
    const events = new InMemoryEventStore<DomainEvent>();
    const artifacts = new InMemoryArtifactStore();
    const registeredIds = new SequenceIdGenerator();
    const registrationDependencies: DisclosureDependencies = {
      artifacts,
      clock: new MutableClock("2026-07-19T03:04:05.000Z"),
      events,
      hash: (value) => `fixture-${value.length}`,
      ids: registeredIds,
      projections: new InMemoryProjectionStore<MeetingProjection>(),
    };
    const context = userAuthorizationContext({
      meetingId: "meeting-1",
      participantId: "participant-owner",
      role: "participant",
      sessionId: "session-owner",
      userId: "user-owner",
    });
    const registered = await registerPrivateTextSource(
      registrationDependencies,
      context,
      {
        expectedPosition: 0,
        idempotencyKey: "register-private-source",
        meetingId: "meeting-1",
        text: privateText,
        title: "Synthetic private note",
      },
    );
    if (registered.kind !== "registered") {
      throw new Error(`Registration failed: ${registered.code}`);
    }

    const model: PrivateDisclosureModel = {
      generate(request) {
        return Promise.resolve(
          validResult({
            output: {
              ...(validResult().output as Record<string, unknown>),
              candidates: [
                {
                  confidence: 0.9,
                  exactSnippet: "vendor migration reversible",
                  reason: "This constraint may change the shared plan.",
                  sourceRange: {
                    end:
                      privateText.indexOf("vendor migration reversible") +
                      "vendor migration reversible".length,
                    start: privateText.indexOf("vendor migration reversible"),
                  },
                  sourceReferenceId: request.sourceReferenceId,
                },
              ],
            },
          }),
        );
      },
    };
    const dependencies: DisclosureDependencies = {
      ...registrationDependencies,
      candidateProposer: new OpenAiPrivateDisclosureProposer({
        modelAdapter: model,
      }),
    };

    const proposed = await proposeDisclosure(dependencies, context, {
      expectedPosition: 1,
      idempotencyKey: "propose-private-source",
      meetingId: "meeting-1",
      sourceArtifactId: registered.source.sourceArtifactId,
    });

    expect(proposed.kind).toBe("proposed");
    const serializedPublicResult = JSON.stringify(proposed);
    const serializedEvents = JSON.stringify(await events.load("meeting-1"));
    for (const serialized of [serializedPublicResult, serializedEvents]) {
      expect(serialized).not.toContain('"billing"');
      expect(serialized).not.toContain('"attemptCount"');
      expect(serialized).not.toContain('"inputTokens"');
      expect(serialized).not.toContain('"outputTokens"');
    }
  });

  it("omits billing when a retried attempt has no trustworthy token usage", async () => {
    const model = new QueueModel([
      new OpenAiCandidateError(
        "INVALID_MODEL_OUTPUT",
        "Synthetic retry without usage.",
        true,
      ),
      validResult(),
    ]);
    const proposer = new OpenAiPrivateDisclosureProposer({
      delay: () => Promise.resolve(),
      modelAdapter: model,
    });

    const proposal = await proposer.propose({
      meetingId: "meeting-1",
      ownerParticipantId: "participant-owner",
      sourceArtifactId: "artifact-private-1",
      text: privateText,
    });

    expect(model.requests).toHaveLength(2);
    expect(proposal).not.toHaveProperty("billing");
  });

  it("omits billing when provider usage is malformed", async () => {
    const malformed = validResult({
      usage: {
        inputTokens: 120,
        outputTokens: -1,
        totalTokens: 119,
      },
    });
    const proposer = new OpenAiPrivateDisclosureProposer({
      modelAdapter: new QueueModel([malformed]),
    });

    const proposal = await proposer.propose({
      meetingId: "meeting-1",
      ownerParticipantId: "participant-owner",
      sourceArtifactId: "artifact-private-1",
      text: privateText,
    });

    expect(proposal).not.toHaveProperty("billing");
  });

  it("caps invalid-output retries and never returns an ungrounded candidate", async () => {
    const invalid = validResult();
    const invalidOutput = structuredClone(invalid.output) as {
      candidates: { exactSnippet: string }[];
    };
    invalidOutput.candidates[0]!.exactSnippet = "invented private claim";
    const model = new QueueModel([
      { ...invalid, output: invalidOutput },
      { ...invalid, output: invalidOutput },
    ]);
    const proposer = new OpenAiPrivateDisclosureProposer({
      delay: () => Promise.resolve(),
      modelAdapter: model,
    });

    await expect(
      proposer.propose({
        meetingId: "meeting-1",
        ownerParticipantId: "participant-owner",
        sourceArtifactId: "artifact-private-1",
        text: privateText,
      }),
    ).rejects.toMatchObject({
      code: "INVALID_MODEL_OUTPUT",
      retryable: true,
    });
    expect(model.requests).toHaveLength(2);
  });

  it("does not retry non-retryable provider failures", async () => {
    const providerError = Object.assign(new Error("invalid key"), {
      status: 401,
    });
    const model = new QueueModel([providerError]);
    const proposer = new OpenAiPrivateDisclosureProposer({
      delay: () => Promise.resolve(),
      modelAdapter: model,
    });

    await expect(
      proposer.propose({
        meetingId: "meeting-1",
        ownerParticipantId: "participant-owner",
        sourceArtifactId: "artifact-private-1",
        text: privateText,
      }),
    ).rejects.toEqual(
      new OpenAiCandidateError(
        "OPENAI_UNAVAILABLE",
        "Private AI assistance is currently unavailable.",
        false,
      ),
    );
    expect(model.requests).toHaveLength(1);
  });

  it("provides a deterministic no-network model for tests and degraded flows", async () => {
    const proposer = new OpenAiPrivateDisclosureProposer({
      clock: () => new Date("2026-07-19T04:00:00.000Z"),
      modelAdapter: new DeterministicPrivateDisclosureModel({
        exactSnippet: "vendor migration reversible",
      }),
    });

    const proposal = await proposer.propose({
      meetingId: "meeting-1",
      ownerParticipantId: "participant-owner",
      sourceArtifactId: "artifact-private-1",
      text: privateText,
    });

    expect(proposal.exactSnippet).toBe("vendor migration reversible");
    expect(proposal.ai.model).toBe("deterministic-private-disclosure");
    expect(proposal.ai.candidates[0]).not.toHaveProperty("publish");
  });
});
