import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { fileURLToPath } from "node:url";

import { createServerApp } from "./app.js";
import { readServerConfiguration } from "./config.js";
import { createLocalServerRuntime } from "./runtime.js";

const configuration = readServerConfiguration();
const runtime = await createLocalServerRuntime(configuration);
const app = createServerApp(runtime);
const webRoot = fileURLToPath(new URL("../../web/dist/", import.meta.url));

app.use("*", serveStatic({ root: webRoot }));

const server = serve({
  fetch: app.fetch,
  hostname: configuration.host,
  port: configuration.port,
});

const shutdown = () => {
  server.close(() => {
    runtime.close();
    process.exitCode = 0;
  });
};

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

console.log(
  `Counterpoint is available at ${
    configuration.appOrigin ?? `http://0.0.0.0:${String(configuration.port)}`
  }`,
);
