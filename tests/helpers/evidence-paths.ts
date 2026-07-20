import { resolve } from "node:path";

export function evidenceDirectory(relativePath: string): string {
  const root =
    process.env.CAPTURE_EVIDENCE === "1"
      ? resolve("docs/media")
      : resolve("test-results/evidence");
  return resolve(root, relativePath);
}
