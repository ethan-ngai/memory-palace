/**
 * @file types.ts
 * @description Shared transport types for the asset generation feature.
 * @module asset-generation
 */
import type { ConceptAsset, ConceptMetaphor } from "@/features/concept-extraction/types";

/**
 * Minimal concept row shape required by the asset generator.
 * @description Keeps the batch worker focused on the fields needed for prompt building and lifecycle updates.
 */
export type AssetGenerationConceptRow = {
  id: string;
  userId: string;
  name: string;
  description: string;
  metaphor: ConceptMetaphor | null;
  asset: ConceptAsset | null;
};

/**
 * Per-concept result reported by the batch worker.
 * @description Keeps failure isolation explicit so callers can surface partial success without inspecting Mongo directly.
 */
export type AssetGenerationResultItem = {
  conceptId: string;
  conceptName?: string;
  status: "succeeded" | "failed" | "skipped";
  jobId?: string;
  assetUrl?: string;
  previewUrl?: string;
  error?: string;
};

/**
 * Optional knobs controlling batch size and concurrency.
 * @description Exposes a small server-function surface while still allowing safe tuning for hackathon load.
 */
export type AssetGenerationBatchOptions = {
  batchSize?: number;
  concurrency?: number;
};

/**
 * Progress event emitted during one local asset generation batch.
 * @description Gives manual scripts enough context to show which concept, metaphor object, and prompt are currently in flight.
 */
export type AssetGenerationProgressEvent = {
  phase: "selected" | "started" | "succeeded" | "failed" | "skipped";
  conceptId: string;
  conceptName: string;
  conceptIndex: number;
  totalConcepts: number;
  objectName?: string;
  prompt?: string;
  assetUrl?: string;
  jobId?: string;
  error?: string;
};

/**
 * Server-side-only batch options used by local scripts.
 * @description Extends the public batch knobs with a progress callback that should never cross the JSON server-function boundary.
 */
export type AssetGenerationBatchRuntimeOptions = AssetGenerationBatchOptions & {
  onProgress?: (event: AssetGenerationProgressEvent) => void;
};

/**
 * JSON-safe summary returned after one batch run finishes.
 * @description Provides both high-level counts and item-level outcomes for UI feedback or admin monitoring.
 */
export type AssetGenerationBatchResult = {
  totalSelected: number;
  totalClaimed: number;
  succeeded: number;
  failed: number;
  skipped: number;
  results: AssetGenerationResultItem[];
};
