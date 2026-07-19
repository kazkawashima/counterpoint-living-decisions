import { lookup } from "node:dns/promises";
import { request as requestHttp } from "node:http";
import { request as requestHttps } from "node:https";
import { isIP, type LookupFunction } from "node:net";

import type {
  UrlFetcher,
  UrlFetchFailureReason,
  UrlFetchRequest,
  UrlFetchResult,
} from "@counterpoint/ports";

const DEFAULT_MAX_BYTES = 20 * 1024 * 1024;
const DEFAULT_MAX_REDIRECTS = 3;
const DEFAULT_TIMEOUT_MS = 10_000;

const REDIRECT_STATUS_CODES = new Set([301, 302, 303, 307, 308]);
const SUPPORTED_CONTENT_TYPES = new Set([
  "application/json",
  "application/pdf",
  "text/markdown",
  "text/plain",
]);
const FILE_POLICY_BY_CONTENT_TYPE = new Map<
  string,
  { readonly extensions: readonly string[]; readonly fallback: string }
>([
  ["application/json", { extensions: [".json"], fallback: "artifact.json" }],
  ["application/pdf", { extensions: [".pdf"], fallback: "artifact.pdf" }],
  [
    "text/markdown",
    { extensions: [".md", ".markdown"], fallback: "artifact.md" },
  ],
  ["text/plain", { extensions: [".txt"], fallback: "artifact.txt" }],
]);

export interface ResolvedUrlAddress {
  readonly address: string;
  readonly family: 4 | 6;
}

export type UrlAddressResolver = (
  hostname: string,
) => Promise<readonly ResolvedUrlAddress[]>;

export interface SafeUrlTransportRequest {
  readonly family: 4 | 6;
  readonly pinnedAddress: string;
  readonly signal: AbortSignal;
  readonly url: URL;
}

export interface SafeUrlTransportResponse {
  readonly body: AsyncIterable<Uint8Array>;
  readonly headers: Readonly<
    Record<string, string | readonly string[] | undefined>
  >;
  readonly statusCode: number;
  readonly close: () => void;
}

export interface SafeUrlTransport {
  request(input: SafeUrlTransportRequest): Promise<SafeUrlTransportResponse>;
}

export interface NodeSafeUrlFetcherOptions {
  readonly maxBytes?: number;
  readonly resolver?: UrlAddressResolver;
  readonly transport?: SafeUrlTransport;
}

class SafeUrlFetchFailure extends Error {
  constructor(readonly reason: UrlFetchFailureReason) {
    super("Safe URL fetch failed");
  }
}

function fail(reason: UrlFetchFailureReason): never {
  throw new SafeUrlFetchFailure(reason);
}

function validatedMaxBytes(value: number | undefined): number {
  const maxBytes = value ?? DEFAULT_MAX_BYTES;
  if (
    !Number.isSafeInteger(maxBytes) ||
    maxBytes <= 0 ||
    maxBytes > DEFAULT_MAX_BYTES
  ) {
    throw new TypeError(
      "URL fetch byte limit must be a positive integer no greater than 20 MiB",
    );
  }
  return maxBytes;
}

function hostnameWithoutBrackets(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;
}

function parseIpv4(address: string): readonly number[] | undefined {
  const parts = address.split(".");
  if (parts.length !== 4) {
    return undefined;
  }

  const octets = parts.map((part) => {
    if (!/^(?:0|[1-9]\d{0,2})$/.test(part)) {
      return undefined;
    }
    const octet = Number(part);
    return octet <= 255 ? octet : undefined;
  });
  return octets.every((octet) => octet !== undefined) ? octets : undefined;
}

