import { beforeEach, describe, expect, it, vi } from "vitest";

function makeReadyConcept(id: string) {
  return {
    id,
    userId: "user-1",
    name: `Concept ${id}`,
    description: `Description for ${id}.`,
    metaphor: {
      status: "ready" as const,
      objectName: `object ${id}`,
      prompt: `a prompt for ${id}`,
      rationale: "Signals.",
      generatedAt: "2026-03-28T12:00:00.000Z",
    },
    asset: null,
  };
}

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
    getConceptsNeedingAssets.mockResolvedValueOnce([
      makeReadyConcept("concept-1"),
      makeReadyConcept("concept-2"),
    ]);
    getConceptsNeedingAssets.mockResolvedValueOnce([]);
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
    expect(getConceptsNeedingAssets).toHaveBeenNthCalledWith(1, "user-1", 5, []);
    expect(getConceptsNeedingAssets).toHaveBeenNthCalledWith(
      2,
      "user-1",
      5,
      expect.arrayContaining(["concept-1", "concept-2"]),
    );
  });

  it("continues when one concept fails", async () => {
    getConceptsNeedingAssets.mockResolvedValueOnce([
      makeReadyConcept("concept-1"),
      makeReadyConcept("concept-2"),
    ]);
    getConceptsNeedingAssets.mockResolvedValueOnce([]);
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
    getConceptsNeedingAssets.mockResolvedValueOnce([makeReadyConcept("concept-1")]);
    getConceptsNeedingAssets.mockResolvedValueOnce([]);
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
    getConceptsNeedingAssets.mockResolvedValueOnce([makeReadyConcept("concept-1")]);
    getConceptsNeedingAssets.mockResolvedValueOnce([]);
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
    getConceptsNeedingAssets.mockResolvedValueOnce([makeReadyConcept("concept-1")]);
    getConceptsNeedingAssets.mockResolvedValueOnce([]);
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
    getConceptsNeedingAssets.mockResolvedValueOnce([makeReadyConcept("concept-1")]);
    getConceptsNeedingAssets.mockResolvedValueOnce([]);
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

  it("processes all ready concepts in repeated fixed waves of five", async () => {
    getConceptsNeedingAssets
      .mockResolvedValueOnce([
        makeReadyConcept("concept-1"),
        makeReadyConcept("concept-2"),
        makeReadyConcept("concept-3"),
        makeReadyConcept("concept-4"),
        makeReadyConcept("concept-5"),
      ])
      .mockResolvedValueOnce([makeReadyConcept("concept-6"), makeReadyConcept("concept-7")])
      .mockResolvedValueOnce([]);
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
    const result = await generateAssetsForPendingConcepts();

    expect(result.totalSelected).toBe(7);
    expect(result.succeeded).toBe(7);
    expect(getConceptsNeedingAssets).toHaveBeenCalledTimes(3);
    expect(getConceptsNeedingAssets).toHaveBeenNthCalledWith(1, "user-1", 5, []);
    expect(getConceptsNeedingAssets).toHaveBeenNthCalledWith(
      2,
      "user-1",
      5,
      expect.arrayContaining(["concept-1", "concept-2", "concept-3", "concept-4", "concept-5"]),
    );
  });

  it("starts five provider requests together when a full wave is available", async () => {
    const deferreds = Array.from({ length: 5 }, () =>
      Promise.withResolvers<{
        modelUrl: string;
        providerFileUrl: string;
        mimeType: string;
        fileExtension: string;
      }>(),
    );

    getConceptsNeedingAssets
      .mockResolvedValueOnce([
        makeReadyConcept("concept-1"),
        makeReadyConcept("concept-2"),
        makeReadyConcept("concept-3"),
        makeReadyConcept("concept-4"),
        makeReadyConcept("concept-5"),
      ])
      .mockResolvedValueOnce([]);
    tryMarkConceptProcessing.mockResolvedValue(true);
    generateTrellisModel
      .mockImplementationOnce(() => deferreds[0]!.promise)
      .mockImplementationOnce(() => deferreds[1]!.promise)
      .mockImplementationOnce(() => deferreds[2]!.promise)
      .mockImplementationOnce(() => deferreds[3]!.promise)
      .mockImplementationOnce(() => deferreds[4]!.promise);
    uploadGeneratedAssetToS3.mockResolvedValue({
      key: "concept-assets/user-1/concept-1/generation-1.glb",
      url: "https://cdn.example.com/concept-assets/user-1/concept-1/generation-1.glb",
      mimeType: "model/gltf-binary",
    });

    const { generateAssetsForPendingConcepts } =
      await import("@/features/asset-generation/server/asset-generation.server");
    const batchPromise = generateAssetsForPendingConcepts();

    await vi.waitFor(() => {
      expect(generateTrellisModel).toHaveBeenCalledTimes(5);
    });

    deferreds.forEach((deferred) =>
      deferred.resolve({
        modelUrl: "https://example.com/model.glb",
        providerFileUrl: "https://trellis.example.com/model.glb",
        mimeType: "model/gltf-binary",
        fileExtension: "glb",
      }),
    );

    const result = await batchPromise;
    expect(result.succeeded).toBe(5);
  });
});
