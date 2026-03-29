/**
 * @file asset-generation.server.ts
 * @description Coordinates bounded-concurrency TRELLIS generation and per-concept asset persistence.
 * @module asset-generation
 */
import { z } from "zod";
import { requireAuthUser } from "@/features/auth/server/auth-session.server";
import {
  getConceptsNeedingAssets,
  markConceptDone,
  markConceptFailed,
  tryMarkConceptProcessing,
} from "@/features/asset-generation/server/concepts-repo.server";
import { buildAssetGenerationPrompt } from "@/features/asset-generation/server/prompt-builder.server";
import { generateTrellisModel } from "@/features/asset-generation/server/trellis-client.server";
import { uploadGeneratedAssetToS3 } from "@/features/asset-generation/server/s3-storage.server";
import type {
  AssetGenerationBatchOptions,
  AssetGenerationBatchResult,
  AssetGenerationConceptRow,
  AssetGenerationBatchRuntimeOptions,
  AssetGenerationProgressEvent,
  AssetGenerationResultItem,
} from "@/features/asset-generation/types";

/**
 * Fixed concept count selected for each diffusion batch wave.
 * @description Normal app flows always send at most five concepts to the provider before selecting the next batch.
 */
export const FIXED_ASSET_BATCH_SIZE = 5;

/**
 * Fixed number of in-flight diffusion requests per batch wave.
 * @description Matches the required five-at-a-time policy so every selected concept in a batch starts together.
 */
export const FIXED_ASSET_CONCURRENCY = 5;

export const assetGenerationBatchOptionsSchema = z
  .object({
    batchSize: z.number().int().min(1).max(50).optional(),
    concurrency: z.number().int().min(1).max(5).optional(),
  })
  .optional();

/**
 * Runs work items with a bounded number of concurrent workers.
 * @param items - Items that should be processed.
 * @param concurrency - Maximum number of in-flight workers.
 * @param worker - Async worker function for each item.
 * @returns Settled results for every scheduled worker.
 * @remarks This keeps the batch safe for third-party APIs without introducing an external limiter dependency.
 */
