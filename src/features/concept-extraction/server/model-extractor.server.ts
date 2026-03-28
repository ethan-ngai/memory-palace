/**
 * @file model-extractor.server.ts
 * @description Sends cleaned study material to K2 for text and Gemini for PDFs, then repairs structured output when needed.
 * @module concept-extraction
 */
import { z } from "zod";
import { getServerEnv } from "@/lib/env/server";
import { conceptArraySchema } from "@/features/concept-extraction/server/concept-extraction.schemas";
import type { Concept, ExtractionInput } from "@/features/concept-extraction/types";

type K2Response = {
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

/**
 * Prompt used for concept extraction across both model backends.
 * @description Keeps the extraction contract stable even though text and PDF sources route to different providers.
 */
export const K2_CONCEPT_EXTRACTION_PROMPT = `
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

/**
 * Repair prompt used when K2 responds with analysis text instead of the required JSON array.
 * @description Keeps the recovery step narrow so the model reformats its own answer instead of re-solving the task from scratch.
 */
const K2_CONCEPT_REPAIR_PROMPT = `
You are reformatting a previous model response.

Return only valid JSON.
The JSON must be an array of objects with this exact shape:
[
  {
    "name": "Concept name",
    "description": "Clear explanation of the concept"
  }
]

Rules:
- Use only concepts that are already present in the supplied response.
- Remove analysis, notes, numbering, and commentary.
- Keep descriptions concise and useful for memorization.
- Avoid duplicates and near-duplicates.
- If the supplied response contains no usable concepts, return [].
- Do not wrap the JSON in markdown fences.
- Your first character must be [.
- Your last character must be ].
- Do not explain the JSON.
`;

const k2ResponseSchema = z.object({
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
 * Derives lightweight source context for the K2 prompt.
 * @param input - Original extraction input before ingestion.
 * @returns A short human-readable label describing where the study text came from.
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
 * Builds the user-facing prompt body sent to K2.
 * @param cleanedText - Source text after normalization.
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
 * Extracts the textual assistant payload from a K2 chat completion response.
 * @param payload - Raw provider response body.
 * @returns Flattened textual content suitable for JSON repair and validation.
 */
function getK2MessageContent(payload: K2Response) {
  const parsed = k2ResponseSchema.parse(payload);
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

function stripMarkdownCodeFence(raw: string) {
  const trimmed = raw.trim();

  if (!trimmed.startsWith("```")) {
    return trimmed;
  }

  return trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/u, "")
    .trim();
}

function extractFirstJsonArray(raw: string) {
  for (let start = 0; start < raw.length; start += 1) {
    if (raw[start] !== "[") {
      continue;
    }

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let index = start; index < raw.length; index += 1) {
      const char = raw[index];

      if (inString) {
        if (escaped) {
          escaped = false;
          continue;
        }

        if (char === "\\") {
          escaped = true;
          continue;
        }

        if (char === '"') {
          inString = false;
        }

        continue;
      }

      if (char === '"') {
        inString = true;
        continue;
      }

      if (char === "[") {
        depth += 1;
        continue;
      }

      if (char !== "]") {
        continue;
      }

      depth -= 1;
      if (depth !== 0) {
        continue;
      }

      const candidate = raw.slice(start, index + 1);
      try {
        const parsed = JSON.parse(candidate);
        if (Array.isArray(parsed)) {
          return candidate;
        }
      } catch {
        // Keep scanning for the next balanced candidate.
      }
    }
  }

  return null;
}

function tryExtractConceptArrayFromObject(raw: string) {
  const parsed = JSON.parse(raw);

  if (!parsed || typeof parsed !== "object") {
    return null;
  }

  const candidateKeys = ["concepts", "items", "data"];
  for (const key of candidateKeys) {
    if (!(key in parsed)) {
      continue;
    }

    const candidate = conceptArraySchema.safeParse(parsed[key as keyof typeof parsed]);
    if (candidate.success) {
      return candidate.data;
    }

    if (Array.isArray(parsed[key as keyof typeof parsed])) {
      return normalizeConceptRows(parsed[key as keyof typeof parsed]);
    }
  }

  return null;
}

/**
 * Filters parsed JSON down to valid concept rows.
 * @param payload - JSON parsed from the model response or repair path.
 * @returns A schema-validated concept array containing only usable rows.
 * @remarks Some model outputs are partially valid; filtering lets the feature recover instead of failing the whole request.
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
 * Parses K2 output into the final concept array, attempting one repair pass when the model adds extra text.
 * @param raw - Raw assistant message content from K2.
 * @returns Validated study concepts or an empty array for `[]`.
 */
