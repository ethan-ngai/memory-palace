/**
 * @file concept-extraction.server.ts
 * @description Orchestrates ingestion, cleanup, and model extraction into a final concept array.
 * @module concept-extraction
 */
import { z } from "zod";
import { conceptArraySchema } from "@/features/concept-extraction/server/concept-extraction.schemas";
import { extractConceptsWithModel } from "@/features/concept-extraction/server/model-extractor.server";
import { ingestSource } from "@/features/concept-extraction/server/source-ingestion.server";
import {
  cleanText,
  dedupeConcepts,
} from "@/features/concept-extraction/server/text-cleaning.server";
import type { Concept, ExtractionInput } from "@/features/concept-extraction/types";

export {
  conceptArraySchema,
  extractionInputSchema,
} from "@/features/concept-extraction/server/concept-extraction.schemas";

function isConceptExtractionDebugEnabled() {
  return process.env.CONCEPT_EXTRACTION_DEBUG === "1";
}

function hasMeaningfulText(text: string) {
  if (text.trim().length === 0) {
    return false;
  }

  const tokens = text.trim().split(/\s+/);
  if (tokens.length === 1 && tokens[0].length < 4) {
    return false;
  }

  return true;
}

/**
 * Narrows unexpected lower-level failures to safe, caller-facing errors.
 * @param error - The thrown value from ingestion, cleanup, or model extraction.
 * @returns A normalized error with transport-safe messaging.
 * @remarks Keeps the server function contract predictable without leaking provider-specific or parser-internal details.
 */
function normalizeError(error: unknown) {
  if (error instanceof z.ZodError) {
    return new Error("Concept extraction input or model output failed validation.");
  }

  if (error instanceof Error) {
    return new Error(error.message);
  }

  return new Error("Concept extraction failed due to an unknown error.");
}

/**
 * Executes the full concept extraction pipeline for one input source.
 * @param input - Validated input describing pasted text or a PDF source.
 * @returns A deduplicated array of study concepts, or an empty array when the source has no meaningful material.
 * @remarks
 * - Cleans text before model submission so the active model prompt receives less UI noise and duplicate content.
 * - Treats weak or empty text as a non-error outcome because hackathon callers often submit partial sources.
 */
export async function extractConceptsFromSource(input: ExtractionInput): Promise<Concept[]> {
  try {
    const rawText = await ingestSource(input);
    const cleanedText = cleanText(rawText);

    if (isConceptExtractionDebugEnabled()) {
      console.log("[concept-extraction] cleaned text preview:");
      console.log(cleanedText.slice(0, 2000));
      console.log("[concept-extraction] cleaned text length:", cleanedText.length);
    }

    if (!hasMeaningfulText(cleanedText)) {
      return [];
    }

    const concepts = await extractConceptsWithModel(cleanedText, input);
    if (isConceptExtractionDebugEnabled()) {
      console.log("[concept-extraction] model concept count:", concepts.length);
    }
    return conceptArraySchema.parse(dedupeConcepts(concepts));
  } catch (error) {
    throw normalizeError(error);
  }
}
