import { createHash } from "node:crypto";
import { readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const MEDIA_TYPES = new Map([
  [".png", "image/png"],
  [".webm", "video/webm"],
]);

async function mediaFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await mediaFiles(path)));
    } else if (
      entry.isFile() &&
      [...MEDIA_TYPES.keys()].some((extension) =>
        entry.name.endsWith(extension),
      )
    ) {
      files.push(path);
    }
  }
  return files;
}

function reviewedProvenance(manifest, assetPath) {
  const existing = manifest?.assets?.find(({ path }) => path === assetPath);
  if (existing === undefined) {
    return {
      creator: "UNREVIEWED",
      license: "UNREVIEWED",
      origin: "UNREVIEWED",
      syntheticData: null,
      thirdPartyMedia: null,
    };
  }
  return {
    creator: existing.creator,
    license: existing.license,
    origin: existing.origin,
    syntheticData: existing.syntheticData,
    thirdPartyMedia: existing.thirdPartyMedia,
  };
}

export function assertMediaAssetProvenanceReviewed(manifest) {
  const unresolved = manifest.assets.filter(
    ({ creator, license, origin, syntheticData, thirdPartyMedia }) =>
      creator === "UNREVIEWED" ||
      license === "UNREVIEWED" ||
      origin === "UNREVIEWED" ||
      typeof syntheticData !== "boolean" ||
      typeof thirdPartyMedia !== "boolean",
  );
  if (unresolved.length > 0) {
    throw new Error(
      `Unreviewed media provenance: ${unresolved
        .map(({ path }) => path)
        .join(", ")}`,
    );
  }
}

export async function buildMediaAssetManifest(root, reviewedManifest) {
  const mediaRoot = resolve(root, "docs/media");
  const files = (await mediaFiles(mediaRoot)).sort();
  const assets = await Promise.all(
    files.map(async (path) => {
      const [bytes, metadata] = await Promise.all([readFile(path), stat(path)]);
      const extension = [...MEDIA_TYPES.keys()].find((candidate) =>
        path.endsWith(candidate),
      );
      const assetPath = relative(root, path).split(sep).join("/");
      return {
        bytes: metadata.size,
        mediaType: MEDIA_TYPES.get(extension),
        path: assetPath,
        ...reviewedProvenance(reviewedManifest, assetPath),
        sha256: createHash("sha256").update(bytes).digest("hex"),
      };
    }),
  );
  return {
    assets,
    generatedFrom: "docs/media/**/*.png and docs/media/**/*.webm",
    rightsStatement:
      "First-party development evidence; final project license is pending.",
    schemaVersion: 1,
    verificationNote:
      "Hashes prove file identity. Perform a final visual/OCR/frame review for secrets, private data, and third-party marks before submission.",
  };
}

export function renderMediaAssetManifest(manifest) {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

export async function assertMediaAssetManifestCurrent(root, currentManifest) {
  const reviewedManifest = JSON.parse(currentManifest);
  assertMediaAssetProvenanceReviewed(reviewedManifest);
  const expected = renderMediaAssetManifest(
    await buildMediaAssetManifest(root, reviewedManifest),
  );
  if (currentManifest !== expected) {
    throw new Error(
      "docs/media/ASSET_MANIFEST.json is stale; run npm run media:manifest:generate",
    );
  }
}

const invokedAsScript =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (invokedAsScript) {
  const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
  const outputPath = resolve(repositoryRoot, "docs/media/ASSET_MANIFEST.json");
  const reviewedManifest = JSON.parse(await readFile(outputPath, "utf8"));
  if (process.argv[2] === "--check") {
    await assertMediaAssetManifestCurrent(
      repositoryRoot,
      await readFile(outputPath, "utf8"),
    );
    console.log("docs/media/ASSET_MANIFEST.json is current");
  } else {
    const temporaryPath = `${outputPath}.tmp`;
    const manifest = await buildMediaAssetManifest(
      repositoryRoot,
      reviewedManifest,
    );
    assertMediaAssetProvenanceReviewed(manifest);
    await writeFile(temporaryPath, renderMediaAssetManifest(manifest));
    await rename(temporaryPath, outputPath);
    console.log(`Wrote ${outputPath}`);
  }
}
