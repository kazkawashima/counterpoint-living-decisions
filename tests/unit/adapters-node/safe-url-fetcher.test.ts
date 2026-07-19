import {
  NodeSafeUrlFetcher,
  type ResolvedUrlAddress,
  type SafeUrlTransport,
  type SafeUrlTransportRequest,
  type SafeUrlTransportResponse,
  type UrlAddressResolver,
} from "@counterpoint/adapters-node";
import type { UrlFetcher, UrlFetchResult } from "@counterpoint/ports";
import { describe, expect, it, vi } from "vitest";

const encoder = new TextEncoder();
const PUBLIC_V4: ResolvedUrlAddress = {
  address: "93.184.216.34",
  family: 4,
};
const PUBLIC_V6: ResolvedUrlAddress = {
  address: "2606:2800:220:1:248:1893:25c8:1946",
  family: 6,
};

function bodyFrom(
  source: () => Generator<Uint8Array, void, undefined>,
): AsyncIterable<Uint8Array> {
  return {
    async *[Symbol.asyncIterator]() {
      await Promise.resolve();
      yield* source();
    },
  };
}

function response(
  overrides: Partial<SafeUrlTransportResponse> = {},
): SafeUrlTransportResponse {
  return {
    body: bodyFrom(function* () {
      yield encoder.encode("synthetic evidence");
    }),
    close: vi.fn(),
    headers: { "content-type": "text/plain; charset=utf-8" },
    statusCode: 200,
    ...overrides,
  };
}

function queueTransport(
  ...responses: SafeUrlTransportResponse[]
): SafeUrlTransport & {
  readonly requests: SafeUrlTransportRequest[];
} {
  const requests: SafeUrlTransportRequest[] = [];
  return {
    requests,
    request(input) {
      requests.push(input);
      const next = responses.shift();
      if (next === undefined) {
        throw new Error("Unexpected synthetic request");
      }
      return Promise.resolve(next);
    },
  };
}

function resolverFor(
  values: Readonly<Record<string, readonly ResolvedUrlAddress[]>>,
): UrlAddressResolver {
  return (hostname) => Promise.resolve(values[hostname] ?? []);
}

async function fetchWith(
  rawUrl: string,
  options: ConstructorParameters<typeof NodeSafeUrlFetcher>[0],
): Promise<UrlFetchResult> {
  const fetcher: UrlFetcher = new NodeSafeUrlFetcher(options);
  return fetcher.fetch({ url: rawUrl });
}

