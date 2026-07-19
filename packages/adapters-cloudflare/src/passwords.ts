import type { PasswordVerifier } from "@counterpoint/ports";

const SCRYPT_FORMAT = "scrypt";
const SCRYPT_VERSION = "v1";
const SCRYPT_COST = 16_384;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELIZATION = 1;
const SCRYPT_KEY_BYTES = 32;
const SCRYPT_SALT_BYTES = 16;
const SCRYPT_BLOCK_BYTES = 128 * SCRYPT_BLOCK_SIZE;
const SCRYPT_BLOCK_WORDS = SCRYPT_BLOCK_BYTES / 4;
const SCRYPT_MEMORY_BYTES =
  SCRYPT_COST * SCRYPT_BLOCK_WORDS * Uint32Array.BYTES_PER_ELEMENT;
const MAX_PASSWORD_CHARACTERS = 1024;
const MAX_ENCODED_HASH_CHARACTERS = 256;

const PBKDF2_ALGORITHM = { name: "PBKDF2" } as const;
const PBKDF2_HASH = "SHA-256" as const;

interface ParsedScryptHash {
  readonly derivedKey: Uint8Array;
  readonly salt: Uint8Array;
}

function parsePositiveInteger(value: string): number | undefined {
  if (!/^[1-9]\d*$/u.test(value)) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCodePoint(byte);
  }
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function decodeBase64Url(
  encoded: string,
  expectedLength: number,
): Uint8Array | undefined {
  if (!/^[A-Za-z0-9_-]+$/u.test(encoded) || encoded.length % 4 === 1) {
    return undefined;
  }

  try {
    const padding = "=".repeat((4 - (encoded.length % 4)) % 4);
    const binary = atob(
      `${encoded.replaceAll("-", "+").replaceAll("_", "/")}${padding}`,
    );
    if (binary.length !== expectedLength) {
      return undefined;
    }
    const bytes = Uint8Array.from(
      binary,
      (character) => character.codePointAt(0) ?? 0,
    );
    return encodeBase64Url(bytes) === encoded ? bytes : undefined;
  } catch {
    return undefined;
  }
}

function parseScryptHash(encodedHash: unknown): ParsedScryptHash | undefined {
  if (
    typeof encodedHash !== "string" ||
    encodedHash.length > MAX_ENCODED_HASH_CHARACTERS
  ) {
    return undefined;
  }

  const parts = encodedHash.split("$");
  if (parts.length !== 7) {
    return undefined;
  }
  const [
    format,
    version,
    encodedCost,
    encodedBlockSize,
    encodedParallelization,
    encodedSalt,
    encodedDerivedKey,
  ] = parts;
  if (
    format !== SCRYPT_FORMAT ||
    version !== SCRYPT_VERSION ||
    encodedCost === undefined ||
    encodedBlockSize === undefined ||
    encodedParallelization === undefined ||
    encodedSalt === undefined ||
    encodedDerivedKey === undefined
  ) {
    return undefined;
  }

  if (
    parsePositiveInteger(encodedCost) !== SCRYPT_COST ||
    parsePositiveInteger(encodedBlockSize) !== SCRYPT_BLOCK_SIZE ||
    parsePositiveInteger(encodedParallelization) !== SCRYPT_PARALLELIZATION
  ) {
    return undefined;
  }

  const salt = decodeBase64Url(encodedSalt, SCRYPT_SALT_BYTES);
  const derivedKey = decodeBase64Url(encodedDerivedKey, SCRYPT_KEY_BYTES);
  return salt === undefined || derivedKey === undefined
    ? undefined
    : { derivedKey, salt };
}

async function derivePbkdf2Sha256(
  password: string,
  salt: Uint8Array,
  outputBytes: number,
): Promise<Uint8Array> {
  const saltCopy = new Uint8Array(salt.length);
  saltCopy.set(salt);
  try {
    const passwordKey = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(password),
      PBKDF2_ALGORITHM,
      false,
      ["deriveBits"],
    );
    const derivedBits = await crypto.subtle.deriveBits(
      {
        hash: PBKDF2_HASH,
        iterations: 1,
        name: "PBKDF2",
        salt: saltCopy.buffer,
      },
      passwordKey,
      outputBytes * 8,
    );
    return new Uint8Array(derivedBits);
  } finally {
    saltCopy.fill(0);
  }
}

function rotateLeft(value: number, shift: number): number {
  return ((value << shift) | (value >>> (32 - shift))) >>> 0;
}

