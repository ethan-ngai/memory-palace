/**
 * @file functions.ts
 * @description Client-callable server functions for concept extraction.
 * @module concept-extraction
 */
import { createServerFn } from "@tanstack/react-start";
import { extractionInputSchema } from "@/features/concept-extraction/server/concept-extraction.schemas";
import { extractConceptsFromSource } from "@/features/concept-extraction/server/concept-extraction.server";

/**
 * Extracts study concepts from pasted text, a PDF source, or a URL.
 *
 * Usage from a component or hook:
 * `await extractConcepts({ data: { type: "text", content: studyText } })`
 *
 * Usage for a PDF URL:
 * `await extractConcepts({ data: { type: "pdf", source: { kind: "url", value: "https://example.com/chapter-3.pdf" } } })`
 */
export const extractConcepts = createServerFn({ method: "POST" })
  .inputValidator(extractionInputSchema)
  .handler(async ({ data }) => {
    return extractConceptsFromSource(data);
  });
