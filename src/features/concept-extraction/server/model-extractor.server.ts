/**
 * @file model-extractor.server.ts
 * @description Sends cleaned study material to the configured model provider and repairs structured output when possible.
 * @module concept-extraction
 */
import { z } from "zod";
import { getServerEnv } from "@/lib/env/server";
import { conceptArraySchema } from "@/features/concept-extraction/server/concept-extraction.schemas";
import type { Concept, ExtractionInput } from "@/features/concept-extraction/types";

type OpenAICompatibleResponse = {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
  }>;
};

type GeminiResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
  }>;
};

type ModelProvider = "gemini" | "openai-compatible";

/**
 * Prompt used for concept extraction regardless of the backing provider.
 * @description Keeping one prompt string avoids provider drift and makes a later K2 cutover a configuration change instead of a prompt rewrite.
 */
export const CONCEPT_EXTRACTION_PROMPT = `
You are extracting study concepts from source material.

Return only valid JSON.
The JSON must be an array of objects with this exact shape:
[
  {
    "name": "Concept name",
    "description": "Clear explanation of the concept"
  }
]

Rules:
- Extract every important concept, term, keyword, principle, process, formula, or idea needed for studying.
- Preserve important terminology exactly when possible.
- Descriptions must be concise, accurate, and useful for memorization.
- Avoid duplicates and near-duplicates.
- Do not include filler concepts, UI text, navigation text, or source metadata.
- If the material contains no meaningful study concepts, return [].
- Do not wrap the JSON in markdown fences.
`;

const openAICompatibleResponseSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({
          content: z.union([
            z.string(),
            z.array(
              z.object({
                type: z.string().optional(),
                text: z.string().optional(),
              }),
            ),
          ]),
        }),
      }),
    )
    .min(1),
});

const geminiResponseSchema = z.object({
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
});

/**
 * Derives lightweight source context for the model prompt.
 * @param input - Original extraction input before ingestion.
 * @returns A short human-readable label describing where the study text came from.
 * @remarks The prompt uses this hint to distinguish direct text from parsed PDF content without creating separate model logic.
 */
function getSourceContext(input: ExtractionInput) {
  switch (input.type) {
    case "text":
      return "pasted raw text";
    case "pdf":
      return `PDF (${input.source.kind})`;
  }
}

/**
 * Builds the user-facing prompt body shared by all providers.
 * @param cleanedText - Source text after scraping and normalization.
 * @param input - Original extraction input used for context hints.
 * @returns Prompt text to send as the main user turn.
 */
function buildUserPrompt(cleanedText: string, input: ExtractionInput) {
  return [
    `Source type: ${getSourceContext(input)}`,
    "Extract all study-worthy concepts from the material below.",
    "",
    "<study_material>",
    cleanedText,
    "</study_material>",
  ].join("\n");
}

/**
 * Extracts a text payload from an OpenAI-compatible chat completion response.
 * @param payload - Raw provider response body.
 * @returns Flattened textual content suitable for JSON repair and validation.
 */
function getOpenAICompatibleMessageContent(payload: OpenAICompatibleResponse) {
  const parsed = openAICompatibleResponseSchema.parse(payload);
  const content = parsed.choices[0].message.content;

  if (typeof content === "string") {
    return content;
  }

  return content
    .map((part) => part.text ?? "")
    .join("")
    .trim();
}

/**
 * Extracts generated text from a Gemini `generateContent` response.
 * @param payload - Raw Gemini response body.
 * @returns Concatenated textual content from the first candidate.
 * @remarks Google documents `candidates[].content.parts[].text` as the standard text path for REST responses.
 */
function getGeminiMessageContent(payload: GeminiResponse) {
  const parsed = geminiResponseSchema.parse(payload);

  return parsed.candidates[0].content.parts
    .map((part) => part.text ?? "")
    .join("")
    .trim();
}

function tryParseConceptArray(raw: string) {
  const direct = conceptArraySchema.safeParse(JSON.parse(raw));
  if (direct.success) {
    return direct.data;
  }

  return null;
}

function extractFirstJsonArray(raw: string) {
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");

  if (start === -1 || end === -1 || end < start) {
    return null;
  }

  return raw.slice(start, end + 1);
}

/**
 * Filters parsed JSON down to valid concept rows.
 * @param payload - JSON parsed from the model response or repair path.
 * @returns A schema-validated concept array containing only usable rows.
 * @remarks Some providers emit partially correct arrays; filtering lets the feature recover instead of failing the entire request.
 */
