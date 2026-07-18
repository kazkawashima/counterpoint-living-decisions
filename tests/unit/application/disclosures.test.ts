import { describe, expect, it } from "vitest";

import {
  approveDisclosure,
  previewDisclosure,
  proposeDisclosure,
  registerPrivateTextSource,
  rejectDisclosure,
  type DisclosureDependencies,
} from "../../../packages/application/src/disclosures.js";
import { userAuthorizationContext } from "../../../packages/application/src/sessions.js";
import type {
  DomainEvent,
  MeetingProjection,
} from "../../../packages/domain/src/index.js";
import {
  InMemoryArtifactStore,
  InMemoryEventStore,
  InMemoryProjectionStore,
} from "../../helpers/in-memory-ports.js";
import {
  MutableClock,
  SequenceIdGenerator,
} from "../../helpers/application-adapters.js";

const MEETING_ID = "meeting-flagship";
const OTHER_MEETING_ID = "meeting-other";
const OWNER_ID = "participant-legal";
const OTHER_OWNER_ID = "participant-operations";
const SOURCE_TEXT =
  "Private planning note. Budget guardrail is 25 USD. Do not share the appendix.";
const SELECTED_SNIPPET = "Budget guardrail is 25 USD.";

function stableFixtureHash(value: string): string {
  let hash = 2_166_136_261;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16_777_619);
  }
  return `fixture-${(hash >>> 0).toString(16)}`;
}

function ownerContext(meetingScope = MEETING_ID) {
  return userAuthorizationContext({
    meetingId: meetingScope,
    participantId: OWNER_ID,
    role: "participant",
    sessionId: "session-owner",
    userId: "user-owner",
  });
}

function otherOwnerContext() {
  return userAuthorizationContext({
    meetingId: MEETING_ID,
    participantId: OTHER_OWNER_ID,
    role: "participant",
    sessionId: "session-other-owner",
    userId: "user-other-owner",
  });
}

function dependencies(): DisclosureDependencies {
  return {
    artifacts: new InMemoryArtifactStore(),
    candidateProposer: {
      propose: ({ text }) => {
        const start = text.indexOf(SELECTED_SNIPPET);
        return Promise.resolve({
          sourceRange: {
            start,
            end: start + SELECTED_SNIPPET.length,
          },
        });
      },
    },
    clock: new MutableClock("2026-07-19T03:04:05.000Z"),
    events: new InMemoryEventStore<DomainEvent>(),
    hash: stableFixtureHash,
    ids: new SequenceIdGenerator(),
    projections: new InMemoryProjectionStore<MeetingProjection>(),
  };
}

async function registerSource(deps: DisclosureDependencies) {
  const result = await registerPrivateTextSource(deps, ownerContext(), {
    expectedPosition: 0,
    idempotencyKey: "register-source",
    meetingId: MEETING_ID,
    text: SOURCE_TEXT,
    title: "Synthetic rollout note",
  });
  if (result.kind !== "registered") {
    throw new Error(`Source fixture failed: ${result.code}`);
  }
  return result;
}

async function registerAndPropose(deps: DisclosureDependencies) {
  const registered = await registerSource(deps);
  const proposed = await proposeDisclosure(deps, ownerContext(), {
    expectedPosition: 1,
    idempotencyKey: "propose-disclosure",
    meetingId: MEETING_ID,
    sourceArtifactId: registered.source.sourceArtifactId,
  });
  if (proposed.kind !== "proposed") {
    throw new Error(`Proposal fixture failed: ${proposed.code}`);
  }
  return { proposed, registered };
}

async function registerProposeAndPreview(deps: DisclosureDependencies) {
  const setup = await registerAndPropose(deps);
  const previewed = await previewDisclosure(deps, ownerContext(), {
    candidateId: setup.proposed.candidate.candidateId,
    exactSnippet: SELECTED_SNIPPET,
    expectedPosition: 2,
    idempotencyKey: "preview-disclosure",
    meetingId: MEETING_ID,
    sourceRange: setup.proposed.candidate.outgoingPayload.sourceRange,
  });
  if (previewed.kind !== "previewed") {
    throw new Error(`Preview fixture failed: ${previewed.code}`);
  }
  return { ...setup, previewed };
}

