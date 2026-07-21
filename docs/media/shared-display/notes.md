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
| Revoked display | Desktop, 1280×720 | Show immediate fail-closed behavior: the previous projection disappears and the screen asks for a new facilitator-issued link. |

The clip under `docs/media/clips/shared-display/` records approved Evidence on
the read-only display followed by facilitator revocation and complete content
removal. This transition is a useful security beat before the Decision
commitment sequence.

Useful narration:

> The facilitator can open a clean shared surface for the room. It receives
> only approved state—never participant workspaces—and one click revokes the
> link and clears the screen.

Original capture date: 2026-07-19; refreshed 2026-07-21. Feature slice: L4 revocable read-only shared display and projector canvas.
