import { mkdir } from "node:fs/promises";

import {
  expect,
  test,
  type BrowserContext,
  type Locator,
  type Page,
} from "@playwright/test";
import {
  FacilitatorDemoResetResponseSchema,
  GetRoleProjectionResponseSchema,
  LoginResponseSchema,
} from "@counterpoint/protocol";
import { evidenceDirectory } from "../helpers/evidence-paths.js";

const FLAGSHIP_MEETING_ID = "meeting-global-ai-rollout";
const FLAGSHIP_PURPOSE = "Global AI Product Rollout";
const SCREENSHOT_DATE = "2026-07-22";
const screenshotDirectory = evidenceDirectory(
  "screenshots/flagship-reliability",
);
const syntheticApiKey = "sk-synthetic-flagship-evidence-never-exposed";

async function resetFlagship(page: Page): Promise<void> {
  const loginResponse = await page.request.post("/api/v1/login", {
    data: {
      password: "counterpoint-product",
      userId: "product",
    },
  });
  expect(loginResponse.status()).toBe(200);
  const facilitator = LoginResponseSchema.parse(await loginResponse.json());
  const headers = {
    authorization: `Bearer ${facilitator.bearerToken}`,
  };
  const projectionResponse = await page.request.get(
    `/api/v1/meetings/${FLAGSHIP_MEETING_ID}/projection`,
    { headers },
  );
  expect(projectionResponse.status()).toBe(200);
  const projection = GetRoleProjectionResponseSchema.parse(
    await projectionResponse.json(),
  );
  const resetResponse = await page.request.post(
    `/api/v1/meetings/${FLAGSHIP_MEETING_ID}/demo/reset`,
    {
      data: {
        expectedPosition: projection.shared.position,
        idempotencyKey: `flagship-evidence-reset-${crypto.randomUUID()}`,
        meetingId: FLAGSHIP_MEETING_ID,
      },
      headers,
    },
  );
  expect(resetResponse.status()).toBe(200);
  FacilitatorDemoResetResponseSchema.parse(await resetResponse.json());
}

async function signInAndOpenFlagship(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: "Product" }).click();
  await page.getByLabel("Demo password").fill("counterpoint-product");
  await page.getByRole("button", { name: "Continue to meetings" }).click();
  await expect(
    page.getByRole("heading", { name: "Your assigned meetings" }),
  ).toBeVisible();

  const flagship = page.getByRole("article").filter({
    has: page.getByRole("heading", {
      exact: true,
      name: FLAGSHIP_PURPOSE,
    }),
  });
  await expect(flagship).toHaveCount(1);
  await flagship.getByRole("button", { name: "Open workspace" }).click();
  await expect(
    page.getByRole("heading", {
      name: "Live channels, explicit boundaries",
    }),
  ).toBeVisible();
}

async function installSyntheticWebRtc(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    class SyntheticDataChannel extends EventTarget {
      readyState: RTCDataChannelState = "open";

      close(): void {
        this.readyState = "closed";
      }

      send(): void {
        // Evidence capture does not send audio or private content.
      }
    }

    class SyntheticPeerConnection extends EventTarget {
      connectionState: RTCPeerConnectionState = "new";
      localDescription: RTCSessionDescription | null = null;
      remoteDescription: RTCSessionDescription | null = null;

      addTransceiver(): RTCRtpTransceiver {
        return {
          sender: {
            replaceTrack: () => Promise.resolve(),
          },
        } as unknown as RTCRtpTransceiver;
      }

      close(): void {
        this.connectionState = "closed";
        this.dispatchEvent(new Event("connectionstatechange"));
      }

      createDataChannel(): RTCDataChannel {
        return new SyntheticDataChannel() as unknown as RTCDataChannel;
      }

      createOffer(): Promise<RTCSessionDescriptionInit> {
        return Promise.resolve({
          sdp: "v=0\r\no=counterpoint 1 1 IN IP4 127.0.0.1\r\ns=Flagship evidence synthetic offer\r\nt=0 0\r\n",
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
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: () =>
          Promise.resolve({
            getAudioTracks: () => [
              {
                enabled: false,
                stop() {
                  // Synthetic microphone track.
                },
              },
            ],
          }),
      },
    });
  });
}

