# Degraded-mode capture notes

All screenshots and clips use synthetic meeting content, browser credentials,
WebRTC peers, and provider failures. No real API key, client secret, customer
content, or microphone audio is present.

## Reel sequence

1. `2026-07-19-realtime-text-fallback-desktop.png` — the compact continuity
   strip after capped Realtime reconnect: durable state reads and manual text
   remain live while AI + voice move to text fallback.
2. `2026-07-19-api-key-loss-state-preserved-desktop.png` — BYOK has been
   removed and the client-secret request returns `API_KEY_REQUIRED`; the
   owner-private text command is still captured and visible.
3. `2026-07-19-openai-unavailable-manual-decision-desktop.png` — shared
   Evidence remains intact after synthetic Decision-synthesis failure, with
   bounded retry and explicit manual editing controls.
4. `2026-07-19-manual-decision-audit-export-desktop.png` — the same meeting
   reaches a human-authored committed Decision, visible audit lineage, and a
   prepared two-revision JSON export without AI recovery.

## Clips

- `../../clips/degraded-mode/2026-07-19-realtime-failure-to-durable-text.webm`
  records BYOK setup, isolated Realtime failure, capped retries, key removal,
  `API_KEY_REQUIRED`, and successful durable text capture.
- `../../clips/degraded-mode/2026-07-19-openai-failure-to-manual-decision.webm`
  records provider failure through manual candidate editing, explicit human
  confirmation, commitment, audit, and export.
