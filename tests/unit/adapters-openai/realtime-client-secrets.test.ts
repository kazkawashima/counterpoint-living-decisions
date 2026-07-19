import {
  DEFAULT_OPENAI_REALTIME_MODEL,
  OPENAI_REALTIME_CLIENT_SECRETS_URL,
  OpenAiRealtimeClientSecretError,
  OpenAiRealtimeClientSecretIssuer,
} from "@counterpoint/adapters-openai";
import { describe, expect, it, vi } from "vitest";

const request = {
  apiKey: "sk-standard-secret-must-stay-server-side",
  channel: "private" as const,
  meetingId: "meeting-private-metadata",
  ownerParticipantId: "participant-private-metadata",
  safetyIdentifier: "sha256:stable-pseudonymous-user",
  sessionId: "session-private-metadata",
};

describe("OpenAiRealtimeClientSecretIssuer", () => {
  it("mints a short-lived channel secret without sending meeting metadata", async () => {
    const fetch = vi.fn<
      (input: string | URL | Request, init?: RequestInit) => Promise<Response>
    >(async () =>
      Promise.resolve(
        Response.json({
          expires_at: 1_784_432_860,
          value: "ek_ephemeral_client_secret",
        }),
      ),
    );
    const issuer = new OpenAiRealtimeClientSecretIssuer({ fetch });

    const secret = await issuer.issue(request);

    expect(secret).toEqual({
      channel: "private",
      expiresAt: "2026-07-19T03:47:40.000Z",
      model: DEFAULT_OPENAI_REALTIME_MODEL,
      value: "ek_ephemeral_client_secret",
    });
    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe(OPENAI_REALTIME_CLIENT_SECRETS_URL);
    expect(init).toMatchObject({
      headers: {
        authorization: `Bearer ${request.apiKey}`,
        "content-type": "application/json",
        "OpenAI-Safety-Identifier": request.safetyIdentifier,
      },
      method: "POST",
    });
    if (typeof init?.body !== "string") {
      throw new TypeError("Expected a JSON string request body");
    }
    const body = init.body;
    const parsed = JSON.parse(body) as {
      session: {
        instructions: string;
        model: string;
        type: string;
      };
    };
    expect(parsed.session).toEqual({
      instructions: parsed.session.instructions,
      model: DEFAULT_OPENAI_REALTIME_MODEL,
      type: "realtime",
    });
    expect(parsed.session.instructions).toContain("owner-private");
    expect(body).not.toContain(request.meetingId);
    expect(body).not.toContain(request.ownerParticipantId);
    expect(body).not.toContain(request.sessionId);
    expect(JSON.stringify(secret)).not.toContain(request.apiKey);
  });

  it("uses shared-only isolation instructions for a shared channel", async () => {
    const fetch = vi.fn<
      (input: string | URL | Request, init?: RequestInit) => Promise<Response>
    >(async () =>
      Promise.resolve(
        Response.json({
          expires_at: 1_784_432_860,
          value: "ek_shared",
        }),
      ),
    );
    const issuer = new OpenAiRealtimeClientSecretIssuer({
      fetch,
      model: "gpt-realtime-test",
    });

    const secret = await issuer.issue({
      apiKey: request.apiKey,
      channel: "shared",
      meetingId: request.meetingId,
      safetyIdentifier: request.safetyIdentifier,
      sessionId: request.sessionId,
    });

    const init = fetch.mock.calls[0]?.[1];
    if (typeof init?.body !== "string") {
      throw new TypeError("Expected a JSON string request body");
    }
    const body = init.body;
    expect(body).toContain("Use only content explicitly supplied");
    expect(body).toContain("participant-private context");
    expect(secret.model).toBe("gpt-realtime-test");
  });

  it.each([
    {
      label: "provider rejection",
      response: new Response("", { status: 429 }),
    },
    {
      label: "invalid response",
      response: Response.json({ expires_at: "later", value: "" }),
    },
  ])("fails closed on $label", async ({ response }) => {
    const issuer = new OpenAiRealtimeClientSecretIssuer({
      fetch: vi.fn(() => Promise.resolve(response)),
    });

    await expect(issuer.issue(request)).rejects.toBeInstanceOf(
      OpenAiRealtimeClientSecretError,
    );
  });

  it("normalizes transport failures without leaking the standard key", async () => {
    const issuer = new OpenAiRealtimeClientSecretIssuer({
      fetch: vi.fn(() =>
        Promise.reject(new Error(`transport failed for ${request.apiKey}`)),
      ),
    });

    const failure = await issuer
      .issue(request)
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(OpenAiRealtimeClientSecretError);
    expect(String(failure)).not.toContain(request.apiKey);
  });
});
