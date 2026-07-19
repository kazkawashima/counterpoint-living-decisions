import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const rootUrl = new URL("../", import.meta.url);
const exampleUrl = new URL(".env.example", rootUrl);
const secretNames = new Set([
  "OPENAI_API_KEY",
  "OPENAI_API_KEY_JUDGE",
  "JUDGE_IP_HMAC_SECRET",
]);

function parseEnvironment(text) {
  return new Map(
    text
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#"))
      .map((line) => {
        const separator = line.indexOf("=");
        if (separator < 1) {
          throw new Error(`Invalid environment entry: ${line}`);
        }
        return [line.slice(0, separator), line.slice(separator + 1)];
      }),
  );
}

function assertValidPort(name, value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`${name} must be an integer from 1 to 65535`);
  }
}

const environment = parseEnvironment(await readFile(exampleUrl, "utf8"));

if (environment.get("HOST") !== "0.0.0.0") {
  throw new Error("HOST in .env.example must remain 0.0.0.0");
}

assertValidPort("PORT", environment.get("PORT"));
assertValidPort("WEB_PORT", environment.get("WEB_PORT"));

for (const name of secretNames) {
  const value = environment.get(name);
  if (value !== undefined && value.length > 0) {
    throw new Error(`${name} must not contain a value in .env.example`);
  }
}

console.log(
  `Environment example is valid (${fileURLToPath(exampleUrl)}); OpenAI keys remain optional.`,
);
