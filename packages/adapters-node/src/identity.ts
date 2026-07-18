import {
  createHash,
  randomBytes,
  randomUUID,
  scrypt,
  timingSafeEqual,
  type ScryptOptions,
} from "node:crypto";

import type {
  Clock,
  IdGenerator,
  PasswordVerifier,
  SessionToken,
  SessionTokenIssuer,
} from "@counterpoint/ports";

const SCRYPT_FORMAT = "scrypt";
const SCRYPT_VERSION = "v1";
const SCRYPT_COST = 16_384;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELIZATION = 1;
const SCRYPT_KEY_BYTES = 32;
const SCRYPT_SALT_BYTES = 16;
const SCRYPT_MAX_MEMORY = 64 * 1024 * 1024;
const TOKEN_BYTES = 32;

interface ParsedScryptHash {
  readonly derivedKey: Buffer;
  readonly salt: Buffer;
}

function requireNonEmpty(value: string, label: string): void {
  if (value.length === 0) {
    throw new TypeError(`${label} must not be empty`);
  }
}

function digestToken(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function parsePositiveInteger(value: string): number | undefined {
  if (!/^[1-9]\d*$/.test(value)) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function parseScryptHash(encodedHash: string): ParsedScryptHash | undefined {
  const [
    format,
    version,
    encodedCost,
    encodedBlockSize,
    encodedParallelization,
    encodedSalt,
    encodedDerivedKey,
    ...extra
  ] = encodedHash.split("$");
  if (
    format !== SCRYPT_FORMAT ||
    version !== SCRYPT_VERSION ||
    extra.length > 0 ||
    encodedSalt === undefined ||
    encodedDerivedKey === undefined
  ) {
    return undefined;
  }

  const cost = parsePositiveInteger(encodedCost ?? "");
  const blockSize = parsePositiveInteger(encodedBlockSize ?? "");
  const parallelization = parsePositiveInteger(encodedParallelization ?? "");
  if (
    cost !== SCRYPT_COST ||
    blockSize !== SCRYPT_BLOCK_SIZE ||
    parallelization !== SCRYPT_PARALLELIZATION
  ) {
    return undefined;
  }

  try {
    const salt = Buffer.from(encodedSalt, "base64url");
    const derivedKey = Buffer.from(encodedDerivedKey, "base64url");
    if (
      salt.length !== SCRYPT_SALT_BYTES ||
      derivedKey.length !== SCRYPT_KEY_BYTES ||
      salt.toString("base64url") !== encodedSalt ||
      derivedKey.toString("base64url") !== encodedDerivedKey
    ) {
      return undefined;
    }
    return { derivedKey, salt };
  } catch {
    return undefined;
  }
}

export function isScryptPasswordHash(encodedHash: string): boolean {
  return parseScryptHash(encodedHash) !== undefined;
}

function deriveScryptKey(password: string, salt: Buffer): Promise<Buffer> {
  const options: ScryptOptions = {
    N: SCRYPT_COST,
    maxmem: SCRYPT_MAX_MEMORY,
    p: SCRYPT_PARALLELIZATION,
    r: SCRYPT_BLOCK_SIZE,
  };
  return new Promise((resolve, reject) => {
    scrypt(password, salt, SCRYPT_KEY_BYTES, options, (error, derivedKey) => {
      if (error === null) {
        resolve(derivedKey);
        return;
      }
      reject(error);
    });
  });
}

export class SystemClock implements Clock {
  now(): string {
    return new Date().toISOString();
  }
}

export class CryptographicIdGenerator implements IdGenerator {
  next(namespace: string): string {
    requireNonEmpty(namespace, "ID namespace");
    return `${namespace}_${randomUUID()}`;
  }
}

export class Sha256SessionTokenIssuer implements SessionTokenIssuer {
  async digest(value: string): Promise<string> {
    await Promise.resolve();
    return digestToken(value);
  }

  async issue(): Promise<SessionToken> {
    await Promise.resolve();
    const value = randomBytes(TOKEN_BYTES).toString("base64url");
    return {
      hash: digestToken(value),
      value,
    };
  }
}

export class ScryptPasswordHasher implements PasswordVerifier {
  async hash(password: string): Promise<string> {
    requireNonEmpty(password, "Password");
    const salt = randomBytes(SCRYPT_SALT_BYTES);
    const derivedKey = await deriveScryptKey(password, salt);
    return [
      SCRYPT_FORMAT,
      SCRYPT_VERSION,
      String(SCRYPT_COST),
      String(SCRYPT_BLOCK_SIZE),
      String(SCRYPT_PARALLELIZATION),
      salt.toString("base64url"),
      derivedKey.toString("base64url"),
    ].join("$");
  }

  async verify(password: string, encodedHash: string): Promise<boolean> {
    const parsed = parseScryptHash(encodedHash);
    if (parsed === undefined) {
      return false;
    }
    const candidate = await deriveScryptKey(password, parsed.salt);
    return timingSafeEqual(candidate, parsed.derivedKey);
  }
}
