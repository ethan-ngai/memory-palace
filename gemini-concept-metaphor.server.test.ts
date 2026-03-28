import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StoredConcept } from "@/features/concept-extraction/types";

const fetchMock = vi.fn<typeof fetch>();

describe("generateConceptMetaphorsWithGemini", () => {
  beforeEach(() => {
    process.env.AUTH0_DOMAIN = "test.us.auth0.com";
    process.env.AUTH0_CLIENT_ID = "client-id";
    process.env.AUTH0_CLIENT_SECRET = "client-secret";
    process.env.APP_BASE_URL = "http://localhost:3000";
    process.env.GEMINI_API_KEY = "gemini-key";
    process.env.GEMINI_MODEL = "";
    process.env.MONGODB_URI = "mongodb://127.0.0.1:27017";
    process.env.MONGODB_DB_NAME = "memory_palace_test";
    process.env.SESSION_COOKIE_SECRET = "x".repeat(32);
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetAllMocks();
  });

  it("parses strict JSON metaphors from Gemini", async () => {
    const concepts: StoredConcept[] = [
      {
        id: "concept-1",
        userId: "user-1",
        name: "Neuron",
        description: "Cell that transmits signals.",
        normalizedName: "neuron",
        room: { roomId: "room-1", name: "Science", slug: "science" },
        metaphor: null,
        embedding: null,
        asset: null,
        createdAt: "2026-03-28T12:00:00.000Z",
        updatedAt: "2026-03-28T12:00:00.000Z",
      },
    ];

    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: '```json\n{"metaphors":[{"conceptId":"concept-1","objectName":"glass neuron lantern","prompt":"A glass neuron lantern with glowing branching filaments, clean silhouette.","rationale":"The lantern suggests transmitted signals and branching structure."}]}\n```',
                },
              ],
            },
          },
        ],
      }),
    } as Response);

    const { generateConceptMetaphorsWithGemini } =
      await import("@/features/concept-extraction/server/gemini-concept-metaphor.server");

    const result = await generateConceptMetaphorsWithGemini({
      concepts,
      prompt: "Generate metaphors.",
    });

    expect(result).toEqual([
      {
        conceptId: "concept-1",
        objectName: "glass neuron lantern",
        prompt: "A glass neuron lantern with glowing branching filaments, clean silhouette.",
        rationale: "The lantern suggests transmitted signals and branching structure.",
      },
    ]);
  });

  it("rejects malformed Gemini metaphor payloads", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: '{"metaphors":[{"conceptId":"concept-1","objectName":"glass neuron lantern","prompt":"","rationale":"x"}]}',
                },
              ],
            },
          },
        ],
      }),
    } as Response);

    const { generateConceptMetaphorsWithGemini } =
      await import("@/features/concept-extraction/server/gemini-concept-metaphor.server");

    await expect(
      generateConceptMetaphorsWithGemini({
        concepts: [
          {
            id: "concept-1",
            userId: "user-1",
            name: "Neuron",
            description: "Cell that transmits signals.",
            normalizedName: "neuron",
            room: { roomId: "room-1", name: "Science", slug: "science" },
            metaphor: null,
            embedding: null,
            asset: null,
            createdAt: "2026-03-28T12:00:00.000Z",
            updatedAt: "2026-03-28T12:00:00.000Z",
          },
        ],
        prompt: "Generate metaphors.",
      }),
    ).rejects.toThrow();
  });
});