function readWord(block: Uint32Array, index: number): number {
  return block[index] ?? 0;
}

function xorWord(block: Uint32Array, index: number, value: number): void {
  block[index] = (readWord(block, index) ^ value) >>> 0;
}

function salsa208(block: Uint32Array): void {
  const original = block.slice();
  for (let round = 0; round < 4; round += 1) {
    xorWord(
      block,
      4,
      rotateLeft((readWord(block, 0) + readWord(block, 12)) >>> 0, 7),
    );
    xorWord(
      block,
      8,
      rotateLeft((readWord(block, 4) + readWord(block, 0)) >>> 0, 9),
    );
    xorWord(
      block,
      12,
      rotateLeft((readWord(block, 8) + readWord(block, 4)) >>> 0, 13),
    );
    xorWord(
      block,
      0,
      rotateLeft((readWord(block, 12) + readWord(block, 8)) >>> 0, 18),
    );
    xorWord(
      block,
      9,
      rotateLeft((readWord(block, 5) + readWord(block, 1)) >>> 0, 7),
    );
    xorWord(
      block,
      13,
      rotateLeft((readWord(block, 9) + readWord(block, 5)) >>> 0, 9),
    );
    xorWord(
      block,
      1,
      rotateLeft((readWord(block, 13) + readWord(block, 9)) >>> 0, 13),
    );
    xorWord(
      block,
      5,
      rotateLeft((readWord(block, 1) + readWord(block, 13)) >>> 0, 18),
    );
    xorWord(
      block,
      14,
      rotateLeft((readWord(block, 10) + readWord(block, 6)) >>> 0, 7),
    );
    xorWord(
      block,
      2,
      rotateLeft((readWord(block, 14) + readWord(block, 10)) >>> 0, 9),
    );
    xorWord(
      block,
      6,
      rotateLeft((readWord(block, 2) + readWord(block, 14)) >>> 0, 13),
    );
    xorWord(
      block,
      10,
      rotateLeft((readWord(block, 6) + readWord(block, 2)) >>> 0, 18),
    );
    xorWord(
      block,
      3,
      rotateLeft((readWord(block, 15) + readWord(block, 11)) >>> 0, 7),
    );
    xorWord(
      block,
      7,
      rotateLeft((readWord(block, 3) + readWord(block, 15)) >>> 0, 9),
    );
    xorWord(
      block,
      11,
      rotateLeft((readWord(block, 7) + readWord(block, 3)) >>> 0, 13),
    );
    xorWord(
      block,
      15,
      rotateLeft((readWord(block, 11) + readWord(block, 7)) >>> 0, 18),
    );

    xorWord(
      block,
      1,
      rotateLeft((readWord(block, 0) + readWord(block, 3)) >>> 0, 7),
    );
    xorWord(
      block,
      2,
      rotateLeft((readWord(block, 1) + readWord(block, 0)) >>> 0, 9),
    );
    xorWord(
      block,
      3,
      rotateLeft((readWord(block, 2) + readWord(block, 1)) >>> 0, 13),
    );
    xorWord(
      block,
      0,
      rotateLeft((readWord(block, 3) + readWord(block, 2)) >>> 0, 18),
    );
    xorWord(
      block,
      6,
      rotateLeft((readWord(block, 5) + readWord(block, 4)) >>> 0, 7),
    );
    xorWord(
      block,
      7,
      rotateLeft((readWord(block, 6) + readWord(block, 5)) >>> 0, 9),
    );
    xorWord(
      block,
      4,
      rotateLeft((readWord(block, 7) + readWord(block, 6)) >>> 0, 13),
    );
    xorWord(
      block,
      5,
      rotateLeft((readWord(block, 4) + readWord(block, 7)) >>> 0, 18),
    );
    xorWord(
      block,
      11,
      rotateLeft((readWord(block, 10) + readWord(block, 9)) >>> 0, 7),
    );
    xorWord(
      block,
      8,
      rotateLeft((readWord(block, 11) + readWord(block, 10)) >>> 0, 9),
    );
    xorWord(
      block,
      9,
      rotateLeft((readWord(block, 8) + readWord(block, 11)) >>> 0, 13),
    );
    xorWord(
      block,
      10,
      rotateLeft((readWord(block, 9) + readWord(block, 8)) >>> 0, 18),
    );
    xorWord(
      block,
      12,
      rotateLeft((readWord(block, 15) + readWord(block, 14)) >>> 0, 7),
    );
    xorWord(
      block,
      13,
      rotateLeft((readWord(block, 12) + readWord(block, 15)) >>> 0, 9),
    );
    xorWord(
      block,
      14,
      rotateLeft((readWord(block, 13) + readWord(block, 12)) >>> 0, 13),
    );
    xorWord(
      block,
      15,
      rotateLeft((readWord(block, 14) + readWord(block, 13)) >>> 0, 18),
    );
  }

  for (let index = 0; index < block.length; index += 1) {
    block[index] = (readWord(block, index) + (original[index] ?? 0)) >>> 0;
  }
  original.fill(0);
}

