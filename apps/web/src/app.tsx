import { useEffect, useId, useState, type FormEvent } from "react";
import type { AssignedMeeting } from "@counterpoint/protocol";

import {
  ApiError,
  clearStoredSession,
  joinMeeting,
  listMeetings,
  loadStoredSession,
  login,
  logout,
  storeSession,
  type StoredSession,
} from "./api.js";

const DEMO_IDENTITIES = [
  { label: "Product", role: "Facilitator", userId: "product" },
  { label: "Safety", role: "Participant", userId: "safety" },
  { label: "Legal", role: "Participant", userId: "legal" },
  { label: "Engineering", role: "Participant", userId: "engineering" },
  { label: "Enterprise Sales", role: "Participant", userId: "sales" },
] as const;

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

function WorkspaceShell({
  meeting,
  session,
  onBack,
}: {
  readonly meeting: AssignedMeeting;
  readonly session: StoredSession;
  readonly onBack: () => void;
}) {
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
                <strong>Speak to room</strong>
                <small>Shared immediately</small>
              </span>
            </button>
          </div>
          <div className="workspace-input">
            <label htmlFor="private-note">Text fallback</label>
            <textarea
              id="private-note"
              placeholder="Add a synthetic private observation…"
              rows={3}
            />
            <button disabled type="button">
              Disclosure flow arrives in the next slice
            </button>
          </div>
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
          <div className="readiness-card">
            <div>
              <span className="source-type">Decision readiness</span>
              <strong>0 of 5 conditions assembled</strong>
            </div>
            <span className="readiness-ring">0%</span>
          </div>
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
