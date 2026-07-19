import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import type {
  AssignedMeeting,
  Decision as DecisionView,
  DecisionAuditResponse,
  DecisionHistoryResponse,
  DecisionJsonExportResponse,
  DispositionSharedDecisionCandidateResponse,
  ExternalEventReceipt,
  InvalidationEvaluation,
  IssueDisplayTokenResponse,
  PreviewDisclosureResponse,
  SharedEvidence,
  SharedDecisionSynthesisCandidate,
  SharedDisplayProjectionResponse,
} from "@counterpoint/protocol";

import {
  ApiError,
  approveDisclosure,
  clearAllStoredMeetingByok,
  clearStoredSession,
  commitDecision,
  dispositionSharedDecisionCandidate,
  exportDecisionJson,
  getDecisionAudit,
  getDecisionHistory,
  getSharedDisplayProjection,
  injectDemoRegulatoryChange,
  issueDisplayToken,
  joinMeeting,
  listMeetings,
  listInvalidationEvaluations,
  listSharedDecisions,
  listSharedEvidence,
  listSharedExternalEvents,
  loadStoredSession,
  login,
  logout,
  markDecisionReady,
  previewDisclosure,
  proposeDisclosure,
  registerPrivateTextSource,
  rejectDisclosure,
  resetDemoMeeting,
  revokeDisplayToken,
  reviewInvalidation,
  resolveDecisionReview,
  saveDecisionDraft,
  storeSession,
  startDecisionMonitoring,
  synthesizeSharedDecisionCandidate,
  type StoredSession,
} from "./api.js";
import { RealtimePanel } from "./realtime-panel.js";

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

