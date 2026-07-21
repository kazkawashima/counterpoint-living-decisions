# 14 — Descant — Living Decisions Implementation Requirements

Created: 2026-07-19
Target repository: `https://github.com/kazkawashima/counterpoint-living-decisions`
Migrated from: `meeting-runtime-kernel` and `docs/newEra/basedtalks/topics`

## 1. Position of this document

These are the agreed implementation requirements for evolving the existing
Meeting Runtime Kernel into **Descant — Living Decisions** for OpenAI Build
Week. The historical Counterpoint working title remains only in source-history
references and internal identifiers.

Related concept, state-model, and MVP boundaries:

- [Meeting State Model](./11-state-model.md)
- [Counterpoint / Living Decisions](./12-counterpoint-living-decisions.md)
- [MVP Scope](./13-mvp-scope.md)

Explicitly confirmed requirements in this document take priority over
“unresolved candidate” notes in the other documents.

## 2. Confirmed product

The submitted product is **Descant + Living Decisions**.

> A Decision Runtime that connects each participant’s private context to shared
> state only with explicit approval, maintains claims, assumptions, evidence,
> dissent, and decisions as auditable meeting state, and makes a decision
> reviewable when the external environment changes.

Core experience:

```text
Private context
→ Permissioned evidence
→ Shared decision state
→ Explicit assumptions
→ Commitment
→ External event
→ Assumption invalidated
→ REVIEW_REQUIRED
→ Actions held / revisit task
```

## 3. Success conditions

The hackathon version must prove the following as one continuous experience:

1. Each participant has private material and a private agent.
2. Private information is not shared without the owner’s explicit approval.
3. Users can explicitly switch between speaking to the room and speaking to a private agent.
4. Factual utterances, AI inferences, and human-confirmed information are not conflated.
5. The meeting produces a Decision with evidence, assumptions, dissent, and Actions.
6. An external event can invalidate an assumption and move the Decision into review.
7. The complete value arc is understandable in approximately three minutes.

## 4. Users and screens

### 4.1 Roles

**Facilitator**

- Creates a meeting and assigns participants.
- Sets the meeting-scoped OpenAI API key.
- Confirms AI inferences, commits a Decision, injects demo events, and resets a demo.

**Participant**

- Registers private materials.
- Speaks by voice or text to the room or to a private agent.
- Edits the sharing scope of private evidence and explicitly approves it.

**Shared screen**

- Read-only display of shared state, issues, assumptions, evidence, dissent,
  Decisions, and Actions.
- Uses a revocable, hard-to-guess URL in another tab or monitor.

### 4.2 Screens

The React application has separate surfaces for:

- Login
- Available-meetings list
- Facilitator dashboard
- Participant private workspace
- Shared screen
- Decision history and audit view
- Guided demo selection and reset

## 5. Authentication and meeting participation

### 5.1 Simple login

- Use fixed demo users for the hackathon.
- Define users and password hashes through environment configuration.
- Do not implement self-registration, OAuth, or password recovery.
- Issue a short-lived Bearer session after successful authentication.
- Keep the session in tab-scoped `sessionStorage`.
- Validate the same session identity for both API and WebSocket traffic.
- Use a two-hour inactivity timeout and an eight-hour absolute timeout.
- Do not enforce exclusive login.

`sessionStorage` allows multiple tabs in one browser to operate as different
users for a single-person multi-participant demo.

### 5.2 Joining a meeting

- A meeting has 3–8 people including the facilitator.
- The facilitator assigns fixed users to a meeting.
- Assigned users see the meeting in their post-login available-meetings list.
- Retain meeting-code entry as a fallback path.
- Isolate all data, connections, temporary state, and API keys by meeting.

## 6. OpenAI API keys

### 6.1 Policy

- Public general use requires BYOK.
- The Devpost judge account uses server-funded judge mode so judges do not need
  to pay or prepare an API key.
- Store the judge-mode key as Cloudflare Worker Secret
  `OPENAI_API_KEY_JUDGE`; never place it in `wrangler.toml`, D1, R2, logs, or the repository.
