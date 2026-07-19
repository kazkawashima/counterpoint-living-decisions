export {
  HTTP_STATUS_BY_ERROR_CODE,
  apiErrorResponse,
  apiJsonResponse,
  parseBearerToken,
} from "./common.js";
export {
  handleIssueRealtimeClientSecretHttp,
  type IssueRealtimeClientSecretHttpDependencies,
} from "./realtime-client-secrets.js";
export {
  handleRealtimeAccessHttp,
  type RealtimeAccessHttpDependencies,
} from "./realtime-access.js";

export const httpApiPackage = "@counterpoint/http-api";
