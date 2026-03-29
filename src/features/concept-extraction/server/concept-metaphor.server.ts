/**
 * @file concept-metaphor.server.ts
 * @description Validates, generates, and persists concept metaphors for the authenticated user.
 * @module concept-extraction
 */
import { z } from "zod";
import { getMongoClient } from "@/lib/server/mongodb.server";
import { requireAuthUser } from "@/features/auth/server/auth-session.server";
import {
  findConceptsByIdsForUser,
  updateConceptMetaphorById,
} from "@/features/concept-extraction/server/concept.repository.server";
import { generateConceptMetaphorsWithGemini } from "@/features/concept-extraction/server/gemini-concept-metaphor.server";
import type {
  ConceptMetaphor,
  GenerateConceptMetaphorsInput,
  GenerateConceptMetaphorsResult,
  StoredConcept,
} from "@/features/concept-extraction/types";

/**
 * Developer-editable prompt template used for concept metaphor generation.
 * @description Lives in feature server code so developers can tune metaphor style and text-to-3D prompt quality without introducing user settings yet.
 */
export const CONCEPT_METAPHOR_PROMPT = `
You convert saved study concepts into concrete, memorable physical objects for a 3D memory palace.

Rules:
- Return one metaphor per concept.
- Choose a single visually distinctive physical object, not a full scene.
- Keep the metaphor aligned with the concept meaning, not just the room category.
- Make the prompt directly usable for a text-to-3D model as a simple object prompt.
- Keep both objectName and prompt short and concrete.
- Prefer common everyday object names like "battery", "turbine", "generator", or "conveyor belt".
- The prompt should usually be a plain noun phrase like "a battery" or "a conveyor belt".
- Do not add extra descriptive flourishes unless they are essential to the concept.
- Avoid colors, lighting, camera language, materials, textures, backgrounds, environments, and scene composition unless absolutely necessary.
- Avoid long descriptive sentences.
- Avoid adjectives like "large", "glowing", "futuristic", "ornate", "miniature", or "detailed" unless the concept absolutely depends on them.
- Avoid unsafe, abstract-only, or overly complex prompts.
- Return strict JSON only.
`;

/**
 * Stored metaphor schema exposed by concept server APIs.
 * @description Keeps the current metaphor payload explicit so later asset-generation code can rely on one stable shape.
 */
export const conceptMetaphorSchema = z.object({
  status: z.enum(["pending", "ready", "failed"]),
  objectName: z.string().trim().min(1),
  prompt: z.string().trim().min(1),
  rationale: z.string().trim().min(1),
  generatedAt: z.string().datetime().nullable(),
  errorMessage: z.string().trim().min(1).optional(),
});

export const generateConceptMetaphorsInputSchema = z.object({
  conceptIds: z.array(z.string().min(1)).min(1),
});

const geminiConceptMetaphorSchema = z.object({
  conceptId: z.string().min(1),
  objectName: z.string().trim().min(1),
  prompt: z.string().trim().min(1),
  rationale: z.string().trim().min(1),
});

/**
 * Validates concept ids for uniqueness before any database work begins.
 * @param conceptIds - Raw concept ids sent by the caller.
 * @returns The same ids when there are no duplicates.
 * @remarks The workflow fails fast because duplicate ids would make result coverage and request-order guarantees ambiguous.
 */
function validateUniqueConceptIds(conceptIds: string[]) {
  const uniqueIds = new Set(conceptIds);

  if (uniqueIds.size !== conceptIds.length) {
    throw new Error("Duplicate concept ids are not allowed.");
  }

  return conceptIds;
}

/**
 * Validates exact Gemini metaphor coverage for the requested concepts.
 * @param concepts - Stored concepts requested by the caller.
 * @param metaphors - Raw metaphor payloads returned by Gemini.
 * @returns Parsed metaphor payloads guaranteed to match the requested concepts one-for-one.
 * @remarks Rejects duplicates, omissions, and foreign ids before any concept updates occur.
 */
function validateMetaphorCoverage(concepts: StoredConcept[], metaphors: unknown[]) {
  if (metaphors.length !== concepts.length) {
    throw new Error("Gemini returned the wrong number of concept metaphors.");
  }

  const conceptIds = new Set(concepts.map((concept) => concept.id));
  const seen = new Set<string>();

  return metaphors.map((metaphor) => {
    const parsed = geminiConceptMetaphorSchema.parse(metaphor);

    if (!conceptIds.has(parsed.conceptId)) {
      throw new Error(`Gemini returned an unknown concept id "${parsed.conceptId}".`);
    }

    if (seen.has(parsed.conceptId)) {
      throw new Error(`Gemini returned a duplicate metaphor for concept "${parsed.conceptId}".`);
    }

    seen.add(parsed.conceptId);
    return parsed;
  });
}

