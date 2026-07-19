import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

import { expect, test, type BrowserContext, type Page } from "@playwright/test";

const screenshotDirectory = resolve("docs/media/screenshots/realtime-channels");
const clipDirectory = resolve("docs/media/clips/realtime-channels");
const standardApiKey = "sk-synthetic-e2e-standard-key-never-exposed";

async function installSyntheticWebRtc(context: BrowserContext) {
  await context.addInitScript(() => {
    class SyntheticPeerConnection extends EventTarget {
      connectionState: RTCPeerConnectionState = "new";
      localDescription: RTCSessionDescription | null = null;
      remoteDescription: RTCSessionDescription | null = null;

      close(): void {
        this.connectionState = "closed";
        this.dispatchEvent(new Event("connectionstatechange"));
      }

      createDataChannel(): RTCDataChannel {
        return {
          close() {
            // Synthetic A6 data channel; no audio or application events.
          },
        } as RTCDataChannel;
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
  const issuedSecrets: string[] = [];
  const sdpAuthorizations: string[] = [];
  let clientSecretHost = "";
  await context.route(
    "**/api/v1/meetings/*/realtime/client-secrets",
    async (route) => {
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
  await dock.screenshot({
    animations: "disabled",
    path: `${screenshotDirectory}/2026-07-19-realtime-private-degraded-desktop.png`,
  });

  const video = page.video();
  const saveVideo = video?.saveAs(
    `${clipDirectory}/2026-07-19-byok-connect-to-degraded.webm`,
  );
  await context.close();
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

  await expect(page.getByText("Facilitator-managed lease")).toBeVisible();
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
