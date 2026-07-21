import { copyFile, mkdir } from "node:fs/promises";

import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { evidenceDirectory } from "../helpers/evidence-paths.js";
import { resetFlagshipFixture } from "../helpers/flagship-reset.js";
import { activateByKeyboard } from "../helpers/keyboard.js";

const screenshotDirectory = evidenceDirectory("screenshots/realtime-channels");
const clipDirectory = evidenceDirectory("clips/realtime-channels");
const voiceScreenshotDirectory = evidenceDirectory(
  "screenshots/voice-channels",
);
const voiceClipDirectory = evidenceDirectory("clips/voice-channels");
const degradedScreenshotDirectory = evidenceDirectory(
  "screenshots/degraded-mode",
);
const degradedClipDirectory = evidenceDirectory("clips/degraded-mode");
const judgeUsageScreenshotDirectory = evidenceDirectory(
  "screenshots/judge-usage",
);
const realtimeRecoveryScreenshotDirectory = evidenceDirectory(
  "screenshots/realtime-recovery",
);
const standardApiKey = "sk-synthetic-e2e-standard-key-never-exposed";

async function installSyntheticWebRtc(
  context: BrowserContext,
  microphoneFailureName?: string,
) {
  await context.addInitScript((failureName) => {
    const lifecycle = {
      peerCloses: 0,
      peersCreated: 0,
    };
    Object.defineProperty(window, "__counterpointSyntheticWebRtcLifecycle", {
      configurable: true,
      value: lifecycle,
      writable: false,
    });

    class SyntheticDataChannel extends EventTarget {
      readyState: RTCDataChannelState = "open";
      static transcriptSequence = 0;

      close(): void {
        this.readyState = "closed";
      }

      send(data: string): void {
        const event = JSON.parse(data) as { type?: string };
        if (event.type !== "input_audio_buffer.commit") {
          return;
        }
        SyntheticDataChannel.transcriptSequence += 1;
        const itemId = `item-synthetic-voice-${String(
          SyntheticDataChannel.transcriptSequence,
        )}`;
        queueMicrotask(() => {
          this.dispatchEvent(
            new MessageEvent("message", {
              data: JSON.stringify({
                item_id: itemId,
                transcript: "Synthetic voice floor statement.",
                type: "conversation.item.input_audio_transcription.completed",
              }),
            }),
          );
        });
      }
    }

    class SyntheticPeerConnection extends EventTarget {
      connectionState: RTCPeerConnectionState = "new";
      localDescription: RTCSessionDescription | null = null;
      remoteDescription: RTCSessionDescription | null = null;

      constructor() {
        super();
        lifecycle.peersCreated += 1;
      }

      close(): void {
        lifecycle.peerCloses += 1;
        this.connectionState = "closed";
        this.dispatchEvent(new Event("connectionstatechange"));
      }

      addTransceiver(): RTCRtpTransceiver {
        return {
          sender: {
            replaceTrack: () => Promise.resolve(),
          },
        } as unknown as RTCRtpTransceiver;
      }

      createDataChannel(): RTCDataChannel {
        return new SyntheticDataChannel() as unknown as RTCDataChannel;
      }

      createOffer(): Promise<RTCSessionDescriptionInit> {
        return Promise.resolve({
          sdp: "v=0\r\no=counterpoint 1 1 IN IP4 127.0.0.1\r\ns=A6 synthetic offer\r\nt=0 0\r\n",
          type: "offer",
        });
      }

      setLocalDescription(
        description: RTCLocalSessionDescriptionInit,
      ): Promise<void> {
        this.localDescription = description as RTCSessionDescription;
        return Promise.resolve();
      }

      setRemoteDescription(
        description: RTCSessionDescriptionInit,
      ): Promise<void> {
        this.remoteDescription = description as RTCSessionDescription;
        this.connectionState = "connected";
        this.dispatchEvent(new Event("connectionstatechange"));
        return Promise.resolve();
      }
    }

    Object.defineProperty(window, "RTCPeerConnection", {
      configurable: true,
      value: SyntheticPeerConnection,
      writable: true,
    });
    const syntheticTrack = () => ({
      enabled: false,
      stop() {
        // Synthetic microphone track.
      },
    });
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: () =>
          failureName === undefined
            ? Promise.resolve({
                getAudioTracks: () => [syntheticTrack()],
              })
            : Promise.reject(
                new DOMException("Synthetic private detail", failureName),
              ),
      },
    });
  }, microphoneFailureName);
}

async function signIn(page: Page, identity: string, password: string) {
  await page.getByRole("button", { name: new RegExp(identity, "iu") }).click();
  await page.getByLabel("Demo password").fill(password);
  await page.getByRole("button", { name: "Continue to meetings" }).click();
  await expect(
    page.getByRole("heading", { name: "Your assigned meetings" }),
  ).toBeVisible();
  const flagship = page.getByRole("article").filter({
    has: page.getByRole("heading", {
      name: "Global AI Product Rollout",
    }),
  });
  await flagship.getByRole("button", { name: "Open workspace" }).click();
  await expect(
    page.getByRole("heading", {
      name: "Live channels, explicit boundaries",
    }),
  ).toBeVisible();
}

test.beforeAll(async () => {
  await mkdir(screenshotDirectory, { recursive: true });
  await mkdir(clipDirectory, { recursive: true });
  await mkdir(voiceScreenshotDirectory, { recursive: true });
  await mkdir(voiceClipDirectory, { recursive: true });
  await mkdir(degradedScreenshotDirectory, { recursive: true });
  await mkdir(degradedClipDirectory, { recursive: true });
  await mkdir(judgeUsageScreenshotDirectory, { recursive: true });
  await mkdir(realtimeRecoveryScreenshotDirectory, { recursive: true });
});

test.afterEach(async ({ page }) => {
  const removeKey = page.getByRole("button", { name: "Remove key" });
  if (await removeKey.isVisible().catch(() => false)) {
    await removeKey.click();
    await expect(page.getByText("Facilitator BYOK · tab only")).toBeVisible();
  }
  await resetFlagshipFixture(page.request);
});

