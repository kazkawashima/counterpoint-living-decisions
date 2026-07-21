import { readFile } from "node:fs/promises";

import { expect, test, type Page } from "@playwright/test";

import {
  FLAGSHIP_CONTROL_SELECTOR,
  controlNameMatches,
  flagshipControlExclusions,
  flagshipControls,
  type FlagshipControlKind,
  type FlagshipControlState,
} from "../helpers/flagship-controls.js";
import { resetFlagshipFixture } from "../helpers/flagship-reset.js";

interface RuntimeControl {
  readonly enabled: boolean;
  readonly kind: FlagshipControlKind;
  readonly name: string;
}

test.afterEach(async ({ page }) => {
  await resetFlagshipFixture(page.request);
});

async function visibleControls(page: Page): Promise<readonly RuntimeControl[]> {
  return page
    .locator(FLAGSHIP_CONTROL_SELECTOR)
    .evaluateAll((elements, exclusions) => {
      const normalize = (value: string | null): string =>
        (value ?? "").replace(/\s+/gu, " ").trim();
      const labelText = (label: HTMLLabelElement | null): string => {
        if (label === null) return "";
        const copy = label.cloneNode(true) as HTMLLabelElement;
        copy
          .querySelectorAll("button, input, select, textarea")
          .forEach((nestedControl) => nestedControl.remove());
        return normalize(copy.textContent);
      };
      const nameOf = (element: Element): string => {
        const labelledBy = element.getAttribute("aria-labelledby");
        if (labelledBy !== null) {
          const labelledText = labelledBy
            .split(/\s+/u)
            .map((id) => document.getElementById(id)?.textContent ?? "")
            .join(" ");
          if (normalize(labelledText) !== "") return normalize(labelledText);
        }
        const ariaLabel = normalize(element.getAttribute("aria-label"));
        if (ariaLabel !== "") return ariaLabel;
        if (
          element instanceof HTMLInputElement ||
          element instanceof HTMLTextAreaElement ||
          element instanceof HTMLSelectElement
        ) {
          if (element.id !== "") {
            const label = document.querySelector<HTMLLabelElement>(
              `label[for="${CSS.escape(element.id)}"]`,
            );
            if (labelText(label) !== "") return labelText(label);
          }
          const wrappingLabel = element.closest<HTMLLabelElement>("label");
          if (labelText(wrappingLabel) !== "") return labelText(wrappingLabel);
          if (
            element instanceof HTMLInputElement &&
            ["button", "submit", "reset"].includes(element.type)
          ) {
            return normalize(element.value);
          }
        }
        return normalize(element.textContent);
      };
      const kindOf = (element: Element): FlagshipControlKind => {
        const explicitRole = element.getAttribute("role");
        if (explicitRole === "radio") return "radio";
        if (explicitRole === "button") return "role-button";
        switch (element.tagName.toLowerCase()) {
          case "a":
            return "link";
          case "button":
            return "button";
          case "input":
            return (element as HTMLInputElement).type === "radio"
              ? "radio"
              : "input";
          case "textarea":
            return "textarea";
          case "select":
            return "select";
          case "summary":
            return "summary";
          default:
            throw new Error(
              `Unsupported interactive control: ${element.outerHTML}`,
            );
        }
      };
      return elements
        .filter((element) => {
          const style = getComputedStyle(element);
          return (
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            element.getClientRects().length > 0 &&
            element.closest('[aria-hidden="true"], [inert]') === null &&
            !exclusions.some(
              ({ selector }) => element.closest(selector) !== null,
            )
          );
        })
        .map((element) => {
          const nativelyDisabled =
            "disabled" in element &&
            Boolean((element as HTMLButtonElement).disabled);
          const readOnly =
            (element instanceof HTMLInputElement ||
              element instanceof HTMLTextAreaElement) &&
            element.readOnly;
          return {
            enabled:
              !nativelyDisabled &&
              !readOnly &&
              element.getAttribute("aria-disabled") !== "true",
            kind: kindOf(element),
            name: nameOf(element),
          };
        });
    }, flagshipControlExclusions);
}

async function signInToMeetings(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: /Product/iu }).click();
  await page.getByLabel("Demo password").fill("counterpoint-product");
  await page.getByRole("button", { name: "Continue to meetings" }).click();
  await expect(
    page.getByRole("heading", { name: "Your assigned meetings" }),
  ).toBeVisible();
}