function normalizeConceptRows(payload: unknown): Concept[] {
  if (!Array.isArray(payload)) {
    return [];
  }

  const normalized = payload.flatMap((item) => {
    if (!item || typeof item !== "object") {
      return [];
    }

    const name = "name" in item && typeof item.name === "string" ? item.name.trim() : "";
    const description =
      "description" in item && typeof item.description === "string" ? item.description.trim() : "";

    if (!name || !description) {
      return [];
    }

    return [{ name, description }];
  });

  return conceptArraySchema.parse(normalized);
}

/**
 * Parses model output into the final concept array, attempting one repair pass when the model adds extra text.
 * @param raw - Raw assistant message content from the configured model provider.
 * @returns Validated study concepts or an empty array for `[]`.
 * @remarks The repair logic is intentionally conservative: it only recovers the first JSON array and still revalidates the result.
 */
function parseConceptsFromModelContent(raw: string) {
  const trimmed = raw.trim();
  if (trimmed === "[]") {
    return [] satisfies Concept[];
  }

  try {
    const parsed = tryParseConceptArray(trimmed);
    if (parsed) {
      return parsed;
    }
  } catch {
    // Fall through to repair path.
  }

  const repaired = extractFirstJsonArray(trimmed);
  if (!repaired) {
    throw new Error("Model response did not contain a JSON array.");
  }

  try {
    return normalizeConceptRows(JSON.parse(repaired));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown response parsing failure.";
    throw new Error(`Unable to parse model output. ${message}`);
  }
}

/**
 * Calls Gemini using the documented `generateContent` REST endpoint.
 * @param cleanedText - Source text after ingestion and normalization.
 * @param input - Original validated extraction input used for prompt context.
 * @returns The raw generated text from Gemini.
 * @remarks
 * - Uses `x-goog-api-key` authentication and `candidates[].content.parts[].text`, per Google's REST docs.
 * - Requests `application/json` output to reduce repair work, but still validates and repairs the response defensively.
 */
async function generateWithGemini(cleanedText: string, input: ExtractionInput) {
  const env = getServerEnv();
  const endpoint = new URL(
    `models/${env.GEMINI_MODEL}:generateContent`,
    env.GEMINI_API_BASE_URL.endsWith("/") ? env.GEMINI_API_BASE_URL : `${env.GEMINI_API_BASE_URL}/`,
  );

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-goog-api-key": env.GEMINI_API_KEY ?? "",
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: CONCEPT_EXTRACTION_PROMPT }],
      },
      contents: [
        {
          role: "user",
          parts: [{ text: buildUserPrompt(cleanedText, input) }],
        },
      ],
      generationConfig: {
        temperature: 0.1,
        responseMimeType: "application/json",
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Gemini request failed with status ${response.status}.`);
  }

  return getGeminiMessageContent((await response.json()) as GeminiResponse);
}

/**
 * Calls a generic OpenAI-compatible chat-completions endpoint.
 * @param cleanedText - Source text after ingestion and normalization.
 * @param input - Original validated extraction input used for prompt context.
 * @returns The raw generated text from the provider.
 * @remarks This path exists so the app can switch back to K2 later without changing the rest of the feature pipeline.
 */
async function generateWithOpenAICompatible(cleanedText: string, input: ExtractionInput) {
  const env = getServerEnv();
  const endpoint = new URL(
    "chat/completions",
    env.OPENAI_COMPATIBLE_API_BASE_URL?.endsWith("/")
      ? env.OPENAI_COMPATIBLE_API_BASE_URL
      : `${env.OPENAI_COMPATIBLE_API_BASE_URL ?? ""}/`,
  );

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${env.OPENAI_COMPATIBLE_API_KEY ?? ""}`,
    },
    body: JSON.stringify({
      model: env.OPENAI_COMPATIBLE_MODEL,
      temperature: 0.1,
      messages: [
        {
          role: "system",
          content: CONCEPT_EXTRACTION_PROMPT,
        },
        {
          role: "user",
          content: buildUserPrompt(cleanedText, input),
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI-compatible request failed with status ${response.status}.`);
  }

  return getOpenAICompatibleMessageContent((await response.json()) as OpenAICompatibleResponse);
}

/**
 * Calls the configured model provider and converts the response into validated concepts.
 * @param cleanedText - Source text after ingestion and normalization.
 * @param input - Original validated extraction input used for prompt context.
 * @returns A validated concept array suitable for returning from a server function.
 * @remarks Gemini is the default active provider, but the adapter seam keeps a later K2 switch to configuration plus provider-specific env vars.
 */
export async function extractConceptsWithModel(cleanedText: string, input: ExtractionInput) {
  const env = getServerEnv();
  const provider = env.AI_PROVIDER as ModelProvider;
  const rawContent =
    provider === "gemini"
      ? await generateWithGemini(cleanedText, input)
      : await generateWithOpenAICompatible(cleanedText, input);

  return parseConceptsFromModelContent(rawContent);
}