test("Cancel cleans a held connection attempt and stops reconnecting", async ({
  baseURL,
  browser,
}) => {
  const context = await browser.newContext({
    reducedMotion: "reduce",
    viewport: { height: 900, width: 1440 },
  });
  await installSyntheticWebRtc(context);

  const meetingId = "meeting-global-ai-rollout";
  let directProviderRequests = 0;
  let managedStartRequests = 0;
  let managedTerminateRequests = 0;
  let releaseHeldStart: (() => void) | undefined;
  const heldStart = new Promise<void>((resolve) => {
    releaseHeldStart = resolve;
  });
  let releaseHeldReconnect: (() => void) | undefined;
  const heldReconnect = new Promise<void>((resolve) => {
    releaseHeldReconnect = resolve;
  });

  await context.route(
    "https://api.openai.com/v1/realtime/calls",
    async (route) => {
      directProviderRequests += 1;
      await route.abort();
    },
  );
  await context.route("**/api/v1/meetings/*/realtime/access", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        correlationId: "correlation-cancel-access",
        mode: "judgeManaged",
        usageSummary: "hidden",
      }),
      contentType: "application/json",
      status: 200,
    });
  });
  await context.route(
    "**/api/v1/meetings/*/realtime/calls**",
    async (route) => {
      const url = new URL(route.request().url());
      const input = route.request().postDataJSON() as {
        channel?: "private" | "shared";
        managedCallId?: string;
        meetingId: string;
      };

      if (url.pathname.endsWith("/terminate")) {
        managedTerminateRequests += 1;
        expect(input.managedCallId).toMatch(
          /^managed-call-cancel-(?:proof|reconnect)$/u,
        );
        await route.fulfill({
          body: JSON.stringify({
            correlationId: "correlation-cancel-terminate",
            managedCallId: input.managedCallId,
            meetingId,
            terminated: true,
          }),
          contentType: "application/json",
          status: 200,
        });
        return;
      }

      managedStartRequests += 1;
      expect(input.channel).toBe("private");
      expect(input.meetingId).toBe(meetingId);
      if (managedStartRequests === 1) {
        await heldStart;
        await route.fulfill({
          body: JSON.stringify({
            channel: "private",
            correlationId: "correlation-cancel-held-start",
            managedCallId: "managed-call-cancel-proof",
            meetingId,
            model: "gpt-realtime-2.1",
            sdpAnswer:
              "v=0\r\no=counterpoint 4 4 IN IP4 127.0.0.1\r\ns=Cancel synthetic answer\r\nt=0 0\r\n",
          }),
          contentType: "application/json",
          status: 201,
        });
        return;
      }

      if (managedStartRequests === 3) {
        await heldReconnect;
        await route.fulfill({
          body: JSON.stringify({
            channel: "private",
            correlationId: "correlation-cancel-held-reconnect",
            managedCallId: "managed-call-cancel-reconnect",
            meetingId,
            model: "gpt-realtime-2.1",
            sdpAnswer:
              "v=0\r\no=counterpoint 5 5 IN IP4 127.0.0.1\r\ns=Cancel reconnect answer\r\nt=0 0\r\n",
          }),
          contentType: "application/json",
          status: 201,
        });
        return;
      }

      await route.fulfill({
        body: JSON.stringify({
          code: "REALTIME_UNAVAILABLE",
          correlationId: "correlation-cancel-reconnect",
          details: {},
          message: "Realtime is temporarily unavailable.",
          retryable: true,
        }),
        contentType: "application/json",
        status: 503,
      });
    },
  );

  const page = await context.newPage();
  try {
    await page.goto(baseURL ?? "/");
    await signIn(page, "Product", "counterpoint-product");
    const privateCard = page
      .getByRole("article")
      .filter({ hasText: "Private agent" });

    await privateCard.getByRole("button", { name: "Connect" }).click();
    await expect(
      privateCard.getByText("Connecting", { exact: true }),
    ).toBeVisible();
    await expect.poll(() => managedStartRequests).toBe(1);
    await privateCard.getByRole("button", { name: "Cancel" }).click();
    await expect(privateCard.getByText("Off", { exact: true })).toBeVisible();
    await expect(
      privateCard.getByRole("button", { name: "Connect" }),
    ).toBeVisible();

    releaseHeldStart?.();
    await expect.poll(() => managedTerminateRequests).toBe(1);
    await expect
      .poll(() =>
        page.evaluate(() => {
          const trackedWindow = window as unknown as {
            __counterpointSyntheticWebRtcLifecycle: {
              peerCloses: number;
              peersCreated: number;
            };
          };
          return trackedWindow.__counterpointSyntheticWebRtcLifecycle;
        }),
      )
      .toEqual({ peerCloses: 1, peersCreated: 1 });
    await expect(
      privateCard.getByText("Connected", { exact: true }),
    ).toHaveCount(0);
    await expect(privateCard.getByText("Off", { exact: true })).toBeVisible();

    await privateCard.getByRole("button", { name: "Connect" }).click();
    await expect(
      privateCard.getByText("Retry 1 / 3", { exact: true }),
    ).toBeVisible();
    await expect.poll(() => managedStartRequests).toBe(3);
    await privateCard.getByRole("button", { name: "Cancel" }).click();
    await expect(privateCard.getByText("Off", { exact: true })).toBeVisible();
    releaseHeldReconnect?.();
    await expect.poll(() => managedTerminateRequests).toBe(2);
    await expect
      .poll(() =>
        page.evaluate(() => {
          const trackedWindow = window as unknown as {
            __counterpointSyntheticWebRtcLifecycle: {
              peerCloses: number;
              peersCreated: number;
            };
          };
          return trackedWindow.__counterpointSyntheticWebRtcLifecycle;
        }),
      )
      .toEqual({ peerCloses: 3, peersCreated: 3 });
    await page.waitForTimeout(600);
    expect(managedStartRequests).toBe(3);
    expect(directProviderRequests).toBe(0);
    await expect(
      privateCard.getByText("Connected", { exact: true }),
    ).toHaveCount(0);
  } finally {
    releaseHeldStart?.();
    releaseHeldReconnect?.();
    await context.close();
  }
});

test("Shared to Private selector keeps owner-private text out of the room transcript", async ({
  baseURL,
  browser,
}) => {
  const productContext = await browser.newContext({
    reducedMotion: "reduce",
    viewport: { height: 900, width: 1440 },
  });
  const legalContext = await browser.newContext({
    reducedMotion: "reduce",
    viewport: { height: 900, width: 1280 },
  });
  let providerRequests = 0;
  for (const context of [productContext, legalContext]) {
    await context.route("https://api.openai.com/**", async (route) => {
      providerRequests += 1;
      await route.abort();
    });
  }

  const productPage = await productContext.newPage();
  const legalPage = await legalContext.newPage();
  try {
    await productPage.goto(baseURL ?? "/");
    await signIn(productPage, "Product", "counterpoint-product");
    await legalPage.goto(baseURL ?? "/");
    await signIn(legalPage, "Legal", "counterpoint-legal");

    const productSpeech = productPage.getByRole("region", {
      name: "Explicit speech controls",
    });
    const legalSpeech = legalPage.getByRole("region", {
      name: "Explicit speech controls",
    });
    const productPrivate = productSpeech.getByRole("button", {
      name: /Private · owner only/u,
    });
    const productShared = productSpeech.getByRole("button", {
      name: /Shared · room/u,
    });
    const legalShared = legalSpeech.getByRole("button", {
      name: /Shared · room/u,
    });

    await productShared.click();
    await legalShared.click();
    await expect(productShared).toHaveAttribute("aria-pressed", "true");
    await expect(productPrivate).toHaveAttribute("aria-pressed", "false");
    await expect(legalShared).toHaveAttribute("aria-pressed", "true");

    await productPrivate.click();
    await expect(productPrivate).toHaveAttribute("aria-pressed", "true");
    await expect(productShared).toHaveAttribute("aria-pressed", "false");

    const privateText =
      "Synthetic private selector proof that never enters the room transcript.";
    const legalProjectionAfterSend = legalPage.waitForResponse(
      (response) =>
        response
          .url()
          .endsWith("/api/v1/meetings/meeting-global-ai-rollout/projection") &&
        response.status() === 200,
    );
    await productSpeech.getByLabel("Equivalent text command").fill(privateText);
    await productSpeech.getByRole("button", { name: "Send privately" }).click();
    await expect(
      productSpeech.getByText(`Sent privately · ${privateText} · text-only`),
    ).toBeVisible();

    const productTranscript = productSpeech.getByRole("complementary", {
      name: "Recent utterances",
    });
    await expect(
      productTranscript.getByText("Your private transcript"),
    ).toBeVisible();
    await expect(
      productTranscript.getByText(privateText, { exact: true }),
    ).toBeVisible();

    await legalProjectionAfterSend;
    const legalTranscript = legalSpeech.getByRole("complementary", {
      name: "Recent utterances",
    });
    await expect(
      legalTranscript.getByText("Shared room transcript"),
    ).toBeVisible();
    await expect(
      legalTranscript.getByText(privateText, { exact: true }),
    ).toHaveCount(0);
    expect(providerRequests).toBe(0);
  } finally {
    await Promise.all([productContext.close(), legalContext.close()]);
  }
});

