import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";

const conceptsState: Array<{
  _id: ObjectId;
  userId: string;
  name: string;
  description: string;
  normalizedName: string;
  roomId: string;
  roomName: string;
  roomSlug: string;
  embedding: {
    model: string;
    dimensions: number;
    values: number[];
    createdAt: Date;
  } | null;
  metaphor: {
    status: "pending" | "ready" | "failed";
    objectName: string;
    prompt: string;
    rationale: string;
    generatedAt: Date | null;
    errorMessage?: string;
  } | null;
  asset: {
    provider: "gcs" | "s3" | "r2" | "local" | "unknown";
    key: string;
    url?: string;
    mimeType?: string;
  } | null;
  createdAt: Date;
  updatedAt: Date;
}> = [];

const conceptsCollection = {
  createIndex: vi.fn(async () => "ok"),
  insertOne: vi.fn(async (document: (typeof conceptsState)[number]) => {
    conceptsState.push(document);
    return { acknowledged: true };
  }),
  findOneAndUpdate: vi.fn(
    async (
      query: { _id: ObjectId },
      update: {
        $set: {
          metaphor: (typeof conceptsState)[number]["metaphor"];
          updatedAt: Date;
        };
      },
    ) => {
      const concept = conceptsState.find((entry) => entry._id.equals(query._id));

      if (!concept) {
        return null;
      }

      concept.metaphor = update.$set.metaphor;
      concept.updatedAt = update.$set.updatedAt;
      return concept;
    },
  ),
  find: vi.fn((query: { userId: string; _id?: { $in: ObjectId[] } }) => {
    const filtered = [...conceptsState].filter((concept) => {
      if (concept.userId !== query.userId) {
        return false;
      }

      if (!query._id) {
        return true;
      }

      return query._id.$in.some((objectId) => objectId.equals(concept._id));
    });

    return {
      toArray: async () => filtered,
      sort: (sort: { updatedAt: 1 | -1 }) => ({
        toArray: async () =>
          [...filtered].sort((left, right) =>
            sort.updatedAt === -1
              ? right.updatedAt.getTime() - left.updatedAt.getTime()
              : left.updatedAt.getTime() - right.updatedAt.getTime(),
          ),
      }),
    };
  }),
};

vi.mock("@/lib/server/mongodb.server", () => ({
  getDatabase: vi.fn(async () => ({
    collection: () => conceptsCollection,
  })),
}));

describe("concept repository", () => {
  beforeEach(() => {
    conceptsState.length = 0;
    vi.clearAllMocks();
  });

  it("creates a concept linked to a room", async () => {
    const { createConceptForUser } =
      await import("@/features/concept-extraction/server/concept.repository.server");

    const created = await createConceptForUser({
      userId: "user-1",
      name: "Neuron",
      description: "Cell that transmits signals.",
      normalizedName: "neuron",
      room: {
        roomId: "room-1",
        name: "Science",
        slug: "science",
      },
      embedding: {
        model: "embedding-model",
        dimensions: 3,
        values: [0.1, 0.2, 0.3],
        createdAt: "2026-03-28T12:00:00.000Z",
      },
      asset: {
        status: "ready",
        provider: "s3",
        source: "hunyuan",
        key: "assets/neuron.glb",
        styleVersion: "low-poly-v1",
        updatedAt: "2026-03-28T12:00:00.000Z",
      },
    });

    expect(created.room.slug).toBe("science");
    expect(created.metaphor).toBeNull();
    expect(created.embedding?.dimensions).toBe(3);
    expect(created.asset?.key).toBe("assets/neuron.glb");
  });

  it("lists concepts scoped to one user only", async () => {
    const { createConceptForUser, listConceptsByUserId } =
      await import("@/features/concept-extraction/server/concept.repository.server");

    await createConceptForUser({
      userId: "user-1",
      name: "Neuron",
      description: "Cell that transmits signals.",
      normalizedName: "neuron",
      room: {
        roomId: "room-1",
        name: "Science",
        slug: "science",
      },
    });
    await createConceptForUser({
      userId: "user-2",
      name: "Atom",
      description: "Basic unit of matter.",
      normalizedName: "atom",
      room: {
        roomId: "room-2",
        name: "Chemistry",
        slug: "chemistry",
      },
    });

    const concepts = await listConceptsByUserId("user-1");
    expect(concepts).toHaveLength(1);
    expect(concepts[0]?.name).toBe("Neuron");
  });

  it("finds concepts by id in request order and updates the stored metaphor", async () => {
    const { createConceptForUser, findConceptsByIdsForUser, updateConceptMetaphorById } =
      await import("@/features/concept-extraction/server/concept.repository.server");

    const first = await createConceptForUser({
      userId: "user-1",
      name: "Neuron",
      description: "Cell that transmits signals.",
      normalizedName: "neuron",
      room: {
        roomId: "room-1",
        name: "Science",
        slug: "science",
      },
    });
    const second = await createConceptForUser({
      userId: "user-1",
      name: "Atom",
      description: "Basic unit of matter.",
      normalizedName: "atom",
      room: {
        roomId: "room-1",
        name: "Science",
        slug: "science",
      },
    });

    const ordered = await findConceptsByIdsForUser("user-1", [second.id, first.id]);
    expect(ordered.map((concept) => concept.id)).toEqual([second.id, first.id]);

    const updated = await updateConceptMetaphorById({
      conceptId: first.id,
      metaphor: {
        status: "ready",
        objectName: "glowing neuron lantern",
        prompt:
          "A glowing neuron-shaped lantern with branching filaments, glass shell, clean silhouette.",
        rationale: "The lantern conveys signal transmission and branching structure.",
        generatedAt: "2026-03-28T15:00:00.000Z",
      },
    });

    expect(updated.metaphor?.objectName).toBe("glowing neuron lantern");
    expect(updated.metaphor?.generatedAt).toBe("2026-03-28T15:00:00.000Z");
  });
});
