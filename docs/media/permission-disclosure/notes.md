# Permissioned disclosure reel notes

All captures use explicitly labeled synthetic demo stories. Desktop material
uses `Global AI Product Rollout`; dependency recovery uses the isolated
`AI fallback isolation check`, and the mobile rejection capture uses
`Mobile private disclosure check`. Isolation keeps previously shared Evidence
from affecting those states. The surrounding private note is staged material
and must not be described as real user data.

| State | Viewport | Suggested reel use |
|---|---|---|
| Owner-private AI suggestion and exact outgoing preview | Desktop, 1280×720 | Hold on the split screen while narrating that AI can suggest one grounded range but cannot publish; the complete excerpt, source range, owner-only origin, and destination remain visible before sharing. |
| AI unavailable with manual recovery | Desktop, 1280×720 | Show that the private source stays in place while the user can retry the dependency or continue with the exact manual excerpt. The shared canvas remains empty. |
| Approved Evidence | Desktop, 1280×720 | Cut on “Permission recorded” as the exact excerpt arrives on the shared canvas and readiness moves from 0% to 20%. |
| Kept private | Mobile, 390×844, reduced motion | In an isolated synthetic meeting, show that rejection publishes neither Evidence nor a private-existence hint, and that the boundary survives a narrow viewport. |

The clip under `docs/media/clips/permission-disclosure/` records the live
sequence from private source selection through complete preview, explicit human
approval, and animated shared-Evidence arrival. A reduced-motion browser run
verifies the same state change without relying on animation.

Useful narration:

> Counterpoint never treats an AI suggestion as permission. The participant
> sees the exact outgoing evidence first, then explicitly approves or keeps it
> private. Only the approved excerpt crosses into the decision room.

Capture date: 2026-07-19. Feature slice: A4 owner-private AI assistance with
deterministic browser fixtures and a separately verified live GPT-5.6 smoke.