function SharedDecisionCard({
  decision,
  externalEvent,
  invalidation,
}: {
  readonly decision: DecisionView;
  readonly externalEvent: ExternalEventReceipt | undefined;
  readonly invalidation: InvalidationEvaluation | undefined;
}) {
  const readinessCount = Object.values(decision.readiness).filter(
    Boolean,
  ).length;
  const review = invalidation?.review;
  const activeRisk = decision.status === "AT_RISK";
  const recommitted =
    decision.status === "COMMITTED" &&
    review?.disposition === "confirm_invalidation";

  return (
    <section
      aria-labelledby={`shared-decision-${decision.decisionId}`}
      className={`shared-decision-card${activeRisk ? " at-risk" : ""}${decision.status === "REVIEW_REQUIRED" ? " review-required" : ""}`}
    >
      <div className="shared-decision-seal" aria-hidden="true">
        {activeRisk ? "!" : decision.status === "REVIEW_REQUIRED" ? "↺" : "✓"}
      </div>
      <div>
        <p className="zone-label shared">
          {activeRisk
            ? "Shared · AI inferred risk"
            : decision.status === "REVIEW_REQUIRED"
              ? "Shared · Human confirmed review"
              : recommitted
                ? "Shared · Human recommitted"
                : decision.status === "SUPERSEDED"
                  ? "Shared · Replaced Decision"
                  : decision.status === "REJECTED"
                    ? "Shared · Closed without replacement"
                    : review?.disposition === "reject_suggestion"
                      ? "Shared · Facilitator rejected suggestion"
                      : "Shared · Human committed"}
        </p>
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
      {externalEvent === undefined ? null : (
        <div className="shared-regulatory-event">
          <span>External event received</span>
          <strong>{externalEvent.jurisdiction}</strong>
          <small>
            {invalidation === undefined
              ? "Evaluation pending · Decision remains MONITORING"
              : activeRisk
                ? "Evaluation recorded · Human review still required"
                : review?.disposition === "confirm_invalidation"
                  ? "Impact confirmed · Decision revision required"
                  : "Suggestion reviewed · Monitoring continues"}
          </small>
        </div>
      )}
      {invalidation === undefined ? null : (
        <div
          className={`shared-risk-suggestion${activeRisk ? "" : " reviewed"}`}
          role="status"
        >
          <span>
            {activeRisk
              ? "AT_RISK · AI suggestion"
              : review?.disposition === "confirm_invalidation"
                ? recommitted
                  ? `COMMITTED · Revision ${decision.activeRevision}`
                  : decision.status === "SUPERSEDED"
                    ? "SUPERSEDED · Human resolved"
                    : decision.status === "REJECTED"
                      ? "REJECTED · Human resolved"
                      : "REVIEW_REQUIRED · Human confirmed"
                : "AI suggestion rejected by facilitator"}
          </span>
          <strong>
            {Math.round(invalidation.confidence * 100)}% confidence
          </strong>
          <p>{invalidation.reason}</p>
          <small>
            {review === undefined
              ? `${invalidation.affectedPremiseIds.length} affected premise · ${invalidation.affectedActionIds.length} affected Action · no automatic review confirmation`
              : `Facilitator reason: ${review.reason}`}
          </small>
          {review?.disposition === "confirm_invalidation" ? (
            <div className="shared-review-outcome">
              <span>{review.heldActionIds.length} affected Action held</span>
              <span>
                Reconsideration task{" "}
                {review.reconsiderationTask?.state ?? "open"}
              </span>
              <span>Committed revision remains immutable</span>
              {decision.status === "SUPERSEDED" ? (
                <span>
                  Replacement {decision.supersededByDecisionId ?? "recorded"}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}

function FacilitatorDecisionPanel({
  evidence,
  existingDecision,
  existingExternalEvent,
  existingInvalidation,
  meeting,
  onDecisionChange,
  onExternalEventChange,
  onInvalidationChange,
  onPositionChange,
  position,
  session,
}: {
  readonly evidence: SharedEvidence;
  readonly existingDecision: DecisionView | undefined;
  readonly existingExternalEvent: ExternalEventReceipt | undefined;
  readonly existingInvalidation: InvalidationEvaluation | undefined;
  readonly meeting: AssignedMeeting;
  readonly onDecisionChange: (decision: DecisionView) => void;
  readonly onExternalEventChange: (event: ExternalEventReceipt) => void;
  readonly onInvalidationChange: (evaluation: InvalidationEvaluation) => void;
  readonly onPositionChange: (position: AssignedMeeting["position"]) => void;
  readonly position: AssignedMeeting["position"];
  readonly session: StoredSession;
}) {
  const [phase, setPhase] = useState<
    | "ai-unavailable"
    | "at-risk"
    | "candidate"
    | "committed"
    | "committing"
    | "confirming"
    | "draft"
    | "idle"
    | "manual-edit"
    | "monitoring"
    | "premise-confirmed"
    | "premise-rejected"
    | "ready"
    | "recommitted"
    | "review-rejected"
    | "review-required"
    | "reviewing"
    | "resolving"
    | "saving"
    | "starting-monitor"
    | "superseded"
    | "synthesizing"
    | "decision-rejected"
  >(
    existingDecision?.status === "SUPERSEDED"
      ? "superseded"
      : existingDecision?.status === "REJECTED"
        ? "decision-rejected"
        : existingDecision?.status === "COMMITTED" &&
            existingInvalidation?.review?.disposition === "confirm_invalidation"
          ? "recommitted"
          : existingDecision?.status === "REVIEW_REQUIRED"
            ? "review-required"
            : existingDecision?.status === "AT_RISK"
              ? "at-risk"
              : existingDecision?.status === "MONITORING" &&
                  existingInvalidation?.review?.disposition ===
                    "reject_suggestion"
                ? "review-rejected"
                : existingDecision?.status === "MONITORING"
                  ? "monitoring"
                  : existingDecision?.status === "COMMITTED"
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
  const [externalEvent, setExternalEvent] = useState(existingExternalEvent);
  const [invalidation, setInvalidation] = useState(existingInvalidation);
  const [reviewReason, setReviewReason] = useState("");
  const [resolutionChoice, setResolutionChoice] = useState<
    "recommit_revision" | "reject_decision" | "supersede_decision"
  >("recommit_revision");
  const [resolutionDraft, setResolutionDraft] = useState({
    changeReason:
      "Regulatory change requires a revised approval gate before launch.",
    monitorCondition:
      existingDecision?.snapshot.monitorCondition.description ??
      "Monitor the revised approval gate before resuming launch.",
    outcome:
      existingDecision?.snapshot.outcome ??
      "Pause regional launch until the revised approval gate is satisfied.",
    rejectionReason:
      "The Decision can no longer proceed under the changed regulation.",
    replacementDecisionId: "",
    title:
      existingDecision?.snapshot.title ?? "Revised conditional regional launch",
  });
  const [decisionExport, setDecisionExport] =
    useState<DecisionJsonExportResponse>();
  const [receivingExternalEvent, setReceivingExternalEvent] = useState(false);
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
    monitor: crypto.randomUUID(),
    regulatoryEvent: crypto.randomUUID(),
    ready: crypto.randomUUID(),
    reject: crypto.randomUUID(),
    resolutionRecommit: crypto.randomUUID(),
    resolutionReject: crypto.randomUUID(),
    resolutionSupersede: crypto.randomUUID(),
    riskConfirm: crypto.randomUUID(),
    riskReject: crypto.randomUUID(),
    save: crypto.randomUUID(),
    synthesize: crypto.randomUUID(),
  });

  useEffect(() => {
    if (
      existingDecision?.status !== "COMMITTED" &&
      existingDecision?.status !== "MONITORING" &&
      existingDecision?.status !== "AT_RISK" &&
      existingDecision?.status !== "REVIEW_REQUIRED" &&
      existingDecision?.status !== "SUPERSEDED" &&
      existingDecision?.status !== "REJECTED"
    ) {
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

  async function startMonitoring() {
    if (decision === undefined) {
      return;
    }
    setPhase("starting-monitor");
    setError(undefined);
    try {
      const response = await startDecisionMonitoring(session, {
        decisionId: decision.decisionId,
        expectedPosition: position,
        idempotencyKey: commandKeys.current.monitor,
        meetingId: meeting.meetingId,
      });
      advancePosition(response.position);
      setDecision(response.decision);
      onDecisionChange(response.decision);
      const nextAudit = await getDecisionAudit(session, {
        decisionId: response.decision.decisionId,
        meetingId: meeting.meetingId,
      });
      setAudit(nextAudit);
      setPhase("monitoring");
    } catch (cause) {
      setError(messageFor(cause));
      setPhase("committed");
    }
  }

  async function injectRegulatoryEvent() {
    setReceivingExternalEvent(true);
    setError(undefined);
    try {
      const response = await injectDemoRegulatoryChange(session, {
        idempotencyKey: commandKeys.current.regulatoryEvent,
        meetingId: meeting.meetingId,
      });
      advancePosition(response.position);
      setExternalEvent(response.event);
      onExternalEventChange(response.event);
      const [evaluationState, decisionState, nextAudit] = await Promise.all([
        listInvalidationEvaluations(session, meeting.meetingId),
        listSharedDecisions(session, meeting.meetingId),
        decision === undefined
          ? Promise.resolve(undefined)
          : getDecisionAudit(session, {
              decisionId: decision.decisionId,
              meetingId: meeting.meetingId,
            }),
      ]);
      const nextEvaluation = evaluationState.evaluations.at(-1);
      const nextDecision = decisionState.decisions.at(-1);
      if (nextEvaluation !== undefined && nextDecision !== undefined) {
        setInvalidation(nextEvaluation);
        onInvalidationChange(nextEvaluation);
        setDecision(nextDecision);
        onDecisionChange(nextDecision);
        setAudit(nextAudit);
        advancePosition(
          evaluationState.position >= decisionState.position
            ? evaluationState.position
            : decisionState.position,
        );
        setPhase("at-risk");
      }
    } catch (cause) {
      setError(messageFor(cause));
    } finally {
      setReceivingExternalEvent(false);
    }
  }

  async function submitInvalidationReview(
    disposition: "confirm_invalidation" | "reject_suggestion",
  ) {
    if (decision === undefined || invalidation === undefined) {
      return;
    }
    const reason = reviewReason.trim();
    if (reason.length === 0) {
      setError("Enter a facilitator review reason before choosing an outcome.");
      return;
    }
    setPhase("reviewing");
    setError(undefined);
    try {
      const response = await reviewInvalidation(session, {
        decisionId: decision.decisionId,
        disposition,
        expectedPosition: position,
        idempotencyKey:
          disposition === "confirm_invalidation"
            ? commandKeys.current.riskConfirm
            : commandKeys.current.riskReject,
        meetingId: meeting.meetingId,
        reason,
        suggestionId: invalidation.suggestionId,
      });
      const [evaluationState, decisionState, nextAudit] = await Promise.all([
        listInvalidationEvaluations(session, meeting.meetingId),
        listSharedDecisions(session, meeting.meetingId),
        getDecisionAudit(session, {
          decisionId: decision.decisionId,
          meetingId: meeting.meetingId,
        }),
      ]);
      const nextInvalidation = evaluationState.evaluations.at(-1);
      const nextDecision = decisionState.decisions.at(-1) ?? response.decision;
      advancePosition(
        [response.position, evaluationState.position, decisionState.position]
          .sort((left, right) => left - right)
          .at(-1) ?? response.position,
      );
      setDecision(nextDecision);
      onDecisionChange(nextDecision);
      setAudit(nextAudit);
      if (nextInvalidation !== undefined) {
        setInvalidation(nextInvalidation);
        onInvalidationChange(nextInvalidation);
      }
      setPhase(
        disposition === "confirm_invalidation"
          ? "review-required"
          : "review-rejected",
      );
    } catch (cause) {
      setError(messageFor(cause));
      setPhase("at-risk");
    }
  }

  function setResolutionField(
    field: keyof typeof resolutionDraft,
    value: string,
  ) {
    setResolutionDraft((current) => ({ ...current, [field]: value }));
  }

  async function submitDecisionResolution() {
    if (decision === undefined) {
      return;
    }
    if (
      (resolutionChoice === "recommit_revision" &&
        resolutionDraft.changeReason.trim().length === 0) ||
      (resolutionChoice === "reject_decision" &&
        resolutionDraft.rejectionReason.trim().length === 0) ||
      (resolutionChoice === "supersede_decision" &&
        resolutionDraft.replacementDecisionId.trim().length === 0)
    ) {
      setError("Complete the required resolution field before continuing.");
      return;
    }
    setPhase("resolving");
    setError(undefined);
    try {
      const common = {
        decisionId: decision.decisionId,
        expectedPosition: position,
        meetingId: meeting.meetingId,
      };
      const response = await resolveDecisionReview(
        session,
        resolutionChoice === "recommit_revision"
          ? {
              ...common,
              changeReason: resolutionDraft.changeReason.trim(),
              idempotencyKey: commandKeys.current.resolutionRecommit,
              monitorCondition: {
                description: resolutionDraft.monitorCondition.trim(),
              },
              outcome: resolutionDraft.outcome.trim(),
              resolution: "recommit_revision",
              title: resolutionDraft.title.trim(),
            }
          : resolutionChoice === "supersede_decision"
            ? {
                ...common,
                idempotencyKey: commandKeys.current.resolutionSupersede,
                replacementDecisionId:
                  resolutionDraft.replacementDecisionId.trim(),
                resolution: "supersede_decision",
              }
            : {
                ...common,
                idempotencyKey: commandKeys.current.resolutionReject,
                reason: resolutionDraft.rejectionReason.trim(),
                resolution: "reject_decision",
              },
      );
      const [nextHistory, nextAudit, exported] = await Promise.all([
        getDecisionHistory(session, {
          decisionId: response.decision.decisionId,
          meetingId: meeting.meetingId,
        }),
        getDecisionAudit(session, {
          decisionId: response.decision.decisionId,
          meetingId: meeting.meetingId,
        }),
        exportDecisionJson(session, {
          decisionId: response.decision.decisionId,
          meetingId: meeting.meetingId,
        }),
      ]);
      advancePosition(response.position);
      setDecision(response.decision);
      onDecisionChange(response.decision);
      setHistory(nextHistory);
      setAudit(nextAudit);
      setDecisionExport(exported);
      setPhase(
        response.resolution === "recommit_revision"
          ? "recommitted"
          : response.resolution === "supersede_decision"
            ? "superseded"
            : "decision-rejected",
      );
    } catch (cause) {
      setError(messageFor(cause));
      setPhase("review-required");
    }
  }

  async function prepareDecisionExport() {
    if (decision === undefined) {
      return;
    }
    try {
      setDecisionExport(
        await exportDecisionJson(session, {
          decisionId: decision.decisionId,
          meetingId: meeting.meetingId,
        }),
      );
    } catch (cause) {
      setError(messageFor(cause));
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

      {phase === "starting-monitor" ? (
        <div className="commit-transition" role="status">
          <span aria-hidden="true">◎</span>
          Registering the Decision monitor…
        </div>
      ) : null}

      {(phase === "committed" ||
        phase === "monitoring" ||
        phase === "at-risk" ||
        phase === "reviewing" ||
        phase === "review-required" ||
        phase === "review-rejected" ||
        phase === "resolving" ||
        phase === "recommitted" ||
        phase === "superseded" ||
        phase === "decision-rejected") &&
      decision !== undefined ? (
        <div
          className={`committed-decision${
            phase === "at-risk" || phase === "reviewing" ? " at-risk" : ""
          }${phase === "review-required" ? " review-required" : ""}`}
          aria-live="polite"
        >
          <div className="commit-seal" aria-hidden="true">
            <span>
              {phase === "at-risk" || phase === "reviewing"
                ? "!"
                : phase === "review-required"
                  ? "↺"
                  : "✓"}
            </span>
          </div>
          <div>
            <p className="zone-label shared">
              {phase === "at-risk" || phase === "reviewing"
                ? "AT_RISK · AI suggestion"
                : phase === "review-required"
                  ? "REVIEW_REQUIRED · Human confirmed"
                  : phase === "recommitted"
                    ? `COMMITTED · Revision ${decision.activeRevision}`
                    : phase === "superseded"
                      ? "SUPERSEDED · Human resolved"
                      : phase === "decision-rejected"
                        ? "REJECTED · Human resolved"
                        : phase === "review-rejected"
                          ? "Monitoring · AI suggestion rejected"
                          : phase === "monitoring"
                            ? "Monitoring active"
                            : "Human committed"}
            </p>
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
          <div className="resolution-export committed-export">
            <button onClick={() => void prepareDecisionExport()} type="button">
              Prepare Decision JSON export
            </button>
            {decisionExport === undefined ? null : (
              <a
                download={`counterpoint-${decision.decisionId}.json`}
                href={`data:application/json;charset=utf-8,${encodeURIComponent(
                  JSON.stringify(decisionExport, null, 2),
                )}`}
              >
                Download JSON · {decisionExport.revisions.length} revisions ·{" "}
                {decisionExport.auditEntries.length} audit entries
              </a>
            )}
          </div>
          {phase === "committed" ? (
            <button
              className="monitor-button"
              onClick={() => void startMonitoring()}
              type="button"
            >
              Start Decision monitor
            </button>
          ) : phase === "monitoring" ||
            phase === "at-risk" ||
            phase === "reviewing" ||
            phase === "review-rejected" ? (
            <div className="monitor-active">
              <span>◎ Monitoring</span>
              <small>
                Registration{" "}
                {decision.snapshot.monitorCondition.registrationId?.slice(
                  0,
                  18,
                )}
                …
              </small>
            </div>
          ) : null}
          {phase === "monitoring" && externalEvent === undefined ? (
            <div className="demo-event-control">
              <span>Staged demo story</span>
              <p>
                Injects one synthetic regulatory event. It does not confirm a
                review or change this Decision automatically.
              </p>
              <small>
                Expected demo impact · European Union · first confirmed regional
                premise and its linked Action
              </small>
              <button
                disabled={receivingExternalEvent}
                onClick={() => void injectRegulatoryEvent()}
                type="button"
              >
                {receivingExternalEvent
                  ? "Receiving event…"
                  : "Inject staged regulatory event"}
              </button>
            </div>
          ) : null}
          {externalEvent === undefined ? null : (
            <div className="regulatory-event-receipt" role="status">
              <span>Staged demo event · External event received</span>
              <strong>{externalEvent.jurisdiction}</strong>
              <p>{externalEvent.description}</p>
              <small>
                {invalidation === undefined
                  ? "Evaluation pending · Decision remains MONITORING"
                  : "Evaluation recorded · Human review still required"}{" "}
                · Effective {externalEvent.effectiveAt.slice(0, 10)}
              </small>
            </div>
          )}
          {invalidation === undefined ? null : (
            <div
              className={`invalidation-risk-pulse${
                invalidation.review === undefined ? "" : " reviewed"
              }`}
              role="status"
            >
              <div className="risk-pulse-orbit" aria-hidden="true">
                <span>!</span>
              </div>
              <div>
                <span>
                  {invalidation.review === undefined
                    ? "AI inferred · Human review required"
                    : invalidation.review.disposition === "confirm_invalidation"
                      ? "Human reviewed · Impact confirmed"
                      : "Human reviewed · Suggestion rejected"}
                </span>
                <strong>
                  Assumption invalidation suggested ·{" "}
                  {Math.round(invalidation.confidence * 100)}%
                </strong>
                <p>{invalidation.reason}</p>
                <div className="risk-reference-chain">
                  <span>
                    Premise {invalidation.affectedPremiseIds[0]?.slice(0, 12)}…
                  </span>
                  <span aria-hidden="true">→</span>
                  <span>
                    Action {invalidation.affectedActionIds[0]?.slice(0, 12)}…
                  </span>
                </div>
                <small>
                  Revision {decision.activeRevision} remains immutable ·{" "}
                  {invalidation.review === undefined
                    ? "REVIEW_REQUIRED has not been confirmed"
                    : `Facilitator reason: ${invalidation.review.reason}`}
                </small>
              </div>
            </div>
          )}
          {invalidation === undefined ? null : (
            <section
              aria-labelledby="facilitator-risk-review-title"
              className={`review-workbench${
                invalidation.review?.disposition === "confirm_invalidation"
                  ? " review-confirmed"
                  : invalidation.review?.disposition === "reject_suggestion"
                    ? " review-rejected"
                    : ""
              }`}
              role="region"
            >
              <div className="review-workbench-heading">
                <div>
                  <span>Facilitator authority boundary</span>
                  <h4 id="facilitator-risk-review-title">
                    Facilitator risk review
                  </h4>
                </div>
                <strong>
                  {invalidation.review === undefined
                    ? "Decision pending"
                    : invalidation.review.disposition === "confirm_invalidation"
                      ? "Review required"
                      : "Monitoring resumed"}
                </strong>
              </div>
              <div className="review-reference-grid">
                <article className="review-reference-card">
                  <span>External event</span>
                  <strong>
                    {externalEvent?.jurisdiction ?? "Staged jurisdiction"}
                  </strong>
                  <p>{externalEvent?.description}</p>
                  <small>
                    {externalEvent?.source} ·{" "}
                    {externalEvent?.effectiveAt.slice(0, 10)}
                  </small>
                </article>
                <article
                  className="review-reference-card"
                  data-testid="review-affected-premise"
                >
                  <span>Affected premise</span>
                  <strong>{invalidation.affectedPremiseIds[0]}</strong>
                  <p>{evidence.exactSnippet}</p>
                </article>
                <article
                  className="review-reference-card"
                  data-testid="review-evidence"
                >
                  <span>Reviewed Evidence</span>
                  <strong>{invalidation.evidenceReferenceIds[0]}</strong>
                  <p>Exact shared excerpt retained with source provenance.</p>
                </article>
                <article
                  className="review-reference-card"
                  data-testid="review-affected-action"
                >
                  <span>Affected Action</span>
                  <strong>{invalidation.affectedActionIds[0]}</strong>
                  <p>
                    {invalidation.review?.disposition === "confirm_invalidation"
                      ? "Held pending Decision revision"
                      : "Active until a facilitator confirms impact"}
                  </p>
                </article>
              </div>
              <div className="review-model-reason">
                <span>
                  AI inferred · {invalidation.model} ·{" "}
                  {Math.round(invalidation.confidence * 100)}%
                </span>
                <p>{invalidation.reason}</p>
              </div>
              {invalidation.review === undefined ? (
                <>
                  <label className="review-reason-field">
                    <span>Facilitator review reason</span>
                    <textarea
                      disabled={phase === "reviewing"}
                      onChange={(event) => setReviewReason(event.target.value)}
                      placeholder="Record why this evidence does or does not change the Decision."
                      rows={3}
                      value={reviewReason}
                    />
                  </label>
                  <div className="review-actions">
                    <button
                      disabled={phase === "reviewing"}
                      onClick={() =>
                        void submitInvalidationReview("confirm_invalidation")
                      }
                      type="button"
                    >
                      Confirm impact and open review
                    </button>
                    <button
                      className="review-reject-button"
                      disabled={phase === "reviewing"}
                      onClick={() =>
                        void submitInvalidationReview("reject_suggestion")
                      }
                      type="button"
                    >
                      Reject AI suggestion
                    </button>
                  </div>
                  {phase === "reviewing" ? (
                    <p className="review-recording" role="status">
                      Recording facilitator review…
                    </p>
                  ) : null}
                </>
              ) : (
                <div className="review-outcome">
                  <span>
                    {invalidation.review.disposition === "confirm_invalidation"
                      ? "REVIEW_REQUIRED · Human confirmed"
                      : "AI suggestion rejected by facilitator"}
                  </span>
                  <strong>{invalidation.review.reason}</strong>
                  {invalidation.review.disposition ===
                  "confirm_invalidation" ? (
                    <div
                      className="reconsideration-task-card"
                      data-testid="reconsideration-task"
                    >
                      <span>Reconsideration task</span>
                      <strong>
                        {invalidation.review.reconsiderationTask?.state ??
                          "open"}
                      </strong>
                      <small>
                        {invalidation.review.heldActionIds.length} affected
                        Action held · revision {decision.activeRevision} remains
                        immutable
                      </small>
                    </div>
                  ) : (
                    <small>
                      No Action held · no reconsideration task · monitor remains
                      active
                    </small>
                  )}
                </div>
              )}
            </section>
          )}
          {invalidation?.review?.disposition === "confirm_invalidation" &&
          phase !== "at-risk" &&
          phase !== "reviewing" ? (
            <section
              aria-labelledby="decision-resolution-title"
              className="resolution-workbench"
              role="region"
            >
              <div className="resolution-heading">
                <div>
                  <span>Append-only Decision history</span>
                  <h4 id="decision-resolution-title">
                    Resolve Decision review
                  </h4>
                </div>
                <strong>
                  {phase === "review-required" || phase === "resolving"
                    ? `REVIEW_REQUIRED · Revision ${decision.activeRevision}`
                    : `${decision.status} · Revision ${decision.activeRevision}`}
                </strong>
              </div>
              {phase === "review-required" || phase === "resolving" ? (
                <>
                  <div className="resolution-options">
                    {(
                      [
                        [
                          "recommit_revision",
                          "Commit revised Decision",
                          "Append revision 3 and preserve revision 2.",
                        ],
                        [
                          "supersede_decision",
                          "Replace this Decision",
                          "Point to a different canonical Decision.",
                        ],
                        [
                          "reject_decision",
                          "Close without replacement",
                          "End this Decision with an audit reason.",
                        ],
                      ] as const
                    ).map(([value, label, description]) => (
                      <label key={value} className="resolution-option">
                        <input
                          checked={resolutionChoice === value}
                          disabled={phase === "resolving"}
                          name="decision-resolution"
                          onChange={() => setResolutionChoice(value)}
                          type="radio"
                          value={value}
                        />
                        <span>
                          <strong>{label}</strong>
                          <small>{description}</small>
                        </span>
                      </label>
                    ))}
                  </div>
                  {resolutionChoice === "recommit_revision" ? (
                    <div className="resolution-recommit-form">
                      <div className="revision-comparison">
                        <article>
                          <span>
                            Before · Revision {decision.activeRevision}
                          </span>
                          <strong>{decision.snapshot.title}</strong>
                          <p>{decision.snapshot.outcome}</p>
                          <small>
                            {decision.snapshot.monitorCondition.description}
                          </small>
                        </article>
                        <article className="proposed">
                          <span>
                            After · Proposed revision{" "}
                            {decision.activeRevision + 1}
                          </span>
                          <strong>{resolutionDraft.title}</strong>
                          <p>{resolutionDraft.outcome}</p>
                          <small>{resolutionDraft.monitorCondition}</small>
                        </article>
                      </div>
                      <label>
                        Revised Decision title
                        <input
                          disabled={phase === "resolving"}
                          onChange={(event) =>
                            setResolutionField("title", event.target.value)
                          }
                          value={resolutionDraft.title}
                        />
                      </label>
                      <label>
                        Revised outcome
                        <textarea
                          disabled={phase === "resolving"}
                          onChange={(event) =>
                            setResolutionField("outcome", event.target.value)
                          }
                          rows={3}
                          value={resolutionDraft.outcome}
                        />
                      </label>
                      <label>
                        Revised monitor condition
                        <textarea
                          disabled={phase === "resolving"}
                          onChange={(event) =>
                            setResolutionField(
                              "monitorCondition",
                              event.target.value,
                            )
                          }
                          rows={2}
                          value={resolutionDraft.monitorCondition}
                        />
                      </label>
                      <label>
                        Revision change reason
                        <textarea
                          disabled={phase === "resolving"}
                          onChange={(event) =>
                            setResolutionField(
                              "changeReason",
                              event.target.value,
                            )
                          }
                          rows={2}
                          value={resolutionDraft.changeReason}
                        />
                      </label>
                    </div>
                  ) : resolutionChoice === "supersede_decision" ? (
                    <label className="resolution-single-field">
                      Replacement Decision ID
                      <input
                        disabled={phase === "resolving"}
                        onChange={(event) =>
                          setResolutionField(
                            "replacementDecisionId",
                            event.target.value,
                          )
                        }
                        placeholder="Select a different canonical Decision ID"
                        value={resolutionDraft.replacementDecisionId}
                      />
                      <small>
                        The replacement must already exist in this meeting. The
                        old revision history remains unchanged.
                      </small>
                    </label>
                  ) : (
                    <label className="resolution-single-field">
                      Decision rejection reason
                      <textarea
                        disabled={phase === "resolving"}
                        onChange={(event) =>
                          setResolutionField(
                            "rejectionReason",
                            event.target.value,
                          )
                        }
                        rows={3}
                        value={resolutionDraft.rejectionReason}
                      />
                      <small>
                        This closes the Decision itself; it does not reject only
                        the AI suggestion.
                      </small>
                    </label>
                  )}
                  <button
                    className="resolution-submit"
                    disabled={phase === "resolving"}
                    onClick={() => void submitDecisionResolution()}
                    type="button"
                  >
                    {phase === "resolving"
                      ? "Recording resolution…"
                      : resolutionChoice === "recommit_revision"
                        ? `Commit revision ${decision.activeRevision + 1}`
                        : resolutionChoice === "supersede_decision"
                          ? "Replace this Decision"
                          : "Close Decision as rejected"}
                  </button>
                </>
              ) : (
                <div className="resolution-success" role="status">
                  <span>Human resolution recorded</span>
                  <strong>
                    {phase === "recommitted"
                      ? `Revision ${decision.activeRevision} is now active`
                      : phase === "superseded"
                        ? `Replaced by ${decision.supersededByDecisionId}`
                        : "Decision closed without replacement"}
                  </strong>
                  {history !== undefined && history.revisions.length >= 2 ? (
                    <div className="revision-comparison">
                      {history.revisions.slice(-2).map((revision, index) => (
                        <article
                          className={index === 1 ? "proposed" : undefined}
                          key={revision.revisionId}
                        >
                          <span>Revision {revision.version}</span>
                          <strong>{revision.snapshot.title}</strong>
                          <p>{revision.snapshot.outcome}</p>
                          <small>{revision.changeReason}</small>
                        </article>
                      ))}
                    </div>
                  ) : null}
                  <div className="resolution-export">
                    <button
                      onClick={() => void prepareDecisionExport()}
                      type="button"
                    >
                      Prepare Decision JSON export
                    </button>
                    {decisionExport === undefined ? null : (
                      <a
                        download={`counterpoint-${decision.decisionId}.json`}
                        href={`data:application/json;charset=utf-8,${encodeURIComponent(
                          JSON.stringify(decisionExport, null, 2),
                        )}`}
                      >
                        Download JSON · {decisionExport.revisions.length}{" "}
                        revisions · {decisionExport.auditEntries.length} audit
                        entries
                      </a>
                    )}
                  </div>
                </div>
              )}
            </section>
          ) : null}
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

function SharedDisplayScreen({
  displayToken,
  meetingId,
}: {
  readonly displayToken: string;
  readonly meetingId: string;
}) {
  const [projection, setProjection] =
    useState<SharedDisplayProjectionResponse>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    async function refresh() {
      try {
        const next = await getSharedDisplayProjection(
          meetingId,
          displayToken,
          controller.signal,
        );
        if (active) {
          setProjection(next);
          setError(undefined);
          setLoading(false);
        }
      } catch (cause) {
        if (active && !controller.signal.aborted) {
          setProjection(undefined);
          setError(
            cause instanceof ApiError && cause.code === "DISPLAY_TOKEN_EXPIRED"
              ? "This shared display link has expired or was revoked."
              : messageFor(cause),
          );
          setLoading(false);
        }
      }
    }
    void refresh();
    const interval = window.setInterval(() => void refresh(), 3_000);
    return () => {
      active = false;
      controller.abort();
      window.clearInterval(interval);
    };
  }, [displayToken, meetingId]);

  if (loading) {
    return (
      <main className="shared-display-shell">
        <header className="shared-display-topbar">
          <Brand />
          <span>Read-only shared display</span>
        </header>
        <section className="shared-display-loading" aria-live="polite">
          <span className="live-dot" />
          Loading the shared Decision…
        </section>
      </main>
    );
  }

  if (projection === undefined) {
    return (
      <main className="shared-display-shell">
        <header className="shared-display-topbar">
          <Brand />
          <span>Read-only shared display</span>
        </header>
        <section className="shared-display-expired" role="alert">
          <span aria-hidden="true">◇</span>
          <p className="section-kicker">Access ended</p>
          <h1>Shared content is no longer available</h1>
          <p>{error}</p>
          <small>
            Ask the facilitator for a new display link. No previous meeting
            content is retained on this screen.
          </small>
        </section>
      </main>
    );
  }

  const decision = projection.shared.decisions.at(-1);
  return (
    <main className="shared-display-shell">
      <header className="shared-display-topbar">
        <Brand />
        <div>
          <span className="live-dot" />
          <strong>Read-only shared display</strong>
        </div>
        <small>
          Link expires {new Date(projection.expiresAt).toLocaleTimeString()}
        </small>
      </header>
      <section className="shared-display-hero">
        <div>
          <p className="eyebrow">Current question</p>
          <h1>{projection.meeting.purpose}</h1>
          <p>Shared, human-approved material only.</p>
        </div>
        <div className="shared-display-phase">
          <span>Meeting phase</span>
          <strong>{projection.meeting.phase}</strong>
          <small>Position {projection.shared.position}</small>
        </div>
      </section>
      <section className="shared-display-grid">
        <article className="display-panel display-evidence">
          <header>
            <p className="zone-label shared">Shared evidence</p>
            <span>{projection.shared.evidence.length}</span>
          </header>
          {projection.shared.evidence.length === 0 ? (
            <p className="display-empty">No approved evidence yet.</p>
          ) : (
            projection.shared.evidence.map((evidence) => (
              <blockquote key={evidence.evidenceId}>
                “{evidence.exactSnippet}”
                <small>Human confirmed · Source attached</small>
              </blockquote>
            ))
          )}
        </article>
        <article className="display-panel display-premises">
          <header>
            <p className="zone-label shared">Confirmed premises</p>
            <span>{projection.shared.premises.length}</span>
          </header>
          {projection.shared.premises.length === 0 ? (
            <p className="display-empty">No confirmed premises yet.</p>
          ) : (
            <ul>
              {projection.shared.premises.map((premise) => (
                <li key={premise.premiseId}>
                  <span aria-hidden="true">✓</span>
                  <div>
                    <strong>{premise.statement}</strong>
                    <small>{premise.confirmationStatus}</small>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </article>
        <article className="display-panel display-decision">
          <header>
            <p className="zone-label shared">Living Decision</p>
            <span>{decision?.status ?? "ASSEMBLING"}</span>
          </header>
          {decision === undefined ? (
            <div className="display-decision-empty">
              <span aria-hidden="true">◎</span>
              <h2>Commitment is still assembling</h2>
              <p>
                Evidence, premise, dissent, and Action remain visible above.
              </p>
            </div>
          ) : (
            <div className="display-decision-current">
              <span>Revision {decision.activeRevision}</span>
              <h2>{decision.snapshot.title}</h2>
              <p>{decision.snapshot.outcome}</p>
              <small>{decision.status} · Human-controlled lifecycle</small>
            </div>
          )}
        </article>
        <article className="display-panel display-actions">
          <header>
            <p className="zone-label shared">Actions</p>
            <span>{projection.shared.actions.length}</span>
          </header>
          {projection.shared.actions.length === 0 ? (
            <p className="display-empty">No shared Actions yet.</p>
          ) : (
            <ul>
              {projection.shared.actions.map((action) => (
                <li key={action.actionId}>
                  <strong>{action.scope.join(" · ")}</strong>
                  <small>{action.status}</small>
                </li>
              ))}
            </ul>
          )}
          {projection.shared.dissent.map((dissent) => (
            <div className="display-dissent" key={dissent.dissentId}>
              <span>Retained dissent</span>
              <p>{dissent.reason}</p>
            </div>
          ))}
        </article>
      </section>
      <footer className="shared-display-footer">
        <span>Counterpoint · Living Decisions</span>
        <span>Synthetic hackathon demonstration</span>
      </footer>
    </main>
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
  const [sharedExternalEvent, setSharedExternalEvent] =
    useState<ExternalEventReceipt>();
  const [sharedInvalidation, setSharedInvalidation] =
    useState<InvalidationEvaluation>();
  const [error, setError] = useState<string>();
  const [resetState, setResetState] = useState<
    "confirming" | "idle" | "resetting" | "succeeded"
  >("idle");
  const [displayAccess, setDisplayAccess] =
    useState<IssueDisplayTokenResponse>();
  const [displayAccessState, setDisplayAccessState] = useState<
    "idle" | "issuing" | "revoking"
  >("idle");
  const [displayAccessError, setDisplayAccessError] = useState<string>();
  const [workspaceEpoch, setWorkspaceEpoch] = useState(0);
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
    reset: crypto.randomUUID(),
  });

  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([
      listSharedEvidence(session, meeting.meetingId, controller.signal),
      listSharedDecisions(session, meeting.meetingId, controller.signal),
      listSharedExternalEvents(session, meeting.meetingId, controller.signal),
      listInvalidationEvaluations(
        session,
        meeting.meetingId,
        controller.signal,
      ),
    ])
      .then(
        ([
          evidenceState,
          decisionState,
          externalEventState,
          invalidationState,
        ]) => {
          const nextPosition = [
            decisionState.position,
            externalEventState.position,
            invalidationState.position,
          ].reduce(
            (latest, current) => (current >= latest ? current : latest),
            evidenceState.position,
          );
          setPosition(nextPosition);
          onPositionChange(nextPosition);
          setEvidence(evidenceState.evidence.at(-1));
          setSharedDecision(decisionState.decisions.at(-1));
          setSharedExternalEvent(externalEventState.events.at(-1));
          setSharedInvalidation(invalidationState.evaluations.at(-1));
        },
      )
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

  async function resetStagedMeeting() {
    setResetState("resetting");
    setError(undefined);
    try {
      const reset = await resetDemoMeeting(session, {
        expectedPosition: position,
        idempotencyKey: commandKeys.current.reset,
        meetingId: meeting.meetingId,
      });
      advancePosition(reset.position);
      setPhase("idle");
      setPreview(undefined);
      setProposalOrigin(undefined);
      setEvidence(undefined);
      setSharedDecision(undefined);
      setSharedExternalEvent(undefined);
      setSharedInvalidation(undefined);
      setDisplayAccess(undefined);
      setDisplayAccessState("idle");
      setSelectedSnippet(SYNTHETIC_EXACT_SNIPPET);
      commandKeys.current = {
        approve: crypto.randomUUID(),
        preview: crypto.randomUUID(),
        proposeAi: crypto.randomUUID(),
        proposeManual: crypto.randomUUID(),
        register: crypto.randomUUID(),
        reject: crypto.randomUUID(),
        reset: crypto.randomUUID(),
      };
      setWorkspaceEpoch((current) => current + 1);
      setResetState("succeeded");
    } catch (cause) {
      setError(messageFor(cause));
      setResetState("confirming");
    }
  }

  async function createSharedDisplay() {
    setDisplayAccessState("issuing");
    setDisplayAccessError(undefined);
    try {
      const issued = await issueDisplayToken(session, {
        expectedPosition: position,
        meetingId: meeting.meetingId,
      });
      advancePosition(issued.position);
      setDisplayAccess(issued);
      setDisplayAccessState("idle");
    } catch (cause) {
      setDisplayAccessError(messageFor(cause));
      setDisplayAccessState("idle");
    }
  }

  async function endSharedDisplay() {
    if (displayAccess === undefined) {
      return;
    }
    setDisplayAccessState("revoking");
    setDisplayAccessError(undefined);
    try {
      const revoked = await revokeDisplayToken(session, {
        displayTokenId: displayAccess.displayTokenId,
        expectedPosition: position,
        meetingId: meeting.meetingId,
      });
      advancePosition(revoked.position);
      setDisplayAccess(undefined);
      setDisplayAccessState("idle");
    } catch (cause) {
      setDisplayAccessError(messageFor(cause));
      setDisplayAccessState("idle");
    }
  }

  const displayUrl =
    displayAccess === undefined
      ? undefined
      : `${window.location.origin}/?${new URLSearchParams({
          displayMeetingId: meeting.meetingId,
          displayToken: displayAccess.displayToken,
        }).toString()}`;

  const stageLabels = [
    "01 Context",
    "02 Permission",
    "03 Commitment",
    "04 Risk",
    "05 Review",
  ] as const;
  let completedStage = 0;
  let currentStage: number | undefined = 1;
  let stageCue =
    "Capture independent context. Nothing crosses into the shared room.";
  if (phase !== "idle" || preview !== undefined) {
    completedStage = 1;
    currentStage = 2;
    stageCue =
      "Preview the exact excerpt. Owner approval is required before sharing.";
  }
  if (evidence !== undefined) {
    completedStage = 2;
    currentStage = 3;
    stageCue =
      "Assemble a grounded Decision, then require an explicit human commit.";
  }
  if (
    sharedDecision?.status === "COMMITTED" ||
    sharedDecision?.status === "MONITORING"
  ) {
    completedStage = 3;
    currentStage = 4;
    stageCue =
      "The committed revision is immutable while the external monitor watches for change.";
  }
  if (sharedInvalidation !== undefined) {
    completedStage = 4;
    currentStage = 5;
    stageCue =
      "Review the AI advisory against the event, premise, Evidence, and affected Action.";
  }
  if (sharedInvalidation?.review !== undefined) {
    completedStage = 5;
    currentStage = undefined;
    stageCue =
      (sharedDecision?.activeRevision ?? 0) > 2
        ? "Human review is resolved. Revision history and current state remain exportable."
        : "Human review is recorded. The Action hold and reconsideration task are now shared.";
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
        <div className="workspace-actions">
          {meeting.role === "facilitator" ? (
            displayAccess === undefined ? (
              <button
                className="display-access-button"
                disabled={displayAccessState !== "idle"}
                onClick={() => void createSharedDisplay()}
                type="button"
              >
                {displayAccessState === "issuing"
                  ? "Creating display…"
                  : "Create shared display"}
              </button>
            ) : (
              <div
                aria-label="Read-only display active"
                className="display-access-control"
                role="group"
              >
                <span>Read-only display active</span>
                <a href={displayUrl} rel="noreferrer" target="_blank">
                  Open display ↗
                </a>
                <button
                  disabled={displayAccessState === "revoking"}
                  onClick={() => void endSharedDisplay()}
                  type="button"
                >
                  {displayAccessState === "revoking" ? "Ending…" : "End access"}
                </button>
              </div>
            )
          ) : null}
          {meeting.role === "facilitator" ? (
            resetState === "confirming" || resetState === "resetting" ? (
              <div className="reset-confirmation" role="group">
                <span>Only this staged meeting will be cleared.</span>
                <button
                  className="reset-confirm-button"
                  disabled={resetState === "resetting"}
                  onClick={() => void resetStagedMeeting()}
                  type="button"
                >
                  {resetState === "resetting"
                    ? "Resetting meeting…"
                    : "Confirm meeting reset"}
                </button>
                <button
                  disabled={resetState === "resetting"}
                  onClick={() => setResetState("idle")}
                  type="button"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                className="reset-demo-button"
                onClick={() => setResetState("confirming")}
                type="button"
              >
                Reset staged demo
              </button>
            )
          ) : null}
          <button className="quiet-button" onClick={onBack} type="button">
            ← Meetings
          </button>
        </div>
      </header>
      {displayAccessError === undefined ? null : (
        <p className="display-access-error" role="alert">
          {displayAccessError}
        </p>
      )}

      <nav className="progress-rail" aria-label="Flagship progress">
        {stageLabels.map((label, index) => {
          const stage = index + 1;
          return (
            <span
              aria-current={stage === currentStage ? "step" : undefined}
              className={
                stage <= completedStage
                  ? "complete"
                  : stage === currentStage
                    ? "current"
                    : undefined
              }
              key={label}
            >
              {label}
            </span>
          );
        })}
      </nav>
      <div className="flagship-cue" role="status">
        <span>
          {currentStage === undefined
            ? "Flagship arc complete"
            : `Current stage ${currentStage} of 5`}
        </span>
        <strong>{stageCue}</strong>
        {resetState === "succeeded" ? (
          <small>Meeting reset complete · synthetic Context restored</small>
        ) : null}
      </div>

      <RealtimePanel
        facilitator={meeting.role === "facilitator"}
        meetingId={meeting.meetingId}
        participantId={meeting.participantId}
        session={session}
      />

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
              existingExternalEvent={sharedExternalEvent}
              existingInvalidation={sharedInvalidation}
              key={workspaceEpoch}
              meeting={meeting}
              onDecisionChange={setSharedDecision}
              onExternalEventChange={setSharedExternalEvent}
              onInvalidationChange={setSharedInvalidation}
              onPositionChange={advancePosition}
              position={position}
              session={session}
            />
          ) : sharedDecision?.status === "COMMITTED" ||
            sharedDecision?.status === "MONITORING" ||
            sharedDecision?.status === "AT_RISK" ||
            sharedDecision?.status === "REVIEW_REQUIRED" ||
            sharedDecision?.status === "SUPERSEDED" ||
            sharedDecision?.status === "REJECTED" ? (
            <SharedDecisionCard
              decision={sharedDecision}
              externalEvent={sharedExternalEvent}
              invalidation={sharedInvalidation}
            />
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
  const displayParameters = new URLSearchParams(window.location.search);
  const displayMeetingId = displayParameters.get("displayMeetingId");
  const displayToken = displayParameters.get("displayToken");
  const displayMode = displayMeetingId !== null && displayToken !== null;
  const [session, setSession] = useState<StoredSession | undefined>(() =>
    loadStoredSession(),
  );
  const [meetings, setMeetings] = useState<readonly AssignedMeeting[]>([]);
  const [selectedMeeting, setSelectedMeeting] = useState<AssignedMeeting>();
  const [loading, setLoading] = useState(session !== undefined);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (session === undefined || displayMode) {
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
            clearAllStoredMeetingByok();
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
  }, [displayMode, session]);

  async function signOut() {
    if (session !== undefined) {
      try {
        await logout(session);
      } finally {
        clearAllStoredMeetingByok();
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

  if (displayMode) {
    return (
      <SharedDisplayScreen
        displayToken={displayToken}
        meetingId={displayMeetingId}
      />
    );
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
