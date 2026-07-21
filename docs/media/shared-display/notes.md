# Shared display reel notes

All captures use the synthetic `Shared display privacy check` meeting and the
existing staged regional-launch excerpt. No real meeting data, participant
content, credentials, or display-token value appears in the visible UI.

| State | Viewport | Suggested reel use |
| --- | --- | --- |
| Empty shared display | Desktop, 1280×720 | Establish the projector-style read-only surface before any Evidence is approved. The panels show only shared counts and state. |
| Empty shared display | Projector, 2560×1440 | Establish the full-viewport canvas and large-screen legibility before any Evidence is approved. |
| Approved Evidence | Desktop, 1280×720 | Show the exact human-approved excerpt arriving without participant identity, source title, surrounding note, or any private-workspace field. |
| Approved Evidence | Mobile, 390×844, reduced motion | Responsive and accessibility proof that the same shared state remains legible without animation. |
| Decision lifecycle: MONITORING | Desktop, 1280×720 | Show that the shared Decision has a registered monitor while the audience surface remains read-only. |
| Decision lifecycle: AT_RISK | Desktop, 1280×720 | Show the staged synthetic event changing the latest shared Decision status without implying a Meeting phase transition. |
| Decision lifecycle: REVIEW_REQUIRED | Desktop, 1280×720 | Show the human-confirmed review state, held Action, and reconsideration task as the three-minute endpoint. |
| Revoked display | Desktop, 1280×720 | Show immediate fail-closed behavior: the previous projection disappears and the screen asks for a new facilitator-issued link. |

The clip under `docs/media/clips/shared-display/` records approved Evidence on
the read-only display followed by facilitator revocation and complete content
removal. This transition is a useful security beat before the Decision
commitment sequence.

Useful narration:

> The facilitator can open a clean shared surface for the room. It receives
> only approved state—never participant workspaces—and one click revokes the
> link and clears the screen.

The prominent audience tile is sourced from the latest shared Decision status,
not from `meeting.phase`. Before any Decision exists it says `Building shared
context`; after commitment it follows `MONITORING`, `AT_RISK`, and
`REVIEW_REQUIRED`. The API keeps Meeting phase and the shared event position for
compatibility and synchronization, but neither is presented as audience-facing
progress. Capture only these synthetic lifecycle states and keep technical IDs
collapsed.

Original capture date: 2026-07-19; refreshed 2026-07-21. Feature slice: L4 revocable read-only shared display and projector canvas.