test("projection polling is single-flight and backs off after retryable failures", async ({
  baseURL,
  page,
}) => {
  await page.goto(baseURL ?? "/");
  await signIn(page, "Product", "counterpoint-product");
  const continuity = page.getByRole("complementary", {
    name: "Continuity status",
  });
  await expect(
    continuity.getByText("Meeting state stays online"),
  ).toBeVisible();
  await page.getByLabel("Facilitator BYOK · tab only").fill(standardApiKey);
  await page.getByRole("button", { name: "Set key" }).click();
  await expect(page.getByText("Facilitator lease active")).toBeVisible();
  await expect(continuity).toHaveClass(/\bready\b/u);

  let inFlight = 0;
  let maxInFlight = 0;
  const startedAt: number[] = [];
  const completedAt: number[] = [];
  await page.route(
    "**/api/v1/meetings/meeting-global-ai-rollout/projection",
    async (route) => {
      const requestIndex = startedAt.length;
      startedAt.push(Date.now());
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      if (requestIndex === 0) {
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 1_200);
        });
      }
      completedAt.push(Date.now());
      inFlight -= 1;
      if (requestIndex < 2) {
        await route.fulfill({
          body: JSON.stringify({
            code: "REALTIME_UNAVAILABLE",
            correlationId: `correlation-projection-retry-${String(requestIndex + 1)}`,
            details: {},
            message: "Projection temporarily unavailable.",
            retryable: true,
          }),
          contentType: "application/json",
          status: 503,
        });
        return;
      }
      await route.continue();
    },
  );

  await expect.poll(() => startedAt.length, { timeout: 12_000 }).toBe(2);
  await page.waitForTimeout(250);
  await expect(continuity.getByText("Offline", { exact: true })).toBeVisible();
  await expect(continuity).toHaveClass(/\bdegraded\b/u);

  const speech = page.getByRole("region", {
    name: "Explicit speech controls",
  });
  const privateText = "Keep retryable projection backoff after private text.";
  await speech.getByLabel("Equivalent text command").fill(privateText);
  await speech.getByRole("button", { name: "Send privately" }).click();
  await expect(
    speech.getByText(`Sent privately · ${privateText} · text-only`),
  ).toBeVisible();
  await speech.getByRole("button", { name: /Shared · room/u }).click();
  const sharedText = "Keep retryable projection backoff after shared text.";
  await speech.getByLabel("Equivalent text command").fill(sharedText);
  await speech.getByRole("button", { name: "Send to room" }).click();
  await expect(
    speech.getByText(`Sent to the room · ${sharedText} · text-only`),
  ).toBeVisible();
  await page.waitForTimeout(500);
  expect(startedAt).toHaveLength(2);

  await expect
    .poll(() => startedAt.length, { timeout: 20_000 })
    .toBeGreaterThanOrEqual(3);
  expect(maxInFlight).toBe(1);
  const firstRetryDelay = startedAt[1]! - completedAt[0]!;
  const secondRetryDelay = startedAt[2]! - completedAt[1]!;
  expect(firstRetryDelay).toBeGreaterThanOrEqual(1_500);
  expect(firstRetryDelay).toBeLessThan(6_000);
  expect(secondRetryDelay).toBeGreaterThanOrEqual(3_300);
  expect(secondRetryDelay).toBeLessThan(9_000);
  await expect(
    continuity.getByText("Meeting state stays online"),
  ).toBeVisible();
});

test("Cloudflare 1102 pauses projection polling until one manual retry recovers", async ({
  baseURL,
  page,
}) => {
  await page.goto(baseURL ?? "/");
  await signIn(page, "Product", "counterpoint-product");
  const continuity = page.getByRole("complementary", {
    name: "Continuity status",
  });
  await expect(
    continuity.getByText("Meeting state stays online"),
  ).toBeVisible();

  let projectionRequests = 0;
  let releaseResourceLimit: (() => void) | undefined;
  const resourceLimitGate = new Promise<void>((resolve) => {
    releaseResourceLimit = resolve;
  });
  let releaseRecovery: (() => void) | undefined;
  const recoveryGate = new Promise<void>((resolve) => {
    releaseRecovery = resolve;
  });
  await page.route(
    "**/api/v1/meetings/meeting-global-ai-rollout/projection",
    async (route) => {
      projectionRequests += 1;
      if (projectionRequests === 1) {
        await resourceLimitGate;
        await route.fulfill({
          body: JSON.stringify({
            detail:
              "A Worker script configured by the website owner exceeded its resource limits.",
            error_code: 1102,
            owner_action_required: true,
            retryable: false,
            status: 503,
            title: "Error 1102: Worker exceeded resource limits",
          }),
          contentType: "application/json",
          status: 503,
        });
        return;
      }
      await recoveryGate;
      await route.continue();
    },
  );

  try {
    await expect.poll(() => projectionRequests).toBe(1);
    const speech = page.getByRole("region", {
      name: "Explicit speech controls",
    });
    const privateText = "Queue this private refresh before the 1102 arrives.";
    await speech.getByLabel("Equivalent text command").fill(privateText);
    await speech.getByRole("button", { name: "Send privately" }).click();
    await expect(
      speech.getByText(`Sent privately · ${privateText} · text-only`),
    ).toBeVisible();

    releaseResourceLimit?.();
    await expect(
      continuity.getByText(
        "Server capacity was exceeded. Your meeting state is safe; retry when ready.",
      ),
    ).toBeVisible();
    const retry = continuity.getByRole("button", {
      name: "Retry meeting state",
    });
    await expect(retry).toHaveCount(1);

    await speech.getByRole("button", { name: /Shared · room/u }).click();
    const sharedText = "Do not refresh automatically while reads are paused.";
    await speech.getByLabel("Equivalent text command").fill(sharedText);
    await speech.getByRole("button", { name: "Send to room" }).click();
    await expect(
      speech.getByText(`Sent to the room · ${sharedText} · text-only`),
    ).toBeVisible();
    await page.waitForTimeout(1_250);
    expect(projectionRequests).toBe(1);

    await retry.click();
    await expect.poll(() => projectionRequests).toBe(2);
    await page.waitForTimeout(400);
    expect(projectionRequests).toBe(2);
    releaseRecovery?.();
    await expect(
      continuity.getByText("Meeting state stays online"),
    ).toBeVisible();
  } finally {
    releaseResourceLimit?.();
    releaseRecovery?.();
  }
});

