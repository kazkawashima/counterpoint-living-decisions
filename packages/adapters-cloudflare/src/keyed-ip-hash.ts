const HMAC_ALGORITHM = {
  hash: "SHA-256",
  name: "HMAC",
} as const;

const HASH_PREFIX = "hmac-sha256:";
const HEX_SEGMENT_PATTERN = /^[0-9a-f]{1,4}$/u;
const IPV4_SEGMENT_PATTERN = /^(?:0|[1-9][0-9]{0,2})$/u;

export type KeyedIpHash = (ipAddress: string) => Promise<string>;

function isCanonicalIpv4(value: string): boolean {
  const segments = value.split(".");
  return (
    segments.length === 4 &&
    segments.every(
      (segment) => IPV4_SEGMENT_PATTERN.test(segment) && Number(segment) <= 255,
    )
  );
}

function parseIpv6(value: string): number[] | undefined {
  if (!value.includes(":") || !/^[0-9a-f:]+$/u.test(value)) {
    return undefined;
  }

  const compressionIndex = value.indexOf("::");
  if (
    compressionIndex !== -1 &&
    value.slice(compressionIndex + 2).includes("::")
  ) {
    return undefined;
  }

  if (compressionIndex === -1) {
    const segments = value.split(":");
    if (
      segments.length !== 8 ||
      segments.some((segment) => !HEX_SEGMENT_PATTERN.test(segment))
    ) {
      return undefined;
    }
    return segments.map((segment) => Number.parseInt(segment, 16));
  }

  const leftValue = value.slice(0, compressionIndex);
  const rightValue = value.slice(compressionIndex + 2);
  const left = leftValue === "" ? [] : leftValue.split(":");
  const right = rightValue === "" ? [] : rightValue.split(":");
  const explicitSegments = [...left, ...right];

  if (
    explicitSegments.some((segment) => !HEX_SEGMENT_PATTERN.test(segment)) ||
    explicitSegments.length >= 8
  ) {
    return undefined;
  }

  return [
    ...left.map((segment) => Number.parseInt(segment, 16)),
    ...Array.from({ length: 8 - explicitSegments.length }, () => 0),
    ...right.map((segment) => Number.parseInt(segment, 16)),
  ];
}

function formatCanonicalIpv6(segments: readonly number[]): string {
  let longestZeroRunStart = -1;
  let longestZeroRunLength = 0;

  for (let index = 0; index < segments.length;) {
    if (segments[index] !== 0) {
      index += 1;
      continue;
    }

    const runStart = index;
    while (index < segments.length && segments[index] === 0) {
      index += 1;
    }
    const runLength = index - runStart;
    if (runLength >= 2 && runLength > longestZeroRunLength) {
      longestZeroRunStart = runStart;
      longestZeroRunLength = runLength;
    }
  }

  const formatted = segments.map((segment) => segment.toString(16));
  if (longestZeroRunStart === -1) {
    return formatted.join(":");
  }

  const before = formatted.slice(0, longestZeroRunStart).join(":");
  const after = formatted
    .slice(longestZeroRunStart + longestZeroRunLength)
    .join(":");
  return `${before}::${after}`;
}

function isCanonicalIpv6(value: string): boolean {
  const segments = parseIpv6(value);
  return segments !== undefined && formatCanonicalIpv6(segments) === value;
}

function requireCanonicalIpAddress(value: unknown): asserts value is string {
  if (
    typeof value !== "string" ||
    (!isCanonicalIpv4(value) && !isCanonicalIpv6(value))
  ) {
    throw new TypeError("IP address must be a canonical IPv4 or IPv6 address");
  }
}

function toLowercaseHex(value: ArrayBuffer): string {
  return [...new Uint8Array(value)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function createKeyedIpHash(secret: string): KeyedIpHash {
  if (typeof secret !== "string" || secret.trim().length === 0) {
    throw new TypeError("IP hash secret must be a non-empty string");
  }

  const secretBytes = new TextEncoder().encode(secret);
  let keyPromise: Promise<CryptoKey> | undefined;

  const getKey = (): Promise<CryptoKey> => {
    keyPromise ??= crypto.subtle
      .importKey("raw", secretBytes, HMAC_ALGORITHM, false, ["sign"])
      .catch(() => {
        throw new Error("IP hash key initialization failed");
      });
    return keyPromise;
  };

  return async (ipAddress: string): Promise<string> => {
    requireCanonicalIpAddress(ipAddress);

    try {
      const signature = await crypto.subtle.sign(
        "HMAC",
        await getKey(),
        new TextEncoder().encode(ipAddress),
      );
      return `${HASH_PREFIX}${toLowercaseHex(signature)}`;
    } catch {
      throw new Error("IP hashing failed");
    }
  };
}