- Use a separate Worker Secret, `JUDGE_IP_HMAC_SECRET`, for HMAC-SHA-256 judge
  IP limits. Never reuse the OpenAI key, accept only a canonical IP from the
  verified `CF-Connecting-IP` header, and never persist or log the raw IP.
- Local development may read a standard key from a Git-ignored `.env` or `.dev.vars`.
- A facilitator-provided key applies only to the target meeting.
- Never disclose the standard key to participants.
- An allowlisted judge may optionally enter a personal key in the tab. The
  authenticated Worker uses it only to issue a short-lived client secret and
  then discards it; ordinary users cannot use this request-scoped judge BYOK
  path, and the server-funded judge path remains the default.
- Allow judge mode only for the judge account, never for ordinary users.
- Enforce the rolling USD 25 product ceiling as the only judge spend lock.
  Do not independently lock judge work on account, IP, meeting, concurrency,
  Realtime duration, generation, or token counters. Retain idempotency and
  ownership checks that prevent duplicate provider work.
- Return only a server-generated opaque handle for a managed Realtime call.
  Bind reservation, provider call, participant, session, and key-source
  identity server-side, then re-authenticate and re-resolve meeting assignment,
  judge capability, and handle ownership on every start, turn, transcript, and
  terminate request.
- Do not put judge credentials in the public README, video, repository, or public Devpost description.

### 6.2 Retention and disposal

- Keep BYOK in the facilitator’s browser `sessionStorage` only.
- On the server, keep BYOK only in the meeting Durable Object or Node-process memory.
- Use the Worker Secret only for OpenAI calls and short-lived client-secret issuance;
  do not copy it to the browser or meeting state.
- Never persist it in D1, SQLite, R2, local files, logs, or audit events.
- Renew the key lease with a heartbeat while the facilitator is connected.
- Destroy the server-side copy at the earliest of logout, meeting end, session
  expiry, or five minutes after disconnect.
- If Worker or Durable Object eviction removes the key, ask the facilitator to enter it again.

The browser-side guarantee is best effort because crash/session restoration may
restore `sessionStorage`; the server-side copy must be gone within five minutes
of the last heartbeat.

## 7. Voice and text paths

### 7.1 Two utterance paths

Users explicitly choose a path before or during push-to-talk:

- **Speak to room** — record a transcript as a shared event, deliver it to all
  private agents as shared context, and show it on the shared screen.
- **Speak privately** — send it only to the owner’s private agent, which can
  reference private material and shared state. Before approval, it must not
  reach shared events, the shared screen, or another participant’s agent.

Text input is always available as a fallback.

### 7.2 Realtime

- Keep shared and private paths in separate OpenAI Realtime sessions.
- The server issues a short-lived client secret using the meeting API key.
- Each browser connects directly to OpenAI Realtime over WebRTC with that secret.
- Set `expires_after` explicitly when creating a client secret. The current
  implementation uses 30 seconds. Because a secret can create multiple
  sessions until expiry and the client can override attached session settings,
  neither the secret nor its channel label is an application authorization
  boundary.
- Never send the standard API key or another participant’s private context to the client.
- Human-to-human voice delivery is out of scope; this is a meeting-state input system.
- Aggregate shared transcripts and confirmed events at the application server.

## 8. Materials and permissioned sharing

### 8.1 Materials

Each participant may register multiple private documents and URLs and present
materials to the shared room.

Supported scope: PDF, Markdown, plain text, OpenAI-supported file types, and
public HTTP(S) URLs. Limits: 20 MB per file, 10 items per person, and 100 MB per
meeting.

### 8.2 URL-fetch protection

- Allow only `http` and `https`.
- Reject loopback, private, link-local, and metadata endpoints.
- Re-check every redirect destination.
- Limit response size, timeout, redirect count, and content type.
- Treat fetched material as untrusted input; never execute it.

### 8.3 Private → Shared promotion

- A private agent shows related evidence candidates only to its owner.
- Each candidate includes its source and quote range.
- The owner can edit the snippet and explicitly approve the exact range.
- Record approver, time, source material, and scope in an audit event.
- Do not implicitly share an entire source based on an AI summary.