async function prepareCandidate(page: Page): Promise<Locator> {
  const privateWorkspace = page.locator(".private-zone");
  await privateWorkspace
    .getByRole("button", { name: "Prepare grounded sharing preview" })
    .click();
  const preview = privateWorkspace.getByRole("region", {
    name: "Review the exact payload",
  });
  await expect(preview).toContainText(
    "Regional launch requires a documented approval gate.",
  );
  await preview.getByRole("button", { name: "Approve exact excerpt" }).click();
  await expect(page.getByText("Permission recorded")).toBeVisible();

  const decisionForge = page.getByRole("region", {
    name: "Turn evidence into commitment",
  });
  await decisionForge
    .getByRole("button", { name: "Generate Decision candidate" })
    .click();
  await expect(
    decisionForge.getByText("OpenAI suggestion · grounded in shared Evidence", {
      exact: true,
    }),
  ).toBeVisible();
  return decisionForge;
}

async function driveCandidateToReady(
  page: Page,
  decisionForge: Locator,
): Promise<Locator> {
  await decisionForge.getByRole("button", { name: "Confirm premise" }).click();
  await expect(
    decisionForge.getByRole("button", { name: "Save Decision draft" }),
  ).toBeVisible();
  await decisionForge
    .getByRole("button", { name: "Save Decision draft" })
    .click();
  await expect(
    decisionForge.getByRole("button", { name: "Validate and mark ready" }),
  ).toBeVisible();
  await decisionForge
    .getByRole("button", { name: "Validate and mark ready" })
    .click();
  const commitGate = decisionForge.locator(".commit-gate");
  await expect(commitGate).toBeVisible();
  return commitGate;
}

async function driveReadyToReviewRequired(
  page: Page,
  decisionForge: Locator,
): Promise<Locator> {
  await decisionForge.getByRole("button", { name: "Commit Decision" }).click();
  const committedDecision = decisionForge.locator(".committed-decision");
  await expect(committedDecision).toContainText("Revision 2 · COMMITTED");
  await committedDecision
    .getByRole("button", { name: "Start Decision monitor" })
    .click();
  await expect(committedDecision).toContainText("Monitoring active");
  await committedDecision
    .getByRole("button", { name: "Inject staged regulatory event" })
    .click();
  await expect(committedDecision).toContainText("AT_RISK · AI suggestion");

  const review = page.getByRole("region", {
    name: "Facilitator risk review",
  });
  await review
    .getByLabel("Facilitator review reason")
    .fill("Synthetic regulatory evidence requires a revised approval gate.");
  await review
    .getByRole("button", { name: "Confirm impact and open review" })
    .click();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "REVIEW_REQUIRED · Human confirmed" }),
  ).toBeVisible();
  const resolution = page.getByRole("region", {
    name: "Resolve Decision review",
  });
  await expect(resolution).toBeVisible();
  return resolution;
}

