/**
 * @file gemini-room-classifier.server.ts
 * @description Calls Gemini to decide whether each concept belongs in an existing room or requires a new room.
 * @module concept-extraction
 */
import { z } from "zod";
import { getServerEnv } from "@/lib/env/server";
import type { ExtractedConcept, RoomSummary } from "@/features/concept-extraction/types";

const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";

/**
 * Structured room classification for one extracted concept.
 * @description Matches the strict JSON contract the orchestration layer expects back from Gemini.
 */
export type GeminiRoomDecision =
  | {
      conceptName: string;
      decisionType: "existing";
      roomId?: string;
      roomSlug?: string;
    }
  | {
      conceptName: string;
      decisionType: "new";
      roomName: string;
      roomDescription?: string;
    };

const geminiExistingDecisionSchema = z.object({
  conceptName: z.string().min(1),
  decisionType: z.literal("existing"),
  roomId: z.string().min(1).optional(),
  roomSlug: z.string().min(1).optional(),
});

const geminiNewDecisionSchema = z.object({
  conceptName: z.string().min(1),
  decisionType: z.literal("new"),
  roomName: z.string().min(1),
  roomDescription: z.string().min(1).optional(),
});

const geminiDecisionSchema = z.discriminatedUnion("decisionType", [
  geminiExistingDecisionSchema.superRefine((value, context) => {
    if (!value.roomId && !value.roomSlug) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Existing-room decisions must include a roomId or roomSlug.",
      });
    }
  }),
  geminiNewDecisionSchema,
]);

const geminiResponseSchema = z.object({
  assignments: z.array(geminiDecisionSchema),
});

/**
 * Builds the JSON request body for Gemini room classification.
 * @param input - Concepts, existing rooms, and the developer-authored prompt template.
 * @returns A concise prompt payload that tells Gemini to return strict JSON only.
 * @remarks Keeps prompt construction in one helper so tests can focus on the normalization contract instead of string assembly noise.
 */
function buildPrompt(input: {
  concepts: ExtractedConcept[];
  existingRooms: RoomSummary[];
  prompt: string;
}) {
  return [
    input.prompt.trim(),
    "",
    "Return JSON only with this shape:",
    '{ "assignments": [{ "conceptName": "...", "decisionType": "existing", "roomId": "...", "roomSlug": "..." } | { "conceptName": "...", "decisionType": "new", "roomName": "...", "roomDescription": "..." }] }',
    "",
    "Existing rooms:",
    JSON.stringify(input.existingRooms, null, 2),
    "",
    "Concepts to classify:",
    JSON.stringify(input.concepts, null, 2),
  ].join("\n");
}

/**
 * Extracts a plain text candidate from the Gemini REST response shape.
 * @param payload - Raw JSON returned by the Gemini generateContent endpoint.
 * @returns The first text part when present, otherwise null.
 * @remarks The REST API nests content deeply, so this helper keeps the fetch path readable and testable.
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
 * Removes common code-fence wrappers before JSON parsing.
 * @param rawText - Raw model text which may still be wrapped in markdown fences despite explicit instructions.
 * @returns A trimmed JSON candidate string.
 * @remarks Defensive cleanup makes the classifier more resilient without loosening the downstream schema validation.
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
 * Calls Gemini and validates one room decision per concept.
 * @param input - Concepts, existing user rooms, and the developer-editable prompt constant.
 * @returns Strictly validated room decisions in the same order Gemini returned them.
 * @remarks Throws on malformed model output so the persistence workflow fails closed before any MongoDB writes occur.
 */
export async function classifyConceptRoomsWithGemini(input: {
  concepts: ExtractedConcept[];
  existingRooms: RoomSummary[];
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
    throw new Error(`Gemini room classification failed with status ${response.status}.`);
  }

  const payload = (await response.json()) as unknown;
  const text = extractTextFromGeminiPayload(payload);

  if (!text) {
    throw new Error("Gemini room classification did not return text content.");
  }

  const parsedJson = JSON.parse(stripCodeFences(text)) as unknown;
  const parsed = geminiResponseSchema.parse(parsedJson);

  return parsed.assignments as GeminiRoomDecision[];
}