test("facilitator secures BYOK and connects isolated private/shared WebRTC channels", async ({
  baseURL,
  browser,
}) => {
  const context = await browser.newContext({
    recordVideo: {
      dir: "test-results/reel-video",
      size: { height: 720, width: 1280 },
    },
    viewport: { height: 900, width: 1440 },
  });
  await installSyntheticWebRtc(context);
  let failSdp = false;
  let keyRemoved = false;
  const issuedSecrets: string[] = [];
  const sdpAuthorizations: string[] = [];
  let clientSecretHost = "";
  await context.route(
    "**/api/v1/meetings/*/realtime/client-secrets",
    async (route) => {
      if (keyRemoved) {
        await route.continue();
        return;
      }
      const request = route.request();
      clientSecretHost = new URL(request.url()).hostname;
      const input = request.postDataJSON() as {
        channel: "private" | "shared";
        meetingId: string;
      };
      const clientSecret = `ek_synthetic_${input.channel}_${String(issuedSecrets.length + 1)}`;
      issuedSecrets.push(clientSecret);
      await route.fulfill({
        body: JSON.stringify({
          channel: input.channel,
          clientSecret,
          correlationId: `correlation-${String(issuedSecrets.length)}`,
          expiresAt: "2026-07-19T04:30:00.000Z",
          keySource: "facilitatorProvided",
          meetingId: input.meetingId,
          model: "gpt-realtime-2.1",
        }),
        contentType: "application/json",
        status: 201,
      });
    },
  );
  await context.route(
    "https://api.openai.com/v1/realtime/calls",
    async (route) => {
      const request = route.request();
      sdpAuthorizations.push(request.headers().authorization ?? "");
      expect(request.headers()["content-type"]).toBe("application/sdp");
      expect(request.postData()).toContain("A6 synthetic offer");
      expect(request.postData()).not.toContain(standardApiKey);
      if (failSdp) {
        await route.fulfill({ body: "", status: 503 });
        return;
      }
      await route.fulfill({
        body: "v=0\r\no=openai 1 1 IN IP4 127.0.0.1\r\ns=A6 synthetic answer\r\nt=0 0\r\n",
        contentType: "application/sdp",
        status: 200,
      });
    },
  );

  const page = await context.newPage();
  await page.goto(baseURL ?? "/");
  await signIn(page, "Product", "counterpoint-product");
  const dock = page.getByRole("region", {
    name: "Live channels, explicit boundaries",
  });
  await expect(page.getByText("Facilitator BYOK · tab only")).toBeVisible();
  await dock.screenshot({
    animations: "disabled",
    path: `${screenshotDirectory}/2026-07-19-realtime-byok-required-desktop.png`,
  });

  await page.getByLabel("Facilitator BYOK · tab only").fill(standardApiKey);
  await page.getByRole("button", { name: "Set key" }).click();
  await expect(page.getByText("Facilitator lease active")).toBeVisible();
  await expect(page.getByText(standardApiKey)).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(
        (meetingId) => sessionStorage.getItem(`counterpoint.byok.${meetingId}`),
        "meeting-global-ai-rollout",
      ),
    )
    .toBe(standardApiKey);

  const privateCard = page
    .getByRole("article")
    .filter({ hasText: "Private agent" });
  const sharedCard = page
    .getByRole("article")
    .filter({ hasText: "Shared room agent" });
  await privateCard.getByRole("button", { name: "Connect" }).click();
  await sharedCard.getByRole("button", { name: "Connect" }).click();
  await expect(privateCard.getByText("Connected")).toBeVisible();
  await expect(sharedCard.getByText("Connected")).toBeVisible();
  await expect(privateCard.getByText("Mic off")).toBeVisible();
  await expect(sharedCard.getByText("Mic off")).toBeVisible();
  expect(clientSecretHost).not.toBe("localhost");
  expect(issuedSecrets).toHaveLength(2);
  expect(sdpAuthorizations).toEqual(
    issuedSecrets.map((secret) => `Bearer ${secret}`),
  );
  expect(JSON.stringify(sdpAuthorizations)).not.toContain(standardApiKey);
  await dock.screenshot({
    animations: "disabled",
    path: `${screenshotDirectory}/2026-07-19-realtime-both-connected-desktop.png`,
  });

  await privateCard.getByRole("button", { name: "Disconnect" }).click();
  failSdp = true;
  await privateCard.getByRole("button", { name: "Connect" }).click();
  await expect(privateCard.getByText("Text fallback")).toBeVisible({
    timeout: 8_000,
  });
  await expect(sharedCard.getByText("Connected")).toBeVisible();
  await expect(
    privateCard.getByText(
      "Realtime unavailable. Continue in text; the reason is shown below.",
    ),
  ).toBeVisible();
  const continuity = page.getByRole("complementary", {
    name: "Continuity status",
  });
  await expect(
    continuity.getByText("Meeting state stays online"),
  ).toBeVisible();
  await expect(continuity.getByText("Live", { exact: true })).toBeVisible();
  await expect(continuity.getByText("Manual text")).toBeVisible();
  await expect(continuity.getByText("Text fallback active")).toBeVisible();
  await dock.screenshot({
    animations: "disabled",
    path: `${screenshotDirectory}/2026-07-19-realtime-private-degraded-desktop.png`,
  });
  await continuity.screenshot({
    animations: "disabled",
    path: `${degradedScreenshotDirectory}/2026-07-19-realtime-text-fallback-desktop.png`,
  });

  const video = page.video();
  const clipPath = `${clipDirectory}/2026-07-19-byok-connect-to-degraded.webm`;
  const saveVideo = video?.saveAs(clipPath);
  keyRemoved = true;
  await page.getByRole("button", { name: "Remove key" }).click();
  await expect(page.getByText("Facilitator BYOK · tab only")).toBeVisible();
  await expect(continuity.getByText("API key required")).toBeVisible();

  await privateCard.getByRole("button", { name: "Connect" }).click();
  await expect(
    page
      .getByRole("alert")
      .getByText(
        "API key required. Meeting state is preserved; add BYOK or continue in text.",
      ),
  ).toBeVisible({ timeout: 8_000 });
  const speech = page.getByRole("region", {
    name: "Explicit speech controls",
  });
  const durableText = "Synthetic A8 text survives BYOK loss.";
  await speech.getByLabel("Equivalent text command").fill(durableText);
  await speech.getByRole("button", { name: "Send privately" }).click();
  await expect(
    speech.getByText(`Sent privately · ${durableText} · text-only`),
  ).toBeVisible();
  await expect(speech.getByText(durableText, { exact: true })).toBeVisible();
  await dock.screenshot({
    animations: "disabled",
    path: `${degradedScreenshotDirectory}/2026-07-19-api-key-loss-state-preserved-desktop.png`,
  });
  await context.close();
  await saveVideo;
  await copyFile(
    clipPath,
    `${degradedClipDirectory}/2026-07-19-realtime-failure-to-durable-text.webm`,
  );
});