async function mapWithConcurrencyLimit<TInput, TOutput>(
  items: TInput[],
  concurrency: number,
  worker: (item: TInput, index: number) => Promise<TOutput>,
): Promise<PromiseSettledResult<TOutput>[]> {
  const settledResults: PromiseSettledResult<TOutput>[] = new Array(items.length);
  let cursor = 0;

  async function runNext() {
    while (cursor < items.length) {
      const currentIndex = cursor;
      cursor += 1;

      try {
        settledResults[currentIndex] = {
          status: "fulfilled",
          value: await worker(items[currentIndex] as TInput, currentIndex),
        };
      } catch (error) {
        settledResults[currentIndex] = {
          status: "rejected",
          reason: error,
        };
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => runNext()));
  return settledResults;
}

/**
 * Processes one concept through prompt building, TRELLIS generation, upload, and Mongo updates.
 * @param input - Claimed concept metadata plus the owning user id and batch run id.
 * @returns A per-concept result object for the batch summary.
 * @remarks One concept failure never throws past this boundary after failure state is recorded.
 */
async function processOneConcept(input: {
  concept: AssetGenerationConceptRow;
  userId: string;
  runId: string;
  conceptIndex: number;
  totalConcepts: number;
  onProgress?: (event: AssetGenerationProgressEvent) => void;
}): Promise<AssetGenerationResultItem> {
  let prompt: string | undefined;
  let jobId: string | undefined;

  try {
    prompt = buildAssetGenerationPrompt(input.concept);
    const claimed = await tryMarkConceptProcessing({
      id: input.concept.id,
      userId: input.userId,
      prompt,
      runId: input.runId,
    });

    if (!claimed) {
      input.onProgress?.({
        phase: "skipped",
        conceptId: input.concept.id,
        conceptName: input.concept.name,
        conceptIndex: input.conceptIndex,
        totalConcepts: input.totalConcepts,
        objectName: input.concept.metaphor?.objectName,
        prompt,
      });

      return {
        conceptId: input.concept.id,
        conceptName: input.concept.name,
        status: "skipped",
      };
    }

    jobId = crypto.randomUUID();
    input.onProgress?.({
      phase: "started",
      conceptId: input.concept.id,
      conceptName: input.concept.name,
      conceptIndex: input.conceptIndex,
      totalConcepts: input.totalConcepts,
      objectName: input.concept.metaphor?.objectName,
      prompt,
      jobId,
    });
    const generated = await generateTrellisModel(prompt);
    const uploaded = await uploadGeneratedAssetToS3({
      userId: input.userId,
      conceptId: input.concept.id,
      jobId,
      modelUrl: generated.modelUrl,
      previewUrl: generated.previewUrl,
      mimeType: generated.mimeType,
      fileExtension: generated.fileExtension,
    });

    await markConceptDone({
      id: input.concept.id,
      userId: input.userId,
      prompt,
      jobId,
      key: uploaded.key,
      url: uploaded.url,
      previewKey: uploaded.previewKey,
      previewUrl: uploaded.previewUrl,
      mimeType: uploaded.mimeType,
    });

    input.onProgress?.({
      phase: "succeeded",
      conceptId: input.concept.id,
      conceptName: input.concept.name,
      conceptIndex: input.conceptIndex,
      totalConcepts: input.totalConcepts,
      objectName: input.concept.metaphor?.objectName,
      prompt,
      jobId,
      assetUrl: uploaded.url,
    });

    return {
      conceptId: input.concept.id,
      conceptName: input.concept.name,
      status: "succeeded",
      jobId,
      assetUrl: uploaded.url,
      previewUrl: uploaded.previewUrl,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown asset generation failure.";
    const safeError =
      message === "Concept is missing a ready metaphor."
        ? message
        : message === "Trellis generation timed out."
          ? message
          : message === "Malformed Trellis response."
            ? message
            : message === "Failed to download generated asset." ||
                message === "Failed to upload generated asset to storage."
              ? "Generated asset upload failed."
              : message.startsWith("Failed to connect to the Trellis app.")
                ? message
                : message === "Trellis generation is not configured."
                  ? message
                  : message.startsWith("Trellis generation failed.")
                    ? message
                    : "Asset generation failed.";

    try {
      await markConceptFailed({
        id: input.concept.id,
        userId: input.userId,
        prompt,
        error: safeError,
        jobId,
      });
    } catch (markError) {
      const markMessage =
        markError instanceof Error ? markError.message : "Failed to persist asset failure state.";
      const combinedError = `${safeError} ${markMessage}`.trim();

      input.onProgress?.({
        phase: "failed",
        conceptId: input.concept.id,
        conceptName: input.concept.name,
        conceptIndex: input.conceptIndex,
        totalConcepts: input.totalConcepts,
        objectName: input.concept.metaphor?.objectName,
        prompt,
        jobId,
        error: combinedError,
      });

      return {
        conceptId: input.concept.id,
        conceptName: input.concept.name,
        status: "failed",
        jobId,
        error: combinedError,
      };
    }

    input.onProgress?.({
      phase: "failed",
      conceptId: input.concept.id,
      conceptName: input.concept.name,
      conceptIndex: input.conceptIndex,
      totalConcepts: input.totalConcepts,
      objectName: input.concept.metaphor?.objectName,
      prompt,
      jobId,
      error: safeError,
    });

    return {
      conceptId: input.concept.id,
      conceptName: input.concept.name,
      status: "failed",
      jobId,
      error: safeError,
    };
  }
}

/**
 * Starts one bounded-concurrency TRELLIS asset generation batch for the current authenticated user.
 * @param options - Ignored compatibility options retained so older callers do not break.
 * @returns A JSON-safe summary of selected, claimed, succeeded, failed, and skipped concepts.
 * @remarks
 * - The server function kicks off repeated fixed-size waves and waits for all of them to finish before returning.
 * - Each wave selects up to five concepts and launches up to five live TRELLIS requests in parallel.
 * - Caller-supplied batch tuning is ignored so app behavior stays consistent across manual scripts and frontend calls.
 */
export async function generateAssetsForPendingConcepts(
  options?: AssetGenerationBatchOptions,
): Promise<AssetGenerationBatchResult> {
  assetGenerationBatchOptionsSchema.parse(options);
  const user = await requireAuthUser();
  return generateAssetsForPendingConceptsForUser(user.id);
}

/**
 * Runs the bounded-concurrency asset generation batch for one explicit user id.
 * @param userId - User whose ready-metaphor concepts should be selected from MongoDB.
 * @param options - Server-side runtime options; progress callbacks are honored, batch tuning is ignored.
 * @returns A JSON-safe summary of selected, claimed, succeeded, failed, and skipped concepts.
 * @remarks
 * - This loops through all currently ready concepts in repeated five-at-a-time waves.
 * - Failed or skipped concepts are excluded from reselection during the same run so one bad item cannot trap the batch in a retry loop.
 * - Exported primarily so local server-side scripts can verify TRELLIS and S3 integration without a browser session.
 */
export async function generateAssetsForPendingConceptsForUser(
  userId: string,
  options?: AssetGenerationBatchRuntimeOptions,
): Promise<AssetGenerationBatchResult> {
  assetGenerationBatchOptionsSchema.parse(options);
  const onProgress = options?.onProgress;
  const runId = crypto.randomUUID();
  const attemptedConceptIds = new Set<string>();
  const results: AssetGenerationResultItem[] = [];
  let totalSelected = 0;

  while (true) {
    const candidates = await getConceptsNeedingAssets(
      userId,
      FIXED_ASSET_BATCH_SIZE,
      Array.from(attemptedConceptIds),
    );

    if (candidates.length === 0) {
      break;
    }

    totalSelected += candidates.length;
    candidates.forEach((concept) => attemptedConceptIds.add(concept.id));
    candidates.forEach((concept, index) => {
      onProgress?.({
        phase: "selected",
        conceptId: concept.id,
        conceptName: concept.name,
        conceptIndex: index + 1,
        totalConcepts: candidates.length,
        objectName: concept.metaphor?.objectName,
        prompt: concept.metaphor?.prompt ?? undefined,
      });
    });

    const settled = await mapWithConcurrencyLimit(
      candidates,
      FIXED_ASSET_CONCURRENCY,
      async (concept, index) =>
        processOneConcept({
          concept,
          userId,
          runId,
          conceptIndex: index + 1,
          totalConcepts: candidates.length,
          onProgress,
        }),
    );

    results.push(
      ...settled.map((result, index) => {
        if (result.status === "fulfilled") {
          return result.value;
        }

        return {
          conceptId: candidates[index]?.id ?? `unknown-${index}`,
          conceptName: candidates[index]?.name,
          status: "failed",
          error:
            result.reason instanceof Error ? result.reason.message : "Asset generation failed.",
        } satisfies AssetGenerationResultItem;
      }),
    );
  }

  return {
    totalSelected,
    totalClaimed: results.filter((result) => result.status !== "skipped").length,
    succeeded: results.filter((result) => result.status === "succeeded").length,
    failed: results.filter((result) => result.status === "failed").length,
    skipped: results.filter((result) => result.status === "skipped").length,
    results,
  };
}
