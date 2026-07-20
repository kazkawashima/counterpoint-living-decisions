import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const FLAGSHIP_MEETING_ID = "meeting-global-ai-rollout";
const TIMEOUT_MS = 120_000;

export function composeSmokeEnvironment(baseEnvironment, input) {
  if (!/^counterpoint-smoke-[a-z0-9-]+$/u.test(input.projectName)) {
    throw new TypeError(
      "Compose smoke requires an isolated counterpoint-smoke- project name",
    );
  }
  if (
    !Number.isSafeInteger(input.port) ||
    input.port < 1024 ||
    input.port > 65_535
  ) {
    throw new TypeError(
      "Compose smoke port must be an integer from 1024 to 65535",
    );
  }
  return {
    ...baseEnvironment,
    COMPOSE_PORT: String(input.port),
    COMPOSE_PROJECT_NAME: input.projectName,
    JUDGE_IP_HMAC_SECRET: "",
    OPENAI_API_KEY: "",
    OPENAI_API_KEY_JUDGE: "",
    PUBLIC_HOST: "127.0.0.2",
    REGULATORY_WEBHOOK_SECRET: "",
  };
}

export function assertPersistedComposeProjection(projection, sourceArtifactId) {
  const persisted =
    projection.privateWorkspace?.sources?.some(
      (source) => source.sourceArtifactId === sourceArtifactId,
    ) === true;
  if (!persisted) {
    throw new Error(
      "Compose private source did not survive container recreation",
    );
  }
}

async function dockerCompose(input, args) {
  try {
    await input.execFile(
      "docker",
      ["compose", "--project-name", input.projectName, ...args],
      {
        cwd: input.root,
        encoding: "utf8",
        env: input.environment,
        maxBuffer: 16 * 1024 * 1024,
        timeout: TIMEOUT_MS,
      },
    );
  } catch {
    throw new Error(`Compose smoke phase failed: ${args.join(" ")}`);
  }
}

async function requestJson(fetch, origin, path, options = {}) {
  const response = await fetch(`${origin}${path}`, {
    ...options,
    headers: {
      accept: "application/json",
      ...(options.body === undefined
        ? {}
        : { "content-type": "application/json" }),
      ...(options.headers ?? {}),
    },
  });
  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error(`${path} did not return JSON`);
  }
  return { body, response };
}

async function waitUntilReady(fetch, origin) {
  const deadline = Date.now() + TIMEOUT_MS;
  let lastStatus = "unreachable";
  while (Date.now() < deadline) {
    try {
      const { body, response } = await requestJson(fetch, origin, "/ready");
      lastStatus = String(response.status);
      if (response.status === 200 && body.status === "ready") {
        return;
      }
    } catch {
      lastStatus = "unreachable";
    }
    await new Promise((resolvePromise) => {
      setTimeout(resolvePromise, 500);
    });
  }
  throw new Error(`Compose readiness timed out (${lastStatus})`);
}

export async function runComposePersistenceSmoke(input) {
  const environment = composeSmokeEnvironment(
    input.environment ?? process.env,
    input,
  );
  const runtime = {
    environment,
    execFile: input.execFile ?? execFileAsync,
    projectName: input.projectName,
    root: input.root,
  };
  const fetch = input.fetch ?? globalThis.fetch;
  const origin = `http://127.0.0.2:${String(input.port)}`;
  let attemptedStart = false;

  try {
    attemptedStart = true;
    await dockerCompose(runtime, ["up", "--build", "--detach"]);
    await waitUntilReady(fetch, origin);

    const login = await requestJson(fetch, origin, "/api/v1/login", {
      body: JSON.stringify({
        password: "counterpoint-product",
        userId: "product",
      }),
      method: "POST",
    });
    if (
      login.response.status !== 200 ||
      typeof login.body.bearerToken !== "string"
    ) {
      throw new Error("Compose login failed");
    }
    const authorization = {
      authorization: `Bearer ${login.body.bearerToken}`,
    };
    const before = await requestJson(
      fetch,
      origin,
      `/api/v1/meetings/${FLAGSHIP_MEETING_ID}/projection`,
      { headers: authorization },
    );
    if (
      before.response.status !== 200 ||
      !before.body.meeting?.purpose?.startsWith("Work & Productivity")
    ) {
      throw new Error("Compose flagship projection is inconsistent");
    }

    const runId = `${String(Date.now())}-${String(process.pid)}`;
    const source = await requestJson(
      fetch,
      origin,
      "/api/v1/disclosures/sources/text",
      {
        body: JSON.stringify({
          expectedPosition: before.body.shared.position,
          idempotencyKey: `compose-persistence-${runId}`,
          meetingId: FLAGSHIP_MEETING_ID,
          text: "Synthetic Compose persistence marker.",
          title: `Compose persistence ${runId}`,
        }),
        headers: authorization,
        method: "POST",
      },
    );
    if (
      source.response.status !== 201 ||
      typeof source.body.source?.sourceArtifactId !== "string"
    ) {
      throw new Error("Compose persistence marker creation failed");
    }

    await dockerCompose(runtime, [
      "up",
      "--detach",
      "--force-recreate",
      "--no-deps",
      "app",
    ]);
    await waitUntilReady(fetch, origin);

    const after = await requestJson(
      fetch,
      origin,
      `/api/v1/meetings/${FLAGSHIP_MEETING_ID}/projection`,
      { headers: authorization },
    );
    if (after.response.status !== 200) {
      throw new Error("Compose session did not survive container recreation");
    }
    assertPersistedComposeProjection(
      after.body,
      source.body.source.sourceArtifactId,
    );
    return {
      host: new URL(origin).host,
      meetingId: FLAGSHIP_MEETING_ID,
      projectName: input.projectName,
      status: "passed",
    };
  } finally {
    if (attemptedStart) {
      await dockerCompose(runtime, ["down", "--volumes"]);
    }
  }
}

const invokedAsScript =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (invokedAsScript) {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const projectName =
    process.env.COMPOSE_SMOKE_PROJECT_NAME ??
    `counterpoint-smoke-${String(process.pid)}`;
  const port = Number(
    process.env.COMPOSE_SMOKE_PORT ?? 18_000 + (process.pid % 1_000),
  );
  const summary = await runComposePersistenceSmoke({
    port,
    projectName,
    root,
  });
  console.log(JSON.stringify(summary));
}