test("server-funded judge access uses ephemeral direct WebRTC for private and shared channels", async ({
  baseURL,
  browser,
}) => {
  const context = await browser.newContext({
    reducedMotion: "reduce",
    viewport: { height: 900, width: 1440 },
  });
  await installSyntheticWebRtc(context);
  const meetingId = "meeting-global-ai-rollout";
  const secretBodies: {
    readonly apiKey?: string;
    readonly channel: "private" | "shared";
    readonly meetingId: string;
  }[] = [];
  let directProviderRequests = 0;
  let managedCallRequests = 0;

  await context.route("**/api/v1/meetings/*/realtime/access", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        correlationId: "correlation-ephemeral-access",
        mode: "judgeManaged",
        usageSummary: "hidden",
      }),
      contentType: "application/json",
      status: 200,
    });
  });
  await context.route(
    "**/api/v1/meetings/*/realtime/client-secrets",
    async (route) => {
      const body = route.request().postDataJSON() as {
        apiKey?: string;
        channel: "private" | "shared";
        meetingId: string;
      };
      secretBodies.push(body);
      await route.fulfill({
        body: JSON.stringify({
          channel: body.channel,
          clientSecret: `ek_synthetic_server_funded_${body.channel}`,
          correlationId: `correlation-server-funded-${body.channel}`,
          expiresAt: new Date(Date.now() + 30_000).toISOString(),
          keySource:
            body.apiKey === undefined ? "judgeManaged" : "judgeProvided",
          meetingId,
          model: "gpt-realtime-2.1",
        }),
        contentType: "application/json",
        status: 201,
      });
    },
  );
  await context.route(
    "https://api.openai.com/v1/realtime/calls",
    async (route) => {
      directProviderRequests += 1;
      await route.fulfill({
        body: "v=0\r\no=openai 4 4 IN IP4 127.0.0.1\r\ns=Server-funded ephemeral answer\r\nt=0 0\r\n",
        contentType: "application/sdp",
        status: 200,
      });
    },
  );
  await context.route(
    "**/api/v1/meetings/*/realtime/calls**",
    async (route) => {
      managedCallRequests += 1;
      await route.fulfill({
        body: "managed path must stay dormant",
        status: 500,
      });
    },
  );

  const page = await context.newPage();
  await page.goto(baseURL ?? "/");
  await signIn(page, "Product", "counterpoint-product");
  await expect(page.getByText("Judge-sponsored Realtime")).toBeVisible();
  await expect(
    page.getByText(
      "The Worker exchanges its server key for a short-lived browser credential. The standard key never enters this browser. Optional: use your own API key in this tab.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Judge usage limits" }),
  ).toHaveCount(0);

  const privateCard = page
    .getByRole("article")
    .filter({ hasText: "Private agent" });
  const sharedCard = page
    .getByRole("article")
    .filter({ hasText: "Shared room agent" });

  await privateCard.getByRole("button", { name: "Connect" }).click();
  await expect(privateCard.getByText("Connected")).toBeVisible();
  await page
    .getByRole("region", { name: "Live channels, explicit boundaries" })
    .screenshot({
      animations: "disabled",
      path: `${realtimeRecoveryScreenshotDirectory}/2026-07-22-judge-ephemeral-private-connected.png`,
    });
  await privateCard.getByRole("button", { name: "Disconnect" }).click();
  await expect(privateCard.getByText("Off", { exact: true })).toBeVisible();

  await sharedCard.getByRole("button", { name: "Connect" }).click();
  await expect(sharedCard.getByText("Connected")).toBeVisible();
  await sharedCard.getByRole("button", { name: "Disconnect" }).click();
  await expect(sharedCard.getByText("Off", { exact: true })).toBeVisible();

  expect(secretBodies.slice(0, 2)).toEqual([
    { channel: "private", meetingId },
    { channel: "shared", meetingId },
  ]);
  expect(directProviderRequests).toBe(2);
  expect(managedCallRequests).toBe(0);

  await page.getByLabel("Optional judge BYOK · tab only").fill(standardApiKey);
  await page.getByRole("button", { name: "Use my key" }).click();
  await expect(
    page.getByText("Your API key active · this tab only"),
  ).toBeVisible();
  await privateCard.getByRole("button", { name: "Connect" }).click();
  await expect(privateCard.getByText("Connected")).toBeVisible();
  expect(secretBodies[2]).toEqual({
    apiKey: standardApiKey,
    channel: "private",
    meetingId,
  });
  expect(directProviderRequests).toBe(3);
  expect(managedCallRequests).toBe(0);
  await context.close();
});

test("keeps judge Realtime connected and explains blocked microphone recovery", async ({
  baseURL,
  browser,
}) => {
  const context = await browser.newContext({
    reducedMotion: "reduce",
    viewport: { height: 900, width: 1440 },
  });
  await installSyntheticWebRtc(context, "NotAllowedError");
  const meetingId = "meeting-global-ai-rollout";

  await context.route("**/api/v1/meetings/*/realtime/access", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        correlationId: "correlation-microphone-access",
        mode: "judgeManaged",
        usageSummary: "hidden",
      }),
      contentType: "application/json",
      status: 200,
    });
  });
  await context.route(
    "**/api/v1/meetings/*/realtime/client-secrets",
    async (route) => {
      await route.fulfill({
        body: JSON.stringify({
          channel: "private",
          clientSecret: "ek_synthetic_permission_recovery",
          correlationId: "correlation-permission-recovery",
          expiresAt: new Date(Date.now() + 30_000).toISOString(),
          keySource: "judgeManaged",
          meetingId,
          model: "gpt-realtime-2.1",
        }),
        contentType: "application/json",
        status: 201,
      });
    },
  );
  await context.route(
    "https://api.openai.com/v1/realtime/calls",
    async (route) => {
      await route.fulfill({
        body: "v=0\r\no=openai 5 5 IN IP4 127.0.0.1\r\ns=Permission recovery synthetic answer\r\nt=0 0\r\n",
        contentType: "application/sdp",
        status: 200,
      });
    },
  );

  const page = await context.newPage();
  await page.goto(baseURL ?? "/");
  await signIn(page, "Product", "counterpoint-product");
  const privateCard = page
    .getByRole("article")
    .filter({ hasText: "Private agent" });
  await privateCard.getByRole("button", { name: "Connect" }).click();
  await expect(
    privateCard.getByText("Connected", { exact: true }),
  ).toBeVisible();

  const speechControls = page.getByRole("region", {
    name: "Explicit speech controls",
  });
  await speechControls
    .getByRole("button", { name: /Hold to speak privately/u })
    .press("Space");
  await expect(speechControls.getByRole("alert")).toContainText(
    "Microphone permission is blocked. Allow it in browser site settings, then hold to speak again.",
  );
  await expect(
    privateCard.getByText("Connected", { exact: true }),
  ).toBeVisible();
  await speechControls.screenshot({
    animations: "disabled",
    path: `${realtimeRecoveryScreenshotDirectory}/2026-07-22-microphone-permission-recovery.png`,
  });
  await context.close();
});