function parseIpv6(address: string): readonly number[] | undefined {
  if (address.includes("%")) {
    return undefined;
  }

  const halves = address.toLowerCase().split("::");
  if (halves.length > 2) {
    return undefined;
  }

  const parseHalf = (half: string): number[] | undefined => {
    if (half.length === 0) {
      return [];
    }

    const tokens = half.split(":");
    const words: number[] = [];
    for (const [index, token] of tokens.entries()) {
      const ipv4 = parseIpv4(token);
      if (ipv4 !== undefined) {
        if (index !== tokens.length - 1) {
          return undefined;
        }
        words.push(ipv4[0]! * 256 + ipv4[1]!, ipv4[2]! * 256 + ipv4[3]!);
      } else if (/^[\da-f]{1,4}$/.test(token)) {
        words.push(Number.parseInt(token, 16));
      } else {
        return undefined;
      }
    }
    return words;
  };

  const left = parseHalf(halves[0]!);
  const right = parseHalf(halves[1] ?? "");
  if (left === undefined || right === undefined) {
    return undefined;
  }

  if (halves.length === 1) {
    return left.length === 8 ? left : undefined;
  }

  const omittedWords = 8 - left.length - right.length;
  if (omittedWords < 1) {
    return undefined;
  }
  return [...left, ...Array<number>(omittedWords).fill(0), ...right];
}

function isGlobalIpv4(address: string): boolean {
  const octets = parseIpv4(address);
  if (octets === undefined) {
    return false;
  }

  const [first, second, third] = octets as [number, number, number, number];
  return !(
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 0 && third === 0) ||
    (first === 192 && second === 0 && third === 2) ||
    (first === 192 && second === 88 && third === 99) ||
    (first === 192 && second === 168) ||
    (first === 198 && (second === 18 || second === 19)) ||
    (first === 198 && second === 51 && third === 100) ||
    (first === 203 && second === 0 && third === 113) ||
    first >= 224
  );
}

function isGlobalIpv6(address: string): boolean {
  const words = parseIpv6(address);
  if (words === undefined) {
    return false;
  }

  const [first, second, third, fourth, fifth, sixth, seventh, eighth] =
    words as [number, number, number, number, number, number, number, number];

  const ipv4Mapped =
    first === 0 &&
    second === 0 &&
    third === 0 &&
    fourth === 0 &&
    fifth === 0 &&
    sixth === 0xffff;
  if (ipv4Mapped) {
    return isGlobalIpv4(
      `${seventh >>> 8}.${seventh & 0xff}.${eighth >>> 8}.${eighth & 0xff}`,
    );
  }

  const isGlobalUnicast = (first & 0xe000) === 0x2000;
  const isIetfSpecialPurpose = first === 0x2001 && second <= 0x01ff;
  const isDocumentation = first === 0x2001 && second === 0x0db8;
  const isSixToFour = first === 0x2002;
  const isDocumentationV2 = first === 0x3fff && (second & 0xf000) === 0;

  return (
    isGlobalUnicast &&
    !isIetfSpecialPurpose &&
    !isDocumentation &&
    !isSixToFour &&
    !isDocumentationV2
  );
}

function isGlobalAddress(address: string, family: 4 | 6): boolean {
  const actualFamily = isIP(address);
  if (actualFamily !== family) {
    return false;
  }
  return family === 4 ? isGlobalIpv4(address) : isGlobalIpv6(address);
}

async function defaultResolver(
  hostname: string,
): Promise<readonly ResolvedUrlAddress[]> {
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  return addresses.map(({ address, family }) => {
    if (family !== 4 && family !== 6) {
      throw new Error("DNS returned an unsupported address family");
    }
    return { address, family };
  });
}

function pinnedLookup(address: ResolvedUrlAddress): LookupFunction {
  return (_hostname, options, callback) => {
    if (options.all) {
      callback(null, [address]);
      return;
    }
    callback(null, address.address, address.family);
  };
}

