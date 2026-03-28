/**
 * @file functions.ts
 * @description Client-callable server functions for concept extraction.
 * @module concept-extraction
 */
import { extractionInputSchema } from "@/features/concept-extraction/server/concept-extraction.schemas";
import { extractConceptsFromSource } from "@/features/concept-extraction/server/concept-extraction.server";
import { createServerFn } from "@tanstack/react-start";
import {
  generateConceptMetaphorsForCurrentUser,
  generateConceptMetaphorsInputSchema,
} from "@/features/concept-extraction/server/concept-metaphor.server";
import {
  persistConceptsInputSchema,
  persistConceptsForCurrentUser,
} from "@/features/concept-extraction/server/concept-persistence.server";

/**
 * Persists already-extracted concepts for the current authenticated user.
 * @returns Stored concepts and updated room summaries after Gemini classification and MongoDB writes complete.
 * @remarks Keeps the first public API focused on persistence so raw extraction flows can be wired in separately later.
 */
export const persistConcepts = createServerFn({ method: "POST" })
  .inputValidator(persistConceptsInputSchema)
  .handler(async ({ data }) => {
    return persistConceptsForCurrentUser(data);
  });

/**
 * Generates or regenerates concept metaphors for the current authenticated user.
 * @returns Updated concepts whose current metaphor payloads are ready to serve as text-to-3D prompts.
 * @remarks Uses a batch contract so one endpoint can cover single-concept regeneration and generate-many flows.
 */
export const generateConceptMetaphors = createServerFn({ method: "POST" })
  .inputValidator(generateConceptMetaphorsInputSchema)
  .handler(async ({ data }) => {
    return generateConceptMetaphorsForCurrentUser(data);
  });

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