/**
 * Removes article prefixes and trailing punctuation from one Gemini object label.
 * @param objectName - Raw object name returned by Gemini.
 * @returns A concise noun phrase suitable for reuse in both storage and prompt generation.
 * @remarks Normalizing here keeps downstream asset prompts stable even when Gemini returns title case or sentence-style labels.
 */
function normalizeObjectName(objectName: string) {
  return objectName
    .trim()
    .replace(/^[Aa]n?\s+/u, "")
    .replace(/[.!?,;:]+$/u, "")
    .replace(/\s+/gu, " ");
}

/**
 * Adds a simple indefinite article to one normalized object phrase.
 * @param objectPhrase - Plain noun phrase without a leading article.
 * @returns A short prompt such as `a battery` or `an energy turbine`.
 * @remarks The TRELLIS backend has been more reliable with plain object prompts than with embellished descriptive phrases.
 */
function toPlainObjectPrompt(objectPhrase: string) {
  const normalized = normalizeObjectName(objectPhrase);
  const article = /^[aeiou]/iu.test(normalized) ? "an" : "a";
  return `${article} ${normalized.toLowerCase()}`;
}

/**
 * Builds the current ready metaphor object written onto a concept document.
 * @param input - Gemini metaphor payload.
 * @returns The normalized current metaphor object.
 * @remarks Keeps the write model centralized so regeneration overwrites the current metaphor consistently.
 */
function toReadyMetaphor(input: {
  objectName: string;
  prompt: string;
  rationale: string;
}): ConceptMetaphor {
  const objectName = normalizeObjectName(input.objectName);

  return {
    status: "ready",
    objectName,
    prompt: toPlainObjectPrompt(objectName),
    rationale: input.rationale,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Generates or regenerates concept metaphors for the current authenticated user.
 * @param input - Stored concept ids whose current metaphors should be created or replaced.
 * @returns Updated stored concepts in the same order as the request payload.
 * @remarks Fails closed so malformed Gemini output or mixed-ownership requests cannot leave partially updated concept state behind.
 */
export async function generateConceptMetaphorsForCurrentUser(
  input: GenerateConceptMetaphorsInput,
): Promise<GenerateConceptMetaphorsResult> {
  const parsedInput = generateConceptMetaphorsInputSchema.parse(input);
  const conceptIds = validateUniqueConceptIds(parsedInput.conceptIds);
  const user = await requireAuthUser();
  return generateConceptMetaphorsForUser(user.id, { conceptIds });
}

/**
 * Generates or regenerates concept metaphors for one explicit user id.
 * @param userId - Local application user id that owns the concepts.
 * @param input - Stored concept ids whose current metaphors should be created or replaced.
 * @returns Updated stored concepts in the same order as the request payload.
 * @remarks Exported so manual server-side scripts can bootstrap concepts without a browser session.
 */
export async function generateConceptMetaphorsForUser(
  userId: string,
  input: GenerateConceptMetaphorsInput,
): Promise<GenerateConceptMetaphorsResult> {
  const parsedInput = generateConceptMetaphorsInputSchema.parse(input);
  const conceptIds = validateUniqueConceptIds(parsedInput.conceptIds);
  const concepts = await findConceptsByIdsForUser(userId, conceptIds);

  if (concepts.length !== conceptIds.length) {
    throw new Error("One or more requested concepts were not found for the current user.");
  }

  const metaphors = validateMetaphorCoverage(
    concepts,
    await generateConceptMetaphorsWithGemini({
      concepts,
      prompt: CONCEPT_METAPHOR_PROMPT,
    }),
  );
  const client = await getMongoClient();
  const session = client.startSession();

  try {
    const updatedConceptsById = new Map<string, StoredConcept>();

    await session.withTransaction(async () => {
      for (const metaphor of metaphors) {
        const readyMetaphor = conceptMetaphorSchema.parse(
          toReadyMetaphor({
            objectName: metaphor.objectName,
            prompt: metaphor.prompt,
            rationale: metaphor.rationale,
          }),
        );
        const updatedConcept = await updateConceptMetaphorById(
          {
            conceptId: metaphor.conceptId,
            metaphor: readyMetaphor,
          },
          session,
        );

        updatedConceptsById.set(updatedConcept.id, updatedConcept);
      }
    });

    return {
      concepts: conceptIds.map((conceptId) => {
        const concept = updatedConceptsById.get(conceptId);

        if (!concept) {
          throw new Error(`Concept ${conceptId} was not updated.`);
        }

        return concept;
      }),
    };
  } finally {
    await session.endSession();
  }
}