function blockMix(
  input: Uint32Array,
  output: Uint32Array,
  scratch: Uint32Array,
): void {
  scratch.set(input.subarray(input.length - 16));
  const blockCount = input.length / 16;
  for (let blockIndex = 0; blockIndex < blockCount; blockIndex += 1) {
    const inputOffset = blockIndex * 16;
    for (let word = 0; word < 16; word += 1) {
      scratch[word] =
        (readWord(scratch, word) ^ readWord(input, inputOffset + word)) >>> 0;
    }
    salsa208(scratch);
    const outputBlock =
      (blockIndex & 1) === 0
        ? blockIndex >>> 1
        : SCRYPT_BLOCK_SIZE + (blockIndex >>> 1);
    output.set(scratch, outputBlock * 16);
  }
}

function bytesToWords(bytes: Uint8Array): Uint32Array {
  const words = new Uint32Array(bytes.length / 4);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let index = 0; index < words.length; index += 1) {
    words[index] = view.getUint32(index * 4, true);
  }
  return words;
}

function wordsToBytes(words: Uint32Array): Uint8Array {
  const bytes = new Uint8Array(words.length * 4);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < words.length; index += 1) {
    view.setUint32(index * 4, words[index] ?? 0, true);
  }
  return bytes;
}

function integerify(block: Uint32Array): number {
  return block[block.length - 16] ?? 0;
}

function romix(block: Uint32Array): void {
  const work = new Uint32Array(SCRYPT_BLOCK_WORDS);
  const scratch = new Uint32Array(16);
  const memory = new Uint32Array(SCRYPT_MEMORY_BYTES / 4);
  let current: Uint32Array<ArrayBufferLike> = block;
  let next: Uint32Array<ArrayBufferLike> = work;

  try {
    for (let index = 0; index < SCRYPT_COST; index += 1) {
      memory.set(current, index * SCRYPT_BLOCK_WORDS);
      blockMix(current, next, scratch);
      [current, next] = [next, current];
    }
    for (let index = 0; index < SCRYPT_COST; index += 1) {
      const memoryOffset =
        (integerify(current) & (SCRYPT_COST - 1)) * SCRYPT_BLOCK_WORDS;
      for (let word = 0; word < SCRYPT_BLOCK_WORDS; word += 1) {
        current[word] =
          (current[word] ?? 0) ^ (memory[memoryOffset + word] ?? 0);
      }
      blockMix(current, next, scratch);
      [current, next] = [next, current];
    }
    block.set(current);
  } finally {
    work.fill(0);
    scratch.fill(0);
    memory.fill(0);
  }
}

async function deriveScryptKey(
  password: string,
  salt: Uint8Array,
): Promise<Uint8Array> {
  const initial = await derivePbkdf2Sha256(
    password,
    salt,
    SCRYPT_BLOCK_BYTES * SCRYPT_PARALLELIZATION,
  );
  const block = bytesToWords(initial);
  initial.fill(0);
  try {
    romix(block);
    const finalSalt = wordsToBytes(block);
    try {
      return await derivePbkdf2Sha256(password, finalSalt, SCRYPT_KEY_BYTES);
    } finally {
      finalSalt.fill(0);
    }
  } finally {
    block.fill(0);
  }
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) {
    return false;
  }
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

export class ScryptPasswordVerifier implements PasswordVerifier {
  async verify(password: string, encodedHash: string): Promise<boolean> {
    if (
      typeof password !== "string" ||
      password.length === 0 ||
      password.length > MAX_PASSWORD_CHARACTERS
    ) {
      return false;
    }

    const parsed = parseScryptHash(encodedHash);
    if (parsed === undefined) {
      return false;
    }

    let candidate: Uint8Array | undefined;
    try {
      candidate = await deriveScryptKey(password, parsed.salt);
      return constantTimeEqual(candidate, parsed.derivedKey);
    } catch {
      return false;
    } finally {
      candidate?.fill(0);
      parsed.salt.fill(0);
      parsed.derivedKey.fill(0);
    }
  }
}
