import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const MAX_RESPONSE_BYTES = 1024 * 1024;
const TIMEOUT_MS = 10_000;
const SECRET_PATTERN =
  /(?:\bsk-(?:proj|svcacct)-[A-Za-z0-9_-]{20,}\b|\bBearer\s+[A-Za-z0-9._-]{16,}\b|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/u;

export function validatedDeploymentOrigin(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError("Deployment URL must be an absolute HTTPS URL");
  }
  if (
    url.protocol !== "https:" ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.pathname !== "/" ||
    url.search.length > 0 ||
    url.hash.length > 0
  ) {
    throw new TypeError(
      "Deployment URL must be an HTTPS origin without credentials, path, query, or fragment",
    );
  }
  return url.origin;
}

async function boundedBody(response) {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    throw new Error("Remote smoke response exceeded 1 MiB");
  }
  if (response.body === null) {
    return "";
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error("Remote smoke response exceeded 1 MiB");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const text = new TextDecoder().decode(bytes);
  if (SECRET_PATTERN.test(text)) {
    throw new Error("Remote smoke response contained secret-shaped content");
  }
  return text;
}

async function request(fetch, origin, path) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${origin}${path}`, {
      headers: { accept: "application/json, text/html;q=0.9" },
      redirect: "error",
      signal: controller.signal,
    });
    return { response, text: await boundedBody(response) };
  } finally {
    clearTimeout(timeout);
  }
}

function parsedJson(text, label) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} did not return JSON`);
  }
}

export async function runCloudflareRemoteSmoke(input) {
  const origin = validatedDeploymentOrigin(input.origin);
  const fetch = input.fetch ?? globalThis.fetch;
  const [health, readiness, root, unauthenticatedApi] = await Promise.all([
    request(fetch, origin, "/health"),
    request(fetch, origin, "/ready"),
    request(fetch, origin, "/"),
    request(fetch, origin, "/api/v1/meetings"),
  ]);
  const healthBody = parsedJson(health.text, "Health");
  const readinessBody = parsedJson(readiness.text, "Readiness");
  if (
    health.response.status !== 200 ||
    healthBody.status !== "ok" ||
    healthBody.protocolVersion !== 1
  ) {
    throw new Error("Remote health contract failed");
  }
  if (
    readiness.response.status !== 200 ||
    readinessBody.status !== "ready" ||
    readinessBody.migrationsCurrent !== true ||
    readinessBody.protocolVersion !== 1
  ) {
    throw new Error("Remote readiness contract failed");
  }
  if (
    root.response.status !== 200 ||
    !root.response.headers.get("content-type")?.includes("text/html")
  ) {
    throw new Error("Remote SPA contract failed");
  }
  const apiBody = parsedJson(unauthenticatedApi.text, "Unauthenticated API");
  if (
    unauthenticatedApi.response.status !== 401 ||
    apiBody.code !== "AUTHENTICATION_REQUIRED"
  ) {
    throw new Error("Remote API parity/authentication contract failed");
  }
  return {
    apiStatus: unauthenticatedApi.response.status,
    healthStatus: health.response.status,
    host: new URL(origin).host,
    readinessStatus: readiness.response.status,
    rootStatus: root.response.status,
  };
}

const invokedAsScript =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (invokedAsScript) {
  if (process.argv[2] === "--validate-only") {
    const origin = validatedDeploymentOrigin(process.argv[3]);
    console.log(JSON.stringify({ host: new URL(origin).host }));
  } else {
    const summary = await runCloudflareRemoteSmoke({
      origin: process.argv[2],
    });
    console.log(JSON.stringify(summary));
  }
}
