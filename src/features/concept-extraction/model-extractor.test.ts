/**
 * @file model-extractor.test.ts
 * @description Verifies K2 response parsing and safe handling of malformed outputs.
 * @module concept-extraction
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("extractConceptsWithModel", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      AI_PROVIDER: "k2",
      AUTH0_DOMAIN: "example.auth0.com",
      AUTH0_CLIENT_ID: "client-id",
      AUTH0_CLIENT_SECRET: "client-secret",
      AUTH0_AUDIENCE: "",
      APP_BASE_URL: "http://localhost:3000",
      GEMINI_API_BASE_URL: "https://generativelanguage.googleapis.com/v1beta",
      GEMINI_API_KEY: "gemini-secret",
      GEMINI_MODEL: "gemini-2.5-flash",
      K2_API_BASE_URL: "https://api.k2.example/v1",
      K2_API_KEY: "secret",
      K2_MODEL: "k2-think-v2",
      MONGODB_URI: "mongodb://localhost:27017",
      MONGODB_DB_NAME: "memory-palace",
      SESSION_COOKIE_SECRET: "x".repeat(32),
    };
    vi.restoreAllMocks();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it("returns validated concepts from valid K2 JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify([{ name: "Neuron", description: "A nerve cell." }]),
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

  it("routes PDF extraction through Gemini", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify([
                      { name: "Graph", description: "A set of vertices and edges." },
                    ]),
                  },
                ],
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { extractConceptsWithModel } =
      await import("@/features/concept-extraction/server/model-extractor.server");
    const result = await extractConceptsWithModel("Very long PDF text", {
      type: "pdf",
      source: {
        kind: "path",
        value: "/tmp/test.pdf",
      },
    });

    expect(result).toEqual([{ name: "Graph", description: "A set of vertices and edges." }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0].toString()).toContain(":generateContent");
  });

  it("repairs K2 responses that include extra surrounding text", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content:
                    'Here is the JSON:\n[{"name":"Mitosis","description":"Cell division."}]\nDone.',
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
            choices: [
              {
                message: {
                  content:
                    '[{"name":"ATP","description":"Energy currency."},{"name":"","description":"missing name"},{"foo":"bar"}]',
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
            choices: [
              {
                message: {
                  content: "[]",
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
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: "I cannot comply.",
                  },
                },
              ],
            }),
            { status: 200 },
          ),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: "Still not JSON.",
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

  it("throws a safe K2 request error when the provider call fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 401 })));

    const { extractConceptsWithModel } =
      await import("@/features/concept-extraction/server/model-extractor.server");

    await expect(
      extractConceptsWithModel("Unauthorized", {
        type: "text",
        content: "Unauthorized",
      }),
    ).rejects.toThrow("K2 request failed with status 401.");
  });
});
