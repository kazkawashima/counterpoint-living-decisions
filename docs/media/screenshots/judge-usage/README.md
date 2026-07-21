# Judge usage capture notes

All values and states in these captures are synthetic. The panel contains only
content-free rolling-24-hour counters; it does not render account, IP, meeting,
reservation, provider, credential, or decision-content identifiers.

## Capture inventory

1. `2026-07-20-judge-usage-available-desktop-reduced-motion.png` — historical
   1440×900 browser context showing the earlier multi-dimension panel.
2. `2026-07-20-judge-usage-exhausted-desktop-reduced-motion.png` — 1440×900
   browser context. Shows the explicit daily-limit state after a synthetic
   managed turn while durable text remains available.
3. `2026-07-20-judge-usage-exhausted-mobile-reduced-motion.png` — 390×844
   responsive layout of the same limit state with motion forced off.
4. `2026-07-20-judge-usage-unavailable-mobile-reduced-motion.png` — 390×844
   retryable meter failure. New paid work is described as fail-closed without
   implying that meeting state or manual text is unavailable.
5. `2026-07-21-judge-realtime-generation-limit-desktop.png` — historical
   synthetic judge workspace for the retired generation-limit presentation.

The current implementation renders only the rolling USD 25 cost meter. The
earlier multi-dimension and generation-limit captures remain as dated evidence
of the prior implementation and are not the current judge UI contract.

The committed browser test generates every capture, verifies a same-origin
external-style API hostname, exercises explicit refresh, and proves that
sensitive identifiers are absent from the rendered panel. Reel production is
deferred until the hosted product path is viewable; these images are
development evidence only.

Capture dates: 2026-07-20–2026-07-21. Feature slice: judge rolling-24-hour
usage visibility and non-retryable managed-call denial.
