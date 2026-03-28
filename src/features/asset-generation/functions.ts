/**
 * @file functions.ts
 * @description Client-callable server functions for asset generation.
 * @module asset-generation
 */
import { createServerFn } from "@tanstack/react-start";
import {
  assetGenerationBatchOptionsSchema,
  generateAssetsForPendingConcepts,
} from "@/features/asset-generation/server/asset-generation.server";

/**
 * Starts a bounded-concurrency Hunyuan batch for the current authenticated user.
 *
 * Example:
 * `await startAssetGeneration({ data: { batchSize: 10, concurrency: 3 } })`
 *
 * Environment:
 * `HUNYUAN_API_KEY=...`
 * `HUNYUAN_API_BASE_URL=https://api.example-hunyuan.com/v1`
 * `HUNYUAN_MODEL=hunyuan-3d`
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
