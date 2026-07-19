import { copyFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

import { expect, test, type BrowserContext, type Page } from "@playwright/test";

const screenshotDirectory = resolve("docs/media/screenshots/realtime-channels");
const clipDirectory = resolve("docs/media/clips/realtime-channels");
const voiceScreenshotDirectory = resolve(
  "docs/media/screenshots/voice-channels",
);
const voiceClipDirectory = resolve("docs/media/clips/voice-channels");
const degradedScreenshotDirectory = resolve(
  "docs/media/screenshots/degraded-mode",
);
const degradedClipDirectory = resolve("docs/media/clips/degraded-mode");
const standardApiKey = "sk-synthetic-e2e-standard-key-never-exposed";

async function installSyntheticWebRtc(context: BrowserContext) {
  await context.addInitScript(() => {
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

      close(): void {
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
          Promise.resolve({
            getAudioTracks: () => [syntheticTrack()],
          }),
      },
    });
  });
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
      "Realtime unavailable after capped reconnect. Continue in text.",
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

test("server-owned access switches the browser to a credential-free managed call", async ({
  baseURL,
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { height: 900, width: 1440 },
  });
  await installSyntheticWebRtc(context);
  const managedCallId = "managed-call-browser-proof";
  const meetingId = "meeting-global-ai-rollout";
  let clientSecretRequests = 0;
  let directProviderRequests = 0;
  let managedHost = "";
  let managedIdempotencyKey = "";
  let managedTurnUtteranceId = "";

  await context.route("**/api/v1/meetings/*/realtime/access", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        correlationId: "correlation-managed-access",
        mode: "judgeManaged",
      }),
      contentType: "application/json",
      status: 200,
    });
  });
  await context.route(
    "**/api/v1/meetings/*/realtime/client-secrets",
    async (route) => {
      clientSecretRequests += 1;
      await route.fulfill({ body: "", status: 500 });
    },
  );
  await context.route(
    "https://api.openai.com/v1/realtime/calls",
    async (route) => {
      directProviderRequests += 1;
      await route.fulfill({ body: "", status: 500 });
    },
  );
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
      "Server-owned bounded call. No provider credential enters this browser.",
    ),
  ).toBeVisible();
  await expect(page.locator('input[type="password"]')).toHaveCount(0);

  const privateCard = page
    .getByRole("article")
    .filter({ hasText: "Private agent" });
  await privateCard.getByRole("button", { name: "Connect" }).click();
  await expect(privateCard.getByText("Connected")).toBeVisible();
  expect(managedHost).not.toBe("localhost");
  expect(managedIdempotencyKey).toMatch(/^[0-9a-f-]{36}$/u);
  expect(clientSecretRequests).toBe(0);
  expect(directProviderRequests).toBe(0);

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
  await page.mouse.up();
  await expect(
    speech.getByText("Captured privately · Synthetic managed judge statement."),
  ).toBeVisible({ timeout: 6_000 });
  expect(managedTurnUtteranceId).toMatch(/^[0-9a-f-]{36}$/u);
  expect(clientSecretRequests).toBe(0);
  expect(directProviderRequests).toBe(0);

  await dock.screenshot({
    animations: "disabled",
    path: `${screenshotDirectory}/2026-07-20-judge-managed-connected-desktop.png`,
  });
  await page.setViewportSize({ height: 844, width: 390 });
  await dock.screenshot({
    animations: "disabled",
    path: `${screenshotDirectory}/2026-07-20-judge-managed-connected-mobile.png`,
  });
  await privateCard.getByRole("button", { name: "Disconnect" }).click();
  await expect(privateCard.getByText("Off", { exact: true })).toBeVisible();
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
  await productPage.getByRole("button", { name: "Set key" }).click();
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

  await productSpeech.getByRole("button", { name: /Shared · room/u }).click();
  await legalSpeech.getByRole("button", { name: /Shared · room/u }).click();
  await expect(legalSpeech.getByText(privateText)).toHaveCount(0);

  const productSharedCard = productPage
    .getByRole("article")
    .filter({ hasText: "Shared room agent" });
  const legalSharedCard = legalPage
    .getByRole("article")
    .filter({ hasText: "Shared room agent" });
  await productSharedCard.getByRole("button", { name: "Connect" }).click();
  await legalSharedCard.getByRole("button", { name: "Connect" }).click();
  await expect(productSharedCard.getByText("Connected")).toBeVisible();
  await expect(legalSharedCard.getByText("Connected")).toBeVisible();

  const sharedText = "Synthetic shared launch statement for A7.";
  await productSpeech.getByLabel("Equivalent text command").fill(sharedText);
  await productSpeech.getByRole("button", { name: /Send to room/u }).click();
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

  const video = productPage.video();
  const saveVideo = video?.saveAs(
    `${voiceClipDirectory}/2026-07-19-private-text-shared-floor-voice.webm`,
  );
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
  const page = await context.newPage();
  await page.goto(baseURL ?? "/");
  await signIn(page, "Legal", "counterpoint-legal");

  await expect(page.getByText("Realtime access unavailable")).toBeVisible();
  await expect(page.getByLabel("Facilitator BYOK · tab only")).toHaveCount(0);
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
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