describe("deterministic private text disclosure", () => {
  it("replays an AI proposal before calling the provider again", async () => {
    let proposalCalls = 0;
    const deps: DisclosureDependencies = {
      ...dependencies(),
      candidateProposer: {
        propose: ({ text }) => {
          proposalCalls += 1;
          if (proposalCalls > 1) {
            return Promise.reject(
              new Error("provider must not run during replay"),
            );
          }
          const start = text.indexOf(SELECTED_SNIPPET);
          return Promise.resolve({
            exactSnippet: SELECTED_SNIPPET,
            sourceRange: {
              end: start + SELECTED_SNIPPET.length,
              start,
            },
          });
        },
      },
    };
    const registered = await registerSource(deps);
    const input = {
      expectedPosition: 1,
      idempotencyKey: "replay-ai-proposal",
      meetingId: MEETING_ID,
      sourceArtifactId: registered.source.sourceArtifactId,
    };

    const first = await proposeDisclosure(deps, ownerContext(), input);
    const replayed = await proposeDisclosure(deps, ownerContext(), input);

    expect(first.kind).toBe("proposed");
    expect(replayed).toEqual(
      first.kind === "proposed"
        ? {
            ...first,
            replayed: true,
          }
        : first,
    );
    expect(proposalCalls).toBe(1);
    expect(await deps.events.position(MEETING_ID)).toBe(2);
  });

  it("rejects a cross-command idempotency collision before AI spend", async () => {
    let proposalCalls = 0;
    const deps: DisclosureDependencies = {
      ...dependencies(),
      candidateProposer: {
        propose: () => {
          proposalCalls += 1;
          return Promise.reject(new Error("provider must not run"));
        },
      },
    };
    const registered = await registerSource(deps);

    await expect(
      proposeDisclosure(deps, ownerContext(), {
        expectedPosition: 1,
        idempotencyKey: "register-source",
        meetingId: MEETING_ID,
        sourceArtifactId: registered.source.sourceArtifactId,
      }),
    ).resolves.toEqual({
      code: "IDEMPOTENCY_CONFLICT",
      kind: "failed",
    });
    expect(proposalCalls).toBe(0);
    expect(await deps.events.position(MEETING_ID)).toBe(1);
  });

  it("does not append a disclosure event when candidate generation fails", async () => {
    const deps: DisclosureDependencies = {
      ...dependencies(),
      candidateProposer: {
        propose: () =>
          Promise.reject(new Error("synthetic provider unavailable")),
      },
    };
    const registered = await registerSource(deps);

    await expect(
      proposeDisclosure(deps, ownerContext(), {
        expectedPosition: 1,
        idempotencyKey: "failed-ai-proposal",
        meetingId: MEETING_ID,
        sourceArtifactId: registered.source.sourceArtifactId,
      }),
    ).rejects.toThrow("synthetic provider unavailable");

    expect(await deps.events.position(MEETING_ID)).toBe(1);
    expect(
      (await deps.events.load(MEETING_ID)).map(({ event }) => event.eventType),
    ).toEqual(["ArtifactRegistered"]);
  });

  it("publishes only the exact owner-approved snippet as shared Evidence", async () => {
    const deps = dependencies();
    const { previewed, proposed, registered } =
      await registerProposeAndPreview(deps);

    expect(proposed.candidate.outgoingPayload).toEqual({
      exactSnippet: SELECTED_SNIPPET,
      sourceArtifactId: registered.source.sourceArtifactId,
      sourceRange: {
        start: SOURCE_TEXT.indexOf(SELECTED_SNIPPET),
        end: SOURCE_TEXT.indexOf(SELECTED_SNIPPET) + SELECTED_SNIPPET.length,
      },
    });
    expect(previewed.outgoingPayload.exactSnippet).toBe(SELECTED_SNIPPET);

    const beforeApproval = await deps.projections.get({
      meetingId: MEETING_ID,
      ownerParticipantId: OWNER_ID,
      projection: "meeting",
    });
    expect(beforeApproval?.shared.evidence).toEqual([]);
    expect(JSON.stringify(beforeApproval?.shared)).not.toContain(SOURCE_TEXT);

    const approved = await approveDisclosure(deps, ownerContext(), {
      candidateId: proposed.candidate.candidateId,
      expectedPosition: 3,
      idempotencyKey: "approve-disclosure",
      meetingId: MEETING_ID,
      previewHash: previewed.previewHash,
    });

    expect(approved).toMatchObject({
      evidence: {
        exactSnippet: SELECTED_SNIPPET,
        sourceRange: previewed.outgoingPayload.sourceRange,
      },
      kind: "approved",
      position: 5,
      replayed: false,
    });
    const projection = await deps.projections.get({
      meetingId: MEETING_ID,
      ownerParticipantId: OWNER_ID,
      projection: "meeting",
    });
    expect(projection?.shared.evidence).toHaveLength(1);
    expect(projection?.shared.evidence[0]?.exactSnippet).toBe(SELECTED_SNIPPET);
    const shared = JSON.stringify(projection?.shared);
    expect(shared).not.toContain("Private planning note");
    expect(shared).not.toContain("Do not share the appendix");
    await expect(
      deps.projections.get({
        meetingId: MEETING_ID,
        projection: "meeting",
      }),
    ).resolves.toBeUndefined();
    await expect(
      deps.projections.get({
        meetingId: MEETING_ID,
        ownerParticipantId: OTHER_OWNER_ID,
        projection: "meeting",
      }),
    ).resolves.toBeUndefined();

    const events = await deps.events.load(MEETING_ID);
    const sharedEvents = events.filter(
      ({ event }) => event.visibility === "shared",
    );
    expect(sharedEvents.map(({ event }) => event.eventType)).toEqual([
      "EvidenceShared",
    ]);
  });

  it("returns non-disclosing forbidden failures for other-owner and cross-meeting requests", async () => {
    const deps = dependencies();
    const registered = await registerSource(deps);

    await expect(
      proposeDisclosure(deps, otherOwnerContext(), {
        exactSnippet: "",
        expectedPosition: 1,
        idempotencyKey: "other-owner-proposal",
        meetingId: MEETING_ID,
        sourceArtifactId: registered.source.sourceArtifactId,
        sourceRange: { start: -1, end: -1 },
      }),
    ).resolves.toEqual({ code: "FORBIDDEN", kind: "failed" });

    await expect(
      proposeDisclosure(deps, ownerContext(), {
        exactSnippet: "",
        expectedPosition: -1,
        idempotencyKey: "",
        meetingId: OTHER_MEETING_ID,
        sourceArtifactId: registered.source.sourceArtifactId,
        sourceRange: { start: -1, end: -1 },
      }),
    ).resolves.toEqual({ code: "FORBIDDEN", kind: "failed" });

    expect(await deps.events.position(MEETING_ID)).toBe(1);
    expect(await deps.events.position(OTHER_MEETING_ID)).toBe(0);
  });

  it("rejects an edited range that does not match its exact snippet and a tampered preview hash", async () => {
    const deps = dependencies();
    const { proposed } = await registerAndPropose(deps);
    const originalRange = proposed.candidate.outgoingPayload.sourceRange;

    await expect(
      previewDisclosure(deps, ownerContext(), {
        candidateId: proposed.candidate.candidateId,
        exactSnippet: SELECTED_SNIPPET,
        expectedPosition: 2,
        idempotencyKey: "tampered-range",
        meetingId: MEETING_ID,
        sourceRange: {
          start: originalRange.start + 1,
          end: originalRange.end,
        },
      }),
    ).resolves.toEqual({
      code: "DISCLOSURE_PREVIEW_MISMATCH",
      kind: "failed",
    });
    expect(await deps.events.position(MEETING_ID)).toBe(2);

    const previewed = await previewDisclosure(deps, ownerContext(), {
      candidateId: proposed.candidate.candidateId,
      exactSnippet: SELECTED_SNIPPET,
      expectedPosition: 2,
      idempotencyKey: "valid-preview",
      meetingId: MEETING_ID,
      sourceRange: originalRange,
    });
    if (previewed.kind !== "previewed") {
      throw new Error(`Valid preview failed: ${previewed.code}`);
    }

    await expect(
      approveDisclosure(deps, ownerContext(), {
        candidateId: proposed.candidate.candidateId,
        expectedPosition: 3,
        idempotencyKey: "tampered-approval",
        meetingId: MEETING_ID,
        previewHash: `${previewed.previewHash}-tampered`,
      }),
    ).resolves.toEqual({
      code: "DISCLOSURE_PREVIEW_MISMATCH",
      kind: "failed",
    });
    expect(await deps.events.position(MEETING_ID)).toBe(3);
  });

  it("revalidates the private source body before approval", async () => {
    const deps = dependencies();
    const { previewed, registered, proposed } =
      await registerProposeAndPreview(deps);

    await deps.artifacts.put({
      bytes: new TextEncoder().encode(SOURCE_TEXT.replace("25 USD", "250 USD")),
      contentType: "text/plain; charset=utf-8",
      hash: "fixture-tampered",
      scope: {
        artifactId: registered.source.sourceArtifactId,
        meetingId: MEETING_ID,
        ownerParticipantId: OWNER_ID,
        visibility: "private",
      },
    });

    await expect(
      approveDisclosure(deps, ownerContext(), {
        candidateId: proposed.candidate.candidateId,
        expectedPosition: 3,
        idempotencyKey: "approve-tampered-source",
        meetingId: MEETING_ID,
        previewHash: previewed.previewHash,
      }),
    ).resolves.toEqual({
      code: "DISCLOSURE_PREVIEW_MISMATCH",
      kind: "failed",
    });
    expect(await deps.events.position(MEETING_ID)).toBe(3);
  });

  it("rejects privately without creating any shared content or audit trace", async () => {
    const deps = dependencies();
    const { proposed } = await registerAndPropose(deps);

    const rejected = await rejectDisclosure(deps, ownerContext(), {
      candidateId: proposed.candidate.candidateId,
      expectedPosition: 2,
      idempotencyKey: "reject-disclosure",
      meetingId: MEETING_ID,
      reason: "Not relevant to the shared decision.",
    });

    expect(rejected).toMatchObject({
      kind: "rejected",
      position: 3,
      state: "rejected",
    });
    const projection = await deps.projections.get({
      meetingId: MEETING_ID,
      ownerParticipantId: OWNER_ID,
      projection: "meeting",
    });
    expect(projection?.shared.evidence).toEqual([]);
    expect(projection?.shared.auditTimeline).toEqual([]);
    expect(JSON.stringify(projection?.shared)).not.toContain(SELECTED_SNIPPET);
    const events = await deps.events.load(MEETING_ID);
    expect(events.every(({ event }) => event.visibility === "private")).toBe(
      true,
    );
  });

  it("maps idempotent source replay, key reuse, and position conflicts", async () => {
    const deps = dependencies();
    const first = await registerSource(deps);
    const replayed = await registerPrivateTextSource(deps, ownerContext(), {
      expectedPosition: 0,
      idempotencyKey: "register-source",
      meetingId: MEETING_ID,
      text: SOURCE_TEXT,
      title: "Synthetic rollout note",
    });

    expect(replayed).toMatchObject({
      kind: "registered",
      position: 1,
      replayed: true,
      source: { sourceArtifactId: first.source.sourceArtifactId },
    });
    expect(await deps.events.load(MEETING_ID)).toHaveLength(1);

    await expect(
      registerPrivateTextSource(deps, ownerContext(), {
        expectedPosition: 1,
        idempotencyKey: "register-source",
        meetingId: MEETING_ID,
        text: `${SOURCE_TEXT} Changed.`,
        title: "Synthetic rollout note",
      }),
    ).resolves.toEqual({
      code: "IDEMPOTENCY_CONFLICT",
      kind: "failed",
    });

    await expect(
      registerPrivateTextSource(deps, ownerContext(), {
        expectedPosition: 0,
        idempotencyKey: "stale-position",
        meetingId: MEETING_ID,
        text: "Another synthetic source.",
        title: "Another note",
      }),
    ).resolves.toEqual({
      actualPosition: 1,
      code: "CONFLICT",
      expectedPosition: 0,
      kind: "failed",
    });
    expect(await deps.events.load(MEETING_ID)).toHaveLength(1);
  });

  it("replays approval idempotently even when the original expected position is stale", async () => {
    const deps = dependencies();
    const { previewed, proposed } = await registerProposeAndPreview(deps);
    const input = {
      candidateId: proposed.candidate.candidateId,
      expectedPosition: 3,
      idempotencyKey: "approve-once",
      meetingId: MEETING_ID,
      previewHash: previewed.previewHash,
    };

    const first = await approveDisclosure(deps, ownerContext(), input);
    const replayed = await approveDisclosure(deps, ownerContext(), input);

    expect(first).toMatchObject({ kind: "approved", replayed: false });
    expect(replayed).toMatchObject({
      evidence: first.kind === "approved" ? first.evidence : {},
      kind: "approved",
      position: 5,
      replayed: true,
    });
    const events = await deps.events.load(MEETING_ID);
    expect(
      events.filter(({ event }) => event.eventType === "EvidenceShared"),
    ).toHaveLength(1);
  });
});
