import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";

const conceptDocuments: any[] = [];

function matchesFilter(document: any, filter: any) {
  if (filter._id && !document._id.equals(filter._id)) {
    return false;
  }

  if (filter.userId && document.userId !== filter.userId) {
    return false;
  }

  if (filter["metaphor.status"] && document.metaphor?.status !== filter["metaphor.status"]) {
    return false;
  }

  if (filter["metaphor.prompt"]) {
    const prompt = document.metaphor?.prompt;
    if (typeof prompt !== "string" || prompt.length === 0) {
      return false;
    }
  }

  if (filter.$or) {
    return filter.$or.some((condition: any) => {
      if ("asset" in condition && condition.asset?.$exists === false) {
        return typeof document.asset === "undefined";
      }

      if ("asset" in condition && condition.asset === null) {
        return document.asset === null;
      }

      if (condition["asset.status"]) {
        return document.asset?.status === condition["asset.status"];
      }

      return false;
    });
  }

  return true;
}

const conceptsCollection = {
  find: vi.fn((filter: any) => {
    let documents = conceptDocuments.filter((document) => matchesFilter(document, filter));

    return {
      sort: (sort: { updatedAt: 1 | -1 }) => {
        documents = [...documents].sort((left, right) =>
          sort.updatedAt === -1
            ? right.updatedAt.getTime() - left.updatedAt.getTime()
            : left.updatedAt.getTime() - right.updatedAt.getTime(),
        );

        return {
          limit: (limit: number) => ({
            toArray: async () => documents.slice(0, limit),
          }),
        };
      },
    };
  }),
  updateOne: vi.fn(async (filter: any, update: any) => {
    const document = conceptDocuments.find((entry) => matchesFilter(entry, filter));

    if (!document) {
      return { modifiedCount: 0 };
    }

    Object.assign(document, update.$set);
    return { modifiedCount: 1 };
  }),
  findOne: vi.fn(
    async (filter: any) => conceptDocuments.find((entry) => matchesFilter(entry, filter)) ?? null,
  ),
};

vi.mock("@/features/concept-extraction/server/concept.repository.server", () => ({
  getConceptsCollection: vi.fn(async () => conceptsCollection),
}));