test.skip("legacy managed sideband UI path remains dormant for rollback", async ({
  baseURL,
  browser,
}) => {
  const context = await browser.newContext({
    reducedMotion: "reduce",
    viewport: { height: 900, width: 1440 },
  });
  await installSyntheticWebRtc(context);
  const managedCallId = "managed-call-browser-proof";
  const meetingId = "meeting-global-ai-rollout";
  let clientSecretRequests = 0;
  let directProviderRequests = 0;
  let managedHost = "";
  let managedIdempotencyKey = "";
  let managedStartRequests = 0;
  let managedTurnUtteranceId = "";
  let denyManagedStart = false;
  let managedFailureReason: "PROVIDER_REJECTED" | undefined;
  let usageExhausted = false;
  let usageHost = "";
  let usageRequests = 0;
  let usageUnavailable = false;

  await context.route("**/api/v1/meetings/*/realtime/access", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        correlationId: "correlation-managed-access",
        mode: "judgeManaged",
        usageSummary: "available",
      }),
      contentType: "application/json",
      status: 200,
    });
  });
  await context.route(
    "**/api/v1/meetings/*/realtime/client-secrets",
    async (route) => {
      clientSecretRequests += 1;
      const input = route.request().postDataJSON() as { apiKey?: string };
      expect(input.apiKey).toBe(standardApiKey);
      await route.fulfill({
        body: JSON.stringify({
          channel: "private",
          clientSecret: "ek_synthetic_judge_byok",
          correlationId: "correlation-judge-byok",
          expiresAt: "2026-07-19T05:00:00.000Z",
          keySource: "judgeProvided",
          meetingId,
          model: "gpt-realtime-2.1",
        }),
        contentType: "application/json",
        status: 201,
      });
    },
  );
  await context.route(
    "https://api.openai.com/v1/realtime/calls",
    async (route) => {
      directProviderRequests += 1;
      if (clientSecretRequests === 0) {
        await route.fulfill({ body: "", status: 500 });
        return;
      }
      await route.fulfill({
        body: "v=0\r\no=openai 2 2 IN IP4 127.0.0.1\r\ns=Judge BYOK synthetic answer\r\nt=0 0\r\n",
        contentType: "application/sdp",
        status: 200,
      });
    },
  );
  await context.route("**/api/v1/meetings/*/judge/usage", async (route) => {
    usageHost = new URL(route.request().url()).hostname;
    usageRequests += 1;
    if (usageUnavailable) {
      await route.fulfill({
        body: JSON.stringify({
          code: "REALTIME_UNAVAILABLE",
          correlationId: `correlation-judge-usage-${String(usageRequests)}`,
          message: "Realtime is unavailable.",
        }),
        contentType: "application/json",
        status: 503,
      });
      return;
    }
    await route.fulfill({
      body: JSON.stringify({
        correlationId: `correlation-judge-usage-${String(usageRequests)}`,
        dimensions: {
          account: {
            limit: Number.MAX_SAFE_INTEGER,
            remaining: Number.MAX_SAFE_INTEGER - 1,
            used: 1,
          },
          concurrency: {
            limit: Number.MAX_SAFE_INTEGER,
            remaining: Number.MAX_SAFE_INTEGER,
            used: 0,
          },
          costMicroUsd: usageExhausted
            ? { limit: 25_000_000, remaining: 0, used: 25_000_000 }
            : { limit: 25_000_000, remaining: 6_600_000, used: 18_400_000 },
          generation: {
            limit: Number.MAX_SAFE_INTEGER,
            remaining: Number.MAX_SAFE_INTEGER - 2,
            used: 2,
          },
          ip: {
            limit: Number.MAX_SAFE_INTEGER,
            remaining: Number.MAX_SAFE_INTEGER - 1,
            used: 1,
          },
          meeting: {
            limit: Number.MAX_SAFE_INTEGER,
            remaining: Number.MAX_SAFE_INTEGER - 1,
            used: 1,
          },
          realtimeSeconds: {
            limit: Number.MAX_SAFE_INTEGER,
            remaining: Number.MAX_SAFE_INTEGER - 24,
            used: 24,
          },
          tokens: {
            limit: Number.MAX_SAFE_INTEGER,
            remaining: Number.MAX_SAFE_INTEGER - 800_000,
            used: 800_000,
          },
        },
        rollingWindowSeconds: 86_400,
      }),
      contentType: "application/json",
      status: 200,
    });
  });
  await context.route(
    "**/api/v1/meetings/*/realtime/calls**",
    async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      managedHost = url.hostname;
      const input = request.postDataJSON() as {
        channel?: "private" | "shared";
        idempotencyKey?: string;
        managedCallId?: string;
        meetingId: string;
        sdpOffer?: string;
        utteranceId?: string;
      };
      expect(input.meetingId).toBe(meetingId);

      if (url.pathname.endsWith("/turn")) {
        expect(input.managedCallId).toBe(managedCallId);
        managedTurnUtteranceId = input.utteranceId ?? "";
        await route.fulfill({
          body: JSON.stringify({
            correlationId: "correlation-managed-turn",
            managedCallId,
            meetingId,
            utteranceId: managedTurnUtteranceId,
          }),
          contentType: "application/json",
          status: 200,
        });
        return;
      }
      if (url.pathname.endsWith("/transcript")) {
        expect(input.managedCallId).toBe(managedCallId);
        expect(input.utteranceId).toBe(managedTurnUtteranceId);
        await route.fulfill({
          body: JSON.stringify({
            correlationId: "correlation-managed-transcript",
            managedCallId,
            meetingId,
            transcript: "Synthetic managed judge statement.",
            utteranceId: managedTurnUtteranceId,
          }),
          contentType: "application/json",
          status: 200,
        });
        return;
      }
      if (url.pathname.endsWith("/terminate")) {
        expect(input.managedCallId).toBe(managedCallId);
        await route.fulfill({
          body: JSON.stringify({
            correlationId: "correlation-managed-terminate",
            managedCallId,
            meetingId,
            terminated: true,
          }),
          contentType: "application/json",
          status: 200,
        });
        return;
      }

      expect(input.channel).toBe("private");
      expect(input.sdpOffer).toContain("A6 synthetic offer");
      managedIdempotencyKey = input.idempotencyKey ?? "";
      managedStartRequests += 1;
      if (denyManagedStart) {
        await route.fulfill({
          body: JSON.stringify({
            code: "USAGE_LIMIT_REACHED",
            correlationId: "correlation-managed-cost-limit",
            details: { limit: "cost" },
            message: "The meeting usage limit has been reached.",
            retryable: false,
          }),
          contentType: "application/json",
          status: 429,
        });
        return;
      }
      if (managedFailureReason !== undefined) {
        await route.fulfill({
          body: JSON.stringify({
            code: "REALTIME_UNAVAILABLE",
            correlationId: "correlation-managed-provider-rejected",
            details: {
              providerStatus: 401,
              reason: managedFailureReason,
            },
            message: "Realtime updates are temporarily unavailable.",
            retryable: true,
          }),
          contentType: "application/json",
          status: 503,
        });
        return;
      }
      await route.fulfill({
        body: JSON.stringify({
          channel: "private",
          correlationId: "correlation-managed-start",
          managedCallId,
          meetingId,
          model: "gpt-realtime-2.1",
          sdpAnswer:
            "v=0\r\no=counterpoint 3 3 IN IP4 127.0.0.1\r\ns=Managed synthetic answer\r\nt=0 0\r\n",
        }),
        contentType: "application/json",
        status: 201,
      });
    },
  );

  const page = await context.newPage();
  await page.goto(baseURL ?? "/");
  await signIn(page, "Product", "counterpoint-product");
  const dock = page.getByRole("region", {
    name: "Live channels, explicit boundaries",
  });
  await expect(page.getByText("Judge-managed access")).toBeVisible();
  await expect(
    page.getByText(
      "Server-owned bounded call. No provider credential enters this browser. Optional: use your own API key for direct Realtime in this tab.",
    ),
  ).toBeVisible();
  await expect(page.getByLabel("Optional judge BYOK · tab only")).toBeVisible();
  const usagePanel = page.getByRole("region", {
    name: "Judge usage limits",
  });
  await expect(usagePanel.getByText("Budget available")).toBeVisible();
  await expect(usagePanel.getByText("$18.40 / $25.00")).toBeVisible();
  await expect(
    usagePanel.getByText(
      "Only the rolling 24h cost total locks new managed work at $25. Meeting state and manual text remain available after the lock.",
    ),
  ).toBeVisible();
  expect(usageHost).not.toBe("localhost");
  await expect(
    usagePanel.getByText(
      /accountId|ipHash|reservationId|meeting-global-ai-rollout/iu,
    ),
  ).toHaveCount(0);
  const requestsBeforeRefresh = usageRequests;
  await usagePanel.getByRole("button", { name: "Refresh" }).click();
  await expect.poll(() => usageRequests).toBeGreaterThan(requestsBeforeRefresh);
  await usagePanel.screenshot({
    animations: "disabled",
    path: `${judgeUsageScreenshotDirectory}/2026-07-20-judge-usage-available-desktop-reduced-motion.png`,
  });

  const privateCard = page
    .getByRole("article")
    .filter({ hasText: "Private agent" });
  await privateCard.getByRole("button", { name: "Connect" }).click();
  await expect(privateCard.getByText("Connected")).toBeVisible();
  expect(managedHost).not.toBe("localhost");
  expect(managedIdempotencyKey).toMatch(/^[0-9a-f-]{36}$/u);
  expect(clientSecretRequests).toBe(0);
  expect(directProviderRequests).toBe(0);

  await privateCard.getByRole("button", { name: "Disconnect" }).click();
  managedFailureReason = "PROVIDER_REJECTED";
  await privateCard.getByRole("button", { name: "Connect" }).click();
  await expect(privateCard.getByText("Text fallback")).toBeVisible({
    timeout: 8_000,
  });
  await expect(
    page
      .getByRole("alert")
      .getByText(
        "Realtime call creation failed. Realtime provider rejected the call. Check the configured key or provider account, then retry.",
      ),
  ).toBeVisible();
  await dock.screenshot({
    animations: "disabled",
    path: `${realtimeRecoveryScreenshotDirectory}/2026-07-22-judge-provider-rejected-recovery.png`,
  });
  expect(clientSecretRequests).toBe(0);
  expect(directProviderRequests).toBe(0);
  managedFailureReason = undefined;
  await privateCard.getByRole("button", { name: "Try again" }).click();
  await expect(privateCard.getByText("Connected")).toBeVisible();

  const speech = page.getByRole("region", {
    name: "Explicit speech controls",
  });
  const pushToTalk = speech.getByRole("button", {
    name: /Hold to speak privately/u,
  });
  const bounds = await pushToTalk.boundingBox();
  expect(bounds).not.toBeNull();
  await page.mouse.move(
    (bounds?.x ?? 0) + (bounds?.width ?? 0) / 2,
    (bounds?.y ?? 0) + (bounds?.height ?? 0) / 2,
  );
  await page.mouse.down();
  await expect(
    speech.getByRole("button", { name: /Listening privately/u }),
  ).toBeVisible();
  usageExhausted = true;
  await page.mouse.up();
  await expect(
    speech.getByText("Captured privately · Synthetic managed judge statement."),
  ).toBeVisible({ timeout: 6_000 });
  expect(managedTurnUtteranceId).toMatch(/^[0-9a-f-]{36}$/u);
  expect(clientSecretRequests).toBe(0);
  expect(directProviderRequests).toBe(0);
  await expect(usagePanel.getByText("Daily cost limit reached")).toBeVisible();
  await expect(usagePanel.getByText("$25.00 / $25.00")).toBeVisible();
  await expect.poll(() => usageRequests).toBeGreaterThanOrEqual(3);
  await usagePanel.screenshot({
    animations: "disabled",
    path: `${judgeUsageScreenshotDirectory}/2026-07-20-judge-usage-exhausted-desktop-reduced-motion.png`,
  });

  await dock.screenshot({
    animations: "disabled",
    path: `${screenshotDirectory}/2026-07-20-judge-managed-connected-desktop.png`,
  });
  await page.setViewportSize({ height: 844, width: 390 });
  await usagePanel.screenshot({
    animations: "disabled",
    path: `${judgeUsageScreenshotDirectory}/2026-07-20-judge-usage-exhausted-mobile-reduced-motion.png`,
  });
  await dock.screenshot({
    animations: "disabled",
    path: `${screenshotDirectory}/2026-07-20-judge-managed-connected-mobile.png`,
  });
  usageUnavailable = true;
  await usagePanel.getByRole("button", { name: "Refresh" }).click();
  await expect(usagePanel.getByText("Usage meter unavailable")).toBeVisible();
  await expect(
    usagePanel.getByText(
      "New paid work remains fail-closed; durable text stays available.",
    ),
  ).toBeVisible();
  await usagePanel.screenshot({
    animations: "disabled",
    path: `${judgeUsageScreenshotDirectory}/2026-07-20-judge-usage-unavailable-mobile-reduced-motion.png`,
  });
  await page.setViewportSize({ height: 900, width: 1440 });
  usageUnavailable = false;
  await usagePanel.getByRole("button", { name: "Retry usage check" }).click();
  await expect(usagePanel.getByText("Daily cost limit reached")).toBeVisible();
  await privateCard.getByRole("button", { name: "Disconnect" }).click();
  await expect(privateCard.getByText("Off", { exact: true })).toBeVisible();
  const startsBeforeDenial = managedStartRequests;
  denyManagedStart = true;
  await privateCard.getByRole("button", { name: "Connect" }).click();
  await expect(privateCard.getByText("Text fallback")).toBeVisible();
  await expect(
    page
      .getByRole("alert")
      .getByText(
        "Realtime call creation failed. Daily judge cost limit reached. Meeting state and text remain available.",
      ),
  ).toBeVisible();
  await expect(speech.getByLabel("Equivalent text command")).toBeEnabled();
  await expect(
    privateCard.getByRole("button", { name: "Try again" }),
  ).toHaveCount(1);
  await page.waitForTimeout(1_200);
  expect(managedStartRequests).toBe(startsBeforeDenial + 1);
  denyManagedStart = false;
  await privateCard.getByRole("button", { name: "Try again" }).click();
  await expect(privateCard.getByText("Connected")).toBeVisible();
  expect(managedStartRequests).toBe(startsBeforeDenial + 2);
  await privateCard.getByRole("button", { name: "Disconnect" }).click();
  await expect(privateCard.getByText("Off", { exact: true })).toBeVisible();
  await page.getByLabel("Optional judge BYOK · tab only").fill(standardApiKey);
  await activateByKeyboard(
    page,
    page.getByRole("button", { name: "Use my key" }),
  );
  await expect(
    page.getByText("Your API key active · this tab only"),
  ).toBeVisible();
  await privateCard.getByRole("button", { name: "Connect" }).click();
  await expect(privateCard.getByText("Connected")).toBeVisible();
  expect(clientSecretRequests).toBe(1);
  expect(directProviderRequests).toBe(1);
  await dock.screenshot({
    animations: "disabled",
    path: `${screenshotDirectory}/2026-07-21-judge-byok-optional-desktop.png`,
  });
  await dock.screenshot({
    animations: "disabled",
    path: `${judgeUsageScreenshotDirectory}/2026-07-21-judge-realtime-generation-limit-desktop.png`,
  });
  await page.getByRole("button", { name: "Reset staged demo" }).click();
  await page
    .locator(".reset-confirmation")
    .getByRole("button", { name: "Confirm meeting reset" })
    .click();
  await expect(
    page.getByText("Meeting reset complete · synthetic Context restored"),
  ).toBeVisible();
  await context.close();
});

