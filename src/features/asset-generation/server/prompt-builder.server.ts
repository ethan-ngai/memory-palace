/**
 * @file prompt-builder.server.ts
 * @description Builds short object-first prompts for text-to-3D generation.
 * @module asset-generation
 */
import type { AssetGenerationConceptRow } from "@/features/asset-generation/types";

/**
 * Shared collection style version written onto every generated asset lifecycle record.
 * @description Lets later prompt revisions coexist with older generated assets without losing provenance.
 */
export const ASSET_STYLE_VERSION = "standard-3d-v3";

/**
 * Shared style suffix appended when the core object prompt is short enough.
 * @description Keeps the live TRELLIS prompt focused on a centered object shot without bloating the request.
 */
export const SHARED_STYLE_BLOCK = "isolated single object, white background";

/**
 * Removes noisy punctuation so the generation prompt stays compact and legible.
 * @param value - Candidate object phrase from the metaphor or concept metadata.
 * @returns A cleaned one-line phrase suitable for text-to-image prompting.
 * @remarks The active provider responds best to concise object phrases, so only the first simple clause is kept.
 */
function normalizePromptFragment(value: string) {
  return (
    value
      .split(/[.!?\n]/u)[0]
      ?.trim()
      .replace(/\s+/gu, " ")
      .replace(/,$/u, "") ?? ""
  );
}

/**
 * Builds a single 3D generation prompt for one concept.
 * @param concept - Persisted concept row with a ready metaphor.
 * @returns A concise object prompt tailored to the current live TRELLIS endpoint.
 * @remarks Throws when a concept is not ready for generation so the worker does not submit meaningless jobs.
 */
export function buildAssetGenerationPrompt(concept: AssetGenerationConceptRow) {
  if (!concept.metaphor || concept.metaphor.status !== "ready") {
    throw new Error("Concept is missing a ready metaphor.");
  }

  const primaryPrompt =
    normalizePromptFragment(concept.metaphor.prompt) ||
    normalizePromptFragment(concept.metaphor.objectName) ||
    normalizePromptFragment(concept.name);

  const styledPrompt = `${primaryPrompt}, ${SHARED_STYLE_BLOCK}`;

  return styledPrompt.length <= 60 ? styledPrompt : primaryPrompt;
}
