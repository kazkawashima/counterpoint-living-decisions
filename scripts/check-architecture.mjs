import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const rootPath = fileURLToPath(new URL("../", import.meta.url));

const packageRules = new Map([
  [
    "domain",
    {
      allowedInternal: new Set(),
      allowedExternal: new Set(),
    },
  ],
  [
    "ports",
    {
      allowedInternal: new Set(["domain"]),
      allowedExternal: new Set(),
    },
  ],
  [
    "protocol",
    {
      allowedInternal: new Set(["domain"]),
      allowedExternal: new Set(["zod"]),
    },
  ],
  [
    "application",
    {
      allowedInternal: new Set(["domain", "ports", "protocol"]),
      allowedExternal: new Set(),
    },
  ],
  [
    "adapters-openai",
    {
      allowedInternal: new Set(["application", "ports"]),
      allowedExternal: new Set(["openai", "openai/helpers/zod", "zod"]),
    },
  ],
  [
    "adapters-cloudflare",
    {
      allowedInternal: new Set(["application", "domain", "ports", "protocol"]),
      allowedExternal: new Set(),
    },
  ],
  [
    "worker",
    {
      allowedInternal: new Set([
        "adapters-cloudflare",
        "application",
        "domain",
        "ports",
        "protocol",
      ]),
      allowedExternal: new Set(["cloudflare:workers"]),
    },
  ],
]);

const importPattern = /(?:from\s*|import\s*\(\s*|import\s*)["']([^"']+)["']/gu;

async function listSourceFiles(directory) {
  const files = [];

  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolutePath = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listSourceFiles(absolutePath)));
    } else if ([".ts", ".tsx"].includes(extname(entry.name))) {
      files.push(absolutePath);
    }
  }

  return files;
}

export function findArchitectureViolations({
  packageName,
  source,
  sourcePath,
}) {
  const rule = packageRules.get(packageName);
  if (rule === undefined) {
    return [];
  }

  const violations = [];
  for (const match of source.matchAll(importPattern)) {
    const specifier = match[1];
    if (specifier === undefined) {
      continue;
    }

    const internalMatch = /^@counterpoint\/([^/]+)$/u.exec(specifier);
    if (
      internalMatch?.[1] !== undefined &&
      !rule.allowedInternal.has(internalMatch[1])
    ) {
      violations.push(
        `${sourcePath}: ${packageName} cannot import ${specifier}`,
      );
    }

    const isRelative =
      specifier.startsWith("./") || specifier.startsWith("../");
    const isInternal = internalMatch !== null;
    if (!isRelative && !isInternal && !rule.allowedExternal.has(specifier)) {
      violations.push(
        `${sourcePath}: ${packageName} cannot import runtime dependency ${specifier}`,
      );
    }
  }

  return violations;
}

export async function checkArchitecture(repositoryRoot = rootPath) {
  const violations = [];

  for (const packageName of packageRules.keys()) {
    const sourceDirectory =
      packageName === "worker"
        ? resolve(repositoryRoot, "apps", "worker", "src")
        : resolve(repositoryRoot, "packages", packageName, "src");
    for (const sourceFile of await listSourceFiles(sourceDirectory)) {
      violations.push(
        ...findArchitectureViolations({
          packageName,
          source: await readFile(sourceFile, "utf8"),
          sourcePath: relative(repositoryRoot, sourceFile),
        }),
      );
    }
  }

  return violations;
}

const invokedAsScript =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (invokedAsScript) {
  const violations = await checkArchitecture();
  if (violations.length > 0) {
    console.error(violations.join("\n"));
    process.exitCode = 1;
  } else {
    console.log("Architecture dependency boundaries are valid.");
  }
}
