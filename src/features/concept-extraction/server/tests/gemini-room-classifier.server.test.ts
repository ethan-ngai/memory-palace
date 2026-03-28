import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RoomSummary } from "@/features/concept-extraction/types";

const fetchMock = vi.fn<typeof fetch>();

describe("classifyConceptRoomsWithGemini", () => {
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

  it("parses strict JSON assignments from Gemini", async () => {
    const existingRooms: RoomSummary[] = [
      {
        id: "room-1",
        userId: "user-1",
        name: "Science",
        slug: "science",
        description: "STEM concepts",
        conceptCount: 3,
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
                  text: '```json\n{"assignments":[{"conceptName":"Neuron","decisionType":"existing","roomSlug":"science"}]}\n```',
                },
              ],
            },
          },
        ],
      }),
    } as Response);

    const { classifyConceptRoomsWithGemini } =
      await import("@/features/concept-extraction/server/gemini-room-classifier.server");

    const result = await classifyConceptRoomsWithGemini({
      prompt: "Classify concepts.",
      existingRooms,
      concepts: [{ name: "Neuron", description: "Cell that transmits signals." }],
    });

    expect(result).toEqual([
      {
        conceptName: "Neuron",
        decisionType: "existing",
        roomSlug: "science",
      },
    ]);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("throws when Gemini returns malformed assignments", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: '{"assignments":[{"conceptName":"Neuron","decisionType":"existing"}]}',
                },
              ],
            },
          },
        ],
      }),
    } as Response);

    const { classifyConceptRoomsWithGemini } =
      await import("@/features/concept-extraction/server/gemini-room-classifier.server");

    await expect(
      classifyConceptRoomsWithGemini({
        prompt: "Classify concepts.",
        existingRooms: [],
        concepts: [{ name: "Neuron", description: "Cell that transmits signals." }],
      }),
    ).rejects.toThrow();
  });
});
