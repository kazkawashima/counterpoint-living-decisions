import { expect, test, type APIRequestContext } from "@playwright/test";
import { LoginResponseSchema } from "@counterpoint/protocol";

const FLAGSHIP_MEETING_ID = "meeting-global-ai-rollout";

async function login(
  request: APIRequestContext,
  userId: string,
  password: string,
) {
  const response = await request.post("/api/v1/login", {
    data: { password, userId },
  });
  expect(response.status()).toBe(200);
  return LoginResponseSchema.parse(await response.json());
}

function authorization(bearerToken: string) {
  return { authorization: `Bearer ${bearerToken}` };
}

test("Meeting B stays isolated and survives a flagship reset", async ({
  browser,
  baseURL,
}) => {
  expect(baseURL).toBeDefined();
  if (baseURL === undefined) {
    throw new Error("Playwright baseURL is required for isolated contexts.");
  }
  const productContext = await browser.newContext({ baseURL });
  const legalContext = await browser.newContext({ baseURL });
  const safetyContext = await browser.newContext({ baseURL });
  const product = await login(
    productContext.request,
    "product",
    "counterpoint-product",
  );
  const legal = await login(
    legalContext.request,
    "legal",
    "counterpoint-legal",
  );
  const safety = await login(
    safetyContext.request,
    "safety",
    "counterpoint-safety",
  );

  const runId = crypto.randomUUID();
  const createdResponse = await productContext.request.post(
    "/api/v1/meetings",
    {
      data: {
        idempotencyKey: `e2e-isolation-meeting-${runId}`,
        purpose: "Synthetic isolated review room",
        users: [
          { role: "facilitator", userId: "product" },
          { role: "participant", userId: "legal" },
          { role: "participant", userId: "engineering" },
        ],
      },
      headers: authorization(product.bearerToken),
    },
  );
  expect(createdResponse.status()).toBe(201);
  const created = (await createdResponse.json()) as {
    meetingId: string;
  };

  const privateText =
    "Synthetic Meeting B legal note that must remain owner-private.";
  const sourceResponse = await legalContext.request.post(
    "/api/v1/disclosures/sources/text",
    {
      data: {
        expectedPosition: 0,
        idempotencyKey: `e2e-isolation-source-${runId}`,
        meetingId: created.meetingId,
        text: privateText,
        title: "Meeting B private marker",
      },
      headers: authorization(legal.bearerToken),
    },
  );
  expect(sourceResponse.status()).toBe(201);
  const source = (await sourceResponse.json()) as {
    source: { sourceArtifactId: string };
  };

  const unassignedPaths = [
    `/api/v1/meetings/${created.meetingId}/projection`,
    `/api/v1/meetings/${created.meetingId}/evidence`,
    `/api/v1/meetings/${created.meetingId}/decisions`,
    `/api/v1/meetings/${created.meetingId}/realtime/access`,
    `/api/v1/meetings/${created.meetingId}/artifacts/${source.source.sourceArtifactId}?representation=source`,
  ];
  for (const path of unassignedPaths) {
    const unassignedRead = await safetyContext.request.get(path, {
      headers: authorization(safety.bearerToken),
    });
    expect(unassignedRead.status(), path).toBe(403);
    expect(JSON.stringify(await unassignedRead.json()), path).not.toContain(
      privateText,
    );
  }

  const resetResponse = await productContext.request.post(
    `/api/v1/meetings/${FLAGSHIP_MEETING_ID}/demo/reset`,
    {
      data: {
        expectedPosition: 0,
        idempotencyKey: `e2e-isolation-reset-${runId}`,
        meetingId: FLAGSHIP_MEETING_ID,
      },
      headers: authorization(product.bearerToken),
    },
  );
  expect(resetResponse.status()).toBe(200);

  const legalProjectionResponse = await legalContext.request.get(
    `/api/v1/meetings/${created.meetingId}/projection`,
    { headers: authorization(legal.bearerToken) },
  );
  expect(legalProjectionResponse.status()).toBe(200);
  const legalProjection = (await legalProjectionResponse.json()) as {
    meeting: { purpose: string };
    privateWorkspace: {
      sources: { sourceArtifactId: string; text: string }[];
    };
  };
  expect(legalProjection.meeting.purpose).toBe(
    "Synthetic isolated review room",
  );
  expect(legalProjection.privateWorkspace.sources).toContainEqual(
    expect.objectContaining({
      sourceArtifactId: source.source.sourceArtifactId,
      text: privateText,
    }),
  );

  await Promise.all([
    productContext.close(),
    legalContext.close(),
    safetyContext.close(),
  ]);
});
