import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAuthUser = vi.fn(async () => ({ id: "user-1" }));
const listConceptsByRoomIdForUser = vi.fn();
const findRoomByIdForUser = vi.fn();
const getRoomAnchorSetByRoomId = vi.fn();
const listRoomsByUserId = vi.fn();
const replaceRoomAnchorSet = vi.fn();

vi.mock("@/features/auth/server/auth-session.server", () => ({
  requireAuthUser,
}));

vi.mock("@/features/concept-extraction/server/concept.repository.server", () => ({
  listConceptsByRoomIdForUser,
}));

vi.mock("@/features/concept-extraction/server/room.repository.server", () => ({
  findRoomByIdForUser,
  getRoomAnchorSetByRoomId,
  listRoomsByUserId,
  replaceRoomAnchorSet,
}));

describe("room placement server", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("accepts the Lavender room anchor payload shape", async () => {
    const { roomAnchorSetSchema } = await import("@/features/game/server/room-placement.server");
    const payload = JSON.parse(
      await readFile(resolve(process.cwd(), "rohan", "LAVENDER_ROOM_ANCHORS.json"), "utf8"),
    );

    expect(roomAnchorSetSchema.parse(payload).anchors).toHaveLength(25);
  });

  it("discovers bundled public rooms from the room naming convention", async () => {
    const { listBundledViewerRooms } = await import("@/features/game/server/room-placement.server");

    await expect(listBundledViewerRooms()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "LAVENDER_ROOM",
          name: "LAVENDER ROOM",
          sceneUrl: "/rooms/LAVENDER_ROOM.spz",
          anchorUrl: "/rooms/LAVENDER_ROOM_ANCHORS.json",
        }),
      ]),
    );
  });

  it("rejects duplicate anchor ids", async () => {
    const { roomAnchorSetSchema } = await import("@/features/game/server/room-placement.server");

    expect(() =>
      roomAnchorSetSchema.parse({
        version: "1.0",
        created: "2026-03-29T03:44:14.009Z",
        description: "Anchors",
        totalCandidates: 2,
        anchors: [
          { id: 1, label: "A", surface: "surface", position: { x: 0, y: 0, z: 0 } },
          { id: 1, label: "B", surface: "surface", position: { x: 1, y: 1, z: 1 } },
        ],
      }),
    ).toThrow(/Duplicate anchor id 1/);
  });

  it("rejects mismatched anchor counts", async () => {
    const { roomAnchorSetSchema } = await import("@/features/game/server/room-placement.server");

    expect(() =>
      roomAnchorSetSchema.parse({
        version: "1.0",
        created: "2026-03-29T03:44:14.009Z",
        description: "Anchors",
        totalCandidates: 3,
        anchors: [{ id: 1, label: "A", surface: "surface", position: { x: 0, y: 0, z: 0 } }],
      }),
    ).toThrow(/totalCandidates/);
  });

  it("builds randomized placements capped by the smaller of anchors and ready assets", async () => {
    const { buildRoomPlacementPlan } = await import("@/features/game/server/room-placement.server");

    const result = buildRoomPlacementPlan({
      anchorSet: {
        version: "1.0",
        created: "2026-03-29T03:44:14.009Z",
        description: "Anchors",
        totalCandidates: 2,
        anchors: [
          { id: 10, label: "Desk", surface: "surface", position: { x: 1, y: 2, z: 3 } },
          { id: 11, label: "Shelf", surface: "surface", position: { x: 4, y: 5, z: 6 } },
        ],
      },
      concepts: [
        {
          id: "concept-1",
          userId: "user-1",
          name: "Neuron",
          description: "Signal cell",
          normalizedName: "neuron",
          room: { roomId: "room-1", name: "Science", slug: "science" },
          metaphor: null,
          embedding: null,
          asset: {
            status: "ready",
            provider: "s3",
            source: "trellis",
            url: "https://cdn.example.com/neuron.glb",
            styleVersion: "v1",
            updatedAt: "2026-03-29T00:00:00.000Z",
          },
          createdAt: "2026-03-29T00:00:00.000Z",
          updatedAt: "2026-03-29T00:00:00.000Z",
        },
        {
          id: "concept-2",
          userId: "user-1",
          name: "Atom",
          description: "Matter unit",
          normalizedName: "atom",
          room: { roomId: "room-1", name: "Science", slug: "science" },
          metaphor: null,
          embedding: null,
          asset: {
            status: "ready",
            provider: "s3",
            source: "trellis",
            url: "https://cdn.example.com/atom.glb",
            styleVersion: "v1",
            updatedAt: "2026-03-29T00:00:00.000Z",
          },
          createdAt: "2026-03-29T00:00:00.000Z",
          updatedAt: "2026-03-29T00:00:00.000Z",
        },
        {
          id: "concept-3",
          userId: "user-1",
          name: "Molecule",
          description: "Compound",
          normalizedName: "molecule",
          room: { roomId: "room-1", name: "Science", slug: "science" },
          metaphor: null,
          embedding: null,
          asset: {
            status: "ready",
            provider: "s3",
            source: "trellis",
            url: "https://cdn.example.com/molecule.glb",
            styleVersion: "v1",
            updatedAt: "2026-03-29T00:00:00.000Z",
          },
          createdAt: "2026-03-29T00:00:00.000Z",
          updatedAt: "2026-03-29T00:00:00.000Z",
        },
      ],
      random: () => 0,
    });

    expect(result.placements).toHaveLength(2);
    expect(new Set(result.placements.map((placement) => placement.anchorId)).size).toBe(2);
    expect(new Set(result.placements.map((placement) => placement.conceptId)).size).toBe(2);
    expect(result.unplacedConceptIds).toHaveLength(1);
  });

  it("returns empty placements when a room has no imported anchors", async () => {
    const { getRoomPlacementsForCurrentUser } =
      await import("@/features/game/server/room-placement.server");

    findRoomByIdForUser.mockResolvedValue({
      id: "room-1",
      userId: "user-1",
      name: "Science",
      slug: "science",
      description: "STEM",
      conceptCount: 2,
      anchorSetImportedAt: null,
      anchorCount: 0,
      createdAt: "2026-03-29T00:00:00.000Z",
      updatedAt: "2026-03-29T00:00:00.000Z",
    });
    getRoomAnchorSetByRoomId.mockResolvedValue(null);

    await expect(getRoomPlacementsForCurrentUser({ roomId: "room-1" })).resolves.toEqual({
      roomId: "room-1",
      anchorSetCreated: "",
      totalAnchors: 0,
      totalReadyConcepts: 0,
      placements: [],
      unplacedConceptIds: [],
    });
  });

  it("imports anchors for the current user after server-side validation", async () => {
    const { importRoomAnchorsForCurrentUser } =
      await import("@/features/game/server/room-placement.server");

    replaceRoomAnchorSet.mockResolvedValue({
      id: "room-1",
      userId: "user-1",
      name: "Science",
      slug: "science",
      description: "STEM",
      conceptCount: 2,
      anchorSetImportedAt: "2026-03-29T00:00:00.000Z",
      anchorCount: 1,
      createdAt: "2026-03-29T00:00:00.000Z",
      updatedAt: "2026-03-29T00:00:00.000Z",
    });

    const result = await importRoomAnchorsForCurrentUser({
      roomId: "room-1",
      anchorSet: {
        version: "1.0",
        created: "2026-03-29T03:44:14.009Z",
        description: "Anchors",
        totalCandidates: 1,
        anchors: [{ id: 1, label: "Desk", surface: "surface", position: { x: 0, y: 1, z: 2 } }],
      },
    });

    expect(replaceRoomAnchorSet).toHaveBeenCalledWith({
      userId: "user-1",
      roomId: "room-1",
      anchorSet: expect.objectContaining({
        totalCandidates: 1,
      }),
    });
    expect(result.anchorCount).toBe(1);
  });
});
