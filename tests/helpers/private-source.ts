import { Buffer } from "node:buffer";

import { expect, type Page } from "@playwright/test";

import { activateByKeyboard } from "./keyboard.js";

export async function uploadAndUsePrivateMarkdown(
  page: Page,
  input: {
    readonly filename: string;
    readonly text: string;
  },
): Promise<void> {
  const vault = page.getByRole("region", {
    name: "Bring evidence in. Nothing goes out.",
  });
  await vault.locator('input[type="file"]').setInputFiles({
    buffer: Buffer.from(input.text),
    mimeType: "text/markdown",
    name: input.filename,
  });
  await activateByKeyboard(
    page,
    vault.getByRole("button", { name: "Store and process privately" }),
  );
  const artifact = vault
    .locator(".artifact-item")
    .filter({ hasText: input.filename });
  await expect(artifact.getByText("Derived text ready")).toBeVisible();
  await activateByKeyboard(
    page,
    artifact.getByRole("button", { name: "Use privately" }),
  );
  await expect(
    page.getByLabel("Active private source · derived text"),
  ).toHaveValue(input.text);
}
