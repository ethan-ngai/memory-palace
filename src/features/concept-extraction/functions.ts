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
