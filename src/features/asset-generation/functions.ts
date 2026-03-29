/**
 * @file functions.ts
 * @description Client-callable server functions for asset generation.
 * @module asset-generation
 */
import { createServerFn } from "@tanstack/react-start";
import {
  assetGenerationBatchOptionsSchema,
  generateConceptAssetsForCurrentUser,
  generateConceptAssetsInputSchema,
  generateAssetsForPendingConcepts,
} from "@/features/asset-generation/server/asset-generation.server";

/**
 * Starts the fixed five-at-a-time TRELLIS asset pipeline for the current authenticated user.
 *
 * Example:
 * `await startAssetGeneration({ data: {} })`
 *
 * Notes:
 * - The server always processes ready concepts in waves of up to five.
 * - Compatibility fields like `batchSize` and `concurrency` are ignored by the normal app path.
 *
 * Environment:
 * `TRELLIS_GRADIO_URL=https://081e1666f232d47fcb.gradio.live`
 * `TRELLIS_REQUEST_TIMEOUT_MINUTES=3`
 * `ASSET_S3_ENDPOINT=https://s3.amazonaws.com`
 * `ASSET_S3_REGION=us-east-1`
 * `ASSET_S3_BUCKET=memory-palace-assets`
 * `ASSET_S3_ACCESS_KEY_ID=...`
 * `ASSET_S3_SECRET_ACCESS_KEY=...`
 * `ASSET_S3_PUBLIC_BASE_URL=https://memory-palace-assets.s3.amazonaws.com`
 */
export const startAssetGeneration = createServerFn({ method: "POST" })
  .inputValidator(assetGenerationBatchOptionsSchema)
  .handler(async ({ data }) => {
    return generateAssetsForPendingConcepts(data);
  });

/**
 * Generates TRELLIS assets for one explicit concept selection owned by the current user.
 * @remarks The importer uses this targeted path to surface per-concept progress and timing in the UI.
 */
export const generateConceptAssets = createServerFn({ method: "POST" })
  .inputValidator(generateConceptAssetsInputSchema)
  .handler(async ({ data }) => {
    return generateConceptAssetsForCurrentUser(data);
  });
