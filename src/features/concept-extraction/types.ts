/**
 * @file types.ts
 * @description Shared transport types for the concept extraction feature.
 * @module concept-extraction
 */
/**
 * A study-worthy concept extracted from source material.
 * @description Keeps the transport format intentionally small so server functions return plain JSON.
 */
export type Concept = {
  name: string;
  description: string;
};

/**
 * Classifies pasted text before ingestion.
 * @description Lets callers preserve Quizlet term-definition structure instead of treating all pasted text as prose.
 */
export type TextFormat = "plain" | "quizlet";

/**
 * JSON-safe representation of a PDF source.
 * @description Uses strings instead of browser-only file objects so the feature can stay inside TanStack server function boundaries.
 */
export type PdfSource =
  | { kind: "url"; value: string }
  | { kind: "path"; value: string }
  | { kind: "base64"; value: string };

/**
 * Supported input payloads for concept extraction.
 * @description Discriminated union keeps validation strict while allowing text, PDF, and scraped URL flows to share one API.
 */
export type ExtractionInput =
  | { type: "text"; content: string; format?: TextFormat }
  | { type: "pdf"; source: PdfSource }
  | { type: "url"; url: string };

/**
 * JSON-serializable concept extraction result.
 * @description Alias exists to make server function signatures read as a feature contract instead of a raw array type.
 */
export type ConceptExtractionResult = Concept[];