## 9. Meeting state and Living Decision

### 9.1 Invariants

1. Separate factual utterances and AI inferences.
2. Separate shared and private state.
3. Separate supporter count and option quality.
4. Do not optimize for agreement volume.
5. Preserve source and transition traceability through the Decision.

### 9.2 Core entities

Meeting, Participant, SourceArtifact, Utterance, Proposition, Stance, Question,
Claim, Premise, Evidence, Option, Criterion, Constraint, Risk, Evaluation,
Decision, Dissent, Action, Intervention, ExternalEvent, and DecisionRevision.

### 9.3 Decision lifecycle

```text
DRAFT
→ DECISION_READY
→ COMMITTED
→ MONITORING
→ AT_RISK
→ REVIEW_REQUIRED
→ COMMITTED | SUPERSEDED | REJECTED
```

- A Decision has dependent assumptions, evidence, dissent, Actions, and monitor conditions.
- Add revision history rather than overwriting an existing Decision.
- AI may generate candidates, but Commitment requires explicit facilitator action.
- AI-inferred assumptions have a human confirmation status.

### 9.4 External events

- The MVP monitor adapter is a signed webhook/API.
- Provide a demo button that calls the same event path.
- Use GPT-5.6 to evaluate external events against dependent assumptions.
- Record invalidation candidates with evidence.
- On confirmed invalidation, move the Decision to `REVIEW_REQUIRED`, hold affected
  Actions, and create a reconsideration task.

## 10. Architecture

Adopt **edge-native + runtime adapters**: share the domain core and separate the
local Node and Cloudflare runtimes.

### 10.1 Components

- `apps/web` — React + Vite for facilitator, participant-private, and shared-screen views.
- `apps/worker` — Cloudflare Worker adapter for HTTP API, auth, Realtime-secret
  issuance, webhooks, D1, R2, and Durable Objects.
- `apps/server` — Node adapter for Docker Compose, serving the built React app,
  API, and WebSocket from one container.
- `packages/domain` — entities, value objects, reducer, state machine, and rules;
  no React, Node, Cloudflare, or OpenAI dependency.
- `packages/application` — use cases, ACL, approval flow, and Decision reevaluation.
- `packages/protocol` — API DTOs, WebSocket events, and error schema.
- `packages/ports` — repositories, artifact storage, realtime publisher, AI gateway,
  clock, and ID generator.
- `packages/adapters-node` — SQLite, local files, and Node WebSocket.
- `packages/adapters-cloudflare` — D1, R2, and Durable Objects.
- `packages/adapters-openai` — GPT-5.6, Realtime client secrets, and structured output.

### 10.2 Cloudflare

- Serve React static assets and HTTP API from the Worker.
- Allocate one Durable Object per meeting for connections, event order, temporary
  meeting state, and API-key leases.
- Use D1 as the source of truth for fixed users, meeting metadata, assignments,
  append-only events, Decision revisions, and audit history.
- Use R2 for source materials and derived artifacts.
- Do not use Cloudflare Containers in the MVP.

### 10.3 Local runtime

- `docker compose up` starts the local application.
- The Node server serves the built React app and API from one origin.
- Persist SQLite and materials in named volumes.
- If no OpenAI key is configured, ask the facilitator for BYOK.
- A hot-reload profile may exist for development, but the standard judge path is a production build.

### 10.4 State update

The append-only event stream is canonical; a reducer creates projections.

```text
Command
→ Authorization
→ Domain validation
→ Append event
→ Reduce
→ Persist projection
→ Publish scoped event
```

Never write an AI response directly into canonical state; separate candidate and
confirmation events.

## 11. Data separation

- Every repository query requires `meetingId`.
- Every private record requires `ownerParticipantId`.
- Shared records are readable only by active participants in that meeting.
- Only the facilitator may commit a Commitment.
- The shared screen uses a revocable read-only display token scoped to the shared projection.
- R2 object keys include meeting and owner boundaries.
- File retrieval uses a short-lived authorized URL or an authorized Worker path.