async function captureEvidenceVariants(
  page: Page,
  target: Locator,
  stateName: string,
): Promise<void> {
  const variants = [
    {
      filename: "desktop",
      reducedMotion: "no-preference" as const,
      viewport: { height: 900, width: 1440 },
    },
    {
      filename: "mobile",
      reducedMotion: "no-preference" as const,
      viewport: { height: 844, width: 390 },
    },
    {
      filename: "mobile-reduced-motion",
      reducedMotion: "reduce" as const,
      viewport: { height: 844, width: 390 },
    },
  ];

  for (const variant of variants) {
    await page.setViewportSize(variant.viewport);
    await page.emulateMedia({ reducedMotion: variant.reducedMotion });
    expect(
      await page.evaluate(
        () => matchMedia("(prefers-reduced-motion: reduce)").matches,
      ),
    ).toBe(variant.reducedMotion === "reduce");
    await expect(target).toBeVisible();
    await target.screenshot({
      animations: "disabled",
      path: `${screenshotDirectory}/${SCREENSHOT_DATE}-${stateName}-${variant.filename}.png`,
    });
  }

  await page.setViewportSize({ height: 900, width: 1440 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
}

test.describe("Flagship reliability visual evidence", () => {
  test.skip(
    process.env.CAPTURE_EVIDENCE !== "1",
    "Set CAPTURE_EVIDENCE=1 to write submission evidence.",
  );

  test.beforeAll(async () => {
    await mkdir(screenshotDirectory, { recursive: true });
  });

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ height: 900, width: 1440 });
    await resetFlagship(page);
  });

  test.afterEach(async ({ page }) => {
    await resetFlagship(page);
  });

  test("captures deterministic Connect success and staged failure", async ({
    page,
  }) => {
    await installSyntheticWebRtc(page.context());
    let providerShouldFail = false;
    let providerRequests = 0;
    let secretRequests = 0;

    await page.route(
      "**/api/v1/meetings/*/realtime/client-secrets",
      async (route) => {
        secretRequests += 1;
        const input = route.request().postDataJSON() as {
          channel?: string;
          meetingId?: string;
        };
        expect(input).toMatchObject({
          channel: "private",
          meetingId: FLAGSHIP_MEETING_ID,
        });
        await route.fulfill({
          body: JSON.stringify({
            channel: "private",
            clientSecret: `ek_synthetic_evidence_${String(secretRequests)}`,
            correlationId: `correlation-evidence-secret-${String(secretRequests)}`,
            expiresAt: "2026-07-22T12:30:00.000Z",
            keySource: "facilitatorProvided",
            meetingId: FLAGSHIP_MEETING_ID,
            model: "gpt-realtime-2.1",
          }),
          contentType: "application/json",
          status: 201,
        });
      },
    );
    await page.route(
      "https://api.openai.com/v1/realtime/calls",
      async (route) => {
        providerRequests += 1;
        expect(route.request().headers().authorization).toMatch(
          /^Bearer ek_synthetic_evidence_/u,
        );
        expect(route.request().postData()).toContain(
          "Flagship evidence synthetic offer",
        );
        if (providerShouldFail) {
          await route.fulfill({
            body: "Synthetic provider rejection.",
            contentType: "text/plain",
            status: 400,
          });
          return;
        }
        await route.fulfill({
          body: "v=0\r\no=counterpoint 2 2 IN IP4 127.0.0.1\r\ns=Flagship evidence synthetic answer\r\nt=0 0\r\n",
          contentType: "application/sdp",
          status: 200,
        });
      },
    );

    await signInAndOpenFlagship(page);
    const dock = page.getByRole("region", {
      name: "Live channels, explicit boundaries",
    });
    await page.getByLabel("Facilitator BYOK · tab only").fill(syntheticApiKey);
    await page.getByRole("button", { name: "Set key" }).click();
    await expect(page.getByText("Facilitator lease active")).toBeVisible();
    await expect(page.getByText(syntheticApiKey)).toHaveCount(0);

    const privateCard = page
      .getByRole("article")
      .filter({ hasText: "Private agent" });
    await privateCard.getByRole("button", { name: "Connect" }).click();
    await expect(
      privateCard.getByText("Connected", { exact: true }),
    ).toBeVisible();
    await expect(
      privateCard.getByText("Mic off · text stays available", { exact: true }),
    ).toBeVisible();
    expect(secretRequests).toBe(1);
    expect(providerRequests).toBe(1);
    await captureEvidenceVariants(page, dock, "connect-success");

    await privateCard.getByRole("button", { name: "Disconnect" }).click();
    await expect(privateCard.getByText("Off", { exact: true })).toBeVisible();
    providerShouldFail = true;
    await privateCard.getByRole("button", { name: "Connect" }).click();
    await expect(
      privateCard.getByText("Text fallback", { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("alert")).toContainText(
      "Realtime call creation failed.",
    );
    await expect(
      page
        .getByRole("region", { name: "Explicit speech controls" })
        .getByLabel("Equivalent text command"),
    ).toBeEnabled();
    await expect(
      privateCard.getByRole("button", { name: "Try again" }),
    ).toBeVisible();
    expect(secretRequests).toBe(2);
    expect(providerRequests).toBe(2);
    await captureEvidenceVariants(page, dock, "connect-staged-failure");
  });

  test("captures a non-retryable Cloudflare 1102 projection pause", async ({
    page,
  }) => {
    await signInAndOpenFlagship(page);
    const continuity = page.getByRole("complementary", {
      name: "Continuity status",
    });
    await expect(
      continuity.getByText("Meeting state stays online"),
    ).toBeVisible();

    let projectionRequests = 0;
    await page.route(
      `**/api/v1/meetings/${FLAGSHIP_MEETING_ID}/projection`,
      async (route) => {
        projectionRequests += 1;
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
      },
    );

    await expect(
      continuity.getByText(
        "Server capacity was exceeded. Your meeting state is safe; retry when ready.",
      ),
    ).toBeVisible({ timeout: 5_000 });
    const retryMeetingState = continuity.getByRole("button", {
      name: "Retry meeting state",
    });
    await expect(retryMeetingState).toHaveCount(1);
    await expect(retryMeetingState).toBeVisible();
    await expect(retryMeetingState).toBeEnabled();
    const recoveryButtonStyle = await retryMeetingState.evaluate((element) => {
      const parseColor = (value: string) => {
        const channels = value.match(/[\d.]+/gu)?.map(Number) ?? [];
        if (channels.length < 3) {
          throw new Error(`Expected an RGB color, received ${value}.`);
        }
        return {
          alpha: channels[3] ?? 1,
          blue: channels[2] ?? 0,
          green: channels[1] ?? 0,
          red: channels[0] ?? 0,
        };
      };
      const luminance = (color: ReturnType<typeof parseColor>) => {
        const linear = [color.red, color.green, color.blue].map((channel) => {
          const normalized = channel / 255;
          return normalized <= 0.04045
            ? normalized / 12.92
            : ((normalized + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!;
      };
      const style = getComputedStyle(element);
      const background = parseColor(style.backgroundColor);
      const foreground = parseColor(style.color);
      const lighter = Math.max(luminance(background), luminance(foreground));
      const darker = Math.min(luminance(background), luminance(foreground));
      return {
        backgroundAlpha: background.alpha,
        contrastRatio: (lighter + 0.05) / (darker + 0.05),
      };
    });
    expect(recoveryButtonStyle.backgroundAlpha).toBeGreaterThanOrEqual(0.9);
    expect(recoveryButtonStyle.contrastRatio).toBeGreaterThanOrEqual(4.5);
    await expect(
      continuity.getByText("Offline", { exact: true }),
    ).toBeVisible();
    await page.waitForTimeout(1_200);
    expect(projectionRequests).toBe(1);
    await captureEvidenceVariants(
      page,
      continuity,
      "projection-cloudflare-1102",
    );
  });

  test("captures cleaned AI provenance and the separated commit gate", async ({
    page,
  }) => {
    await signInAndOpenFlagship(page);
    const decisionForge = await prepareCandidate(page);
    const workflowWrapper =
      /AI[-\u2010\u2011 ]proposed|pending facilitator confirmation/iu;
    await expect(page.getByLabel("Decision title")).toHaveValue(
      "Establish Regional Launch Approval Gate",
    );
    await expect(page.getByLabel("Outcome")).toHaveValue(
      "Regional launch proceeds only through a documented approval gate.",
    );
    await expect(page.getByLabel("Decision title")).not.toHaveValue(
      workflowWrapper,
    );
    await expect(page.getByLabel("Outcome")).not.toHaveValue(workflowWrapper);
    const provenance = decisionForge.locator(".candidate-provenance");
    await expect(provenance).toContainText(
      "OpenAI suggestion · grounded in shared Evidence",
    );
    await expect(
      provenance.locator("details.technical-provenance"),
    ).not.toHaveAttribute("open", "");
    await captureEvidenceVariants(
      page,
      decisionForge,
      "cleaned-ai-candidate-provenance",
    );

    const commitGate = await driveCandidateToReady(page, decisionForge);
    await expect(commitGate.getByText("DECISION_READY")).toBeVisible();
    await expect(
      commitGate.getByText(
        "Commitment requires one explicit facilitator action",
      ),
    ).toBeVisible();
    await expect(
      commitGate.getByRole("button", { name: "Commit Decision" }),
    ).toBeVisible();
    const copyLayout = await commitGate
      .locator(".commit-gate-copy")
      .evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          display: style.display,
          flexDirection: style.flexDirection,
          gap: Number.parseFloat(style.gap),
        };
      });
    expect(copyLayout).toEqual({
      display: "flex",
      flexDirection: "column",
      gap: expect.any(Number),
    });
    expect(copyLayout.gap).toBeGreaterThan(0);
    await captureEvidenceVariants(page, commitGate, "separated-commit-gate");
  });

  test("captures revision-3 no-op validation variants", async ({ page }) => {
    test.setTimeout(180_000);
    await signInAndOpenFlagship(page);
    const decisionForge = await prepareCandidate(page);
    await driveCandidateToReady(page, decisionForge);
    await driveReadyToReviewRequired(page, decisionForge);

    await page.reload();
    const flagship = page.getByRole("article").filter({
      has: page.getByRole("heading", {
        exact: true,
        name: FLAGSHIP_PURPOSE,
      }),
    });
    await flagship.getByRole("button", { name: "Open workspace" }).click();
    await page.setViewportSize({ height: 844, width: 390 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    expect(
      await page.evaluate(
        () => matchMedia("(prefers-reduced-motion: reduce)").matches,
      ),
    ).toBe(true);

    const resolution = page.getByRole("region", {
      name: "Resolve Decision review",
    });
    const title = resolution.getByLabel("Revised Decision title");
    const outcome = resolution.getByLabel("Revised outcome");
    const monitorCondition = resolution.getByLabel("Revised monitor condition");
    await expect(title).toHaveValue("Revised conditional regional launch");
    await expect(outcome).toHaveValue(
      "Pause regional launch until the revised approval gate is satisfied.",
    );
    await expect(monitorCondition).toHaveValue(
      "Monitor the revised approval gate before resuming launch.",
    );

    let resolutionRequests = 0;
    page.on("request", (request) => {
      if (
        request.method() === "POST" &&
        new URL(request.url()).pathname ===
          "/api/v1/decisions/review-resolution"
      ) {
        resolutionRequests += 1;
      }
    });
    await title.fill("Establish Regional Launch Approval Gate");
    await outcome.fill(
      "Regional launch proceeds only through a documented approval gate.",
    );
    await monitorCondition.fill(
      "Reopen if the approval gate, staffing plan, or applicable regulation changes.",
    );
    await resolution.getByRole("button", { name: "Commit revision 3" }).click();
    await expect(page.getByRole("alert")).toContainText(
      "Change the title, outcome, or monitor condition before committing a new revision.",
    );
    expect(resolutionRequests).toBe(0);
    await expect(resolution).toContainText("REVIEW_REQUIRED · Revision 2");
    await captureEvidenceVariants(page, decisionForge, "revision-3-no-op");
  });
});
