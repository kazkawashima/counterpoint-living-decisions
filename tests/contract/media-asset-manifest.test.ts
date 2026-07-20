import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  assertMediaAssetManifestCurrent,
  assertMediaAssetProvenanceReviewed,
  buildMediaAssetManifest,
  renderMediaAssetManifest,
} from "../../scripts/generate-media-asset-manifest.mjs";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("media asset manifest generation", () => {
  it("inventories binary captures deterministically and excludes notes", async () => {
    const root = await mkdtemp(join(tmpdir(), "counterpoint-media-manifest-"));
    directories.push(root);
    await mkdir(join(root, "docs/media/screenshots/example"), {
      recursive: true,
    });
    await mkdir(join(root, "docs/media/clips/example"), { recursive: true });
    await writeFile(
      join(root, "docs/media/screenshots/example/state.png"),
      "synthetic png",
    );
    await writeFile(
      join(root, "docs/media/clips/example/flow.webm"),
      "synthetic webm",
    );
    await writeFile(join(root, "docs/media/notes.md"), "not an asset");

    const manifest = await buildMediaAssetManifest(root);

    expect(manifest.assets).toEqual([
      expect.objectContaining({
        bytes: 14,
        creator: "UNREVIEWED",
        mediaType: "video/webm",
        path: "docs/media/clips/example/flow.webm",
        sha256: createHash("sha256").update("synthetic webm").digest("hex"),
        syntheticData: null,
      }),
      expect.objectContaining({
        bytes: 13,
        mediaType: "image/png",
        path: "docs/media/screenshots/example/state.png",
        sha256: createHash("sha256").update("synthetic png").digest("hex"),
        syntheticData: null,
      }),
    ]);
    expect(JSON.stringify(manifest)).not.toContain("notes.md");
    expect(() => assertMediaAssetProvenanceReviewed(manifest)).toThrow(
      "Unreviewed media provenance",
    );
  });

  it("rejects a stale generated manifest", async () => {
    const root = await mkdtemp(join(tmpdir(), "counterpoint-media-manifest-"));
    directories.push(root);
    await mkdir(join(root, "docs/media/screenshots"), { recursive: true });
    await writeFile(join(root, "docs/media/screenshots/state.png"), "capture");
    const unreviewed = await buildMediaAssetManifest(root);
    const unreviewedAssets = unreviewed.assets as {
      readonly [key: string]: unknown;
      readonly path: string;
    }[];
    const reviewed = {
      ...unreviewed,
      assets: unreviewedAssets.map((asset) => ({
        ...asset,
        creator: "Counterpoint Playwright scenario",
        license: "LicenseRef-Counterpoint-Pending",
        origin: "First-party synthetic UI capture",
        syntheticData: true,
        thirdPartyMedia: false,
      })),
    };
    const expected = renderMediaAssetManifest(reviewed);

    await expect(
      assertMediaAssetManifestCurrent(root, expected),
    ).resolves.toBeUndefined();
    await expect(
      assertMediaAssetManifestCurrent(
        root,
        renderMediaAssetManifest({
          ...reviewed,
          rightsStatement: "stale",
        }),
      ),
    ).rejects.toThrow("docs/media/ASSET_MANIFEST.json is stale");
  });
});