test("private/shared text and push-to-talk use one immutable, floor-gated command path", async ({
  baseURL,
  browser,
}) => {
  const productContext = await browser.newContext({
    recordVideo: {
      dir: "test-results/reel-video",
      size: { height: 800, width: 1440 },
    },
    viewport: { height: 1050, width: 1440 },
  });
  const legalContext = await browser.newContext({
    viewport: { height: 950, width: 1280 },
  });
  await Promise.all([
    installSyntheticWebRtc(productContext),
    installSyntheticWebRtc(legalContext),
  ]);

  for (const context of [productContext, legalContext]) {
    let issued = 0;
    await context.route(
      "**/api/v1/meetings/*/realtime/client-secrets",
      async (route) => {
        const input = route.request().postDataJSON() as {
          channel: "private" | "shared";
          meetingId: string;
        };
        issued += 1;
        await route.fulfill({
          body: JSON.stringify({
            channel: input.channel,
            clientSecret: `ek_synthetic_a7_${input.channel}_${String(issued)}`,
            correlationId: `correlation-a7-${String(issued)}`,
            expiresAt: "2026-07-19T05:00:00.000Z",
            keySource: "facilitatorProvided",
            meetingId: input.meetingId,
            model: "gpt-realtime-2.1",
          }),
          contentType: "application/json",
          status: 201,
        });
      },
    );
    await context.route(
      "https://api.openai.com/v1/realtime/calls",
      async (route) => {
        await route.fulfill({
          body: "v=0\r\no=openai 2 2 IN IP4 127.0.0.1\r\ns=A7 synthetic answer\r\nt=0 0\r\n",
          contentType: "application/sdp",
          status: 200,
        });
      },
    );
  }

  const productPage = await productContext.newPage();
  const legalPage = await legalContext.newPage();
  await productPage.goto(baseURL ?? "/");
  await signIn(productPage, "Product", "counterpoint-product");
  await productPage
    .getByLabel("Facilitator BYOK · tab only")
    .fill(standardApiKey);
  await activateByKeyboard(
    productPage,
    productPage.getByRole("button", { name: "Set key" }),
  );
  await expect(productPage.getByText("Facilitator lease active")).toBeVisible();

  await legalPage.goto(baseURL ?? "/");
  await signIn(legalPage, "Legal", "counterpoint-legal");
  const productSpeech = productPage.getByRole("region", {
    name: "Explicit speech controls",
  });
  const legalSpeech = legalPage.getByRole("region", {
    name: "Explicit speech controls",
  });
  const privateText = "Synthetic private product concern for A7.";
  await productSpeech.getByLabel("Equivalent text command").fill(privateText);
  await productSpeech.getByRole("button", { name: /Send privately/u }).click();
  await expect(
    productSpeech.getByText(`Sent privately · ${privateText} · text-only`),
  ).toBeVisible();
  await productSpeech.screenshot({
    animations: "disabled",
    path: `${voiceScreenshotDirectory}/2026-07-19-private-text-desktop.png`,
  });

  await activateByKeyboard(
    productPage,
    productSpeech.getByRole("button", { name: /Shared · room/u }),
  );
  await legalSpeech.getByRole("button", { name: /Shared · room/u }).click();
  await expect(legalSpeech.getByText(privateText)).toHaveCount(0);

  const productSharedCard = productPage
    .getByRole("article")
    .filter({ hasText: "Shared room agent" });
  const legalSharedCard = legalPage
    .getByRole("article")
    .filter({ hasText: "Shared room agent" });
  await activateByKeyboard(
    productPage,
    productSharedCard.getByRole("button", { name: "Connect" }),
  );
  await legalSharedCard.getByRole("button", { name: "Connect" }).click();
  await expect(productSharedCard.getByText("Connected")).toBeVisible();
  await expect(legalSharedCard.getByText("Connected")).toBeVisible();

  const sharedText = "Synthetic shared launch statement for A7.";
  await productSpeech.getByLabel("Equivalent text command").fill(sharedText);
  await activateByKeyboard(
    productPage,
    productSpeech.getByRole("button", { name: /Send to room/u }),
  );
  await expect(
    productSpeech.getByText(`Sent to the room · ${sharedText}`),
  ).toBeVisible();
  await expect(legalSpeech.getByText(sharedText)).toBeVisible({
    timeout: 4_000,
  });

  const productPushToTalk = productSpeech.getByRole("button", {
    name: /Hold to speak to room/u,
  });
  const bounds = await productPushToTalk.boundingBox();
  expect(bounds).not.toBeNull();
  await productPage.mouse.move(
    (bounds?.x ?? 0) + (bounds?.width ?? 0) / 2,
    (bounds?.y ?? 0) + (bounds?.height ?? 0) / 2,
  );
  await productPage.mouse.down();
  await expect(
    productSpeech.getByText("You hold the room floor", { exact: true }),
  ).toBeVisible();
  await expect(
    productSpeech.getByRole("button", { name: /Private · owner only/u }),
  ).toBeDisabled();
  await expect(legalSpeech.getByText("Room floor busy")).toBeVisible({
    timeout: 4_000,
  });
  await expect(
    legalSpeech.getByRole("button", { name: /Hold to speak to room/u }),
  ).toBeDisabled();
  await legalSpeech.screenshot({
    animations: "disabled",
    path: `${voiceScreenshotDirectory}/2026-07-19-shared-floor-busy-desktop.png`,
  });
  await productSpeech.screenshot({
    animations: "allow",
    path: `${voiceScreenshotDirectory}/2026-07-19-shared-floor-live-desktop.png`,
  });

  await productPage.mouse.up();
  await expect(
    productSpeech.getByText(
      "Captured for the room · Synthetic voice floor statement.",
    ),
  ).toBeVisible({ timeout: 5_000 });
  await expect(
    legalSpeech.getByText("Synthetic voice floor statement."),
  ).toBeVisible({ timeout: 4_000 });

  await productPushToTalk.focus();
  await expect(productPushToTalk).toBeFocused();
  await productPage.keyboard.down("Enter");
  await expect(
    productSpeech.getByText("You hold the room floor", { exact: true }),
  ).toBeVisible();
  await expect(legalSpeech.getByText("Room floor busy")).toBeVisible({
    timeout: 4_000,
  });
  await productPage.keyboard.up("Enter");
  await expect(
    productSpeech.getByRole("button", { name: /Private · owner only/u }),
  ).toBeEnabled({ timeout: 5_000 });
  await expect(
    legalSpeech.getByRole("button", { name: /Hold to speak to room/u }),
  ).toBeEnabled({ timeout: 5_000 });

  const video = productPage.video();
  const saveVideo = video?.saveAs(
    `${voiceClipDirectory}/2026-07-19-private-text-shared-floor-voice.webm`,
  );
  await activateByKeyboard(
    productPage,
    productSharedCard.getByRole("button", { name: "Disconnect" }),
  );
  await expect(
    productSharedCard.getByRole("button", { name: "Connect" }),
  ).toBeVisible();
  await productPage.getByRole("button", { name: "Remove key" }).click();
  await expect(
    productPage.getByText("Facilitator BYOK · tab only"),
  ).toBeVisible();
  await Promise.all([productContext.close(), legalContext.close()]);
  await saveVideo;
});

test("participant mobile view receives no standard-key control", async ({
  baseURL,
  browser,
}) => {
  const context = await browser.newContext({
    reducedMotion: "reduce",
    viewport: { height: 844, width: 390 },
  });
  await installSyntheticWebRtc(context);
  let judgeUsageRequests = 0;
  await context.route("**/api/v1/meetings/*/judge/usage", async (route) => {
    judgeUsageRequests += 1;
    await route.fulfill({ body: "", status: 403 });
  });
  const page = await context.newPage();
  await page.goto(baseURL ?? "/");
  await signIn(page, "Legal", "counterpoint-legal");

  await expect(page.getByText("Realtime access unavailable")).toBeVisible();
  await expect(page.getByLabel("Facilitator BYOK · tab only")).toHaveCount(0);
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "Judge usage limits" }),
  ).toHaveCount(0);
  expect(judgeUsageRequests).toBe(0);
  await page
    .getByRole("region", {
      name: "Live channels, explicit boundaries",
    })
    .screenshot({
      animations: "disabled",
      path: `${screenshotDirectory}/2026-07-19-realtime-participant-mobile-reduced-motion.png`,
    });
  await context.close();
});
