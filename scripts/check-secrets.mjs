import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { basename, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";

const execFileAsync = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const MAX_SCANNED_FILE_BYTES = 2 * 1024 * 1024;

const secretPatterns = [
  {
    name: "OpenAI API key",
    pattern: /\bsk-(?:(?:proj|svcacct)-[A-Za-z0-9_-]{20,}|[A-Za-z0-9]{32,})\b/u,
  },
  {
    name: "private key",
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u,
  },
  {
    name: "GitHub token",
    pattern: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/u,
  },
  {
    name: "Slack token",
    pattern: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/u,
  },
  {
    name: "AWS access key",
    pattern: /\bAKIA[A-Z0-9]{16}\b/u,
  },
  {
    name: "Bearer JWT",
    pattern:
      /\bBearer\s+[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/u,
  },
];

function isForbiddenSecretPath(path) {
  const name = basename(path);
  if (name === ".env.example" || name === ".dev.vars.example") {
    return false;
  }
  return (
    name === ".env" ||
    name.startsWith(".env.") ||
    name === ".dev.vars" ||
    name.startsWith(".dev.vars.") ||
    name.endsWith(".pem") ||
    name.endsWith(".key")
  );
}

function isBinary(content) {
  return content.includes(0);
}

export function findSecretViolations(entries) {
  const violations = [];
  for (const { content, path } of entries) {
    if (isForbiddenSecretPath(path)) {
      violations.push({ path, rule: "tracked secret-bearing filename" });
    }
    if (content.byteLength > MAX_SCANNED_FILE_BYTES || isBinary(content)) {
      continue;
    }
    const text = content.toString("utf8");
    for (const { name, pattern } of secretPatterns) {
      if (pattern.test(text)) {
        violations.push({ path, rule: name });
      }
    }
  }
  return violations;
}

async function repositoryPaths(root) {
  const { stdout } = await execFileAsync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    {
      cwd: root,
      encoding: "buffer",
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  return stdout
    .toString("utf8")
    .split("\0")
    .filter((path) => path.length > 0);
}

async function filesBelow(root, directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
  const nested = await Promise.all(
    entries.map((entry) => {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        return filesBelow(root, path);
      }
      return Promise.resolve(entry.isFile() ? [relative(root, path)] : []);
    }),
  );
  return nested.flat();
}

async function generatedOutputPaths(root) {
  const workspaceRoots = await Promise.all(
    ["apps", "packages"].map(async (workspaceDirectory) => {
      const directory = resolve(root, workspaceDirectory);
      let entries;
      try {
        entries = await readdir(directory, { withFileTypes: true });
      } catch (error) {
        if (
          error instanceof Error &&
          "code" in error &&
          error.code === "ENOENT"
        ) {
          return [];
        }
        throw error;
      }
      return Promise.all(
        entries
          .filter((entry) => entry.isDirectory())
          .map((entry) =>
            filesBelow(root, resolve(directory, entry.name, "dist")),
          ),
      );
    }),
  );
  return workspaceRoots.flat(2);
}

export async function checkRepositoryFilesForSecrets(root = repositoryRoot) {
  const paths = [
    ...new Set([
      ...(await repositoryPaths(root)),
      ...(await generatedOutputPaths(root)),
    ]),
  ];
  const entries = await Promise.all(
    paths.map(async (path) => ({
      content: await readFile(resolve(root, path)),
      path,
    })),
  );
  return findSecretViolations(entries);
}

const invokedAsScript =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (invokedAsScript) {
  const violations = await checkRepositoryFilesForSecrets();
  if (violations.length > 0) {
    for (const { path, rule } of violations) {
      console.error(`${path}: ${rule}`);
    }
    process.exitCode = 1;
  } else {
    console.log(
      "Repository and generated-output secret scan passed; no secret values were printed.",
    );
  }
}
