import { expect, test } from "@playwright/test";

const MEETING_ID = "meeting-global-ai-rollout";

test("Worker SPA serves the hosted flagship through one external-style origin", async ({
  page,
}) => {
  const apiRequests: URL[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/")) {
      apiRequests.push(new URL(request.url()));
    }
  });

  const loginResponse = await page.request.post("/api/v1/login", {
    data: { password: "counterpoint-product", userId: "product" },
  });
  expect(loginResponse.ok()).toBe(true);
  const loginBody = (await loginResponse.json()) as {
    bearerToken?: string;
  };
  expect(loginBody.bearerToken).toEqual(expect.any(String));

  const resetResponse = await page.request.post(
    `/api/v1/meetings/${MEETING_ID}/demo/reset`,
    {
      data: {
        expectedPosition: 0,
        idempotencyKey: `cloudflare-browser-reset-${String(Date.now())}`,
        meetingId: MEETING_ID,
      },
      headers: { authorization: `Bearer ${loginBody.bearerToken}` },
    },
  );
  expect(resetResponse.ok()).toBe(true);

  await page.goto("/");
  await expect(page).toHaveTitle(/Descant/u);
  const pageHost = new URL(page.url()).hostname;
  expect(["localhost", "127.0.0.1", "0.0.0.0"]).not.toContain(pageHost);
  await expect(
    page.getByRole("heading", { name: /Independent minds/u }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Product" }).click();
  await page.getByLabel("Demo password").fill("counterpoint-product");
  await page.getByRole("button", { name: "Continue to meetings" }).click();
  await expect(
    page.getByRole("heading", { name: "Your assigned meetings" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: /Work & Productivity/u }),
  ).toBeVisible();

  await page
    .getByRole("article")
    .filter({ hasText: "Work & Productivity — Global AI Product Rollout" })
    .getByRole("button", { name: "Open workspace" })
    .click();
  await expect(
    page.getByRole("heading", { name: "product workspace" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "No evidence has crossed the boundary" }),
  ).toBeVisible();

  await page
    .getByRole("button", { name: "Prepare grounded sharing preview" })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Private assistant is temporarily unavailable",
  );
  await page
    .getByRole("button", { name: "Continue with manual excerpt" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Review the exact payload" }),
  ).toBeVisible();
  await expect(page.getByText("Human-selected source excerpt")).toBeVisible();

  expect(apiRequests.length).toBeGreaterThanOrEqual(3);
  expect(apiRequests.every(({ hostname }) => hostname === pageHost)).toBe(true);
});
