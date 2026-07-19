import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const MAX_INPUT_BYTES = 1024 * 1024;
const MAX_SAMPLES = 10_000;
const DIMENSIONS = [
  "costMicroUsd",
  "generationCount",
  "inputTokens",
  "outputTokens",
  "realtimeSeconds",
];

function nonNegativeSafeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function usageSample(value) {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).length !== DIMENSIONS.length ||
    !DIMENSIONS.every(
      (dimension) =>
        Object.hasOwn(value, dimension) &&
        nonNegativeSafeInteger(value[dimension]),
    )
  ) {
    throw new TypeError("Usage sample must contain only bounded counters");
  }
  return Object.fromEntries(
    DIMENSIONS.map((dimension) => [dimension, value[dimension]]),
  );
}

function percentile(sorted, percentage) {
  const rank = Math.max(1, Math.ceil((percentage / 100) * sorted.length));
  return sorted[rank - 1];
}

export function summarizeJudgeRealtimeUsageJsonl(source) {
  if (typeof source !== "string") {
    throw new TypeError("Usage input must be text");
  }
  if (new TextEncoder().encode(source).byteLength > MAX_INPUT_BYTES) {
    throw new TypeError("Usage input is too large");
  }
  const lines = source
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0 || lines.length > MAX_SAMPLES) {
    throw new TypeError("Usage input must contain a bounded sample set");
  }
  const samples = lines.map((line) => usageSample(JSON.parse(line)));
  return {
    dimensions: Object.fromEntries(
      DIMENSIONS.map((dimension) => {
        const values = samples
          .map((sample) => sample[dimension])
          .sort((left, right) => left - right);
        return [
          dimension,
          {
            max: values.at(-1),
            min: values[0],
            p50: percentile(values, 50),
            p95: percentile(values, 95),
            p99: percentile(values, 99),
          },
        ];
      }),
    ),
    sampleCount: samples.length,
  };
}

async function main() {
  const [inputPath, ...unexpected] = process.argv.slice(2);
  if (inputPath === undefined || unexpected.length > 0) {
    throw new TypeError("Expected exactly one JSONL input path");
  }
  const source = await readFile(inputPath, "utf8");
  process.stdout.write(
    `${JSON.stringify(summarizeJudgeRealtimeUsageJsonl(source))}\n`,
  );
}

if (process.argv[1] !== undefined) {
  const entryUrl = pathToFileURL(process.argv[1]).href;
  if (import.meta.url === entryUrl) {
    main().catch(() => {
      process.stderr.write("Judge Realtime usage measurement failed.\n");
      process.exitCode = 1;
    });
  }
}
