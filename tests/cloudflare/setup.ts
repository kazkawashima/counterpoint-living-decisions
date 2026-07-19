/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { env } from "cloudflare:workers";
import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { beforeEach } from "vitest";

interface CloudflareTestBindings extends WorkerBindings {
  readonly TEST_MIGRATIONS: D1Migration[];
}

const testBindings = env as CloudflareTestBindings;

beforeEach(async () => {
  await applyD1Migrations(
    testBindings.DB,
    testBindings.TEST_MIGRATIONS,
    "d1_migrations",
  );
});
