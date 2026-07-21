# Judge usage capture notes

All values and states in these captures are synthetic. The panel contains only
content-free rolling-24-hour counters; it does not render account, IP, meeting,
reservation, provider, credential, or decision-content identifiers.

## Capture inventory

1. `2026-07-20-judge-usage-available-desktop-reduced-motion.png` — 1440×900
   browser context, cropped to the usage panel. Shows the available USD 25
   safety budget and all eight enforced dimensions.
2. `2026-07-20-judge-usage-exhausted-desktop-reduced-motion.png` — 1440×900
   browser context. Shows the explicit daily-limit state after a synthetic
   managed turn while durable text remains available.
3. `2026-07-20-judge-usage-exhausted-mobile-reduced-motion.png` — 390×844
   responsive layout of the same limit state with motion forced off.
4. `2026-07-20-judge-usage-unavailable-mobile-reduced-motion.png` — 390×844
   retryable meter failure. New paid work is described as fail-closed without
   implying that meeting state or manual text is unavailable.
5. `2026-07-21-judge-realtime-generation-limit-desktop.png` — 1440×900
   synthetic judge workspace. A managed Realtime
   start receives a non-retryable generation limit, preserves the exact cause,
   performs no automatic retry, and keeps durable text available. The nearby
   access copy states that one connection reserves three generations and up to
   30 seconds.

The committed browser test generates every capture, verifies a same-origin
external-style API hostname, exercises explicit refresh, and proves that
sensitive identifiers are absent from the rendered panel. Reel production is
deferred until the hosted product path is viewable; these images are
development evidence only.

Capture dates: 2026-07-20–2026-07-21. Feature slice: judge rolling-24-hour
usage visibility and non-retryable managed-call denial.
