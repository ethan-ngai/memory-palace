import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAuthUser = vi.fn();
const getConceptsNeedingAssets = vi.fn();
const tryMarkConceptProcessing = vi.fn();
const markConceptDone = vi.fn();
const markConceptFailed = vi.fn();
const generateTrellisModel = vi.fn();
const uploadGeneratedAssetToS3 = vi.fn();
const buildAssetGenerationPrompt = vi.fn();

vi.mock("@/features/auth/server/auth-session.server", () => ({
  requireAuthUser,
}));

vi.mock("@/features/asset-generation/server/concepts-repo.server", () => ({
  getConceptsNeedingAssets,
  tryMarkConceptProcessing,
  markConceptDone,
  markConceptFailed,
}));

vi.mock("@/features/asset-generation/server/trellis-client.server", () => ({
  generateTrellisModel,
}));

vi.mock("@/features/asset-generation/server/s3-storage.server", () => ({
  uploadGeneratedAssetToS3,
}));

vi.mock("@/features/asset-generation/server/prompt-builder.server", () => ({
  buildAssetGenerationPrompt,
}));

describe("generateAssetsForPendingConcepts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthUser.mockResolvedValue({ id: "user-1" });
    buildAssetGenerationPrompt.mockReturnValue("Generate one object.");
  });

  it("processes a batch and returns summary counts", async () => {
    getConceptsNeedingAssets.mockResolvedValue([
      {
        id: "concept-1",
        userId: "user-1",
        name: "Neuron",
        description: "Cell that transmits signals.",
        metaphor: {
          status: "ready",
          objectName: "glass neuron lantern",
          prompt: "A glass neuron lantern.",
          rationale: "Signals.",
          generatedAt: "2026-03-28T12:00:00.000Z",
        },
        asset: null,
      },
      {
        id: "concept-2",
        userId: "user-1",
        name: "Atom",
        description: "Basic unit of matter.",
        metaphor: {
          status: "ready",
          objectName: "clockwork atom core",
          prompt: "A clockwork atom core.",
          rationale: "Structure.",
          generatedAt: "2026-03-28T12:00:00.000Z",
        },
        asset: null,
      },
    ]);
    tryMarkConceptProcessing.mockResolvedValue(true);
    generateTrellisModel.mockResolvedValue({
      modelUrl: "https://example.com/model.glb",
      providerFileUrl: "https://trellis.example.com/model.glb",
      mimeType: "model/gltf-binary",
      fileExtension: "glb",
    });
    uploadGeneratedAssetToS3.mockResolvedValue({
      key: "concept-assets/user-1/concept-1/generation-1.glb",
      url: "https://cdn.example.com/concept-assets/user-1/concept-1/generation-1.glb",
      mimeType: "model/gltf-binary",
    });

    const { generateAssetsForPendingConcepts } =
      await import("@/features/asset-generation/server/asset-generation.server");
    const result = await generateAssetsForPendingConcepts({
      batchSize: 10,
      concurrency: 3,
    });

    expect(result.totalSelected).toBe(2);
    expect(result.succeeded).toBe(2);
    expect(result.failed).toBe(0);
    expect(markConceptDone).toHaveBeenCalledTimes(2);
  });

  it("continues when one concept fails", async () => {
    getConceptsNeedingAssets.mockResolvedValue([
      {
        id: "concept-1",
        userId: "user-1",
        name: "Neuron",
        description: "Cell that transmits signals.",
        metaphor: {
          status: "ready",
          objectName: "glass neuron lantern",
          prompt: "A glass neuron lantern.",
          rationale: "Signals.",
          generatedAt: "2026-03-28T12:00:00.000Z",
        },
        asset: null,
      },
      {
        id: "concept-2",
        userId: "user-1",
        name: "Atom",
        description: "Basic unit of matter.",
        metaphor: {
          status: "ready",
          objectName: "clockwork atom core",
          prompt: "A clockwork atom core.",
          rationale: "Structure.",
          generatedAt: "2026-03-28T12:00:00.000Z",
        },
        asset: null,
      },
    ]);
    tryMarkConceptProcessing.mockResolvedValue(true);
    generateTrellisModel
      .mockResolvedValueOnce({
        modelUrl: "https://example.com/model.glb",
        providerFileUrl: "https://trellis.example.com/model.glb",
        mimeType: "model/gltf-binary",
        fileExtension: "glb",
      })
      .mockRejectedValueOnce(new Error("Trellis generation failed."));
    uploadGeneratedAssetToS3.mockResolvedValue({
      key: "concept-assets/user-1/concept-1/generation-1.glb",
      url: "https://cdn.example.com/concept-assets/user-1/concept-1/generation-1.glb",
      mimeType: "model/gltf-binary",
    });

    const { generateAssetsForPendingConcepts } =
      await import("@/features/asset-generation/server/asset-generation.server");
    const result = await generateAssetsForPendingConcepts();

    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(1);
    expect(markConceptFailed).toHaveBeenCalledTimes(1);
  });

  it("skips concepts that lose the claim race", async () => {
    getConceptsNeedingAssets.mockResolvedValue([
      {
        id: "concept-1",
        userId: "user-1",
        name: "Neuron",
        description: "Cell that transmits signals.",
        metaphor: {
          status: "ready",
          objectName: "glass neuron lantern",
          prompt: "A glass neuron lantern.",
          rationale: "Signals.",
          generatedAt: "2026-03-28T12:00:00.000Z",
        },
        asset: null,
      },
    ]);
    tryMarkConceptProcessing.mockResolvedValue(false);

    const { generateAssetsForPendingConcepts } =
      await import("@/features/asset-generation/server/asset-generation.server");
    const result = await generateAssetsForPendingConcepts();

    expect(result.skipped).toBe(1);
    expect(generateTrellisModel).not.toHaveBeenCalled();
  });

  it("requires an authenticated user", async () => {
    requireAuthUser.mockRejectedValue(new Error("Unauthorized"));

    const { generateAssetsForPendingConcepts } =
      await import("@/features/asset-generation/server/asset-generation.server");

    await expect(generateAssetsForPendingConcepts()).rejects.toThrow("Unauthorized");
  });

  it("normalizes upload failures into a safe asset error", async () => {
    getConceptsNeedingAssets.mockResolvedValue([
      {
        id: "concept-1",
        userId: "user-1",
        name: "Neuron",
        description: "Cell that transmits signals.",
        metaphor: {
          status: "ready",
          objectName: "glass neuron lantern",
          prompt: "A glass neuron lantern.",
          rationale: "Signals.",
          generatedAt: "2026-03-28T12:00:00.000Z",
        },
        asset: null,
      },
    ]);
    tryMarkConceptProcessing.mockResolvedValue(true);
    generateTrellisModel.mockResolvedValue({
      modelUrl: "https://example.com/model.glb",
      providerFileUrl: "https://trellis.example.com/model.glb",
      mimeType: "model/gltf-binary",
      fileExtension: "glb",
    });
    uploadGeneratedAssetToS3.mockRejectedValue(
      new Error("Failed to upload generated asset to storage."),
    );

    const { generateAssetsForPendingConcepts } =
      await import("@/features/asset-generation/server/asset-generation.server");
    const result = await generateAssetsForPendingConcepts();

    expect(result.failed).toBe(1);
    expect(result.results[0]?.error).toBe("Generated asset upload failed.");
    expect(markConceptFailed).toHaveBeenCalledWith(
      expect.objectContaining({
        error: "Generated asset upload failed.",
      }),
    );
  });

  it("preserves detailed Trellis provider failures in the batch result", async () => {
    getConceptsNeedingAssets.mockResolvedValue([
      {
        id: "concept-1",
        userId: "user-1",
        name: "Neuron",
        description: "Cell that transmits signals.",
        metaphor: {
          status: "ready",
          objectName: "glass neuron lantern",
          prompt: "A glass neuron lantern.",
          rationale: "Signals.",
          generatedAt: "2026-03-28T12:00:00.000Z",
        },
        asset: null,
      },
    ]);
    tryMarkConceptProcessing.mockResolvedValue(true);
    generateTrellisModel.mockRejectedValue(
      new Error("Trellis generation failed. Generation submit failed with status 503."),
    );

    const { generateAssetsForPendingConcepts } =
      await import("@/features/asset-generation/server/asset-generation.server");
    const result = await generateAssetsForPendingConcepts();

    expect(result.failed).toBe(1);
    expect(result.results[0]?.error).toBe(
      "Trellis generation failed. Generation submit failed with status 503.",
    );
    expect(markConceptFailed).toHaveBeenCalledWith(
      expect.objectContaining({
        error: "Trellis generation failed. Generation submit failed with status 503.",
      }),
    );
  });

  it("uses a synthetic generation id as the persisted job id", async () => {
    getConceptsNeedingAssets.mockResolvedValue([
      {
        id: "concept-1",
        userId: "user-1",
        name: "Neuron",
        description: "Cell that transmits signals.",
        metaphor: {
          status: "ready",
          objectName: "glass neuron lantern",
          prompt: "A glass neuron lantern.",
          rationale: "Signals.",
          generatedAt: "2026-03-28T12:00:00.000Z",
        },
        asset: null,
      },
    ]);
    tryMarkConceptProcessing.mockResolvedValue(true);
    generateTrellisModel.mockResolvedValue({
      modelUrl: "https://example.com/model.glb",
      providerFileUrl: "https://trellis.example.com/model.glb",
      mimeType: "model/gltf-binary",
      fileExtension: "glb",
    });
    uploadGeneratedAssetToS3.mockResolvedValue({
      key: "concept-assets/user-1/concept-1/generation-1.glb",
      url: "https://cdn.example.com/concept-assets/user-1/concept-1/generation-1.glb",
      mimeType: "model/gltf-binary",
    });

    const { generateAssetsForPendingConcepts } =
      await import("@/features/asset-generation/server/asset-generation.server");
    await generateAssetsForPendingConcepts();

    expect(uploadGeneratedAssetToS3).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: expect.any(String),
      }),
    );
    expect(markConceptDone).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: expect.any(String),
      }),
    );
  });
});
