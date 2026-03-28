/**
 * @file gemini-concept-metaphor.server.ts
 * @description Calls Gemini to convert stored concepts into concrete metaphor prompts for 3D generation.
 * @module concept-extraction
 */
import { z } from "zod";
import { getServerEnv } from "@/lib/env/server";
import type { StoredConcept } from "@/features/concept-extraction/types";

const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";

/**
 * Strict metaphor payload returned by Gemini for one stored concept.
 * @description Keeps concept identity attached to the metaphor so the orchestration layer can validate exact coverage.
 */
export type GeminiConceptMetaphor = {
  conceptId: string;
  objectName: string;
  prompt: string;
  rationale: string;
};

const geminiConceptMetaphorSchema = z.object({
  conceptId: z.string().min(1),
  objectName: z.string().trim().min(1),
  prompt: z.string().trim().min(1),
  rationale: z.string().trim().min(1),
});

const geminiConceptMetaphorResponseSchema = z.object({
  metaphors: z.array(geminiConceptMetaphorSchema),
});

/**
 * Builds the Gemini prompt used to derive concrete metaphor objects and text-to-3D prompts.
 * @param input - Stored concepts plus the developer-authored prompt template.
 * @returns A plain-text instruction payload that requests strict JSON only.
 * @remarks Keeps prompt construction isolated so prompt tuning does not spill into transport validation logic.
 */
function buildPrompt(input: { concepts: StoredConcept[]; prompt: string }) {
  return [
    input.prompt.trim(),
    "",
    "Return JSON only with this shape:",
    '{ "metaphors": [{ "conceptId": "...", "objectName": "...", "prompt": "...", "rationale": "..." }] }',
    "",
    "Concepts to translate into concrete physical metaphors:",
    JSON.stringify(input.concepts, null, 2),
  ].join("\n");
}

/**
 * Extracts the first text part from Gemini's REST payload.
 * @param payload - Raw JSON returned by the Gemini generateContent endpoint.
 * @returns The first non-empty text part or null when the response shape is unusable.
 * @remarks Matches the same response traversal strategy used by room classification to keep Gemini integration behavior consistent.
 */
function extractTextFromGeminiPayload(payload: unknown) {
  const result = z
    .object({
      candidates: z
        .array(
          z.object({
            content: z.object({
              parts: z.array(
                z.object({
                  text: z.string().optional(),
                }),
              ),
            }),
          }),
        )
        .min(1),
    })
    .safeParse(payload);

  if (!result.success) {
    return null;
  }

  for (const part of result.data.candidates[0].content.parts) {
    if (typeof part.text === "string" && part.text.trim().length > 0) {
      return part.text;
    }
  }

  return null;
}

/**
 * Removes markdown code fences from a Gemini response before JSON parsing.
 * @param rawText - Raw model text.
 * @returns A trimmed JSON candidate string.
 * @remarks Keeps the parser resilient to occasional markdown wrapping without weakening schema validation.
 */
function stripCodeFences(rawText: string) {
  const trimmed = rawText.trim();

  if (trimmed.startsWith("```")) {
    return trimmed
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "")
      .trim();
  }

  return trimmed;
}

/**
 * Calls Gemini to generate concrete metaphor prompts for stored concepts.
 * @param input - Stored concepts and the developer-editable metaphor prompt template.
 * @returns Strictly validated metaphor payloads, one per concept.
 * @remarks Throws on malformed model output so concept documents are not updated with partial or ambiguous metaphor state.
 */
export async function generateConceptMetaphorsWithGemini(input: {
  concepts: StoredConcept[];
  prompt: string;
}) {
  const serverEnv = getServerEnv();
  const model = serverEnv.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
  const apiKey = serverEnv.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is required when AI_PROVIDER is gemini.");
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        generationConfig: {
          responseMimeType: "application/json",
        },
        contents: [
          {
            role: "user",
            parts: [{ text: buildPrompt(input) }],
          },
        ],
      }),
    },
  );

  if (!response.ok) {
    throw new Error(`Gemini concept metaphor generation failed with status ${response.status}.`);
  }

  const payload = (await response.json()) as unknown;
  const text = extractTextFromGeminiPayload(payload);

  if (!text) {
    throw new Error("Gemini concept metaphor generation did not return text content.");
  }

  const parsedJson = JSON.parse(stripCodeFences(text)) as unknown;
  const parsed = geminiConceptMetaphorResponseSchema.parse(parsedJson);

  return parsed.metaphors as GeminiConceptMetaphor[];
}
