/**
 * @file prompt-builder.server.ts
 * @description Builds low-poly, collection-consistent Hunyuan prompts from persisted concepts.
 * @module asset-generation
 */
import type { AssetGenerationConceptRow } from "@/features/asset-generation/types";

/**
 * Shared collection style version written onto every generated asset lifecycle record.
 * @description Lets later prompt revisions coexist with older generated assets without losing provenance.
 */
export const HUNYUAN_STYLE_VERSION = "low-poly-v1";

/**
 * Shared style block appended to every Hunyuan request.
 * @description Centralizes the low-poly art direction so all generated objects remain visually cohesive across the set.
 */
export const SHARED_STYLE_BLOCK = [
  "low poly",
  "stylized",
  "simple geometric forms",
  "cohesive visual language across the whole set",
  "game-friendly",
  "single central object",
  "clean silhouette",
  "no photorealism",
  "no realistic detailing",
  "no hyper-detailed surfaces",
  "no cluttered background",
  "no complex scene composition",
].join(", ");

/**
 * Builds a single Hunyuan prompt for one concept.
 * @param concept - Persisted concept row with a ready metaphor.
 * @returns A strongly constrained 3D generation prompt with the shared collection style baked in.
 * @remarks Throws when a concept is not ready for generation so the worker does not submit meaningless jobs.
 */
export function buildHunyuanPrompt(concept: AssetGenerationConceptRow) {
  if (!concept.metaphor || concept.metaphor.status !== "ready") {
    throw new Error("Concept is missing a ready metaphor.");
  }

  return [
    "Generate one 3D object for a memory palace concept.",
    `Concept name: ${concept.name}.`,
    `Concept description: ${concept.description}.`,
    `Metaphor object: ${concept.metaphor.objectName}.`,
    `Metaphor rationale: ${concept.metaphor.rationale}.`,
    `Visual direction: ${concept.metaphor.prompt}.`,
    "The output must be a single central object only, with no scene, no environment, and no background clutter.",
    `All generated assets in this project must share the same collection style: ${SHARED_STYLE_BLOCK}.`,
    "Make this asset feel like it belongs to the same low-poly stylized game-ready set as every other generated asset.",
    "Do not create photoreal materials, realistic surface wear, dense micro-detailing, or multi-object compositions.",
  ].join(" ");
}
