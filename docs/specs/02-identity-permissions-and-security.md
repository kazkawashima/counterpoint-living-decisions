# Identity, permissions, and security specification

## Authentication

The hackathon build uses fixed demo users configured through environment
settings with password hashes. It does not include registration, OAuth,
password recovery, or exclusive login.

After login, the server issues a Bearer session with:

- tab-scoped storage in browser `sessionStorage`
- two-hour inactivity expiry
- eight-hour absolute expiry
- user identity and server-resolved capabilities
- identical validation for HTTP and realtime application connections

The browser MUST NOT treat claims in local storage or route parameters as
authorization.

## Capability matrix

| Capability | Facilitator | Participant | Display token |
|---|---:|---:|---:|
| Read assigned meeting metadata | Yes | Yes | Minimal |
| Read own private records | If owner | Yes | No |
| Read another owner's private records | No | No | No |
| Read shared projection | Yes | Yes | Yes |
| Add own private artifact | Yes | Yes | No |
| Propose own disclosure | Yes | Yes | No |
| Approve another owner's disclosure | No | No | No |
| Commit Decision | Yes | No | No |
| Confirm `REVIEW_REQUIRED` | Yes | No | No |
| Inject demo external event | Yes | No | No |
| Reset owned demo meeting | Yes | No | No |
| Configure BYOK | Yes | No | No |

Every use case performs server-side authorization before domain validation.

## Meeting and owner isolation

- Every repository query requires `meetingId`.
- Every private record requires `ownerParticipantId`.
- Membership is resolved from server-side assignment data.
- Shared records are visible only to active meeting participants and scoped
  display tokens.
- Object-storage keys contain meeting and owner partitions.
- Download requires a short-lived authorized URL or an authorized Worker path.
- Cross-meeting identifiers MUST return a non-disclosing authorization result.

Meeting A's users, artifacts, events, temporary state, key leases, and
projections MUST be inaccessible from Meeting B.

## Display tokens

Display tokens are high-entropy, read-only, meeting-scoped, and revocable. They
expose only the shared projection, never participant identity details beyond
what that projection intentionally displays. Revocation takes effect on the
next API call and closes the associated realtime subscription.

## Private disclosure protocol

```text
private agent proposes candidate
→ owner sees source, exact quote, metadata, and complete outgoing payload
→ owner edits allowed snippet
→ client submits preview hash and approval
→ server revalidates user, meeting, source, range, and hash
→ shared Evidence event is appended
```

Security rules:

1. Private agents have `proposeDisclosure`, never `publishDisclosure`.
2. A model summary never implies permission for its source.
3. The exact outgoing payload is previewed.
4. Server compares the preview hash with the payload it will publish.
5. Approval records owner, source, range, timestamp, and resulting evidence.
6. Rejection and cancellation create no shared trace of the private content.

## API-key modes

### Facilitator-provided BYOK

- Stored in the facilitator tab's `sessionStorage`.
- Held server-side only in meeting-scoped Node memory or the meeting Durable
  Object's transient memory.
- Never persisted to SQLite, D1, files, R2, logs, events, or projections.
- Lease renewed by heartbeat while the facilitator is connected.
- Removed at the earliest of logout, meeting end, session expiry, or five
  minutes after the last heartbeat.
- If lost, state remains intact and the app returns `API_KEY_REQUIRED`.

### Judge-managed

- Available only to an allowlisted judge account.
- Standard key exists only as Cloudflare Secret `OPENAI_API_KEY_JUDGE`.
- The Worker may use it only behind server-owned, pre-billable OpenAI call
  paths. Judge mode does not return a provider client secret to the browser.
- The standard key is never sent to a Durable Object or browser.
- Ordinary users cannot select or inherit judge mode.
- Hard limits bound account, IP, meeting count, concurrent sessions, Realtime
  seconds, generations, tokens, and daily spend.
- The application-side currency boundary is USD 25 per rolling 24-hour period.
  It is enforced before new billable work.
- The provider's USD 50 budget alert is a secondary warning and MUST NOT be
  treated as enforcement of the USD 25 product boundary.
- Secondary limits are derived from measured flagship usage so their combined
  worst case remains within the currency boundary.
- Hitting any limit fails closed with an explicit cap error and no new OpenAI
  request.
- Direct judge Realtime client-secret issuance remains disabled until a
  server-owned controller can enforce bounded termination and account for the
  reserved call. Ordinary facilitator-provided BYOK remains a separate mode.

Exact budget values are a user decision recorded separately.

## Artifact and URL security

Limits:

- 20 MB per file
- 10 items per participant
- 100 MB per meeting

Only supported document types are processed. Claimed content type, detected
content type, extension, and safe parsing outcome are compared.

URL fetch:

1. Accept only `http` and `https`.
2. Resolve and reject loopback, private, link-local, multicast, and cloud
   metadata destinations.
3. Re-resolve and re-check every redirect.
4. Bound timeout, bytes, redirects, and content types.
5. Do not execute fetched content.
6. Treat all source text as untrusted data, not model instructions.

MVP URL-fetch policy is deliberately closed:

- reject URL user information and ports other than HTTP 80 or HTTPS 443
- require every A/AAAA answer to be globally routable, then pin the socket to
  one of the checked answers so DNS cannot change the destination after review
- follow at most three redirects and repeat the complete URL, DNS, and
  destination check at every hop
- enforce one 10-second overall deadline and a 20 MiB received-body limit,
  including streaming responses without a trustworthy `Content-Length`
- accept only identity/no content encoding and the same PDF, Markdown,
  plain-text, and JSON content-type/extension/parser matrix as file upload
- persist only a hash of the normalized source locator, never URL credentials,
  query text, or the raw locator in events, responses, errors, or logs

## Prompt-injection boundary

- Private retrieval results never enter shared model context automatically.
- Tools exposed to the model cannot publish or commit.
- Prompts isolate source data from trusted instructions.
- Structured outputs contain references to source records, not arbitrary
  commands.
- Human approval does not authorize hidden or later-expanded content.

## Webhook security

- Signed request with timestamp and replay window.
- Raw body signature verification before JSON interpretation.
- Idempotency key required.
- Event type and schema allowlist.
- Meeting scope resolved from a server-controlled webhook registration.
- Demo injection uses an authenticated facilitator command that reaches the
  same validated application use case.

## Secret hygiene

Secrets, Bearer tokens, raw audio, and private source bodies are excluded from:

- repository files
- errors and stack traces returned to clients
- structured logs
- analytics
- screenshots and reel recordings
- audit event payloads

Synthetic demo content is mandatory.

## Security acceptance

Automated tests MUST cover:

- IDOR and cross-meeting identifiers
- cross-owner private reads
- shared projection leakage
- disclosure approval tampering and preview-hash mismatch
- expired/revoked sessions and display tokens
- judge-mode authorization and every spend-limit boundary
- BYOK lease expiry
- SSRF across redirects and DNS resolution
- upload type spoofing and oversized content
- webhook signature, replay, and duplicate delivery
- log/error secret scanning
