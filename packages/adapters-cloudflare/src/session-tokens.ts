import type { SessionToken, SessionTokenIssuer } from "@counterpoint/ports";

const TOKEN_BYTES = 32;

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCodePoint(byte);
  }
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export class WebCryptoSessionTokenIssuer implements SessionTokenIssuer {
  digest(value: string): Promise<string> {
    return sha256Hex(value);
  }

  async issue(): Promise<SessionToken> {
    const bytes = crypto.getRandomValues(new Uint8Array(TOKEN_BYTES));
    const value = base64Url(bytes);
    return {
      hash: await sha256Hex(value),
      value,
    };
  }
}
