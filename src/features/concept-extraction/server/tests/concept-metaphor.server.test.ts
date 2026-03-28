import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAuthUser = vi.fn();
const findConceptsByIdsForUser = vi.fn();
const updateConceptMetaphorById = vi.fn();
const generateConceptMetaphorsWithGemini = vi.fn();
const endSession = vi.fn();
const withTransaction = vi.fn(async (callback: () => Promise<void>) => callback());
const startSession = vi.fn(() => ({ withTransaction, endSession }));

vi.mock("@/features/auth/server/auth-session.server", () => ({
  requireAuthUser,
}));

vi.mock("@/features/concept-extraction/server/concept.repository.server", () => ({
  findConceptsByIdsForUser,
  updateConceptMetaphorById,
}));

vi.mock("@/features/concept-extraction/server/gemini-concept-metaphor.server", () => ({
  generateConceptMetaphorsWithGemini,
}));

vi.mock("@/lib/server/mongodb.server", () => ({
  getMongoClient: vi.fn(async () => ({
    startSession,
  })),
}));

describe("generateConceptMetaphorsForCurrentUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthUser.mockResolvedValue({ id: "user-1" });
  });

  it("generates metaphors for stored concepts in request order", async () => {
    findConceptsByIdsForUser.mockResolvedValue([
      {
        id: "concept-2",
        userId: "user-1",
        name: "Atom",
        description: "Basic unit of matter.",
        normalizedName: "atom",
        room: { roomId: "room-1", name: "Science", slug: "science" },
        metaphor: null,
        embedding: null,
        asset: null,
        createdAt: "2026-03-28T12:00:00.000Z",
        updatedAt: "2026-03-28T12:00:00.000Z",
      },
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
    ]);
    generateConceptMetaphorsWithGemini.mockResolvedValue([
      {
        conceptId: "concept-2",
        objectName: "clockwork atom core",
        prompt: "A clockwork atom core with orbiting brass rings and a bright nucleus.",
        rationale: "The layered rings make atomic structure easier to picture.",
      },
      {
        conceptId: "concept-1",
        objectName: "glass neuron lantern",
        prompt: "A glass neuron lantern with glowing branching filaments, clean silhouette.",
        rationale: "The lantern suggests transmitted signals and branching structure.",
      },
    ]);
    updateConceptMetaphorById
      .mockResolvedValueOnce({
        id: "concept-2",
        userId: "user-1",
        name: "Atom",
        description: "Basic unit of matter.",
        normalizedName: "atom",
        room: { roomId: "room-1", name: "Science", slug: "science" },
        metaphor: {
          status: "ready",
          objectName: "clockwork atom core",
          prompt: "A clockwork atom core with orbiting brass rings and a bright nucleus.",
          rationale: "The layered rings make atomic structure easier to picture.",
          generatedAt: "2026-03-28T15:00:00.000Z",
        },
        embedding: null,
        asset: null,
        createdAt: "2026-03-28T12:00:00.000Z",
        updatedAt: "2026-03-28T15:00:00.000Z",
      })
      .mockResolvedValueOnce({
        id: "concept-1",
        userId: "user-1",
        name: "Neuron",
        description: "Cell that transmits signals.",
        normalizedName: "neuron",
        room: { roomId: "room-1", name: "Science", slug: "science" },
        metaphor: {
          status: "ready",
          objectName: "glass neuron lantern",
          prompt: "A glass neuron lantern with glowing branching filaments, clean silhouette.",
          rationale: "The lantern suggests transmitted signals and branching structure.",
          generatedAt: "2026-03-28T15:00:00.000Z",
        },
        embedding: null,
        asset: null,
        createdAt: "2026-03-28T12:00:00.000Z",
        updatedAt: "2026-03-28T15:00:00.000Z",
      });

    const { generateConceptMetaphorsForCurrentUser } =
      await import("@/features/concept-extraction/server/concept-metaphor.server");

    const result = await generateConceptMetaphorsForCurrentUser({
      conceptIds: ["concept-2", "concept-1"],
    });

    expect(result.concepts.map((concept) => concept.id)).toEqual(["concept-2", "concept-1"]);
    expect(updateConceptMetaphorById).toHaveBeenCalledTimes(2);
    expect(result.concepts[1]?.metaphor?.prompt).toContain("glowing branching filaments");
  });

  it("rejects duplicate concept ids before hitting Gemini", async () => {
    const { generateConceptMetaphorsForCurrentUser } =
      await import("@/features/concept-extraction/server/concept-metaphor.server");

    await expect(
      generateConceptMetaphorsForCurrentUser({
        conceptIds: ["concept-1", "concept-1"],
      }),
    ).rejects.toThrow("Duplicate concept ids are not allowed.");

    expect(generateConceptMetaphorsWithGemini).not.toHaveBeenCalled();
  });

  it("rejects when requested concepts are missing for the current user", async () => {
    findConceptsByIdsForUser.mockResolvedValue([]);

    const { generateConceptMetaphorsForCurrentUser } =
      await import("@/features/concept-extraction/server/concept-metaphor.server");

    await expect(
      generateConceptMetaphorsForCurrentUser({
        conceptIds: ["concept-1"],
      }),
    ).rejects.toThrow("One or more requested concepts were not found for the current user.");
  });

  it("rejects malformed Gemini coverage", async () => {
    findConceptsByIdsForUser.mockResolvedValue([
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
    ]);
    generateConceptMetaphorsWithGemini.mockResolvedValue([
      {
        conceptId: "concept-x",
        objectName: "glass neuron lantern",
        prompt: "A glass neuron lantern with glowing branching filaments, clean silhouette.",
        rationale: "The lantern suggests transmitted signals and branching structure.",
      },
    ]);

    const { generateConceptMetaphorsForCurrentUser } =
      await import("@/features/concept-extraction/server/concept-metaphor.server");

    await expect(
      generateConceptMetaphorsForCurrentUser({
        conceptIds: ["concept-1"],
      }),
    ).rejects.toThrow('Gemini returned an unknown concept id "concept-x".');
  });
});