class NodeCoreSafeUrlTransport implements SafeUrlTransport {
  request(input: SafeUrlTransportRequest): Promise<SafeUrlTransportResponse> {
    return new Promise((resolve, reject) => {
      const request =
        input.url.protocol === "https:" ? requestHttps : requestHttp;
      const outgoing = request(
        input.url,
        {
          agent: false,
          headers: {
            accept:
              "application/pdf, application/json, text/markdown, text/plain",
            "user-agent": "Counterpoint-Safe-URL-Fetch/1",
          },
          lookup: pinnedLookup({
            address: input.pinnedAddress,
            family: input.family,
          }),
          method: "GET",
          signal: input.signal,
        },
        (incoming) => {
          resolve({
            body: incoming,
            close: () => {
              incoming.destroy();
            },
            headers: incoming.headers,
            statusCode: incoming.statusCode ?? 0,
          });
        },
      );
      outgoing.once("error", reject);
      outgoing.end();
    });
  }
}

function singleHeader(
  headers: SafeUrlTransportResponse["headers"],
  name: string,
): string | undefined {
  const entry = Object.entries(headers).find(
    ([headerName]) => headerName.toLowerCase() === name,
  )?.[1];
  return typeof entry === "string" ? entry : undefined;
}

function validatedUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    fail("invalid_url");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    fail("unsupported_scheme");
  }
  if (url.username.length > 0 || url.password.length > 0) {
    fail("credentials_not_allowed");
  }
  if (url.port.length > 0) {
    fail("port_not_allowed");
  }
  return url;
}

function contentTypeFrom(
  response: SafeUrlTransportResponse,
): string | undefined {
  const value = singleHeader(response.headers, "content-type");
  if (value === undefined) {
    return undefined;
  }
  const contentType = value.split(";", 1)[0]?.trim().toLowerCase();
  return contentType !== undefined && SUPPORTED_CONTENT_TYPES.has(contentType)
    ? contentType
    : undefined;
}

function safeFilename(url: URL, contentType: string): string {
  const policy = FILE_POLICY_BY_CONTENT_TYPE.get(contentType);
  if (policy === undefined) {
    fail("unsupported_content_type");
  }

  const encodedBasename = url.pathname.slice(url.pathname.lastIndexOf("/") + 1);
  let candidate: string;
  try {
    candidate = decodeURIComponent(encodedBasename);
  } catch {
    return policy.fallback;
  }

  const extension = candidate.slice(candidate.lastIndexOf("."));
  const hasUnsafeCharacter = [...candidate].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return (
      codePoint <= 0x1f ||
      codePoint === 0x7f ||
      character === "/" ||
      character === "\\"
    );
  });
  const unsafe =
    candidate.length === 0 ||
    candidate.length > 255 ||
    candidate === "." ||
    candidate === ".." ||
    hasUnsafeCharacter;

  return !unsafe && policy.extensions.includes(extension)
    ? candidate
    : policy.fallback;
}

function validateContentEncoding(response: SafeUrlTransportResponse): void {
  const entry = Object.entries(response.headers).find(
    ([headerName]) => headerName.toLowerCase() === "content-encoding",
  )?.[1];
  if (
    entry !== undefined &&
    (typeof entry !== "string" || entry.trim().toLowerCase() !== "identity")
  ) {
    fail("unsupported_content_encoding");
  }
}

function validateContentLength(
  response: SafeUrlTransportResponse,
  maxBytes: number,
): void {
  const value = singleHeader(response.headers, "content-length");
  if (value === undefined) {
    return;
  }
  if (!/^(?:0|[1-9]\d*)$/.test(value)) {
    fail("network_error");
  }
  const length = Number(value);
  if (!Number.isSafeInteger(length)) {
    fail("network_error");
  }
  if (length > maxBytes) {
    fail("response_too_large");
  }
}

