import { describe, expect, it, vi } from "vitest";

import {
  runCloudflareRemoteSmoke,
  validatedDeploymentOrigin,
} from "../../scripts/cloudflare-remote-smoke.mjs";

function response(
  body: unknown,
  status = 200,
  contentType = "application/json",
) {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    headers: { "content-type": contentType },
    status,
  });
}

function successfulFetch() {
  return vi.fn<typeof fetch>((input) => {
    const url =
      input instanceof Request
        ? input.url
        : input instanceof URL
          ? input.href
          : input;
    const pathname = new URL(url).pathname;
    if (pathname === "/health") {
      return Promise.resolve(response({ protocolVersion: 1, status: "ok" }));
    }
    if (pathname === "/ready") {
      return Promise.resolve(
        response({
          migrationsCurrent: true,
          protocolVersion: 1,
          status: "ready",
        }),
      );
    }
    if (pathname === "/api/v1/meetings") {
      return Promise.resolve(
        response({ code: "AUTHENTICATION_REQUIRED" }, 401),
      );
    }
    return Promise.resolve(response("<html></html>", 200, "text/html"));
  });
}

describe("Cloudflare remote deployment smoke", () => {
  it("checks health, readiness, SPA, and fail-closed authentication", async () => {
    const fetch = successfulFetch();
    await expect(
      runCloudflareRemoteSmoke({
        fetch,
        origin: "https://counterpoint-preview.example.workers.dev",
      }),
    ).resolves.toEqual({
      apiStatus: 401,
      healthStatus: 200,
      host: "counterpoint-preview.example.workers.dev",
      readinessStatus: 200,
      rootStatus: 200,
    });
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it.each([
    "http://worker.example.com",
    "https://user:password@worker.example.com",
    "https://worker.example.com/path",
    "https://worker.example.com/?query=1",
    "https://worker.example.com/#fragment",
  ])("rejects unsafe deployment URL %s", (url) => {
    expect(() => validatedDeploymentOrigin(url)).toThrow();
  });

  it("fails closed on parity-pending APIs and secret-shaped responses", async () => {
    const parityPending = successfulFetch();
    parityPending.mockImplementationOnce(() =>
      Promise.resolve(
        response({
          protocolVersion: 1,
          status: "ok",
        }),
      ),
    );
    parityPending.mockImplementationOnce(() =>
      Promise.resolve(
        response({
          migrationsCurrent: true,
          protocolVersion: 1,
          status: "ready",
        }),
      ),
    );
    parityPending.mockImplementationOnce(() =>
      Promise.resolve(response("<html></html>", 200, "text/html")),
    );
    parityPending.mockImplementationOnce(() =>
      Promise.resolve(response({ code: "ARTIFACT_STORAGE_UNAVAILABLE" }, 503)),
    );
    await expect(
      runCloudflareRemoteSmoke({
        fetch: parityPending,
        origin: "https://worker.example.com",
      }),
    ).rejects.toThrow("API parity");

    const secretShape = ["sk", "proj", "A".repeat(24)].join("-");
    const leaked = successfulFetch();
    leaked.mockImplementationOnce(() =>
      Promise.resolve(
        response({ protocolVersion: 1, secretShape, status: "ok" }),
      ),
    );
    await expect(
      runCloudflareRemoteSmoke({
        fetch: leaked,
        origin: "https://worker.example.com",
      }),
    ).rejects.toThrow("secret-shaped");
  });
});
