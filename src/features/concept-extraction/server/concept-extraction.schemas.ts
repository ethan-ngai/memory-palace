/**
 * @file concept-extraction.schemas.ts
 * @description Shared Zod schemas for concept extraction inputs and outputs.
 * @module concept-extraction
 */
import { z } from "zod";

/**
 * Validates one extracted concept.
 * @description Enforces non-empty transport fields before results leave the server boundary.
 */
export const conceptSchema = z.object({
  name: z.string().trim().min(1),
  description: z.string().trim().min(1),
});

/**
 * Validates the final JSON payload returned to callers.
 * @description Shared between the orchestration layer and the model adapter so repaired output still obeys the same contract.
 */
export const conceptArraySchema = z.array(conceptSchema);

/**
 * Validates JSON-safe PDF source descriptors.
 * @description The API intentionally avoids `File` objects because server function transports are more predictable with strings.
 */
export const pdfSourceSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("url"),
    value: z.string().url(),
  }),
  z.object({
    kind: z.literal("path"),
    value: z.string().min(1),
  }),
  z.object({
    kind: z.literal("base64"),
    value: z.string().min(1),
  }),
]);

/**
 * Validates every public input shape accepted by `extractConcepts`.
 * @description The discriminated union keeps each ingestion path explicit and prevents ambiguous hybrid payloads.
 */
export const extractionInputSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("text"),
    content: z.string().min(1),
  }),
  z.object({
    type: z.literal("pdf"),
    source: pdfSourceSchema,
  }),
]);