function parseConceptsFromModelContent(raw: string) {
  const trimmed = stripMarkdownCodeFence(raw);
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

  try {
    const objectWrapped = tryExtractConceptArrayFromObject(trimmed);
    if (objectWrapped) {
      return objectWrapped;
    }
  } catch {
    // Fall through to array repair path.
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
 * Calls K2 through a chat-completions style endpoint.
 * @param cleanedText - Source text after ingestion and normalization.
 * @param input - Original validated extraction input used for prompt context.
 * @returns The raw generated text from K2.
 * @remarks Keeps the provider-specific HTTP contract isolated to this file so later endpoint changes stay local.
 */
async function generateWithK2(cleanedText: string, input: ExtractionInput) {
  const env = getServerEnv();
  if (!env.K2_API_KEY || !env.K2_API_BASE_URL || !env.K2_MODEL) {
    throw new Error("K2 extraction is not configured.");
  }
  const endpoint = new URL(
    "chat/completions",
    env.K2_API_BASE_URL.endsWith("/") ? env.K2_API_BASE_URL : `${env.K2_API_BASE_URL}/`,
  );

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${env.K2_API_KEY}`,
    },
    body: JSON.stringify({
      model: env.K2_MODEL,
      temperature: 0.1,
      stream: false,
      messages: [
        {
          role: "system",
          content: K2_CONCEPT_EXTRACTION_PROMPT,
        },
        {
          role: "user",
          content: buildUserPrompt(cleanedText, input),
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`K2 request failed with status ${response.status}.`);
  }

  return getK2MessageContent((await response.json()) as K2Response);
}

/**
 * Calls Gemini for PDF extraction because it tolerates much larger cleaned source bodies.
 * @param cleanedText - Source text after ingestion and normalization.
 * @param input - Original validated extraction input used for prompt context.
 * @returns The raw generated text from Gemini.
 */
async function generateWithGemini(cleanedText: string, input: ExtractionInput) {
  const env = getServerEnv();
  if (!env.GEMINI_API_KEY) {
    throw new Error("Gemini extraction is not configured.");
  }

  const endpoint = new URL(
    `models/${env.GEMINI_MODEL}:generateContent`,
    env.GEMINI_API_BASE_URL.endsWith("/") ? env.GEMINI_API_BASE_URL : `${env.GEMINI_API_BASE_URL}/`,
  );

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-goog-api-key": env.GEMINI_API_KEY,
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: K2_CONCEPT_EXTRACTION_PROMPT }],
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
 * Asks K2 to convert its own non-JSON answer into the strict concept array contract.
 * @param rawContent - Original K2 text that failed local parsing.
 * @returns Raw repaired assistant text that should be much closer to the required JSON array.
 * @remarks This second pass is cheaper than building a custom parser for every reasoning-style failure mode.
 */
async function repairWithK2(rawContent: string) {
  const env = getServerEnv();
  if (!env.K2_API_KEY || !env.K2_API_BASE_URL || !env.K2_MODEL) {
    throw new Error("K2 extraction is not configured.");
  }
  const endpoint = new URL(
    "chat/completions",
    env.K2_API_BASE_URL.endsWith("/") ? env.K2_API_BASE_URL : `${env.K2_API_BASE_URL}/`,
  );

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${env.K2_API_KEY}`,
    },
    body: JSON.stringify({
      model: env.K2_MODEL,
      temperature: 0,
      stream: false,
      messages: [
        {
          role: "system",
          content: K2_CONCEPT_REPAIR_PROMPT,
        },
        {
          role: "user",
          content: [
            "Convert the following response into only a JSON array of {name, description} objects.",
            "If you cannot recover any valid concepts, return [].",
            "<previous_response>",
            rawContent,
            "</previous_response>",
          ].join("\n"),
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`K2 request failed with status ${response.status}.`);
  }

  return getK2MessageContent((await response.json()) as K2Response);
}

/**
 * Calls the source-appropriate model and converts the response into validated concepts.
 * @param cleanedText - Source text after cleanup.
 * @param input - Original extraction input used for source context.
 * @returns A validated concept array suitable for returning from a server function.
 */
export async function extractConceptsWithModel(cleanedText: string, input: ExtractionInput) {
  const provider = input.type === "pdf" ? "gemini" : "k2";
  const rawContent =
    provider === "gemini"
      ? await generateWithGemini(cleanedText, input)
      : await generateWithK2(cleanedText, input);
  if (process.env.CONCEPT_EXTRACTION_DEBUG === "1") {
    console.log("[concept-extraction] model provider:", provider);
    console.log("[concept-extraction] model raw response:");
    console.log(rawContent.slice(0, 4000));
  }

  if (provider === "gemini") {
    return parseConceptsFromModelContent(rawContent);
  }

  try {
    return parseConceptsFromModelContent(rawContent);
  } catch (error) {
    const repairable =
      error instanceof Error &&
      (error.message.includes("JSON array") || error.message.includes("Unexpected non-whitespace"));

    if (!repairable) {
      throw error;
    }

    const repairedContent = await repairWithK2(rawContent);
    if (process.env.CONCEPT_EXTRACTION_DEBUG === "1") {
      console.log("[concept-extraction] model repaired response:");
      console.log(repairedContent.slice(0, 4000));
    }
    return parseConceptsFromModelContent(repairedContent);
  }
}
