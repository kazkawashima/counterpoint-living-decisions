import { NodeArtifactTextExtractor } from "@counterpoint/adapters-node";
import type { ArtifactTextExtractor } from "@counterpoint/ports";
import { describe, expect, it } from "vitest";

const encoder = new TextEncoder();
const NORMALIZED_CONTENT_TYPE = "text/plain; charset=utf-8";

function createOnePagePdf(text: string): Uint8Array {
  const stream = `BT\n/F1 12 Tf\n72 720 Td\n(${text}) Tj\nET\n`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${encoder.encode(stream).byteLength} >>\nstream\n${stream}endstream`,
  ];

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(encoder.encode(pdf).byteLength);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }

  const xrefOffset = encoder.encode(pdf).byteLength;
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (const offset of offsets.slice(1)) {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
  pdf += `startxref\n${xrefOffset}\n%%EOF\n`;

  return encoder.encode(pdf);
}

describe("NodeArtifactTextExtractor", () => {
  it.each([
    ["notes.md", "text/markdown", "# Decision\nKeep the pilot small."],
    ["notes.markdown", "text/markdown", "## Evidence\nSynthetic only."],
    ["notes.txt", "text/plain", "Plain UTF-8 text: 日本語"],
    ["decision.json", "application/json", '{"status":"proposed"}'],
  ])(
    "extracts supported text from %s",
    async (filename, contentType, content) => {
      const extractor: ArtifactTextExtractor = new NodeArtifactTextExtractor();

      await expect(
        extractor.extract({
          bytes: encoder.encode(content),
          contentType,
          filename,
        }),
      ).resolves.toEqual({
        content,
        contentType: NORMALIZED_CONTENT_TYPE,
      });
    },
  );

  it("extracts merged text and page count from a valid PDF", async () => {
    const extractor = new NodeArtifactTextExtractor();

    await expect(
      extractor.extract({
        bytes: createOnePagePdf("Counterpoint PDF evidence"),
        contentType: "application/pdf",
        filename: "evidence.pdf",
      }),
    ).resolves.toEqual({
      content: "Counterpoint PDF evidence",
      contentType: NORMALIZED_CONTENT_TYPE,
      pages: 1,
    });
  });

  it.each([
    ["evidence.pdf", "application/json"],
    ["evidence.bin", "application/pdf"],
    ["notes.md", "text/plain"],
    ["notes.txt", "text/markdown"],
  ])("rejects mismatched %s and %s", async (filename, contentType) => {
    const extractor = new NodeArtifactTextExtractor();

    await expect(
      extractor.extract({
        bytes: encoder.encode("synthetic content"),
        contentType,
        filename,
      }),
    ).rejects.toThrow(
      "Artifact filename extension and content type do not match",
    );
  });

  it("rejects unsupported artifact types", async () => {
    const extractor = new NodeArtifactTextExtractor();

    await expect(
      extractor.extract({
        bytes: encoder.encode("a,b\n1,2"),
        contentType: "text/csv",
        filename: "table.csv",
      }),
    ).rejects.toThrow("Artifact type is not supported");
  });

  it("rejects invalid UTF-8, NUL, and whitespace-only text", async () => {
    const extractor = new NodeArtifactTextExtractor();

    await expect(
      extractor.extract({
        bytes: Uint8Array.from([0xc3, 0x28]),
        contentType: "text/plain",
        filename: "invalid.txt",
      }),
    ).rejects.toThrow("Text artifact is not valid UTF-8");

    await expect(
      extractor.extract({
        bytes: encoder.encode("before\0after"),
        contentType: "text/markdown",
        filename: "nul.md",
      }),
    ).rejects.toThrow("Artifact text contains unsupported NUL characters");

    await expect(
      extractor.extract({
        bytes: encoder.encode(" \n\t"),
        contentType: "text/plain",
        filename: "empty.txt",
      }),
    ).rejects.toThrow("Artifact does not contain extractable text");
  });

  it("rejects invalid JSON without exposing its content", async () => {
    const extractor = new NodeArtifactTextExtractor();
    const sensitiveContent = '{"private":"do-not-leak",}';

    let thrown: unknown;
    try {
      await extractor.extract({
        bytes: encoder.encode(sensitiveContent),
        contentType: "application/json",
        filename: "private.json",
      });
    } catch (error) {
      thrown = error;
    }

    expect(String(thrown)).toContain("JSON artifact is invalid");
    expect(String(thrown)).not.toContain(sensitiveContent);
    expect(String(thrown)).not.toContain("do-not-leak");
  });

  it("rejects missing PDF magic and malformed PDFs with safe errors", async () => {
    const extractor = new NodeArtifactTextExtractor();
    const sensitiveContent = "do-not-leak";

    await expect(
      extractor.extract({
        bytes: encoder.encode(sensitiveContent),
        contentType: "application/pdf",
        filename: "not-a-pdf.pdf",
      }),
    ).rejects.toThrow("PDF artifact is invalid");

    let thrown: unknown;
    try {
      await extractor.extract({
        bytes: encoder.encode(`%PDF-${sensitiveContent}`),
        contentType: "application/pdf",
        filename: "malformed.pdf",
      });
    } catch (error) {
      thrown = error;
    }

    expect(String(thrown)).toContain("PDF artifact could not be parsed");
    expect(String(thrown)).not.toContain(sensitiveContent);
  });
});