async function collectBody(
  response: SafeUrlTransportResponse,
  maxBytes: number,
  signal: AbortSignal,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;

  for await (const chunk of response.body) {
    if (signal.aborted) {
      fail("timeout");
    }
    if (!(chunk instanceof Uint8Array)) {
      fail("network_error");
    }
    total += chunk.byteLength;
    if (total > maxBytes) {
      fail("response_too_large");
    }
    chunks.push(chunk);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export class NodeSafeUrlFetcher implements UrlFetcher {
  readonly #maxBytes: number;
  readonly #resolver: UrlAddressResolver;
  readonly #transport: SafeUrlTransport;

  constructor(options: NodeSafeUrlFetcherOptions = {}) {
    this.#maxBytes = validatedMaxBytes(options.maxBytes);
    this.#resolver = options.resolver ?? defaultResolver;
    this.#transport = options.transport ?? new NodeCoreSafeUrlTransport();
  }

  async fetch(request: UrlFetchRequest): Promise<UrlFetchResult> {
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;

    try {
      const timeoutFailure = new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          controller.abort();
          reject(new SafeUrlFetchFailure("timeout"));
        }, DEFAULT_TIMEOUT_MS);
        timeout.unref();
      });

      return await Promise.race([
        this.#fetchWithinDeadline(request.url, controller.signal),
        timeoutFailure,
      ]);
    } catch (error) {
      return {
        kind: "failed",
        reason:
          error instanceof SafeUrlFetchFailure
            ? error.reason
            : controller.signal.aborted
              ? "timeout"
              : "network_error",
      };
    } finally {
      if (timeout !== undefined) {
        clearTimeout(timeout);
      }
    }
  }

  async #fetchWithinDeadline(
    rawUrl: string,
    signal: AbortSignal,
  ): Promise<UrlFetchResult> {
    let currentUrl = validatedUrl(rawUrl);
    let redirectCount = 0;

    for (;;) {
      if (signal.aborted) {
        fail("timeout");
      }

      const hostname = hostnameWithoutBrackets(currentUrl.hostname);
      const literalFamily = isIP(hostname);
      let addresses: readonly ResolvedUrlAddress[];
      if (literalFamily === 4 || literalFamily === 6) {
        addresses = [
          {
            address: hostname,
            family: literalFamily,
          },
        ];
      } else {
        try {
          addresses = await this.#resolver(hostname);
        } catch {
          fail(signal.aborted ? "timeout" : "dns_resolution_failed");
        }
      }

      if (signal.aborted) {
        fail("timeout");
      }
      if (addresses.length === 0) {
        fail("dns_resolution_failed");
      }
      if (
        addresses.some(
          ({ address, family }) => !isGlobalAddress(address, family),
        )
      ) {
        fail("unsafe_destination");
      }

      const pinnedAddress = addresses[0]!;
      const response = await this.#transport.request({
        family: pinnedAddress.family,
        pinnedAddress: pinnedAddress.address,
        signal,
        url: new URL(currentUrl),
      });
      if (signal.aborted) {
        response.close();
        fail("timeout");
      }

      if (REDIRECT_STATUS_CODES.has(response.statusCode)) {
        response.close();
        if (redirectCount >= DEFAULT_MAX_REDIRECTS) {
          fail("too_many_redirects");
        }
        const location = singleHeader(response.headers, "location");
        if (location === undefined) {
          fail("invalid_redirect");
        }
        try {
          currentUrl = validatedUrl(new URL(location, currentUrl).href);
        } catch (error) {
          if (error instanceof SafeUrlFetchFailure) {
            throw error;
          }
          fail("invalid_redirect");
        }
        redirectCount += 1;
        continue;
      }

      if (response.statusCode < 200 || response.statusCode >= 300) {
        response.close();
        fail("http_error");
      }

      try {
        validateContentEncoding(response);
        validateContentLength(response, this.#maxBytes);
        const contentType = contentTypeFrom(response);
        if (contentType === undefined) {
          fail("unsupported_content_type");
        }
        const bytes = await collectBody(response, this.#maxBytes, signal);
        return {
          bytes,
          contentType,
          filename: safeFilename(currentUrl, contentType),
          kind: "fetched",
        };
      } catch (error) {
        response.close();
        throw error;
      }
    }
  }
}
