import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAuthUser = vi.fn();
const classifyConceptRoomsWithGemini = vi.fn();
const createConceptForUser = vi.fn();
const createRoomForUser = vi.fn();
const incrementRoomConceptCount = vi.fn();
const listRoomsByUserId = vi.fn();
const endSession = vi.fn();
const withTransaction = vi.fn(async (callback: () => Promise<void>) => callback());
const startSession = vi.fn(() => ({ withTransaction, endSession }));

vi.mock("@/features/auth/server/auth-session.server", () => ({
  requireAuthUser,
}));

vi.mock("@/features/concept-extraction/server/gemini-room-classifier.server", () => ({
  classifyConceptRoomsWithGemini,
}));

vi.mock("@/features/concept-extraction/server/concept.repository.server", () => ({
  createConceptForUser,
}));

vi.mock("@/features/concept-extraction/server/room.repository.server", () => ({
  createRoomForUser,
  incrementRoomConceptCount,
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
      name: roomId === "room-1" ? "Science" : "Biology",
      slug: roomId === "room-1" ? "science" : "biology",
      description: roomId === "room-1" ? "STEM concepts" : "Living systems",
      conceptCount: by,
      createdAt: "2026-03-28T12:00:00.000Z",
      updatedAt: "2026-03-28T13:00:00.000Z",
    }));
  });

  it("assigns a concept to an existing room and increments room counts", async () => {
    listRoomsByUserId.mockResolvedValue([
      {
        id: "room-1",
        userId: "user-1",
        name: "Science",
        slug: "science",
        description: "STEM concepts",
        conceptCount: 2,
        createdAt: "2026-03-28T12:00:00.000Z",
        updatedAt: "2026-03-28T12:00:00.000Z",
      },
    ]);
    classifyConceptRoomsWithGemini.mockResolvedValue([
      {
        conceptName: "Neuron",
        decisionType: "existing",
        roomSlug: "science",
      },
    ]);
    createConceptForUser.mockResolvedValue({
      id: "concept-1",
      userId: "user-1",
      name: "Neuron",
      description: "Cell that transmits signals.",
      normalizedName: "neuron",
      room: { roomId: "room-1", name: "Science", slug: "science" },
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

    expect(classifyConceptRoomsWithGemini).toHaveBeenCalledOnce();
    expect(createRoomForUser).not.toHaveBeenCalled();
    expect(createConceptForUser).toHaveBeenCalledWith(
      expect.objectContaining({
        normalizedName: "neuron",
        room: { roomId: "room-1", name: "Science", slug: "science" },
      }),
      expect.any(Object),
    );
    expect(incrementRoomConceptCount).toHaveBeenCalledWith("room-1", 1, expect.any(Object));
    expect(result.concepts).toHaveLength(1);
    expect(result.concepts[0]?.metaphor).toBeNull();
    expect(result.rooms[0]?.slug).toBe("science");
  });

  it("creates a new room when Gemini returns a new-room decision", async () => {
    listRoomsByUserId.mockResolvedValue([]);
    classifyConceptRoomsWithGemini.mockResolvedValue([
      {
        conceptName: "Neuron",
        decisionType: "new",
        roomName: "Biology",
        roomDescription: "Living systems",
      },
    ]);
    createRoomForUser.mockResolvedValue({
      id: "room-2",
      userId: "user-1",
      name: "Biology",
      slug: "biology",
      description: "Living systems",
      conceptCount: 0,
      createdAt: "2026-03-28T12:00:00.000Z",
      updatedAt: "2026-03-28T12:00:00.000Z",
    });
    createConceptForUser.mockResolvedValue({
      id: "concept-1",
      userId: "user-1",
      name: "Neuron",
      description: "Cell that transmits signals.",
      normalizedName: "neuron",
      room: { roomId: "room-2", name: "Biology", slug: "biology" },
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

    expect(createRoomForUser).toHaveBeenCalledWith(
      {
        userId: "user-1",
        name: "Biology",
        slug: "biology",
        description: "Living systems",
      },
      expect.any(Object),
    );
    expect(result.rooms.some((room) => room.slug === "biology")).toBe(true);
  });

  it("reuses an existing room when a new-room decision slug-collides", async () => {
    listRoomsByUserId.mockResolvedValue([
      {
        id: "room-1",
        userId: "user-1",
        name: "Science",
        slug: "science",
        description: "STEM concepts",
        conceptCount: 2,
        createdAt: "2026-03-28T12:00:00.000Z",
        updatedAt: "2026-03-28T12:00:00.000Z",
      },
    ]);
    classifyConceptRoomsWithGemini.mockResolvedValue([
      {
        conceptName: "Atom",
        decisionType: "new",
        roomName: "Science",
        roomDescription: "Should reuse existing",
      },
    ]);
    createConceptForUser.mockResolvedValue({
      id: "concept-1",
      userId: "user-1",
      name: "Atom",
      description: "Basic unit of matter.",
      normalizedName: "atom",
      room: { roomId: "room-1", name: "Science", slug: "science" },
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

    expect(createRoomForUser).not.toHaveBeenCalled();
    expect(createConceptForUser).toHaveBeenCalledWith(
      expect.objectContaining({
        room: { roomId: "room-1", name: "Science", slug: "science" },
      }),
      expect.any(Object),
    );
  });

  it("fails closed for anonymous requests", async () => {
    requireAuthUser.mockRejectedValue(new Error("Unauthorized"));

    const { persistConceptsForCurrentUser } =
      await import("@/features/concept-extraction/server/concept-persistence.server");

    await expect(
      persistConceptsForCurrentUser({
        concepts: [{ name: "Neuron", description: "Cell that transmits signals." }],
      }),
    ).rejects.toThrow("Unauthorized");
  });
});
