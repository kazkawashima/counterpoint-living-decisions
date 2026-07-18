import { checkArchitecture } from "./check-architecture.mjs";

const violations = await checkArchitecture();

if (violations.length > 0) {
  throw new Error(`Deployment smoke failed:\n${violations.join("\n")}`);
}

console.log(
  "Deployment smoke command is wired; runtime health checks will be added with the local server adapter.",
);
