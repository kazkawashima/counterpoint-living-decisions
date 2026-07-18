import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import type {
  AssignedMeeting,
  Decision as DecisionView,
  DecisionAuditResponse,
  DecisionHistoryResponse,
  DispositionSharedDecisionCandidateResponse,
  PreviewDisclosureResponse,
  SharedEvidence,
  SharedDecisionSynthesisCandidate,
} from "@counterpoint/protocol";

import {
  ApiError,
  approveDisclosure,
  clearStoredSession,
  commitDecision,
  dispositionSharedDecisionCandidate,
  getDecisionAudit,
  getDecisionHistory,
  joinMeeting,
  listMeetings,
  listSharedDecisions,
  listSharedEvidence,
  loadStoredSession,
  login,
  logout,
  markDecisionReady,
  previewDisclosure,
  proposeDisclosure,
  registerPrivateTextSource,
  rejectDisclosure,
  saveDecisionDraft,
  storeSession,
  synthesizeSharedDecisionCandidate,
  type StoredSession,
} from "./api.js";

const DEMO_IDENTITIES = [
  { label: "Product", role: "Facilitator", userId: "product" },
  { label: "Safety", role: "Participant", userId: "safety" },
  { label: "Legal", role: "Participant", userId: "legal" },
  { label: "Engineering", role: "Participant", userId: "engineering" },
  { label: "Enterprise Sales", role: "Participant", userId: "sales" },
] as const;

const SYNTHETIC_PRIVATE_NOTE =
  "Private context: the regional team is ready to launch. Regional launch requires a documented approval gate. Keep the fallback owner private until the staffing review.";
const SYNTHETIC_EXACT_SNIPPET =
  "Regional launch requires a documented approval gate.";

function messageFor(error: unknown): string {
  return error instanceof ApiError
    ? error.message
    : "Counterpoint could not reach the local decision service.";
}

function Brand() {
  return (
    <a className="brand" href="/" aria-label="Counterpoint home">
      <span className="brand-mark" aria-hidden="true">
        <span />
        <span />
      </span>
      <span>Counterpoint</span>
    </a>
  );
}

function ScopePath() {
  return (
    <div className="scope-path" aria-label="Counterpoint permission flow">
      <div className="signal-card private-card">
        <span className="signal-label">Private</span>
        <strong>Independent context</strong>
        <small>Owner only</small>
      </div>
      <div className="permission-gate" aria-label="Explicit permission gate">
        <span className="gate-lock" aria-hidden="true">
          ◇
        </span>
        <span>Permission</span>
      </div>
      <div className="signal-card shared-card">
        <span className="signal-label">Shared</span>
        <strong>Approved evidence</strong>
        <small>Exact excerpt</small>
      </div>
    </div>
  );
}

