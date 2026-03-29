import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAuthUser = vi.fn();
const createConceptForUser = vi.fn();
const createRoomForUser = vi.fn();
const incrementRoomConceptCount = vi.fn();
const incrementRoomConceptCountBySlug = vi.fn();
const listRoomsByUserId = vi.fn();
const endSession = vi.fn();
const withTransaction = vi.fn(async (callback: () => Promise<void>) => callback());
const startSession = vi.fn(() => ({ withTransaction, endSession }));

vi.mock("@/features/auth/server/auth-session.server", () => ({
  requireAuthUser,
}));

vi.mock("@/features/concept-extraction/server/concept.repository.server", () => ({
  createConceptForUser,
}));

vi.mock("@/features/concept-extraction/server/room.repository.server", () => ({
  createRoomForUser,
  incrementRoomConceptCount,
  incrementRoomConceptCountBySlug,
  listRoomsByUserId,
}));

vi.mock("@/lib/server/mongodb.server", () => ({
  getMongoClient: vi.fn(async () => ({
    startSession,
  })),
}));

describe("persistConceptsForCurrentUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthUser.mockResolvedValue({ id: "user-1" });
    incrementRoomConceptCount.mockImplementation(async (roomId: string, by = 1) => ({
      id: roomId,
      userId: "user-1",
      name: "Imported Concepts",
      slug: "imported-concepts",
      description: "Temporary catch-all room used while automatic room classification is disabled.",
      conceptCount: by,
      createdAt: "2026-03-28T12:00:00.000Z",
      updatedAt: "2026-03-28T13:00:00.000Z",
    }));
    incrementRoomConceptCountBySlug.mockImplementation(
      async (_userId: string, slug: string, by = 1) => ({
        id: "room-imported",
        userId: "user-1",
        name: "Imported Concepts",
        slug,
        description:
          "Temporary catch-all room used while automatic room classification is disabled.",
        conceptCount: by,
        createdAt: "2026-03-28T12:00:00.000Z",
        updatedAt: "2026-03-28T13:00:00.000Z",
      }),
    );
  });

  it("reuses the fallback room when it already exists", async () => {
    listRoomsByUserId.mockResolvedValue([
      {
        id: "room-imported",
        userId: "user-1",
        name: "Imported Concepts",
        slug: "imported-concepts",
        description:
          "Temporary catch-all room used while automatic room classification is disabled.",
        conceptCount: 2,
        createdAt: "2026-03-28T12:00:00.000Z",
        updatedAt: "2026-03-28T12:00:00.000Z",
      },
    ]);
    createConceptForUser.mockResolvedValue({
      id: "concept-1",
      userId: "user-1",
      name: "Neuron",
      description: "Cell that transmits signals.",
      normalizedName: "neuron",
      room: { roomId: "room-imported", name: "Imported Concepts", slug: "imported-concepts" },
      metaphor: null,
      embedding: null,
      asset: null,
      createdAt: "2026-03-28T13:00:00.000Z",
      updatedAt: "2026-03-28T13:00:00.000Z",
    });

    const { persistConceptsForCurrentUser } =
      await import("@/features/concept-extraction/server/concept-persistence.server");

    const result = await persistConceptsForCurrentUser({
      concepts: [{ name: "Neuron", description: "Cell that transmits signals." }],
    });

    expect(createRoomForUser).not.toHaveBeenCalled();
    expect(createConceptForUser).toHaveBeenCalledWith(
      expect.objectContaining({
        normalizedName: "neuron",
        room: { roomId: "room-imported", name: "Imported Concepts", slug: "imported-concepts" },
      }),
      expect.any(Object),
    );
    expect(incrementRoomConceptCount).toHaveBeenCalledWith("room-imported", 1, expect.any(Object));
    expect(result.rooms[0]?.slug).toBe("imported-concepts");
  });

  it("creates the fallback room when the user does not have it yet", async () => {
    listRoomsByUserId.mockResolvedValue([]);
    createRoomForUser.mockResolvedValue({
      id: "room-imported",
      userId: "user-1",
      name: "Imported Concepts",
      slug: "imported-concepts",
      description: "Temporary catch-all room used while automatic room classification is disabled.",
      conceptCount: 0,
      createdAt: "2026-03-28T12:00:00.000Z",
      updatedAt: "2026-03-28T12:00:00.000Z",
    });
    createConceptForUser.mockResolvedValue({
      id: "concept-1",
      userId: "user-1",
      name: "Atom",
      description: "Basic unit of matter.",
      normalizedName: "atom",
      room: { roomId: "room-imported", name: "Imported Concepts", slug: "imported-concepts" },
      metaphor: null,
      embedding: null,
      asset: null,
      createdAt: "2026-03-28T13:00:00.000Z",
      updatedAt: "2026-03-28T13:00:00.000Z",
    });

    const { persistConceptsForCurrentUser } =
      await import("@/features/concept-extraction/server/concept-persistence.server");

    await persistConceptsForCurrentUser({
      concepts: [{ name: "Atom", description: "Basic unit of matter." }],
    });

    expect(createRoomForUser).toHaveBeenCalledWith(
      {
        userId: "user-1",
        name: "Imported Concepts",
        slug: "imported-concepts",
        description:
          "Temporary catch-all room used while automatic room classification is disabled.",
      },
      expect.any(Object),
    );
  });

  it("still normalizes punctuation-heavy concept names before persistence", async () => {
    listRoomsByUserId.mockResolvedValue([
      {
        id: "room-imported",
        userId: "user-1",
        name: "Imported Concepts",
        slug: "imported-concepts",
        description:
          "Temporary catch-all room used while automatic room classification is disabled.",
        conceptCount: 2,
        createdAt: "2026-03-28T12:00:00.000Z",
        updatedAt: "2026-03-28T12:00:00.000Z",
      },
    ]);
    createConceptForUser.mockResolvedValue({
      id: "concept-1",
      userId: "user-1",
      name: "Non‑Negative Integer Solutions to Equations",
      description: "Counting non-negative integer assignments.",
      normalizedName: "non negative integer solutions to equations",
      room: { roomId: "room-imported", name: "Imported Concepts", slug: "imported-concepts" },
      metaphor: null,
      embedding: null,
      asset: null,
      createdAt: "2026-03-28T13:00:00.000Z",
      updatedAt: "2026-03-28T13:00:00.000Z",
    });

    const { persistConceptsForCurrentUser } =
      await import("@/features/concept-extraction/server/concept-persistence.server");

    await persistConceptsForCurrentUser({
      concepts: [
        {
          name: "Non‑Negative Integer Solutions to Equations",
          description: "Counting non-negative integer assignments.",
        },
      ],
    });

    expect(createConceptForUser).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Non‑Negative Integer Solutions to Equations",
        normalizedName: "non negative integer solutions to equations",
      }),
      expect.any(Object),
    );
  });
});
