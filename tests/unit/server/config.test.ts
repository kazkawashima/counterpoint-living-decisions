import { describe, expect, it } from "vitest";

import { readServerConfiguration } from "../../../apps/server/src/config.js";

describe("server OpenAI configuration", () => {
  it("keeps private assistance disabled when no server-side key exists", () => {
    expect(
      readServerConfiguration({
        OPENAI_API_KEY: "",
        PORT: "8787",
      }),
    ).toMatchObject({
      openAiApiKey: undefined,
      openAiConfigured: false,
      openAiMode: "disabled",
      openAiModel: "gpt-5.6",
    });
  });

  it("selects live mode without changing or exposing the configured key", () => {
    const configuration = readServerConfiguration({
      OPENAI_API_KEY: "synthetic-server-key",
      OPENAI_MODEL: "gpt-5.6",
      PORT: "8787",
    });

    expect(configuration.openAiMode).toBe("live");
    expect(configuration.openAiConfigured).toBe(true);
    expect(configuration.openAiApiKey).toBe("synthetic-server-key");
    expect(
      JSON.stringify({ ...configuration, openAiApiKey: undefined }),
    ).not.toContain("synthetic-server-key");
  });

  it("allows the deterministic adapter only in the test environment", () => {
    expect(
      readServerConfiguration({
        NODE_ENV: "test",
        OPENAI_FAKE_EXACT_SNIPPET: "Synthetic exact excerpt.",
        OPENAI_FAKE_MODE: "deterministic",
        PORT: "8787",
      }),
    ).toMatchObject({
      openAiConfigured: true,
      openAiFakeExactSnippet: "Synthetic exact excerpt.",
      openAiMode: "deterministic",
    });

    expect(() =>
      readServerConfiguration({
        NODE_ENV: "production",
        OPENAI_FAKE_MODE: "deterministic",
        PORT: "8787",
      }),
    ).toThrow(
      "OPENAI_FAKE_MODE=deterministic is allowed only when NODE_ENV=test",
    );
  });
});
