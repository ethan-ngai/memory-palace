/**
 * @file pdf-text.server.ts
 * @description Resolves PDF bytes from supported inputs and extracts plain text from them.
 * @module concept-extraction
 */
import { readFile } from "node:fs/promises";
import type { PdfSource } from "@/features/concept-extraction/types";

type PdfParseResult = {
  text?: string;
};

function decodeBase64Pdf(value: string) {
  const base64Payload = value.replace(/^data:application\/pdf;base64,/i, "");
  return Buffer.from(base64Payload, "base64");
}

/**
 * Resolves a PDF source descriptor into bytes.
 * @param source - JSON-safe PDF source metadata from the public API.
 * @returns The PDF contents as a `Buffer`.
 * @remarks Centralizes the transport branching so parsing logic can stay agnostic to where the file came from.
 */
async function getPdfBuffer(source: PdfSource) {
  switch (source.kind) {
    case "base64":
      return decodeBase64Pdf(source.value);
    case "path":
      return readFile(source.value);
    case "url": {
      const response = await fetch(source.value);
      if (!response.ok) {
        throw new Error(`PDF fetch failed with status ${response.status}.`);
      }

      const arrayBuffer = await response.arrayBuffer();
      return Buffer.from(arrayBuffer);
    }
  }
}

/**
 * Extracts plain text from a PDF source.
 * @param source - JSON-safe PDF source descriptor.
 * @returns Extracted PDF text trimmed for downstream cleanup.
 * @remarks Uses a Node PDF parser because direct document extraction is more reliable than browser-driven rendering for this feature.
 */
export async function extractRawTextFromPdfSource(source: PdfSource) {
  try {
    const pdfBuffer = await getPdfBuffer(source);
    const pdfParseModule = await import("pdf-parse");
    const pdfParse = ("default" in pdfParseModule ? pdfParseModule.default : pdfParseModule) as (
      buffer: Buffer,
    ) => Promise<PdfParseResult>;
    const result = await pdfParse(pdfBuffer);

    return (result.text ?? "").trim();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown PDF parsing failure.";
    throw new Error(`Unable to extract text from PDF source. ${message}`);
  }
}
