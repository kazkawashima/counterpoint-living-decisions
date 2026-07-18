import { lstat, mkdir, open, realpath, rename, unlink } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";

import type {
  ArtifactMetadata,
  ArtifactScope,
  ArtifactStore,
  ArtifactWrite,
} from "@counterpoint/ports";

interface ArtifactLocation {
  readonly path: string;
  readonly storageReference: string;
}

function validateSegment(value: string, label: string): void {
  if (
    value.length === 0 ||
    value === "." ||
    value === ".." ||
    value.includes("/") ||
    value.includes("\\") ||
    value.includes("\0") ||
    isAbsolute(value)
  ) {
    throw new TypeError(`${label} is not a safe path segment`);
  }
}

function validateScope(scope: ArtifactScope): void {
  validateSegment(scope.meetingId, "meetingId");
  validateSegment(scope.artifactId, "artifactId");
  if (
    (scope.visibility === "private" &&
      scope.ownerParticipantId === undefined) ||
    (scope.visibility === "shared" && scope.ownerParticipantId !== undefined)
  ) {
    throw new Error("Artifact visibility and owner scope do not agree");
  }
  if (scope.ownerParticipantId !== undefined) {
    validateSegment(scope.ownerParticipantId, "ownerParticipantId");
  }
}

function isWithinRoot(root: string, candidate: string): boolean {
  const pathFromRoot = relative(root, candidate);
  return (
    pathFromRoot === "" ||
    (!pathFromRoot.startsWith(`..${sep}`) &&
      pathFromRoot !== ".." &&
      !isAbsolute(pathFromRoot))
  );
}

async function readSafeFile(path: string): Promise<Uint8Array | undefined> {
  try {
    const stats = await lstat(path);
    if (stats.isSymbolicLink() || !stats.isFile()) {
      throw new Error("Artifact path is not a regular file");
    }
    const handle = await open(path, "r");
    try {
      return new Uint8Array(await handle.readFile());
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return undefined;
    }
    throw error;
  }
}

export class LocalArtifactStore implements ArtifactStore {
  readonly #configuredRoot: string;

  constructor(rootDirectory: string) {
    if (rootDirectory.length === 0) {
      throw new TypeError("Artifact root must not be empty");
    }
    this.#configuredRoot = resolve(rootDirectory);
  }

  async delete(scope: ArtifactScope): Promise<void> {
    const location = await this.#location(scope, false);
    if (location === undefined) {
      return;
    }
    const artifactPath = join(location.path, scope.artifactId);
    try {
      const stats = await lstat(artifactPath);
      if (stats.isSymbolicLink() || !stats.isFile()) {
        throw new Error("Artifact path is not a regular file");
      }
      await unlink(artifactPath);
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return;
      }
      throw error;
    }
  }

  async get(scope: ArtifactScope): Promise<Uint8Array | undefined> {
    const location = await this.#location(scope, false);
    return location === undefined
      ? undefined
      : readSafeFile(join(location.path, scope.artifactId));
  }

  async put(write: ArtifactWrite): Promise<ArtifactMetadata> {
    const bytes = write.bytes.slice();
    const location = await this.#location(write.scope, true);
    if (location === undefined) {
      throw new Error("Artifact directory could not be created");
    }
    const temporaryPath = join(
      location.path,
      `.${write.scope.artifactId}.${randomUUID()}.tmp`,
    );
    const targetPath = join(location.path, write.scope.artifactId);
    if (
      !isWithinRoot(await this.#root(), temporaryPath) ||
      !isWithinRoot(await this.#root(), targetPath)
    ) {
      throw new Error("Artifact path escapes its storage root");
    }

    let handle;
    try {
      handle = await open(temporaryPath, "wx", 0o600);
      await handle.writeFile(bytes);
      await handle.sync();
      await handle.close();
      handle = undefined;
      await rename(temporaryPath, targetPath);
    } catch (error) {
      await handle?.close().catch(() => undefined);
      await unlink(temporaryPath).catch(() => undefined);
      throw error;
    }

    return {
      ...write.scope,
      contentType: write.contentType,
      hash: write.hash,
      size: bytes.byteLength,
      storageReference: `${location.storageReference}/${write.scope.artifactId}`,
    };
  }

  async #location(
    scope: ArtifactScope,
    create: boolean,
  ): Promise<ArtifactLocation | undefined> {
    validateScope(scope);
    const segments =
      scope.visibility === "shared"
        ? ["meetings", scope.meetingId, "shared"]
        : [
            "meetings",
            scope.meetingId,
            "private",
            scope.ownerParticipantId ?? "",
          ];
    const root = await this.#root();
    let directory = root;

    for (const segment of segments) {
      const next = join(directory, segment);
      if (!isWithinRoot(root, next)) {
        throw new Error("Artifact path escapes its storage root");
      }
      try {
        const stats = await lstat(next);
        if (stats.isSymbolicLink() || !stats.isDirectory()) {
          throw new Error("Artifact directory path is not a safe directory");
        }
      } catch (error) {
        if (
          typeof error !== "object" ||
          error === null ||
          !("code" in error) ||
          error.code !== "ENOENT"
        ) {
          throw error;
        }
        if (!create) {
          return undefined;
        }
        await mkdir(next);
        const stats = await lstat(next);
        if (stats.isSymbolicLink() || !stats.isDirectory()) {
          throw new Error("Artifact directory path is not a safe directory", {
            cause: error,
          });
        }
      }
      directory = next;
    }

    return {
      path: directory,
      storageReference: segments.join("/"),
    };
  }

  async #root(): Promise<string> {
    await mkdir(this.#configuredRoot, { recursive: true });
    return realpath(this.#configuredRoot);
  }
}
