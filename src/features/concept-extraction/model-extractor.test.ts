/**
 * @file model-extractor.test.ts
 * @description Verifies Gemini and OpenAI-compatible response parsing, provider selection, and safe handling of malformed outputs.
 * @module concept-extraction
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("extractConceptsWithModel", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      AI_PROVIDER: "gemini",
      AUTH0_DOMAIN: "example.auth0.com",
      AUTH0_CLIENT_ID: "client-id",
      AUTH0_CLIENT_SECRET: "client-secret",
      AUTH0_AUDIENCE: "",
      APP_BASE_URL: "http://localhost:3000",
      GEMINI_API_BASE_URL: "https://generativelanguage.googleapis.com/v1beta",
      GEMINI_API_KEY: "secret",
      GEMINI_MODEL: "gemini-2.5-flash",
      MONGODB_URI: "mongodb://localhost:27017",
      MONGODB_DB_NAME: "memory-palace",
      OPENAI_COMPATIBLE_API_BASE_URL: "https://example.com/v1",
      OPENAI_COMPATIBLE_API_KEY: "openai-secret",
      OPENAI_COMPATIBLE_MODEL: "k2",
      SESSION_COOKIE_SECRET: "x".repeat(32),
    };
    vi.restoreAllMocks();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it("returns validated concepts from valid Gemini JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: JSON.stringify([{ name: "Neuron", description: "A nerve cell." }]),
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200 },
        ),
      ),
    );

    const { extractConceptsWithModel } =
      await import("@/features/concept-extraction/server/model-extractor.server");
    const result = await extractConceptsWithModel("Neuron cell body and axon", {
      type: "text",
      content: "Neuron cell body and axon",
    });

    expect(result).toEqual([{ name: "Neuron", description: "A nerve cell." }]);
  });

  it("repairs Gemini responses that include extra surrounding text", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: 'Here is the JSON:\n[{"name":"Mitosis","description":"Cell division."}]\nDone.',
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200 },
        ),
      ),
    );

    const { extractConceptsWithModel } =
      await import("@/features/concept-extraction/server/model-extractor.server");
    const result = await extractConceptsWithModel("Mitosis splits a cell", {
      type: "text",
      content: "Mitosis splits a cell",
    });

    expect(result).toEqual([{ name: "Mitosis", description: "Cell division." }]);
  });

  it("filters malformed concept rows when repairing output", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: '[{"name":"ATP","description":"Energy currency."},{"name":"","description":"missing name"},{"foo":"bar"}]',
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200 },
        ),
      ),
    );

    const { extractConceptsWithModel } =
      await import("@/features/concept-extraction/server/model-extractor.server");
    const result = await extractConceptsWithModel("ATP stores energy", {
      type: "text",
      content: "ATP stores energy",
    });

    expect(result).toEqual([{ name: "ATP", description: "Energy currency." }]);
  });

  it("passes through an empty JSON array", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [{ text: "[]" }],
                },
              },
            ],
          }),
          { status: 200 },
        ),
      ),
    );

    const { extractConceptsWithModel } =
      await import("@/features/concept-extraction/server/model-extractor.server");
    const result = await extractConceptsWithModel("No useful content", {
      type: "text",
      content: "No useful content",
    });

    expect(result).toEqual([]);
  });

  it("throws a safe error when no JSON array can be recovered", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [{ text: "I cannot comply." }],
                },
              },
            ],
          }),
          { status: 200 },
        ),
      ),
    );

    const { extractConceptsWithModel } =
      await import("@/features/concept-extraction/server/model-extractor.server");

    await expect(
      extractConceptsWithModel("Bad response", {
        type: "text",
        content: "Bad response",
      }),
    ).rejects.toThrow("Model response did not contain a JSON array.");
  });

  it("can switch to an OpenAI-compatible provider for a later K2 cutover", async () => {
    process.env.AI_PROVIDER = "openai-compatible";

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify([{ name: "Synapse", description: "A neuron junction." }]),
                },
              },
            ],
          }),
          { status: 200 },
        ),
      ),
    );

    const { extractConceptsWithModel } =
      await import("@/features/concept-extraction/server/model-extractor.server");
    const result = await extractConceptsWithModel("Synapses transmit signals", {
      type: "text",
      content: "Synapses transmit signals",
    });

    expect(result).toEqual([{ name: "Synapse", description: "A neuron junction." }]);
  });
});