function LoginScreen({
  onAuthenticated,
}: {
  readonly onAuthenticated: (session: StoredSession) => void;
}) {
  const userIdId = useId();
  const passwordId = useId();
  const [userId, setUserId] = useState("product");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      onAuthenticated(storeSession(await login(userId, password)));
    } catch (cause) {
      setError(messageFor(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-shell">
      <section className="story-panel" aria-labelledby="story-title">
        <div>
          <p className="eyebrow">
            <span className="status-dot" />
            Living decision protocol
          </p>
          <h1 id="story-title">
            Independent minds.
            <br />
            <em>Shared commitment.</em>
          </h1>
          <p className="story-copy">
            Private context crosses into the room only through explicit
            permission—then stays attached to the Decision it shaped.
          </p>
        </div>
        <ScopePath />
        <div className="story-foot">
          <span>01 Permission</span>
          <span>02 Commitment</span>
          <span>03 Reconsideration</span>
        </div>
      </section>

      <section className="auth-panel" aria-labelledby="login-title">
        <div className="auth-card">
          <p className="section-kicker">Synthetic flagship</p>
          <h2 id="login-title">Enter the decision room</h2>
          <p className="muted">
            Choose one fixed demo identity. Each browser tab keeps an isolated
            session.
          </p>

          <div
            className="identity-grid"
            role="group"
            aria-label="Demo identity"
          >
            {DEMO_IDENTITIES.map((identity) => (
              <button
                aria-pressed={userId === identity.userId}
                className="identity-option"
                key={identity.userId}
                onClick={() => setUserId(identity.userId)}
                type="button"
              >
                <span className="identity-monogram">
                  {identity.label.slice(0, 1)}
                </span>
                <span>
                  <strong>{identity.label}</strong>
                  <small>{identity.role}</small>
                </span>
              </button>
            ))}
          </div>

          <form onSubmit={(event) => void submit(event)}>
            <label htmlFor={userIdId}>User ID</label>
            <input
              autoComplete="username"
              id={userIdId}
              onChange={(event) => setUserId(event.target.value)}
              required
              value={userId}
            />
            <label htmlFor={passwordId}>Demo password</label>
            <input
              autoComplete="current-password"
              id={passwordId}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Enter the synthetic password"
              required
              type="password"
              value={password}
            />
            {error === undefined ? null : (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <button className="primary-button" disabled={busy} type="submit">
              <span>{busy ? "Opening room…" : "Continue to meetings"}</span>
              <span aria-hidden="true">↗</span>
            </button>
          </form>
          <p className="security-note">
            <span aria-hidden="true">⌁</span>
            Demo-only synthetic data. No real credentials or meeting content.
          </p>
        </div>
      </section>
    </main>
  );
}

function MeetingListScreen({
  meetings,
  session,
  loading,
  error,
  onJoin,
  onLogout,
  onOpen,
}: {
  readonly meetings: readonly AssignedMeeting[];
  readonly session: StoredSession;
  readonly loading: boolean;
  readonly error: string | undefined;
  readonly onJoin: (code: string) => Promise<void>;
  readonly onLogout: () => Promise<void>;
  readonly onOpen: (meeting: AssignedMeeting) => void;
}) {
  const [code, setCode] = useState("");
  const [joining, setJoining] = useState(false);
  const codeId = useId();

  async function submitCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setJoining(true);
    try {
      await onJoin(code);
    } finally {
      setJoining(false);
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <Brand />
        <div className="session-chip">
          <span className="avatar">
            {session.userId.slice(0, 1).toUpperCase()}
          </span>
          <span>
            <strong>{session.userId}</strong>
            <small>Tab-scoped session</small>
          </span>
          <button onClick={() => void onLogout()} type="button">
            Sign out
          </button>
        </div>
      </header>

      <section className="meeting-hero">
        <div>
          <p className="eyebrow">Decision rooms</p>
          <h1>Your assigned meetings</h1>
          <p>
            Move from participant-owned context to a traceable shared
            commitment.
          </p>
        </div>
        <div className="protocol-badge">
          <span>Protocol</span>
          <strong>Private → Shared → Committed</strong>
        </div>
      </section>

      <section className="meeting-content">
        <div className="meeting-list" aria-busy={loading}>
          <div className="section-heading">
            <h2>Available now</h2>
            <span>{meetings.length} assigned</span>
          </div>
          {loading ? (
            <div className="meeting-skeleton" aria-label="Loading meetings">
              <span />
              <span />
              <span />
            </div>
          ) : null}
          {error === undefined ? null : (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          {!loading && meetings.length === 0 ? (
            <div className="empty-state">
              <span aria-hidden="true">○</span>
              <h3>No assigned rooms yet</h3>
              <p>Use a meeting code if a facilitator invited this identity.</p>
            </div>
          ) : null}
          {meetings.map((meeting, index) => (
            <article className="meeting-card" key={meeting.meetingId}>
              <div className="meeting-number">
                {String(index + 1).padStart(2, "0")}
              </div>
              <div className="meeting-summary">
                <div className="meeting-meta">
                  <span className="role-pill">{meeting.role}</span>
                  <span className="scope-pill">Shared room</span>
                </div>
                <h3>{meeting.purpose}</h3>
                <p>
                  Synthetic launch decision · Five perspectives · Living monitor
                </p>
                <div className="stage-row" aria-label="Meeting progress">
                  <span className="stage active">Prepare</span>
                  <span className="stage">Deliberate</span>
                  <span className="stage">Commit</span>
                  <span className="stage">Monitor</span>
                </div>
              </div>
              <button
                className="open-button"
                onClick={() => onOpen(meeting)}
                type="button"
              >
                Open workspace <span aria-hidden="true">→</span>
              </button>
            </article>
          ))}
        </div>

        <aside className="join-panel">
          <p className="section-kicker">Fallback path</p>
          <h2>Join with a code</h2>
          <p>
            Membership is resolved by the server. A code never grants a role by
            itself.
          </p>
          <form onSubmit={(event) => void submitCode(event)}>
            <label htmlFor={codeId}>Meeting code</label>
            <input
              id={codeId}
              onChange={(event) => setCode(event.target.value)}
              placeholder="GLOBAL-AI-2026"
              required
              value={code}
            />
            <button
              className="secondary-button"
              disabled={joining}
              type="submit"
            >
              {joining ? "Checking…" : "Verify membership"}
            </button>
          </form>
          <div className="boundary-note">
            <span className="boundary-icon" aria-hidden="true">
              ◇
            </span>
            <div>
              <strong>Server-resolved boundary</strong>
              <p>Identity, role, and capabilities never come from the URL.</p>
            </div>
          </div>
        </aside>
      </section>
    </main>
  );
}

interface DecisionDraftForm {
  readonly actionOwnerParticipantId: string;
  readonly actionScope: string;
  readonly dissentReason: string;
  readonly monitorCondition: string;
  readonly outcome: string;
  readonly premise: string;
  readonly title: string;
}

function SharedDecisionCard({ decision }: { readonly decision: DecisionView }) {
  const readinessCount = Object.values(decision.readiness).filter(
    Boolean,
  ).length;

  return (
    <section
      aria-labelledby={`shared-decision-${decision.decisionId}`}
      className="shared-decision-card"
    >
      <div className="shared-decision-seal" aria-hidden="true">
        ✓
      </div>
      <div>
        <p className="zone-label shared">Shared · Human committed</p>
        <h2 id={`shared-decision-${decision.decisionId}`}>
          {decision.snapshot.title}
        </h2>
        <p className="shared-decision-outcome">{decision.snapshot.outcome}</p>
      </div>
      <div className="shared-decision-metadata">
        <span>Revision {decision.activeRevision}</span>
        <span>{decision.status}</span>
        <span>{readinessCount} / 5 readiness checks</span>
      </div>
      <div className="shared-decision-links">
        <span>{decision.snapshot.evidenceIds.length} Evidence source</span>
        <span>{decision.snapshot.premiseIds.length} confirmed premise</span>
        <span>{decision.snapshot.dissentIds.length} retained dissent</span>
        <span>{decision.snapshot.actionIds.length} bounded Action</span>
      </div>
      <p className="shared-decision-monitor">
        <strong>Monitor</strong>
        {decision.snapshot.monitorCondition.description}
      </p>
    </section>
  );
}

function FacilitatorDecisionPanel({
  evidence,
  existingDecision,
  meeting,
  onDecisionChange,
  onPositionChange,
  position,
  session,
}: {
  readonly evidence: SharedEvidence;
  readonly existingDecision: DecisionView | undefined;
  readonly meeting: AssignedMeeting;
  readonly onDecisionChange: (decision: DecisionView) => void;
  readonly onPositionChange: (position: AssignedMeeting["position"]) => void;
  readonly position: AssignedMeeting["position"];
  readonly session: StoredSession;
}) {
  const [phase, setPhase] = useState<
    | "ai-unavailable"
    | "candidate"
    | "committed"
    | "committing"
    | "confirming"
    | "draft"
    | "idle"
    | "manual-edit"
    | "premise-confirmed"
    | "premise-rejected"
    | "ready"
    | "saving"
    | "synthesizing"
  >(
    existingDecision?.status === "COMMITTED"
      ? "committed"
      : existingDecision?.status === "DECISION_READY"
        ? "ready"
        : existingDecision?.status === "DRAFT"
          ? "draft"
          : "idle",
  );
  const [candidate, setCandidate] =
    useState<SharedDecisionSynthesisCandidate>();
  const [materialized, setMaterialized] =
    useState<DispositionSharedDecisionCandidateResponse>();
  const [decision, setDecision] = useState<DecisionView | undefined>(
    existingDecision,
  );
  const [history, setHistory] = useState<DecisionHistoryResponse>();
  const [audit, setAudit] = useState<DecisionAuditResponse>();
  const [error, setError] = useState<string>();
  const [draft, setDraft] = useState<DecisionDraftForm>({
    actionOwnerParticipantId: meeting.participantId,
    actionScope: "Document the approval gate before regional launch.",
    dissentReason:
      "Rollback ownership and staffing remain explicit retained concerns.",
    monitorCondition:
      "Reopen if the approval gate, staffing plan, or regulation changes.",
    outcome:
      "Proceed with regional launch only after the documented approval gate is satisfied.",
    premise: evidence.exactSnippet,
    title: "Conditional regional launch",
  });
  const commandKeys = useRef({
    commit: crypto.randomUUID(),
    confirm: crypto.randomUUID(),
    manualCandidate: crypto.randomUUID(),
    ready: crypto.randomUUID(),
    reject: crypto.randomUUID(),
    save: crypto.randomUUID(),
    synthesize: crypto.randomUUID(),
  });

  useEffect(() => {
    if (existingDecision?.status !== "COMMITTED") {
      return;
    }
    const controller = new AbortController();
    void Promise.all([
      getDecisionHistory(
        session,
        {
          decisionId: existingDecision.decisionId,
          meetingId: meeting.meetingId,
        },
        controller.signal,
      ),
      getDecisionAudit(
        session,
        {
          decisionId: existingDecision.decisionId,
          meetingId: meeting.meetingId,
        },
        controller.signal,
      ),
    ])
      .then(([nextHistory, nextAudit]) => {
        setHistory(nextHistory);
        setAudit(nextAudit);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setError(messageFor(cause));
        }
      });
    return () => controller.abort();
  }, [
    existingDecision?.decisionId,
    existingDecision?.status,
    meeting.meetingId,
    session,
  ]);

  function advancePosition(nextPosition: AssignedMeeting["position"]) {
    onPositionChange(nextPosition);
  }

  function setDraftField<Key extends keyof DecisionDraftForm>(
    key: Key,
    value: DecisionDraftForm[Key],
  ) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function startManualEdit() {
    setCandidate(undefined);
    setMaterialized(undefined);
    setError(undefined);
    commandKeys.current.manualCandidate = crypto.randomUUID();
    setPhase("manual-edit");
  }

  function populateCandidate(next: SharedDecisionSynthesisCandidate) {
    const premise = next.draft.premiseCandidates[0];
    const action = next.draft.actionCandidates[0];
    const dissent = next.draft.dissentCandidates[0];
    setCandidate(next);
    setDraft({
      actionOwnerParticipantId:
        action?.ownerParticipantId ?? meeting.participantId,
      actionScope: action?.scope.join("\n") ?? draft.actionScope,
      dissentReason: dissent?.reason ?? draft.dissentReason,
      monitorCondition: next.draft.monitorCondition.description,
      outcome: next.draft.outcome,
      premise: premise?.statement ?? draft.premise,
      title: next.draft.title,
    });
    setPhase("candidate");
  }

  async function synthesizeAi() {
    setPhase("synthesizing");
    setError(undefined);
    try {
      const response = await synthesizeSharedDecisionCandidate(session, {
        assistance: "ai_preferred",
        expectedPosition: position,
        idempotencyKey: commandKeys.current.synthesize,
        meetingId: meeting.meetingId,
      });
      advancePosition(response.position);
      populateCandidate(response.candidate);
    } catch (cause) {
      setError(messageFor(cause));
      setPhase(
        cause instanceof ApiError && cause.code === "OPENAI_UNAVAILABLE"
          ? "ai-unavailable"
          : "idle",
      );
    }
  }

  async function createManualCandidate() {
    setPhase("synthesizing");
    setError(undefined);
    try {
      const response = await synthesizeSharedDecisionCandidate(session, {
        assistance: "manual",
        draft: {
          actions: [
            {
              ownerParticipantId: draft.actionOwnerParticipantId,
              scope: [draft.actionScope],
            },
          ],
          dissent: [{ reason: draft.dissentReason, retained: true }],
          monitorCondition: { description: draft.monitorCondition },
          outcome: draft.outcome,
          premises: [
            {
              evidenceReferenceIds: [evidence.evidenceId],
              statement: draft.premise,
            },
          ],
          title: draft.title,
        },
        expectedPosition: position,
        idempotencyKey: commandKeys.current.manualCandidate,
        meetingId: meeting.meetingId,
      });
      advancePosition(response.position);
      populateCandidate(response.candidate);
    } catch (cause) {
      setError(messageFor(cause));
      setPhase("manual-edit");
    }
  }

  async function disposePremise(disposition: "confirmed" | "rejected") {
    const premiseCandidate = candidate?.draft.premiseCandidates[0];
    if (candidate === undefined || premiseCandidate === undefined) {
      return;
    }
    setPhase("confirming");
    setError(undefined);
    try {
      const response = await dispositionSharedDecisionCandidate(session, {
        actions:
          disposition === "confirmed"
            ? [
                {
                  ownerParticipantId: draft.actionOwnerParticipantId,
                  scope: [draft.actionScope],
                },
              ]
            : [],
        candidateId: candidate.candidateId,
        dissent:
          disposition === "confirmed"
            ? [{ reason: draft.dissentReason, retained: true }]
            : [],
        expectedPosition: position,
        idempotencyKey:
          disposition === "confirmed"
            ? commandKeys.current.confirm
            : commandKeys.current.reject,
        meetingId: meeting.meetingId,
        monitorCondition: { description: draft.monitorCondition },
        outcome: draft.outcome,
        premiseDispositions: [
          disposition === "confirmed"
            ? {
                candidateId: premiseCandidate.candidateId,
                disposition,
                premise: {
                  evidenceReferenceIds: premiseCandidate.evidenceReferenceIds,
                  statement: draft.premise,
                },
              }
            : {
                candidateId: premiseCandidate.candidateId,
                disposition,
                reason:
                  "Facilitator rejected the proposed premise after review.",
              },
        ],
        reason:
          disposition === "confirmed"
            ? "Facilitator confirmed the grounded premise and edited fields."
            : "Facilitator rejected the premise without publishing linked material.",
        title: draft.title,
      });
      advancePosition(response.position);
      setMaterialized(response);
      setPhase(
        disposition === "confirmed" ? "premise-confirmed" : "premise-rejected",
      );
    } catch (cause) {
      setError(messageFor(cause));
      setPhase("candidate");
    }
  }

  async function saveDraft() {
    if (materialized === undefined) {
      return;
    }
    setPhase("saving");
    setError(undefined);
    try {
      const response = await saveDecisionDraft(session, {
        actionIds: materialized.actions.map(({ actionId }) => actionId),
        changeReason: "Facilitator draft from reviewed synthesis candidate",
        dissentIds: materialized.dissent.map(({ dissentId }) => dissentId),
        evidenceIds: [evidence.evidenceId],
        expectedPosition: position,
        idempotencyKey: commandKeys.current.save,
        meetingId: meeting.meetingId,
        monitorCondition: { description: draft.monitorCondition },
        outcome: draft.outcome,
        premiseIds: materialized.premises.map(({ premiseId }) => premiseId),
        title: draft.title,
      });
      advancePosition(response.position);
      setDecision(response.decision);
      onDecisionChange(response.decision);
      setPhase("draft");
    } catch (cause) {
      setError(messageFor(cause));
      setPhase("premise-confirmed");
    }
  }

  async function markReady() {
    if (decision === undefined) {
      return;
    }
    setPhase("saving");
    setError(undefined);
    try {
      const response = await markDecisionReady(session, {
        decisionId: decision.decisionId,
        expectedPosition: position,
        idempotencyKey: commandKeys.current.ready,
        meetingId: meeting.meetingId,
      });
      advancePosition(response.position);
      setDecision(response.decision);
      onDecisionChange(response.decision);
      setPhase("ready");
    } catch (cause) {
      setError(messageFor(cause));
      setPhase("draft");
    }
  }

  async function commit() {
    if (decision === undefined) {
      return;
    }
    setPhase("committing");
    setError(undefined);
    try {
      const response = await commitDecision(session, {
        decisionId: decision.decisionId,
        expectedPosition: position,
        idempotencyKey: commandKeys.current.commit,
        meetingId: meeting.meetingId,
      });
      advancePosition(response.position);
      setDecision(response.decision);
      onDecisionChange(response.decision);
      const [nextHistory, nextAudit] = await Promise.all([
        getDecisionHistory(session, {
          decisionId: response.decision.decisionId,
          meetingId: meeting.meetingId,
        }),
        getDecisionAudit(session, {
          decisionId: response.decision.decisionId,
          meetingId: meeting.meetingId,
        }),
      ]);
      setHistory(nextHistory);
      setAudit(nextAudit);
      setPhase("committed");
    } catch (cause) {
      setError(messageFor(cause));
      setPhase("ready");
    }
  }

  const premiseCandidate = candidate?.draft.premiseCandidates[0];
  const aiProvenance =
    candidate?.provenance.origin === "ai_assisted"
      ? candidate.provenance
      : undefined;
  const editable =
    phase === "candidate" ||
    phase === "manual-edit" ||
    phase === "ai-unavailable";

  return (
    <section
      aria-labelledby="decision-forge-title"
      className={`decision-forge decision-${phase}`}
    >
      <header className="decision-forge-heading">
        <div>
          <p className="zone-label shared">Facilitator · Decision forge</p>
          <h2 id="decision-forge-title">Turn evidence into commitment</h2>
        </div>
        <div className="forge-state">
          <span>{decision?.status ?? "CANDIDATE"}</span>
          <small>Human authority required</small>
        </div>
      </header>

      {phase === "idle" ? (
        <div className="forge-launch">
          <div className="synthesis-orbit" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <div>
            <strong>Synthesize the shared state</strong>
            <p>
              GPT-5.6 reads only approved shared Evidence. It proposes; you
              edit, confirm, and commit.
            </p>
          </div>
          <button
            className="forge-primary"
            onClick={() => void synthesizeAi()}
            type="button"
          >
            Generate Decision candidate
          </button>
        </div>
      ) : null}

      {phase === "synthesizing" ? (
        <div className="synthesis-stage" role="status">
          <div className="synthesis-wave" aria-hidden="true">
            <span />
            <span />
            <span />
            <span />
          </div>
          <strong>Assembling a grounded Decision candidate…</strong>
          <small>Shared evidence only · No canonical writes</small>
        </div>
      ) : null}

      {phase === "ai-unavailable" ? (
        <div className="forge-recovery" role="alert">
          <strong>Decision synthesis is temporarily unavailable</strong>
          <p>
            Approved Evidence remains intact. Retry AI or edit a manual draft
            through the same confirmation and commit path.
          </p>
          <div>
            <button onClick={() => void synthesizeAi()} type="button">
              Retry synthesis
            </button>
            <button onClick={startManualEdit} type="button">
              Edit manual draft
            </button>
          </div>
        </div>
      ) : null}

      {phase === "manual-edit" ? (
        <div className="manual-candidate-intro">
          <span>Manual fallback</span>
          <p>
            Edit every field first. “Human authored” is recorded only when you
            submit this draft.
          </p>
        </div>
      ) : null}

      {candidate !== undefined || phase === "manual-edit" ? (
        <div className="candidate-workbench">
          <div className="candidate-provenance">
            <span
              className={
                aiProvenance === undefined ? "human-label" : "ai-label"
              }
            >
              {aiProvenance === undefined ? "Human authored" : "AI proposed"}
            </span>
            {aiProvenance === undefined ? null : (
              <>
                <span>{aiProvenance.model}</span>
                <span>
                  Confidence {Math.round(aiProvenance.confidence * 100)}%
                </span>
                <span>
                  Source {aiProvenance.inputReferenceIds[0]?.slice(0, 14)}…
                </span>
              </>
            )}
          </div>
          {aiProvenance === undefined ? null : (
            <p className="candidate-reason">
              <strong>Why this candidate</strong>
              {aiProvenance.reason}
            </p>
          )}
          <div className="candidate-fields">
            <label>
              Decision title
              <input
                onChange={(event) => setDraftField("title", event.target.value)}
                readOnly={!editable}
                value={draft.title}
              />
            </label>
            <label>
              Outcome
              <textarea
                onChange={(event) =>
                  setDraftField("outcome", event.target.value)
                }
                readOnly={!editable}
                rows={3}
                value={draft.outcome}
              />
            </label>
            <label className="candidate-premise-field">
              <span>
                Candidate premise
                <small>Inference · confirmation required</small>
              </span>
              <textarea
                onChange={(event) =>
                  setDraftField("premise", event.target.value)
                }
                readOnly={!editable}
                rows={3}
                value={draft.premise}
              />
              <span className="source-link">
                ↳ Evidence {evidence.evidenceId.slice(0, 18)}…
              </span>
            </label>
            <div className="candidate-split">
              <label>
                Retained dissent
                <textarea
                  onChange={(event) =>
                    setDraftField("dissentReason", event.target.value)
                  }
                  readOnly={!editable}
                  rows={3}
                  value={draft.dissentReason}
                />
              </label>
              <label>
                Bounded Action
                <textarea
                  onChange={(event) =>
                    setDraftField("actionScope", event.target.value)
                  }
                  readOnly={!editable}
                  rows={3}
                  value={draft.actionScope}
                />
              </label>
            </div>
            <label>
              Monitor condition
              <textarea
                onChange={(event) =>
                  setDraftField("monitorCondition", event.target.value)
                }
                readOnly={!editable}
                rows={2}
                value={draft.monitorCondition}
              />
            </label>
          </div>
        </div>
      ) : null}

      {phase === "manual-edit" ? (
        <button
          className="forge-primary full"
          onClick={() => void createManualCandidate()}
          type="button"
        >
          Create human-authored candidate
        </button>
      ) : null}

      {phase === "candidate" && premiseCandidate !== undefined ? (
        <div className="candidate-actions">
          <button
            className="confirm-premise"
            onClick={() => void disposePremise("confirmed")}
            type="button"
          >
            Confirm edited premise
          </button>
          <button
            className="reject-premise"
            onClick={() => void disposePremise("rejected")}
            type="button"
          >
            Reject premise
          </button>
        </div>
      ) : null}

      {phase === "confirming" || phase === "saving" ? (
        <p className="forge-status" role="status">
          Recording the facilitator action…
        </p>
      ) : null}

      {phase === "premise-confirmed" ? (
        <div className="confirmation-stripe" role="status">
          <span>Human confirmed</span>
          <strong>Premise, dissent, and Action are now canonical.</strong>
          <button onClick={() => void saveDraft()} type="button">
            Save Decision draft
          </button>
        </div>
      ) : null}

      {phase === "premise-rejected" ? (
        <div className="rejection-stripe" role="status">
          <strong>Premise rejected</strong>
          <p>No linked premise, dissent, Action, or Decision was published.</p>
          <button onClick={startManualEdit} type="button">
            Edit a manual alternative
          </button>
        </div>
      ) : null}

      {phase === "draft" && decision !== undefined ? (
        <div className="lifecycle-gate">
          <div>
            <span>Revision 1 · immutable DRAFT</span>
            <strong>All 5 readiness conditions are assembled</strong>
          </div>
          <button onClick={() => void markReady()} type="button">
            Validate and mark ready
          </button>
        </div>
      ) : null}

      {phase === "ready" && decision !== undefined ? (
        <div className="commit-gate">
          <div className="commit-lock" aria-hidden="true">
            ◇
          </div>
          <div>
            <span>DECISION_READY</span>
            <strong>Commitment requires one explicit facilitator action</strong>
            <p>AI cannot press this control or create a committed revision.</p>
          </div>
          <button onClick={() => void commit()} type="button">
            Commit Decision
          </button>
        </div>
      ) : null}

      {phase === "committing" ? (
        <div className="commit-transition" role="status">
          <span aria-hidden="true">◇</span>
          Freezing the committed revision…
        </div>
      ) : null}

      {phase === "committed" && decision !== undefined ? (
        <div className="committed-decision" aria-live="polite">
          <div className="commit-seal" aria-hidden="true">
            <span>✓</span>
          </div>
          <div>
            <p className="zone-label shared">Human committed</p>
            <h3>{decision.snapshot.title}</h3>
            <p>{decision.snapshot.outcome}</p>
          </div>
          <span className="revision-marker">
            Revision {decision.activeRevision} · COMMITTED
          </span>
          <div className="lineage-strip">
            {history?.revisions.map((revision, index) => (
              <div key={revision.revisionId}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <strong>{revision.snapshot.status}</strong>
                <small>
                  {revision.previousRevisionId === undefined
                    ? "Origin revision"
                    : `From ${revision.previousRevisionId.slice(0, 10)}…`}
                </small>
              </div>
            ))}
          </div>
          <div className="audit-line">
            {audit?.entries.map((entry) => (
              <span key={entry.auditId}>
                {entry.eventType.replace("Decision", "")}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {error === undefined ? null : (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

function WorkspaceShell({
  meeting,
  session,
  onBack,
  onPositionChange,
}: {
  readonly meeting: AssignedMeeting;
  readonly session: StoredSession;
  readonly onBack: () => void;
  readonly onPositionChange: (position: AssignedMeeting["position"]) => void;
}) {
  const [position, setPosition] = useState(meeting.position);
  const [phase, setPhase] = useState<
    | "ai-unavailable"
    | "approved"
    | "approving"
    | "idle"
    | "preparing"
    | "preview"
    | "rejected"
  >("idle");
  const [preview, setPreview] = useState<PreviewDisclosureResponse>();
  const [proposalOrigin, setProposalOrigin] = useState<
    "ai_assisted" | "human_selected"
  >();
  const [evidence, setEvidence] = useState<SharedEvidence>();
  const [sharedDecision, setSharedDecision] = useState<DecisionView>();
  const [error, setError] = useState<string>();
  const [selectedSnippet, setSelectedSnippet] = useState(
    SYNTHETIC_EXACT_SNIPPET,
  );
  const commandKeys = useRef({
    approve: crypto.randomUUID(),
    preview: crypto.randomUUID(),
    proposeAi: crypto.randomUUID(),
    proposeManual: crypto.randomUUID(),
    register: crypto.randomUUID(),
    reject: crypto.randomUUID(),
  });

  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([
      listSharedEvidence(session, meeting.meetingId, controller.signal),
      listSharedDecisions(session, meeting.meetingId, controller.signal),
    ])
      .then(([evidenceState, decisionState]) => {
        const nextPosition =
          evidenceState.position >= decisionState.position
            ? evidenceState.position
            : decisionState.position;
        setPosition(nextPosition);
        onPositionChange(nextPosition);
        setEvidence(evidenceState.evidence.at(-1));
        setSharedDecision(decisionState.decisions.at(-1));
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setError(messageFor(cause));
        }
      });
    return () => controller.abort();
  }, [meeting.meetingId, session]);

  function advancePosition(nextPosition: AssignedMeeting["position"]) {
    setPosition(nextPosition);
    onPositionChange(nextPosition);
  }

  async function preparePreview(assistance: "ai_preferred" | "manual") {
    setPhase("preparing");
    setError(undefined);
    try {
      const exactSnippet = selectedSnippet.trim();
      const start = SYNTHETIC_PRIVATE_NOTE.indexOf(exactSnippet);
      if (exactSnippet.length === 0 || start < 0) {
        throw new ApiError(
          "VALIDATION_FAILED",
          "Choose an exact excerpt from the staged private note.",
        );
      }
      const sourceRange = { end: start + exactSnippet.length, start };
      const registered = await registerPrivateTextSource(session, {
        expectedPosition: position,
        idempotencyKey: commandKeys.current.register,
        meetingId: meeting.meetingId,
        text: SYNTHETIC_PRIVATE_NOTE,
        title: "Regional launch readiness note",
      });
      advancePosition(registered.position);
      const proposed = await proposeDisclosure(session, {
        assistance,
        exactSnippet,
        expectedPosition: registered.position,
        idempotencyKey:
          assistance === "ai_preferred"
            ? commandKeys.current.proposeAi
            : commandKeys.current.proposeManual,
        meetingId: meeting.meetingId,
        sourceArtifactId: registered.source.sourceArtifactId,
        sourceRange,
      });
      advancePosition(proposed.position);
      const proposedPayload = proposed.candidate.outgoingPayload;
      setSelectedSnippet(proposedPayload.exactSnippet);
      setProposalOrigin(proposed.origin);
      const prepared = await previewDisclosure(session, {
        candidateId: proposed.candidate.candidateId,
        exactSnippet: proposedPayload.exactSnippet,
        expectedPosition: proposed.position,
        idempotencyKey: commandKeys.current.preview,
        meetingId: meeting.meetingId,
        sourceRange: proposedPayload.sourceRange,
      });
      advancePosition(prepared.position);
      setPreview(prepared);
      setPhase("preview");
    } catch (cause) {
      setError(messageFor(cause));
      setPhase(
        assistance === "ai_preferred" &&
          cause instanceof ApiError &&
          cause.code === "OPENAI_UNAVAILABLE"
          ? "ai-unavailable"
          : "idle",
      );
    }
  }

  async function approvePreview() {
    if (preview === undefined) {
      return;
    }
    setPhase("approving");
    setError(undefined);
    try {
      const approved = await approveDisclosure(session, {
        candidateId: preview.candidateId,
        expectedPosition: position,
        idempotencyKey: commandKeys.current.approve,
        meetingId: meeting.meetingId,
        previewHash: preview.previewHash,
      });
      advancePosition(approved.position);
      setEvidence(approved.evidence);
      setPhase("approved");
    } catch (cause) {
      setError(messageFor(cause));
      setPhase("preview");
    }
  }

  async function keepPrivate() {
    if (preview === undefined) {
      return;
    }
    setPhase("approving");
    setError(undefined);
    try {
      const rejected = await rejectDisclosure(session, {
        candidateId: preview.candidateId,
        expectedPosition: position,
        idempotencyKey: commandKeys.current.reject,
        meetingId: meeting.meetingId,
        reason: "Participant chose to keep the staged excerpt private.",
      });
      advancePosition(rejected.position);
      setPhase("rejected");
    } catch (cause) {
      setError(messageFor(cause));
      setPhase("preview");
    }
  }

  return (
    <main className="workspace-shell">
      <header className="topbar workspace-topbar">
        <Brand />
        <div className="workspace-title">
          <span className="live-dot" />
          <span>
            <strong>{meeting.purpose}</strong>
            <small>Staged synthetic demo story</small>
          </span>
        </div>
        <button className="quiet-button" onClick={onBack} type="button">
          ← Meetings
        </button>
      </header>

      <nav className="progress-rail" aria-label="Flagship progress">
        <span className="complete">01 Context</span>
        <span className="current">02 Permission</span>
        <span>03 Commitment</span>
        <span>04 Risk</span>
        <span>05 Review</span>
      </nav>

      <section className="workspace-grid">
        <article className="private-zone">
          <header>
            <div>
              <p className="zone-label private">Private · Owner only</p>
              <h1>{session.userId} workspace</h1>
            </div>
            <span className="origin-tag">Human + Source</span>
          </header>
          <div className="source-card">
            <div className="source-icon" aria-hidden="true">
              §
            </div>
            <div>
              <span className="source-type">Synthetic source</span>
              <h2>Regional launch readiness note</h2>
              <p>
                Visible only here. No private-existence hint reaches the shared
                room.
              </p>
            </div>
          </div>
          <section className="private-assistant" aria-label="Private assistant">
            <div className="assistant-signal" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
            <div>
              <span className="source-type">Private assistant</span>
              <strong>Suggests one grounded excerpt</strong>
              <p>
                Owner-only input. The model cannot publish; your exact preview
                and approval remain required.
              </p>
            </div>
            <span className="assistant-boundary">Suggestion only</span>
          </section>
          <div className="channel-choice">
            <button className="channel active" type="button">
              <span aria-hidden="true">◉</span>
              <span>
                <strong>Speak privately</strong>
                <small>Private agent context</small>
              </span>
            </button>
            <button className="channel" type="button">
              <span aria-hidden="true">◎</span>
              <span>
                <strong>Prepare for room</strong>
                <small>Exact preview required</small>
              </span>
            </button>
          </div>
          <div className="workspace-input">
            <label htmlFor="private-note">Staged private note</label>
            <textarea
              id="private-note"
              readOnly
              rows={5}
              value={SYNTHETIC_PRIVATE_NOTE}
            />
            <label htmlFor="selected-excerpt">Exact excerpt to preview</label>
            <textarea
              id="selected-excerpt"
              onChange={(event) => setSelectedSnippet(event.target.value)}
              readOnly={phase !== "idle"}
              rows={2}
              value={selectedSnippet}
            />
            <small className="excerpt-hint">
              Edit this selection using an exact span from the private note.
            </small>
            {phase === "idle" ? (
              <button
                className="prepare-button"
                onClick={() => void preparePreview("ai_preferred")}
                type="button"
              >
                Prepare grounded sharing preview
              </button>
            ) : null}
            {phase === "preparing" ? (
              <button disabled type="button">
                Building private preview…
              </button>
            ) : null}
            {phase === "ai-unavailable" ? (
              <div className="assistant-recovery" role="alert">
                <strong>Private assistant is temporarily unavailable</strong>
                <p>
                  Your source remains private. Retry the suggestion or continue
                  with the exact excerpt you selected.
                </p>
                <div>
                  <button
                    className="prepare-button"
                    onClick={() => void preparePreview("ai_preferred")}
                    type="button"
                  >
                    Retry private assistant
                  </button>
                  <button
                    className="manual-button"
                    onClick={() => void preparePreview("manual")}
                    type="button"
                  >
                    Continue with manual excerpt
                  </button>
                </div>
              </div>
            ) : null}
          </div>
          {error === undefined || phase === "ai-unavailable" ? null : (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          {phase === "preview" ||
          phase === "approving" ||
          phase === "approved" ? (
            <section
              aria-labelledby="outgoing-preview-title"
              className="disclosure-preview"
            >
              <div className="preview-heading">
                <div>
                  <p className="zone-label private">Outgoing preview</p>
                  <h2 id="outgoing-preview-title">Review the exact payload</h2>
                </div>
                <span className="preview-scope">Shared room</span>
              </div>
              <blockquote>{preview?.outgoingPayload.exactSnippet}</blockquote>
              <dl>
                <div>
                  <dt>Source range</dt>
                  <dd>
                    {preview?.outgoingPayload.sourceRange.start}–
                    {preview?.outgoingPayload.sourceRange.end}
                  </dd>
                </div>
                <div>
                  <dt>Origin</dt>
                  <dd>
                    {proposalOrigin === "ai_assisted"
                      ? "AI suggestion · owner only"
                      : "Human-selected source excerpt"}
                  </dd>
                </div>
              </dl>
              {phase === "approved" ? (
                <p className="boundary-assurance approved">
                  Shared exactly as previewed. The surrounding private note
                  remains owner-only.
                </p>
              ) : (
                <p className="boundary-assurance">
                  Nothing has been shared yet. Approval publishes only this
                  exact excerpt—not the surrounding private note.
                </p>
              )}
              {phase === "preview" ? (
                <div className="approval-actions">
                  <button
                    className="approve-button"
                    onClick={() => void approvePreview()}
                    type="button"
                  >
                    Approve exact excerpt <span aria-hidden="true">→</span>
                  </button>
                  <button
                    className="keep-private-button"
                    onClick={() => void keepPrivate()}
                    type="button"
                  >
                    Keep private
                  </button>
                </div>
              ) : null}
              {phase === "approving" ? (
                <p className="mutation-status" role="status">
                  Recording your explicit choice…
                </p>
              ) : null}
              {phase === "approved" ? (
                <p className="mutation-status success" role="status">
                  Exact excerpt approved and recorded.
                </p>
              ) : null}
            </section>
          ) : null}
          {phase === "rejected" ? (
            <section className="private-confirmation" role="status">
              <span aria-hidden="true">◇</span>
              <div>
                <strong>Kept private</strong>
                <p>
                  The candidate was rejected. No evidence or existence hint was
                  published to the room.
                </p>
              </div>
            </section>
          ) : null}
        </article>

        <div className="permission-divider" aria-hidden="true">
          <span />
          <strong>Permission gate</strong>
          <span />
        </div>

        <article className="shared-zone">
          <header>
            <div>
              <p className="zone-label shared">Shared · Decision room</p>
              <h1>Commitment canvas</h1>
            </div>
            <span className="confirmation-tag">Human confirmed</span>
          </header>
          {evidence === undefined ? (
            <div className="shared-empty">
              <div className="orbit-mark" aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
              <h2>No evidence has crossed the boundary</h2>
              <p>
                Approved excerpts appear here with source, origin, and
                confirmation labels intact.
              </p>
            </div>
          ) : (
            <article className="shared-evidence" aria-live="polite">
              <div className="evidence-arrival" aria-hidden="true">
                Permission recorded
              </div>
              <p className="zone-label shared">Evidence · Exact excerpt</p>
              <blockquote>{evidence.exactSnippet}</blockquote>
              <div className="evidence-meta">
                <span>Human confirmed</span>
                <span>Source attached</span>
                <span>
                  Range {evidence.sourceRange.start}–{evidence.sourceRange.end}
                </span>
              </div>
              <p className="evidence-id">
                Shared evidence {evidence.evidenceId.slice(0, 18)}…
              </p>
            </article>
          )}
          {meeting.role === "facilitator" && evidence !== undefined ? (
            <FacilitatorDecisionPanel
              evidence={evidence}
              existingDecision={sharedDecision}
              meeting={meeting}
              onDecisionChange={setSharedDecision}
              onPositionChange={advancePosition}
              position={position}
              session={session}
            />
          ) : sharedDecision?.status === "COMMITTED" ? (
            <SharedDecisionCard decision={sharedDecision} />
          ) : (
            <div className="readiness-card">
              <div>
                <span className="source-type">Decision readiness</span>
                <strong>
                  {evidence === undefined
                    ? "0 of 5 conditions assembled"
                    : "1 of 5 conditions assembled"}
                </strong>
              </div>
              <span className="readiness-ring">
                {evidence === undefined ? "0%" : "20%"}
              </span>
            </div>
          )}
        </article>
      </section>
    </main>
  );
}

export function App() {
  const [session, setSession] = useState<StoredSession | undefined>(() =>
    loadStoredSession(),
  );
  const [meetings, setMeetings] = useState<readonly AssignedMeeting[]>([]);
  const [selectedMeeting, setSelectedMeeting] = useState<AssignedMeeting>();
  const [loading, setLoading] = useState(session !== undefined);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (session === undefined) {
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(undefined);
    void listMeetings(session, controller.signal)
      .then(setMeetings)
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setError(messageFor(cause));
          if (
            cause instanceof ApiError &&
            (cause.code === "AUTHENTICATION_REQUIRED" ||
              cause.code === "SESSION_EXPIRED")
          ) {
            clearStoredSession();
            setSession(undefined);
          }
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [session]);

  async function signOut() {
    if (session !== undefined) {
      try {
        await logout(session);
      } finally {
        clearStoredSession();
        setSession(undefined);
        setMeetings([]);
      }
    }
  }

  async function join(code: string) {
    if (session === undefined) {
      return;
    }
    setError(undefined);
    try {
      const joined = await joinMeeting(session, code);
      setMeetings((current) =>
        current.some(({ meetingId }) => meetingId === joined.meetingId)
          ? current
          : [...current, joined],
      );
      setSelectedMeeting(joined);
    } catch (cause) {
      setError(messageFor(cause));
    }
  }

  if (session === undefined) {
    return <LoginScreen onAuthenticated={setSession} />;
  }
  if (selectedMeeting !== undefined) {
    return (
      <WorkspaceShell
        meeting={selectedMeeting}
        onBack={() => setSelectedMeeting(undefined)}
        onPositionChange={(position) => {
          setMeetings((current) =>
            current.map((meeting) =>
              meeting.meetingId === selectedMeeting.meetingId
                ? { ...meeting, position }
                : meeting,
            ),
          );
          setSelectedMeeting((current) =>
            current === undefined ? undefined : { ...current, position },
          );
        }}
        session={session}
      />
    );
  }
  return (
    <MeetingListScreen
      error={error}
      loading={loading}
      meetings={meetings}
      onJoin={join}
      onLogout={signOut}
      onOpen={setSelectedMeeting}
      session={session}
    />
  );
}
