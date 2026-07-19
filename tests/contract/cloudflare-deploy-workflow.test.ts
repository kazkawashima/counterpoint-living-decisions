import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const workflowUrl = new URL(
  "../../.github/workflows/deploy-cloudflare.yml",
  import.meta.url,
);
const driverUrl = new URL(
  "../../scripts/cloudflare-deploy.sh",
  import.meta.url,
);

describe("manually approved Cloudflare deployment workflow", () => {
  it("is dispatch-only, main-only, environment-protected, and secret-minimal", async () => {
    const workflow = await readFile(workflowUrl, "utf8");

    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).not.toMatch(/^\s+(?:push|pull_request):/mu);
    expect(workflow).toContain("if: github.ref == 'refs/heads/main'");
    expect(workflow).toContain("name: ${{ inputs.target }}");
    expect(workflow).toContain("contents: read");
    expect(workflow).toContain("uses: actions/checkout@v6");
    expect(workflow).toContain("uses: actions/setup-node@v4");
    expect(workflow).toContain("run: npm ci");
    expect(workflow).toContain(
      'run: bash scripts/cloudflare-deploy.sh --apply "$target"',
    );
    expect(workflow).not.toContain("OPENAI_API_KEY");
    expect(workflow).not.toMatch(/^\s+(?:schedule|workflow_run):/mu);
  });

  it("keeps every remote phase guarded and its raw output in ignored runner state", async () => {
    const driver = await readFile(driverUrl, "utf8");

    expect(driver).toContain(
      'if [[ "${CLOUDFLARE_DEPLOYMENT_APPROVED:-}" != "$target" ]]',
    );
    expect(driver).toContain(
      'if [[ "$target" == "production" && "${CLOUDFLARE_PRODUCTION_CONFIRMATION:-}" != "counterpoint-production" ]]',
    );
    expect(driver).toContain('if [[ -n "$(git status --porcelain)" ]]');
    expect(driver).toContain('run_private "forward D1 migrations"');
    expect(driver).toContain('run_private "strict Worker deploy"');
    expect(driver).toContain('private_log=".wrangler/deploy/');
    expect(driver).toContain("unset OPENAI_API_KEY OPENAI_API_KEY_JUDGE");
    expect(driver).toContain("JUDGE_IP_HMAC_SECRET");
    expect(driver).not.toContain("wrangler secret put");
  });
});
