import { extname } from "node:path";

import type {
  ArtifactTextExtractor,
  ExtractedArtifactText,
} from "@counterpoint/ports";
import { extractText } from "unpdf";

const NORMALIZED_CONTENT_TYPE = "text/plain; charset=utf-8";

const CONTENT_TYPE_BY_EXTENSION = new Map<string, string>([
  [".json", "application/json"],
  [".markdown", "text/markdown"],
  [".md", "text/markdown"],
  [".pdf", "application/pdf"],
  [".txt", "text/plain"],
]);

const SUPPORTED_CONTENT_TYPES = new Set(CONTENT_TYPE_BY_EXTENSION.values());

function validatedExtension(filename: string, contentType: string): string {
  const extension = extname(filename);
  const expectedContentType = CONTENT_TYPE_BY_EXTENSION.get(extension);

  if (expectedContentType === undefined) {
    if (SUPPORTED_CONTENT_TYPES.has(contentType)) {
      throw new Error(
        "Artifact filename extension and content type do not match",
      );
    }
    throw new Error("Artifact type is not supported");
  }

  if (contentType !== expectedContentType) {
    throw new Error(
      "Artifact filename extension and content type do not match",
    );
  }

  return extension;
}

function validateDerivedText(content: string): string {
  if (content.includes("\0")) {
    throw new Error("Artifact text contains unsupported NUL characters");
  }
  if (content.trim().length === 0) {
    throw new Error("Artifact does not contain extractable text");
  }
  return content;
}

function decodeText(bytes: Uint8Array): string {
  let content: string;
  try {
    content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("Text artifact is not valid UTF-8");
  }
  return validateDerivedText(content);
}

function hasPdfMagic(bytes: Uint8Array): boolean {
  return (
    bytes.byteLength >= 5 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46 &&
    bytes[4] === 0x2d
  );
}

export class NodeArtifactTextExtractor implements ArtifactTextExtractor {
  async extract(input: {
    readonly bytes: Uint8Array;
    readonly contentType: string;
    readonly filename: string;
  }): Promise<ExtractedArtifactText> {
    const extension = validatedExtension(input.filename, input.contentType);

    if (extension === ".pdf") {
      if (!hasPdfMagic(input.bytes)) {
        throw new Error("PDF artifact is invalid");
      }

      try {
        const result = await extractText(input.bytes.slice(), {
          mergePages: true,
        });
        return {
          content: validateDerivedText(result.text),
          contentType: NORMALIZED_CONTENT_TYPE,
          pages: result.totalPages,
        };
      } catch {
        throw new Error("PDF artifact could not be parsed");
      }
    }

    const content = decodeText(input.bytes);
    if (extension === ".json") {
      try {
        JSON.parse(content);
      } catch {
        throw new Error("JSON artifact is invalid");
      }
    }

    return {
      content,
      contentType: NORMALIZED_CONTENT_TYPE,
    };
  }
}