## 12. Demo scenarios

### 12.0 Development priority

Complete the flagship scenario end to end before implementing Quickstart, Meta
demo, additional monitors, or additional screens. “Complete” means a fresh
environment can reproduce login → private evidence → shared decision →
Commitment → external event → `REVIEW_REQUIRED`.

### 12.1 Flagship: Global AI product rollout

Roles: Product / Facilitator, Safety, Legal, Engineering, and Enterprise Sales.

1. Each role has different private material.
2. Private agents identify missing evidence during shared discussion.
3. The owner shares only the necessary range.
4. The team commits a rollout Decision with regions, stages, stop conditions, and owners.
5. A regulatory-change event enters through the webhook.
6. A legal assumption becomes invalid and only affected regional Actions are held.
7. The Decision moves to `REVIEW_REQUIRED` with a reconsideration history.

### 12.2 Quickstart: Product-release Go / No-Go

Three roles hold technical, security, and customer context, make a conditional
release decision, and reopen it after an audit-delay event. This is a future
template unless the flagship is complete.

### 12.3 Meta demo: Hackathon judging meeting

Judges hold private reels, demos, READMEs, and individual notes. Shared
discussion forms criteria, evidence, dissent, and ranking Decisions. Private
evaluations remain private until explicit sharing; new eligibility information
or a broken demo can reopen the Decision.

Only the flagship receives a complete guided demo. Keep other scenarios as seed
fixtures or future documents if time runs out.

## 13. Demo data and reset

- Persist meetings, Decisions, audit history, and materials across restarts.
- Let the facilitator reset a demo meeting to its initial state.
- Apply reset only to the target meeting.
- Make guided demos replayable with seed data and staged display.
- Support one-person demos through different users in multiple tabs.
- The same API and screens must support real multiple-device use.

## 14. Error handling and observability

Use this common API and WebSocket error shape:

```text
code
message
correlationId
retryable
details
```

Separate user-facing explanations from developer details. Identify failures by
source (OpenAI, D1, R2, Realtime) and never include API keys, Bearer tokens, or
private text in errors.

If OpenAI is unavailable, continue to support viewing existing state, manual
text input, manual candidate/assumption/Decision editing, JSON export, and audit
history viewing.

Observe structured logs, correlation IDs, API and OpenAI latency, model and token
usage, WebSocket count, Durable Object meeting count, failure rate, and retries.
Never log API keys, raw audio, or private document bodies.

## 15. Deployment

### 15.1 Docker Compose

Standard command:

```text
docker compose up
```

Requirements: safe first-start migrations, healthcheck, SQLite/material volumes,
`.env.example`, startup without a key by falling back to facilitator BYOK, and
one production-like URL.

### 15.2 Cloudflare

Define reproducible scripts for Worker, D1, R2, and Durable Object migrations.
Use `workers.dev` initially. Custom domains are post-MVP. Prefer PR test/build
and manually approved `main` deployments. Put `OPENAI_API_KEY_JUDGE` in a
Cloudflare Worker Secret, never in ordinary vars, `.env`, `.dev.vars`, or GitHub-
managed files. Keep judge mode through August 5, 17:00 PT and revoke/rotate it
afterward.

## 16. Testing

### 16.1 Unit

Reducer, Decision state machine, ACL, private/shared promotion, assumption
invalidation, revision generation, and projections.

### 16.2 Contract

Apply the same port contracts to SQLite/D1, local files/R2, and Node realtime
hub/Durable Objects.

### 16.3 Integration

Authentication and expiry, Realtime client-secret issuance, event append and
projection update, artifact upload/download, webhook signature validation, and
Decision reevaluation.

### 16.4 E2E

Three users in multiple tabs and multiple devices; meeting list and meeting code;
shared/private voice and text; private-evidence approval; shared screen;
Commitment; external event; `REVIEW_REQUIRED`; and demo reset.

### 16.5 Security

IDOR, cross-meeting access, private-record leakage, SSRF, upload content-type
spoofing, session/display-token expiry, and secrets in logs.

