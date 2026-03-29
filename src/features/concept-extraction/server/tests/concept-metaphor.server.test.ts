import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAuthUser = vi.fn();
const findConceptsByIdsForUser = vi.fn();
const updateConceptMetaphorById = vi.fn();
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
          prompt: "a clockwork atom core",
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
          prompt: "a glass neuron lantern",
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
    expect(updateConceptMetaphorById).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        conceptId: "concept-2",
        metaphor: expect.objectContaining({
          objectName: "Atom",
          prompt: "an atom",
        }),
      }),
      expect.any(Object),
    );
    expect(updateConceptMetaphorById).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        conceptId: "concept-1",
        metaphor: expect.objectContaining({
          objectName: "Neuron",
          prompt: "a neuron",
        }),
      }),
      expect.any(Object),
    );
  });

  it("rejects duplicate concept ids before doing local metaphor generation", async () => {
    const { generateConceptMetaphorsForCurrentUser } =
      await import("@/features/concept-extraction/server/concept-metaphor.server");

    await expect(
      generateConceptMetaphorsForCurrentUser({
        conceptIds: ["concept-1", "concept-1"],
      }),
    ).rejects.toThrow("Duplicate concept ids are not allowed.");
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

  it("uses deterministic mappings for known balls-and-bins concepts", async () => {
    findConceptsByIdsForUser.mockResolvedValue([
      {
        id: "concept-1",
        userId: "user-1",
        name: "Injective Function (One-to-One Mapping)",
        description: "No two distinct domain elements map to the same codomain element.",
        normalizedName: "injective function",
        room: { roomId: "room-1", name: "Science", slug: "science" },
        metaphor: null,
        embedding: null,
        asset: null,
        createdAt: "2026-03-28T12:00:00.000Z",
        updatedAt: "2026-03-28T12:00:00.000Z",
      },
    ]);
    updateConceptMetaphorById.mockResolvedValue({
      id: "concept-1",
      userId: "user-1",
      name: "Injective Function (One-to-One Mapping)",
      description: "No two distinct domain elements map to the same codomain element.",
      normalizedName: "injective function",
      room: { roomId: "room-1", name: "Science", slug: "science" },
      metaphor: {
        status: "ready",
        objectName: "Coat Rack",
        prompt: "a coat rack",
        rationale: "One coat per hook matches a one-to-one mapping with no collisions.",
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
      conceptIds: ["concept-1"],
    });

    expect(updateConceptMetaphorById).toHaveBeenCalledWith(
      expect.objectContaining({
        conceptId: "concept-1",
        metaphor: expect.objectContaining({
          objectName: "Coat Rack",
          prompt: "a coat rack",
        }),
      }),
      expect.any(Object),
    );
    expect(result.concepts[0]?.metaphor?.prompt).toBe("a coat rack");
  });
});
