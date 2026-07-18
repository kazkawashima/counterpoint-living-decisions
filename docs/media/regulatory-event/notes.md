# Regulatory event receipt reel notes

All material is part of the explicitly labeled `Grounded Decision commitment
check` synthetic demo story. The regulatory source, jurisdiction, dates,
Decision, and participant identities are fixtures. No real webhook secret,
payload, customer data, or regulation appears in the captures.

| State | Viewport | Suggested reel use |
|---|---|---|
| Staged external event received | Desktop, 1440×900 | Cut from active monitoring to the amber event receipt. Narrate that the event is durably received, but evaluation remains pending and the Decision stays `MONITORING`. |
| Participant shared receipt | Desktop, 1440×900 | Prove that a separate participant sees the shared event and pending state without the facilitator-only injection control. |
| Participant shared receipt | Mobile, 390×844, reduced motion | Reuse the updated mobile Decision capture to show the event receipt without relying on animation. |

The updated clip under `docs/media/clips/decision-commit/` now continues from
candidate synthesis through commitment, monitor registration, and the staged
external-event receipt. Keep the `Staged demo event` label in frame.

Useful narration:

> This is an explicitly staged synthetic event. The demo button enters through
> the same normalized receipt use case as the signed webhook, but its audit
> provenance remains human-injected. Receipt is durable and evaluation is
> still pending—AI has not changed the Decision.

Capture date: 2026-07-19. Feature slice: D2 signed webhook receipt and D3 demo
event parity.