### 16.6 Deployment smoke

Empty-environment Compose start, restart with volumes, Cloudflare preview and
production, and D1/DO migration.

## 17. Acceptance criteria

1. `docker compose up` starts the local app.
2. Three fixed users can operate in separate tabs in one browser.
3. The facilitator can create a meeting and assign 3–8 users.
4. Assigned users can join from the list or meeting code.
5. BYOK is meeting-scoped and the standard key is not disclosed.
6. Shared/private voice and text paths are separate.
7. Private material never reaches other participants, the shared screen, or the
   shared API before explicit approval.
8. Facts, AI inference, and confirmed information are distinct in UI and storage.
9. A Decision can be committed.
10. One webhook event can invalidate an assumption, hold Actions, produce
    `REVIEW_REQUIRED`, and create a reconsideration task.
11. Meeting A’s users, materials, events, and API key are inaccessible from B.
12. Meetings, history, and materials survive restart.
13. Only the target meeting can be reset.
14. The server-side BYOK copy is destroyed within five minutes after disconnect.
15. Existing state, manual input, and JSON export remain available during an OpenAI outage.
16. The flagship value arc can be shown in about three minutes.
17. A judge user completes the flagship without BYOK.
18. Ordinary credentials cannot use the judge-mode key.
19. Reaching a judge-mode limit returns an explicit cap error without extra spend.

## 18. Out of MVP

Human-to-human Zoom-like audio, OAuth, self-registration, billing, production
multi-tenancy, AI final decisions, automatic private sharing, fully automatic
diarization, multiple monitor adapters, continuous URL monitoring, organization-
wide SSoT, Cloudflare Containers, and a high-availability SLA.

## 19. Repository and publication

- Official repository: `counterpoint-living-decisions`.
- Remain private and All Rights Reserved for now.
- Decide the license separately after re-checking submission and publication requirements.
- Keep the organized `topics` documents so design rationale and implementation
  requirements remain traceable.
- If any existing code is used, identify the new submission-period work in commits and README.

## 20. Decisions confirmed in Q&A

Product: Descant + Living Decisions (historical working title: Counterpoint).
Local deployment: Docker Compose.
Demo deployment: Cloudflare. Runtime: shared domain core plus Node/Cloudflare
adapters. Cloudflare: Worker + Durable Objects + D1 + R2. Auth: fixed demo users
and tab-scoped Bearer sessions. Participation: assignment list plus meeting code.
Participants: 3–8. API keys: BYOK for general use and Cloudflare Secret
server-funded judge mode. Realtime: browser-to-OpenAI WebRTC with a short-lived
secret. Voice: shared/private input, not human voice conferencing. Materials:
multiple files, URLs, and shared artifacts. Private sharing: owner-approved,
editable quote snippets. Monitor: signed webhook plus demo button. Persistence:
survive restart and reset per meeting. Demo: multiple tabs and real devices.
Flagship: global AI product rollout. Optional templates: Go/No-Go and judging
meeting. License: private / All Rights Reserved for now.

## 21. External conditions to re-check before implementation

- Current OpenAI Build Week Official Rules and public requirements.
- Current official model IDs for GPT-5.6 and Realtime.
- Realtime client-secret lifetime and session limits.
- Cloudflare Workers, Durable Objects, D1, and R2 account limits.
- Cloudflare production-secret and GitHub Actions permissions.

## 22. References

- OpenAI Realtime WebRTC: <https://developers.openai.com/api/docs/guides/realtime-webrtc>
- OpenAI Realtime client secrets: <https://developers.openai.com/api/docs/api-reference/realtime-sessions/create-realtime-client-secret>
- Cloudflare React SPA + Worker: <https://developers.cloudflare.com/workers/static-assets/>
- Cloudflare Vite plugin: <https://developers.cloudflare.com/workers/vite-plugin/tutorial/>
- Cloudflare Workers secrets: <https://developers.cloudflare.com/workers/configuration/secrets/>
- Devpost Testing Guide: <https://help.devpost.com/article/190-testing-guide>