describe("asset generation concepts repo", () => {
  beforeEach(() => {
    conceptDocuments.length = 0;
    vi.clearAllMocks();

    conceptDocuments.push(
      {
        _id: new ObjectId(),
        userId: "user-1",
        name: "Neuron",
        description: "Cell that transmits signals.",
        normalizedName: "neuron",
        roomId: "room-1",
        roomName: "Science",
        roomSlug: "science",
        metaphor: {
          status: "ready",
          objectName: "glass neuron lantern",
          prompt: "A glass neuron lantern.",
          rationale: "Signals.",
          generatedAt: new Date("2026-03-28T12:00:00.000Z"),
        },
        embedding: null,
        asset: null,
        createdAt: new Date("2026-03-28T12:00:00.000Z"),
        updatedAt: new Date("2026-03-28T12:00:00.000Z"),
      },
      {
        _id: new ObjectId(),
        userId: "user-1",
        name: "Atom",
        description: "Basic unit of matter.",
        normalizedName: "atom",
        roomId: "room-1",
        roomName: "Science",
        roomSlug: "science",
        metaphor: {
          status: "ready",
          objectName: "clockwork atom core",
          prompt: "A clockwork atom core.",
          rationale: "Structure.",
          generatedAt: new Date("2026-03-28T12:00:00.000Z"),
        },
        embedding: null,
        asset: {
          status: "ready",
          provider: "s3",
          source: "trellis",
          key: "concept-assets/user-1/atom.glb",
          url: "https://cdn.example.com/concept-assets/user-1/atom.glb",
          styleVersion: "standard-3d-v2",
          updatedAt: new Date("2026-03-28T12:00:00.000Z"),
        },
        createdAt: new Date("2026-03-28T12:00:00.000Z"),
        updatedAt: new Date("2026-03-28T12:00:00.000Z"),
      },
    );
  });

  it("returns only concepts needing assets", async () => {
    const { getConceptsNeedingAssets } =
      await import("@/features/asset-generation/server/concepts-repo.server");
    const result = await getConceptsNeedingAssets("user-1", 10);

    expect(result).toHaveLength(1);
    expect(result[0]?.name).toBe("Neuron");
  });

  it("does not return concepts already processing", async () => {
    conceptDocuments.push({
      _id: new ObjectId(),
      userId: "user-1",
      name: "Mitochondria",
      description: "Powerhouse of the cell.",
      normalizedName: "mitochondria",
      roomId: "room-1",
      roomName: "Science",
      roomSlug: "science",
      metaphor: {
        status: "ready",
        objectName: "battery chamber",
        prompt: "A faceted battery chamber.",
        rationale: "Energy production.",
        generatedAt: new Date("2026-03-28T12:00:00.000Z"),
      },
      embedding: null,
      asset: {
        status: "processing",
        provider: "s3",
        source: "trellis",
        styleVersion: "standard-3d-v2",
        updatedAt: new Date("2026-03-28T12:00:00.000Z"),
      },
      createdAt: new Date("2026-03-28T12:00:00.000Z"),
      updatedAt: new Date("2026-03-28T12:00:00.000Z"),
    });

    const { getConceptsNeedingAssets } =
      await import("@/features/asset-generation/server/concepts-repo.server");
    const result = await getConceptsNeedingAssets("user-1", 10);

    expect(result.map((concept) => concept.name)).toEqual(["Neuron"]);
  });

  it("claims a concept atomically and refuses a second claim", async () => {
    const { getConceptsNeedingAssets, tryMarkConceptProcessing } =
      await import("@/features/asset-generation/server/concepts-repo.server");
    const [concept] = await getConceptsNeedingAssets("user-1", 10);

    const firstClaim = await tryMarkConceptProcessing({
      id: concept?.id as string,
      userId: "user-1",
      prompt: "Generate one object.",
      runId: "run-1",
    });
    const secondClaim = await tryMarkConceptProcessing({
      id: concept?.id as string,
      userId: "user-1",
      prompt: "Generate one object.",
      runId: "run-1",
    });

    expect(firstClaim).toBe(true);
    expect(secondClaim).toBe(false);
    expect(conceptDocuments[0]?.asset?.source).toBe("trellis");
  });

  it("marks a concept ready", async () => {
    const { getConceptsNeedingAssets, markConceptDone } =
      await import("@/features/asset-generation/server/concepts-repo.server");
    const [concept] = await getConceptsNeedingAssets("user-1", 10);

    await markConceptDone({
      id: concept?.id as string,
      userId: "user-1",
      prompt: "Generate one object.",
      jobId: "job-1",
      key: "concept-assets/user-1/concept-1/job-1.glb",
      url: "https://cdn.example.com/concept-assets/user-1/concept-1/job-1.glb",
      mimeType: "model/gltf-binary",
    });

    expect(conceptDocuments[0]?.asset?.status).toBe("ready");
    expect(conceptDocuments[0]?.asset?.jobId).toBe("job-1");
    expect(conceptDocuments[0]?.asset?.source).toBe("trellis");
  });

  it("marks a concept failed", async () => {
    const { getConceptsNeedingAssets, markConceptFailed } =
      await import("@/features/asset-generation/server/concepts-repo.server");
    const [concept] = await getConceptsNeedingAssets("user-1", 10);

    await markConceptFailed({
      id: concept?.id as string,
      userId: "user-1",
      prompt: "Generate one object.",
      error: "Trellis generation timed out.",
      jobId: "job-1",
    });

    expect(conceptDocuments[0]?.asset?.status).toBe("failed");
    expect(conceptDocuments[0]?.asset?.error).toBe("Trellis generation timed out.");
    expect(conceptDocuments[0]?.asset?.source).toBe("trellis");
  });
});
