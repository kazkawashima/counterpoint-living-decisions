import { expect, type APIRequestContext } from "@playwright/test";
import {
  FacilitatorDemoResetResponseSchema,
  GetRoleProjectionResponseSchema,
  LoginResponseSchema,
} from "@counterpoint/protocol";

const FLAGSHIP_MEETING_ID = "meeting-global-ai-rollout";

export async function resetFlagshipFixture(
  request: APIRequestContext,
): Promise<void> {
  const loginResponse = await request.post("/api/v1/login", {
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
  const projectionResponse = await request.get(
    `/api/v1/meetings/${FLAGSHIP_MEETING_ID}/projection`,
    { headers },
  );
  expect(projectionResponse.status()).toBe(200);
  const projection = GetRoleProjectionResponseSchema.parse(
    await projectionResponse.json(),
  );
  const resetResponse = await request.post(
    `/api/v1/meetings/${FLAGSHIP_MEETING_ID}/demo/reset`,
    {
      data: {
        expectedPosition: projection.shared.position,
        idempotencyKey: `flagship-test-cleanup-${crypto.randomUUID()}`,
        meetingId: FLAGSHIP_MEETING_ID,
      },
      headers,
    },
  );
  expect(resetResponse.status()).toBe(200);
  FacilitatorDemoResetResponseSchema.parse(await resetResponse.json());
}
