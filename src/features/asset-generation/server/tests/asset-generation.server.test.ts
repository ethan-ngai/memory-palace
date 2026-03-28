import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAuthUser = vi.fn();
const getConceptsNeedingAssets = vi.fn();
const tryMarkConceptProcessing = vi.fn();
const markConceptDone = vi.fn();
const markConceptFailed = vi.fn();
const submitHunyuanJob = vi.fn();
const pollHunyuanJobUntilComplete = vi.fn();
const uploadGeneratedAssetToS3 = vi.fn();
const buildHunyuanPrompt = vi.fn();

vi.mock("@/features/auth/server/auth-session.server", () => ({
  requireAuthUser,
}));

vi.mock("@/features/asset-generation/server/concepts-repo.server", () => ({
  getConceptsNeedingAssets,
  tryMarkConceptProcessing,
  markConceptDone,
  markConceptFailed,
}));

vi.mock("@/features/asset-generation/server/hunyuan-client.server", () => ({
  submitHunyuanJob,
  pollHunyuanJobUntilComplete,
}));

vi.mock("@/features/asset-generation/server/s3-storage.server", () => ({
  uploadGeneratedAssetToS3,
}));

vi.mock("@/features/asset-generation/server/prompt-builder.server", () => ({
  buildHunyuanPrompt,
}));

describe("generateAssetsForPendingConcepts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthUser.mockResolvedValue({ id: "user-1" });
    buildHunyuanPrompt.mockReturnValue("Generate one object.");
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
    submitHunyuanJob.mockResolvedValue({ jobId: "job-1", status: "queued" });
    pollHunyuanJobUntilComplete.mockResolvedValue({
      jobId: "job-1",
      status: "succeeded",
      modelUrl: "https://example.com/model.glb",
    });
    uploadGeneratedAssetToS3.mockResolvedValue({
      key: "concept-assets/user-1/concept-1/job-1.glb",
      url: "https://cdn.example.com/concept-assets/user-1/concept-1/job-1.glb",
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
    submitHunyuanJob
      .mockResolvedValueOnce({ jobId: "job-1", status: "queued" })
      .mockRejectedValueOnce(new Error("Hunyuan job submission failed."));
    pollHunyuanJobUntilComplete.mockResolvedValue({
      jobId: "job-1",
      status: "succeeded",
      modelUrl: "https://example.com/model.glb",
    });
    uploadGeneratedAssetToS3.mockResolvedValue({
      key: "concept-assets/user-1/concept-1/job-1.glb",
      url: "https://cdn.example.com/concept-assets/user-1/concept-1/job-1.glb",
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
    expect(submitHunyuanJob).not.toHaveBeenCalled();
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
    submitHunyuanJob.mockResolvedValue({ jobId: "job-1", status: "queued" });
    pollHunyuanJobUntilComplete.mockResolvedValue({
      jobId: "job-1",
      status: "succeeded",
      modelUrl: "https://example.com/model.glb",
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
});
