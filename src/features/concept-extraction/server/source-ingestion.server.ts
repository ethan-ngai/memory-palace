/**
 * @file source-ingestion.server.ts
 * @description Routes validated extraction inputs to the appropriate ingestion strategy.
 * @module concept-extraction
 */
import { extractRawTextFromPdfSource } from "@/features/concept-extraction/server/pdf-text.server";
import type { ExtractionInput } from "@/features/concept-extraction/types";

/**
 * Resolves any supported input into raw text for cleanup and model extraction.
 * @param input - Validated extraction input from the server function boundary.
 * @returns Raw textual study material ready for normalization.
 * @remarks Keeps transport-specific work out of the orchestration layer so scraping, PDF parsing, and direct text flows remain independently testable.
 */
export async function ingestSource(input: ExtractionInput) {
  switch (input.type) {
    case "text":
      return input.content;
    case "pdf":
      return extractRawTextFromPdfSource(input.source);
    case "url": {
      const response = await fetch(input.url);

      if (!response.ok) {
        throw new Error(`Failed to fetch study text from URL with status ${response.status}.`);
      }

      return response.text();
    }
  }
}
