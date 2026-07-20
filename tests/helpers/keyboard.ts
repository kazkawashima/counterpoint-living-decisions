import { expect, type Locator, type Page } from "@playwright/test";

export async function activateByKeyboard(
  page: Page,
  control: Locator,
  key: "Enter" | "Space" = "Enter",
): Promise<void> {
  await expect(control).toBeVisible();
  await expect(control).toBeEnabled();
  await expect(control).toHaveAccessibleName(/\S/u);
  await control.focus();
  await expect(control).toBeFocused();
  await page.keyboard.press(key);
}
