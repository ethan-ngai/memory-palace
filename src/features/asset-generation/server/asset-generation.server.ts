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
  AssetGenerationResultItem,
} from "@/features/asset-generation/types";

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
  worker: (item: TInput) => Promise<TOutput>,
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
          value: await worker(items[currentIndex] as TInput),
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
      return {
        conceptId: input.concept.id,
        status: "skipped",
      };
    }

    jobId = crypto.randomUUID();
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

    return {
      conceptId: input.concept.id,
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

      return {
        conceptId: input.concept.id,
        status: "failed",
        jobId,
        error: `${safeError} ${markMessage}`.trim(),
      };
    }

    return {
      conceptId: input.concept.id,
      status: "failed",
      jobId,
      error: safeError,
    };
  }
}

/**
 * Starts one bounded-concurrency TRELLIS asset generation batch for the current authenticated user.
 * @param options - Optional batch size and concurrency overrides.
 * @returns A JSON-safe summary of selected, claimed, succeeded, failed, and skipped concepts.
 * @remarks
 * - The server function kicks off the batch and waits for completion before returning.
 * - Each concept becomes its own live TRELLIS request with isolated Mongo updates.
 * - Concurrency is capped so third-party app usage stays bounded.
 */
export async function generateAssetsForPendingConcepts(
  options?: AssetGenerationBatchOptions,
): Promise<AssetGenerationBatchResult> {
  const parsedOptions = assetGenerationBatchOptionsSchema.parse(options);
  const user = await requireAuthUser();
  return generateAssetsForPendingConceptsForUser(user.id, parsedOptions);
}

/**
 * Runs the bounded-concurrency asset generation batch for one explicit user id.
 * @param userId - User whose ready-metaphor concepts should be selected from MongoDB.
 * @param options - Optional batch size and concurrency overrides.
 * @returns A JSON-safe summary of selected, claimed, succeeded, failed, and skipped concepts.
 * @remarks This is exported primarily so local server-side scripts can verify TRELLIS and S3 integration without a browser session.
 */
export async function generateAssetsForPendingConceptsForUser(
  userId: string,
  options?: AssetGenerationBatchOptions,
): Promise<AssetGenerationBatchResult> {
  const parsedOptions = assetGenerationBatchOptionsSchema.parse(options);
  const batchSize = parsedOptions?.batchSize ?? 10;
  const concurrency = parsedOptions?.concurrency ?? 3;
  const candidates = await getConceptsNeedingAssets(userId, batchSize);
  const runId = crypto.randomUUID();

  const settled = await mapWithConcurrencyLimit(candidates, concurrency, async (concept) =>
    processOneConcept({
      concept,
      userId,
      runId,
    }),
  );
  const results = settled.map((result, index) => {
    if (result.status === "fulfilled") {
      return result.value;
    }

    return {
      conceptId: candidates[index]?.id ?? `unknown-${index}`,
      status: "failed",
      error: result.reason instanceof Error ? result.reason.message : "Asset generation failed.",
    } satisfies AssetGenerationResultItem;
  });

  return {
    totalSelected: candidates.length,
    totalClaimed: results.filter((result) => result.status !== "skipped").length,
    succeeded: results.filter((result) => result.status === "succeeded").length,
    failed: results.filter((result) => result.status === "failed").length,
    skipped: results.filter((result) => result.status === "skipped").length,
    results,
  };
}
