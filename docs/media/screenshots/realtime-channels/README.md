# Realtime channel capture notes

All captures use the synthetic flagship meeting. No real standard API key,
ephemeral client secret, private customer data, or microphone audio appears in
the screenshots or clip.

## Reel sequence

1. `2026-07-19-realtime-byok-required-desktop.png` — 1440×900 facilitator
   state before BYOK. Narration: ordinary use is facilitator-funded and the
   standard key stays tab- and meeting-scoped.
2. `2026-07-19-realtime-both-connected-desktop.png` — separate private and
   shared sessions connected, both explicitly `Mic off`. Use as the visual
   proof that the channels do not merge.
3. `2026-07-19-realtime-private-degraded-desktop.png` — private transport has
   exhausted capped reconnect while shared remains connected. Narration: one
   failed channel does not erase meeting state or block the text path.
4. `2026-07-19-realtime-participant-mobile-reduced-motion.png` — 390×844
   participant view with no standard-key input plus the A7 private/shared
   speech boundary and typed fallback. Reduced motion is forced.

`../../clips/realtime-channels/2026-07-19-byok-connect-to-degraded.webm`
records the key-secured → two-channel connected → private-only degraded
sequence. The SDP transport and credentials in this E2E capture are synthetic.
The updated clip also preserves the A7 controls in-frame while both channel
controllers change state.
