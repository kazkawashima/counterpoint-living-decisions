import type {
  D1UsageSummary,
  D1UsageLimiter,
} from "@counterpoint/adapters-cloudflare";
import { apiErrorResponse, apiJsonResponse } from "@counterpoint/http-api";
import { JudgeUsageSummaryResponseSchema } from "@counterpoint/protocol";

import {
  resolveJudgeManagedAuthorization,
  type JudgeManagedAuthorizationDependencies,
} from "./judge-managed-realtime-authorization.js";

export async function handleJudgeUsageSummaryHttp(input: {
  readonly correlationId: string;
  readonly dependencies: JudgeManagedAuthorizationDependencies;
  readonly ipAddress: string;
  readonly meetingId: string;
  readonly request: Request;
  readonly usage: Pick<D1UsageLimiter, "readUsageSummary">;
}): Promise<Response> {
  const authorization = await resolveJudgeManagedAuthorization({
    dependencies: input.dependencies,
    meetingId: input.meetingId,
    request: input.request,
  });
  if (authorization.kind === "rejected") {
    return apiErrorResponse(authorization.code, input.correlationId);
  }

  let summary: D1UsageSummary;
  try {
    summary = await input.usage.readUsageSummary({
      accountId: authorization.authorization.userId,
      ipAddress: input.ipAddress,
      meetingId: authorization.authorization.meetingId,
    });
  } catch {
    return apiErrorResponse("REALTIME_UNAVAILABLE", input.correlationId);
  }

  return apiJsonResponse(
    JudgeUsageSummaryResponseSchema.parse({
      correlationId: input.correlationId,
      dimensions: summary.dimensions,
      rollingWindowSeconds: summary.rollingWindowSeconds,
    }),
    200,
    input.correlationId,
  );
}