describe("NodeSafeUrlFetcher", () => {
  it.each([
    ["unsupported scheme", "file:///etc/passwd", "unsupported_scheme"],
    [
      "URL userinfo",
      "https://user:secret@public.example/document",
      "credentials_not_allowed",
    ],
    [
      "non-default HTTP port",
      "http://public.example:8080/document",
      "port_not_allowed",
    ],
    [
      "non-default HTTPS port",
      "https://public.example:8443/document",
      "port_not_allowed",
    ],
  ])("rejects %s before DNS or transport", async (_label, url, reason) => {
    const resolver = vi.fn<UrlAddressResolver>();
    const transport = queueTransport();

    await expect(fetchWith(url, { resolver, transport })).resolves.toEqual({
      kind: "failed",
      reason,
    });
    expect(resolver).not.toHaveBeenCalled();
    expect(transport.requests).toHaveLength(0);
  });

  it.each([
    ["loopback IPv4", "127.0.0.1"],
    ["private IPv4", "10.20.30.40"],
    ["link-local IPv4", "169.254.1.2"],
    ["metadata IPv4", "169.254.169.254"],
    ["carrier-grade NAT IPv4", "100.100.100.200"],
    ["multicast IPv4", "224.0.0.1"],
    ["documentation/non-global IPv4", "192.0.2.10"],
    ["unspecified IPv6", "::"],
    ["loopback IPv6", "::1"],
    ["IPv4-mapped loopback IPv6", "::ffff:127.0.0.1"],
    ["unique-local IPv6", "fd00::1"],
    ["link-local IPv6", "fe80::1"],
    ["multicast IPv6", "ff02::1"],
    ["documentation/non-global IPv6", "2001:db8::1"],
  ])("rejects %s destination %s", async (_label, address) => {
    const transport = queueTransport();
    const literal = address.includes(":") ? `[${address}]` : address;

    await expect(
      fetchWith(`https://${literal}/document`, { transport }),
    ).resolves.toEqual({
      kind: "failed",
      reason: "unsafe_destination",
    });
    expect(transport.requests).toHaveLength(0);
  });

  it("rejects a hostname when any DNS answer is non-global", async () => {
    const transport = queueTransport();
    const resolver = resolverFor({
      "mixed.example": [
        PUBLIC_V4,
        { address: "10.0.0.7", family: 4 },
        PUBLIC_V6,
      ],
    });

    await expect(
      fetchWith("https://mixed.example/document", { resolver, transport }),
    ).resolves.toEqual({
      kind: "failed",
      reason: "unsafe_destination",
    });
    expect(transport.requests).toHaveLength(0);
  });

  it("pins the connection to a validated public DNS answer", async () => {
    const transport = queueTransport(response());
    const resolver = vi
      .fn<UrlAddressResolver>()
      .mockResolvedValue([PUBLIC_V4, PUBLIC_V6]);

    await expect(
      fetchWith("https://public.example:443/document?synthetic=1", {
        resolver,
        transport,
      }),
    ).resolves.toEqual({
      bytes: encoder.encode("synthetic evidence"),
      contentType: "text/plain",
      filename: "artifact.txt",
      kind: "fetched",
    });
    expect(resolver).toHaveBeenCalledWith("public.example");
    expect(transport.requests).toHaveLength(1);
    expect(transport.requests[0]).toMatchObject({
      family: 4,
      pinnedAddress: PUBLIC_V4.address,
    });
    expect(transport.requests[0]?.url.href).toBe(
      "https://public.example/document?synthetic=1",
    );
  });

  it("allows explicitly written default HTTP and HTTPS ports", async () => {
    const httpTransport = queueTransport(response());
    const httpsTransport = queueTransport(response());

    await expect(
      fetchWith("http://public.example:80/document.txt", {
        resolver: () => Promise.resolve([PUBLIC_V4]),
        transport: httpTransport,
      }),
    ).resolves.toMatchObject({ filename: "document.txt", kind: "fetched" });
    await expect(
      fetchWith("https://public.example:443/document.txt", {
        resolver: () => Promise.resolve([PUBLIC_V4]),
        transport: httpsTransport,
      }),
    ).resolves.toMatchObject({ filename: "document.txt", kind: "fetched" });
    expect(httpTransport.requests[0]?.url.href).toBe(
      "http://public.example/document.txt",
    );
    expect(httpsTransport.requests[0]?.url.href).toBe(
      "https://public.example/document.txt",
    );
  });

  it("re-resolves redirects and rejects a private redirect target without reading either body", async () => {
    const redirectBodyStarted = vi.fn();
    const redirect = response({
      body: bodyFrom(function* () {
        redirectBodyStarted();
        yield encoder.encode("must not be read");
      }),
      headers: { location: "http://private.example/metadata" },
      statusCode: 302,
    });
    const transport = queueTransport(redirect);
    const resolver = vi
      .fn<UrlAddressResolver>()
      .mockResolvedValueOnce([PUBLIC_V4])
      .mockResolvedValueOnce([{ address: "10.0.0.5", family: 4 }]);

    await expect(
      fetchWith("https://public.example/start", { resolver, transport }),
    ).resolves.toEqual({
      kind: "failed",
      reason: "unsafe_destination",
    });
    expect(resolver).toHaveBeenNthCalledWith(1, "public.example");
    expect(resolver).toHaveBeenNthCalledWith(2, "private.example");
    expect(redirect.close).toHaveBeenCalledOnce();
    expect(redirectBodyStarted).not.toHaveBeenCalled();
    expect(transport.requests).toHaveLength(1);
  });

  it("permits three redirects, re-resolves every hop, and rejects the fourth", async () => {
    const redirects = Array.from({ length: 4 }, (_, index) =>
      response({
        headers: { location: `https://hop${index + 1}.example/document` },
        statusCode: 302,
      }),
    );
    const transport = queueTransport(...redirects);
    const resolver = vi.fn<UrlAddressResolver>().mockResolvedValue([PUBLIC_V4]);

    await expect(
      fetchWith("https://hop0.example/document", { resolver, transport }),
    ).resolves.toEqual({
      kind: "failed",
      reason: "too_many_redirects",
    });
    expect(resolver).toHaveBeenCalledTimes(4);
    expect(transport.requests).toHaveLength(4);
    for (const redirect of redirects) {
      expect(redirect.close).toHaveBeenCalledOnce();
    }
  });

  it("rejects redirect loops at the same three-redirect bound", async () => {
    const transport = queueTransport(
      ...Array.from({ length: 4 }, () =>
        response({
          headers: { location: "/same" },
          statusCode: 307,
        }),
      ),
    );

    await expect(
      fetchWith("https://public.example/same", {
        resolver: () => Promise.resolve([PUBLIC_V4]),
        transport,
      }),
    ).resolves.toEqual({
      kind: "failed",
      reason: "too_many_redirects",
    });
    expect(transport.requests).toHaveLength(4);
  });

  it.each([
    ["gzip", "gzip"],
    ["Brotli", "br"],
    ["deflate", "deflate"],
    ["multiple encodings", "gzip, br"],
  ])(
    "rejects %s content encoding without reading the body",
    async (_, value) => {
      const bodyStarted = vi.fn();
      const encoded = response({
        body: bodyFrom(function* () {
          bodyStarted();
          yield encoder.encode("compressed");
        }),
        headers: {
          "content-encoding": value,
          "content-type": "text/plain",
        },
      });

      await expect(
        fetchWith("https://public.example/document", {
          resolver: () => Promise.resolve([PUBLIC_V4]),
          transport: queueTransport(encoded),
        }),
      ).resolves.toEqual({
        kind: "failed",
        reason: "unsupported_content_encoding",
      });
      expect(bodyStarted).not.toHaveBeenCalled();
      expect(encoded.close).toHaveBeenCalledOnce();
    },
  );

  it("allows an explicit identity content encoding", async () => {
    await expect(
      fetchWith("https://public.example/document.txt", {
        resolver: () => Promise.resolve([PUBLIC_V4]),
        transport: queueTransport(
          response({
            headers: {
              "content-encoding": " identity ",
              "content-type": "text/plain",
            },
          }),
        ),
      }),
    ).resolves.toMatchObject({ kind: "fetched" });
  });

  it.each([
    ["PDF", "report.pdf", "application/pdf"],
    ["Markdown", "notes.md", "text/markdown; charset=utf-8"],
    ["long Markdown extension", "notes.markdown", "text/markdown"],
    ["plain text", "notes.txt", "text/plain"],
    ["JSON", "decision.json", "application/json"],
  ])(
    "accepts supported %s extension/content-type matrix",
    async (_label, filename, contentType) => {
      await expect(
        fetchWith(`https://public.example/${filename}`, {
          resolver: () => Promise.resolve([PUBLIC_V6]),
          transport: queueTransport(
            response({ headers: { "content-type": contentType } }),
          ),
        }),
      ).resolves.toMatchObject({
        contentType: contentType.split(";")[0],
        filename,
        kind: "fetched",
      });
    },
  );

  it("derives and decodes a safe basename when extension and content type match", async () => {
    await expect(
      fetchWith(
        "https://public.example/evidence/%E8%AD%B0%E4%BA%8B%E9%8C%B2.md?download=1",
        {
          resolver: () => Promise.resolve([PUBLIC_V4]),
          transport: queueTransport(
            response({ headers: { "content-type": "text/markdown" } }),
          ),
        },
      ),
    ).resolves.toMatchObject({
      contentType: "text/markdown",
      filename: "議事録.md",
      kind: "fetched",
    });
  });

  it("derives the filename from the final redirect URL only", async () => {
    const transport = queueTransport(
      response({
        headers: { location: "/final%20evidence.json" },
        statusCode: 302,
      }),
      response({ headers: { "content-type": "application/json" } }),
    );

    await expect(
      fetchWith("https://public.example/original.txt", {
        resolver: () => Promise.resolve([PUBLIC_V4]),
        transport,
      }),
    ).resolves.toMatchObject({
      filename: "final evidence.json",
      kind: "fetched",
    });
    expect(transport.requests).toHaveLength(2);
  });

  it.each([
    ["/page.html", "text/plain", "artifact.txt"],
    ["/notes.txt", "text/markdown", "artifact.md"],
    ["/report.pdf", "text/plain", "artifact.txt"],
    ["/data.txt", "application/json", "artifact.json"],
    ["/", "application/pdf", "artifact.pdf"],
    ["/document.exe", "application/pdf", "artifact.pdf"],
    ["/REPORT.PDF", "application/pdf", "artifact.pdf"],
    ["/bad%2Fname.pdf", "application/pdf", "artifact.pdf"],
    ["/bad%5Cname.pdf", "application/pdf", "artifact.pdf"],
    ["/bad%00name.pdf", "application/pdf", "artifact.pdf"],
    ["/bad%ZZname.pdf", "application/pdf", "artifact.pdf"],
    [`/${"a".repeat(252)}.txt`, "text/plain", "artifact.txt"],
  ])(
    "falls back for unsafe or mismatched pathname %s with %s",
    async (pathname, contentType, filename) => {
      const result = await fetchWith(`https://public.example${pathname}`, {
        resolver: () => Promise.resolve([PUBLIC_V4]),
        transport: queueTransport(
          response({ headers: { "content-type": contentType } }),
        ),
      });

      expect(result).toMatchObject({ filename, kind: "fetched" });
      if (result.kind === "fetched") {
        expect(result.filename.length).toBeLessThanOrEqual(255);
        expect(result.filename).not.toMatch(/[/\\\0]/u);
      }
    },
  );

  it.each(["text/html", "application/octet-stream", "application/zip"])(
    "rejects unsupported content type %s",
    async (contentType) => {
      await expect(
        fetchWith("https://public.example/document", {
          resolver: () => Promise.resolve([PUBLIC_V4]),
          transport: queueTransport(
            response({ headers: { "content-type": contentType } }),
          ),
        }),
      ).resolves.toEqual({
        kind: "failed",
        reason: "unsupported_content_type",
      });
    },
  );

  it("rejects an oversized Content-Length before reading the body", async () => {
    const bodyStarted = vi.fn();
    const oversized = response({
      body: bodyFrom(function* () {
        bodyStarted();
        yield encoder.encode("must not be read");
      }),
      headers: {
        "content-length": String(20 * 1024 * 1024 + 1),
        "content-type": "text/plain",
      },
    });

    await expect(
      fetchWith("https://public.example/document", {
        resolver: () => Promise.resolve([PUBLIC_V4]),
        transport: queueTransport(oversized),
      }),
    ).resolves.toEqual({
      kind: "failed",
      reason: "response_too_large",
    });
    expect(bodyStarted).not.toHaveBeenCalled();
    expect(oversized.close).toHaveBeenCalledOnce();
  });

  it("enforces the streaming byte limit when Content-Length is absent", async () => {
    const oversized = response({
      body: bodyFrom(function* () {
        yield encoder.encode("1234");
        yield encoder.encode("56789");
      }),
    });

    await expect(
      fetchWith("https://public.example/document", {
        maxBytes: 8,
        resolver: () => Promise.resolve([PUBLIC_V4]),
        transport: queueTransport(oversized),
      }),
    ).resolves.toEqual({
      kind: "failed",
      reason: "response_too_large",
    });
    expect(oversized.close).toHaveBeenCalledOnce();
  });

  it("applies one ten-second overall deadline and aborts the active transport", async () => {
    vi.useFakeTimers();
    const transport: SafeUrlTransport = {
      request: ({ signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => {
              reject(new Error("synthetic upstream details"));
            },
            { once: true },
          );
        }),
    };

    try {
      const result = fetchWith("https://public.example/document", {
        resolver: () => Promise.resolve([PUBLIC_V4]),
        transport,
      });

      await vi.advanceTimersByTimeAsync(9_999);
      let settled = false;
      void result.then(() => {
        settled = true;
      });
      await Promise.resolve();
      expect(settled).toBe(false);

      await vi.advanceTimersByTimeAsync(1);
      await expect(result).resolves.toEqual({
        kind: "failed",
        reason: "timeout",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns only safe failure codes without raw URLs, credentials, or response bodies", async () => {
    const rawUrl = "https://private-user:private-password@public.example/path";
    const secretBody = "private response body";
    const result = await fetchWith(rawUrl, {
      resolver: () => Promise.resolve([PUBLIC_V4]),
      transport: queueTransport(
        response({
          body: bodyFrom(function* () {
            yield encoder.encode(secretBody);
            throw new Error(secretBody);
          }),
        }),
      ),
    });
    const serialized = JSON.stringify(result);

    expect(result).toEqual({
      kind: "failed",
      reason: "credentials_not_allowed",
    });
    expect(serialized).not.toContain(rawUrl);
    expect(serialized).not.toContain("private-user");
    expect(serialized).not.toContain("private-password");
    expect(serialized).not.toContain(secretBody);
  });
});
