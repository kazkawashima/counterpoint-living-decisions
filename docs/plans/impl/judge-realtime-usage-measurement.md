# Judge Realtime usage measurement

Status: harness ready; no approved-provider sample set recorded.

## Purpose

Replace the temporary full-cap-per-attempt token reservation with secondary
limits grounded in the scripted flagship while preserving the USD 25
rolling-24-hour hard stop.

## Accepted sample format

One JSON object per line with exactly these non-negative integer counters:

```json
{"costMicroUsd":0,"generationCount":0,"inputTokens":0,"outputTokens":0,"realtimeSeconds":0}
```

Identifiers, IP data, reservation IDs, call IDs, transcripts, prompts, model
frames, and other fields are rejected. The input file remains local and
ignored; only the content-free summary may be retained.

Run:

```bash
npm run judge:usage:measure -- .data/judge-realtime-usage.jsonl
```

The command emits sample count plus min, max, p50, p95, and p99 for each
dimension. Errors are generic and never print the input path or rejected
content.

## Collection gate

Do not lower production limits until all of the following are true:

1. Provider use is explicitly approved and the judge Secret is registered
   through the deployment runbook.
2. At least 20 complete scripted flagship sessions are collected across
   private and shared turns, interruption, and the three-generation ceiling.
3. Only trustworthy final accumulator totals enter the measurement file.
   Untrustworthy or failed sessions continue to settle at the full reservation
   and are counted separately as failures.
4. The sample summary and pricing version are recorded with the tested commit.
5. Candidate limits use at least 100% headroom above the observed maximum,
   remain bounded by 30 Realtime seconds and three generations, and are
   re-priced against the pinned worst-case modality rates.
6. The resulting per-attempt reservation and rolling request limits cannot
   exceed the USD 25 product ceiling under concurrency or retry.

This harness describes evidence; it does not mutate configuration or infer
production limits from synthetic fixtures.