async function signInAndOpenFlagship(page: Page): Promise<void> {
  await signInToMeetings(page);
  const flagship = page.getByRole("article").filter({
    has: page.getByRole("heading", { name: "Global AI Product Rollout" }),
  });
  await flagship.getByRole("button", { name: "Open workspace" }).click();
  await expect(
    page.getByRole("heading", { name: "Live channels, explicit boundaries" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Reset staged demo" }).click();
  await page.getByRole("button", { name: "Confirm meeting reset" }).click();
  await expect(page.getByText("Current stage 1 of 5")).toBeVisible();
}

async function expectRegisteredControls(
  page: Page,
  state: FlagshipControlState,
): Promise<void> {
  const runtime = await visibleControls(page);
  const stateGroups: Partial<
    Record<FlagshipControlState, readonly FlagshipControlState[]>
  > = {
    "reset-confirmation": ["context"],
    "display-active": ["context"],
    "commitment-idle": ["approved-context"],
    candidate: ["approved-context", "candidate-surface"],
    "premise-confirmed": [
      "approved-context",
      "candidate-surface",
      "candidate-readonly",
    ],
    "decision-draft": [
      "approved-context",
      "candidate-surface",
      "candidate-readonly",
    ],
    "decision-ready": [
      "approved-context",
      "candidate-surface",
      "candidate-readonly",
    ],
    "decision-committed": [
      "approved-context",
      "candidate-surface",
      "candidate-readonly",
      "decision-export",
    ],
    "decision-export-ready": [
      "approved-context",
      "candidate-surface",
      "candidate-readonly",
      "decision-export",
      "decision-committed",
    ],
    monitoring: [
      "approved-context",
      "candidate-surface",
      "candidate-readonly",
      "decision-export",
      "decision-export-ready",
    ],
    "at-risk": [
      "approved-context",
      "candidate-surface",
      "candidate-readonly",
      "decision-export",
      "decision-export-ready",
      "invalidation-surface",
    ],
    "review-required": [
      "approved-context",
      "candidate-surface",
      "candidate-readonly",
      "decision-export",
      "decision-export-ready",
      "invalidation-surface",
    ],
    resolution: [
      "approved-context",
      "candidate-surface",
      "candidate-readonly",
      "decision-export",
      "decision-export-ready",
      "invalidation-surface",
    ],
  };
  const activeGroups = new Set<FlagshipControlState>([
    ...(state === "shared-display" ? [] : (["workspace-shell"] as const)),
    state,
    ...(stateGroups[state] ?? []),
  ]);
  const suppressedByState: Partial<
    Record<FlagshipControlState, readonly string[]>
  > = {
    "reset-confirmation": ["flagship-reset-request"],
    "display-active": ["display-create"],
  };
  const suppressedIds = new Set(suppressedByState[state] ?? []);
  const expected = flagshipControls.filter(
    (entry) => activeGroups.has(entry.state) && !suppressedIds.has(entry.id),
  );
  const unmatched = [...expected];
  const unregistered = runtime.filter((actual) => {
    const matchIndex = unmatched.findIndex(
      (entry) =>
        entry.kind === actual.kind &&
        entry.enabled === actual.enabled &&
        controlNameMatches(entry.name, actual.name),
    );
    if (matchIndex === -1) return true;
    unmatched.splice(matchIndex, 1);
    return false;
  });
  expect(
    unregistered,
    `Unregistered visible controls in ${state}:\n${unregistered
      .map((control) => `- ${control.kind}: ${control.name}`)
      .join("\n")}`,
  ).toEqual([]);
  expect(
    unmatched,
    `Registered controls missing from the ${state} checkpoint:\n${unmatched
      .map((control) => `- ${control.id}`)
      .join("\n")}`,
  ).toEqual([]);
}

test("inventory entries have unique ids, concrete owners, and postconditions", async () => {
  const ids = flagshipControls.map(({ id }) => id);
  expect(new Set(ids).size).toBe(ids.length);
  expect(flagshipControlExclusions).toHaveLength(2);
  for (const exclusion of flagshipControlExclusions) {
    expect(exclusion.reason.trim().length).toBeGreaterThan(20);
  }

  const ownerFiles = {
    "decision-commit": "tests/e2e/decision-commit.spec.ts",
    "flagship-control-inventory":
      "tests/e2e/flagship-control-inventory.spec.ts",
    "guided-flagship": "tests/e2e/guided-flagship.spec.ts",
    "realtime-channels": "tests/e2e/realtime-channels.spec.ts",
    "shared-display": "tests/e2e/shared-display.spec.ts",
  } as const;
  const sources = new Map<string, string>();
  for (const entry of flagshipControls) {
    expect(entry.id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u);
    expect(entry.postcondition.trim().length).toBeGreaterThan(20);
    const separator = entry.owner.indexOf(": ");
    expect(separator).toBeGreaterThan(0);
    const suite = entry.owner.slice(0, separator) as keyof typeof ownerFiles;
    const scenario = entry.owner.slice(separator + 2);
    const path = ownerFiles[suite];
    expect(path, `Unknown owner suite for ${entry.id}`).toBeDefined();
    let source = sources.get(path);
    if (source === undefined) {
      source = await readFile(path, "utf8");
      sources.set(path, source);
    }
    const scenarioStart = source.indexOf(`test("${scenario}"`);
    expect(
      scenarioStart,
      `Owner scenario for ${entry.id} does not exist: ${entry.owner}`,
    ).toBeGreaterThanOrEqual(0);
    const nextScenario = source.indexOf("\ntest(", scenarioStart + 1);
    const scenarioSource = source.slice(
      scenarioStart,
      nextScenario === -1 ? undefined : nextScenario,
    );
    const sourceProofStates = new Set<FlagshipControlState>([
      "realtime-key-active",
      "realtime-connecting",
      "realtime-connected",
      "realtime-fallback",
      "projection-paused",
      "judge-usage-ready",
      "judge-usage-unavailable",
      "judge-byok",
      "manual-private-ready",
      "manual-shared-ready",
    ]);
    const requiresSourceProof =
      entry.id === "keep-excerpt-private" || sourceProofStates.has(entry.state);
    if (requiresSourceProof && typeof entry.name === "string") {
      expect(
        scenarioSource,
        `Owner scenario does not locate ${entry.id} by its accessible name`,
      ).toContain(entry.name);
    }
    if (entry.enabled && requiresSourceProof) {
      expect(
        /\.click\(|\.fill\(|activateByKeyboard\(|mouse\.down\(|waitForEvent\("download"\)/u.test(
          scenarioSource,
        ),
        `Owner scenario for ${entry.id} has no browser interaction`,
      ).toBe(true);
    }
  }
});

test("checkpoints reset and display controls", async ({ page }) => {
  await signInAndOpenFlagship(page);
  await page.getByRole("button", { name: "Reset staged demo" }).click();
  await expectRegisteredControls(page, "reset-confirmation");
  await page.getByRole("button", { name: "Cancel" }).click();

  await page.getByRole("button", { name: "Create shared display" }).click();
  await expectRegisteredControls(page, "display-active");
  await page.getByRole("button", { name: "End access" }).click();
  await expect(
    page.getByRole("button", { name: "Create shared display" }),
  ).toBeVisible();
});

test("traverses seeded Flagship states", async ({ page }) => {
  await signInAndOpenFlagship(page);
  await expectRegisteredControls(page, "context");

  await page
    .getByRole("button", { name: "Prepare grounded sharing preview" })
    .click();
  await expect(
    page.getByRole("region", { name: "Review the exact payload" }),
  ).toBeVisible();
  await expectRegisteredControls(page, "permission-preview");

  await page.getByRole("button", { name: /Approve exact excerpt/u }).click();
  await expect(page.getByText("Current stage 3 of 5")).toBeVisible();
  await expectRegisteredControls(page, "commitment-idle");

  await page
    .getByRole("button", { name: "Generate Decision candidate" })
    .click();
  await expect(
    page.getByRole("button", { name: /^Confirm(?: edited)? premise$/u }),
  ).toBeVisible();
  await expectRegisteredControls(page, "candidate");

  await page.getByRole("button", { name: "Confirm premise" }).click();
  await expect(
    page
      .locator(".decision-forge")
      .getByText("Human confirmed", { exact: true }),
  ).toBeVisible();
  await expectRegisteredControls(page, "premise-confirmed");

  await page.getByRole("button", { name: "Save Decision draft" }).click();
  await expect(page.getByText("Revision 1 · immutable DRAFT")).toBeVisible();
  await expectRegisteredControls(page, "decision-draft");

  await page.getByRole("button", { name: "Validate and mark ready" }).click();
  await expect(
    page.getByRole("button", { name: "Commit Decision" }),
  ).toBeVisible();
  await expectRegisteredControls(page, "decision-ready");

  await page.getByRole("button", { name: "Commit Decision" }).click();
  await expect(
    page.getByRole("button", { name: "Start Decision monitor" }),
  ).toBeVisible();
  await expectRegisteredControls(page, "decision-committed");

  await page
    .getByRole("button", { name: "Prepare Decision JSON export" })
    .click();
  await expect(
    page.getByRole("link", { name: /^Download JSON/u }),
  ).toBeVisible();
  await expectRegisteredControls(page, "decision-export-ready");

  await page.getByRole("button", { name: "Start Decision monitor" }).click();
  await expect(
    page.getByText("Monitoring active", { exact: true }),
  ).toBeVisible();
  await expectRegisteredControls(page, "monitoring");

  await page
    .getByRole("button", { name: "Inject staged regulatory event" })
    .click();
  await expect(page.getByText(/AT_RISK ·/u).first()).toBeVisible();
  await expectRegisteredControls(page, "at-risk");

  await page
    .getByLabel("Facilitator review reason")
    .fill("Regulatory change requires a revised approval gate before launch.");
  await page
    .getByRole("button", { name: "Confirm impact and open review" })
    .click();
  await expect(
    page.getByText(/REVIEW_REQUIRED · Human confirmed/u).first(),
  ).toBeVisible();
  await expectRegisteredControls(page, "review-required");

  await page.getByRole("button", { name: /^Commit revision \d+$/u }).click();
  await expect(
    page
      .locator(".committed-decision")
      .getByRole("status")
      .filter({ hasText: "COMMITTED · Revision 3" }),
  ).toBeVisible();
  await expectRegisteredControls(page, "resolution");

  await page.getByRole("button", { name: "Reset staged demo" }).click();
  await page.getByRole("button", { name: "Confirm meeting reset" }).click();
  await expect(page.getByText("Current stage 1 of 5")).toBeVisible();
});
