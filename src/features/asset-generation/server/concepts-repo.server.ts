/**
 * @file concepts-repo.server.ts
 * @description Selects and updates concept asset lifecycle state in the existing concepts collection.
 * @module asset-generation
 */
import { ObjectId, type Filter } from "mongodb";
import {
  getConceptsCollection,
  type ConceptDocument,
} from "@/features/concept-extraction/server/concept.repository.server";
import { ASSET_STYLE_VERSION } from "@/features/asset-generation/server/prompt-builder.server";
import type { AssetGenerationConceptRow } from "@/features/asset-generation/types";

function toConceptRow(document: ConceptDocument): AssetGenerationConceptRow {
  return {
    id: document._id.toHexString(),
    userId: document.userId,
    name: document.name,
    description: document.description,
    metaphor: document.metaphor
      ? {
          status: document.metaphor.status,
          objectName: document.metaphor.objectName,
          prompt: document.metaphor.prompt,
          rationale: document.metaphor.rationale,
          generatedAt: document.metaphor.generatedAt?.toISOString() ?? null,
          errorMessage: document.metaphor.errorMessage,
        }
      : null,
    asset: document.asset
      ? {
          status: document.asset.status,
          provider: document.asset.provider,
          source: document.asset.source,
          key: document.asset.key,
          url: document.asset.url,
          previewKey: document.asset.previewKey,
          previewUrl: document.asset.previewUrl,
          mimeType: document.asset.mimeType,
          prompt: document.asset.prompt,
          styleVersion: document.asset.styleVersion,
          jobId: document.asset.jobId,
          error: document.asset.error,
          startedAt: document.asset.startedAt?.toISOString() ?? null,
          completedAt: document.asset.completedAt?.toISOString() ?? null,
          updatedAt: document.asset.updatedAt.toISOString(),
        }
      : null,
  };
}

/**
 * Builds the MongoDB selector for concepts that are ready to enter asset generation.
 * @param userId - Current authenticated user id.
 * @param excludedConceptIds - Concept ids already attempted earlier in the same batch run.
 * @returns MongoDB filter that skips in-flight, ready, and already-attempted concepts.
 * @remarks Excluding attempted ids prevents one failed concept from being re-selected again in the next fixed-size batch wave.
 */
function getNeedsAssetFilter(userId: string, excludedConceptIds: string[] = []) {
  const excludedObjectIds = excludedConceptIds.map((id) => new ObjectId(id));

  return {
    userId,
    "metaphor.status": "ready",
    "metaphor.prompt": { $exists: true, $ne: "" },
    $or: [{ asset: { $exists: false } }, { asset: null }, { "asset.status": "failed" }],
    ...(excludedObjectIds.length > 0 ? { _id: { $nin: excludedObjectIds } } : {}),
  } satisfies Filter<ConceptDocument>;
}

/**
 * Reads concepts owned by the current user that still need generated assets.
 * @param userId - Current authenticated user id.
 * @param limit - Maximum number of concepts to select for the batch.
 * @param excludedConceptIds - Concept ids already attempted earlier in the current batch run.
 * @returns Candidate concept rows ready to be claimed by the worker.
 * @remarks Excludes concepts already marked `processing` or `ready` so the batch does not duplicate in-flight work.
 */
export async function getConceptsNeedingAssets(
  userId: string,
  limit: number,
  excludedConceptIds: string[] = [],
) {
  const concepts = await getConceptsCollection();
  const documents = await concepts
    .find(getNeedsAssetFilter(userId, excludedConceptIds))
    .sort({ updatedAt: -1 })
    .limit(limit)
    .toArray();

  return documents.map(toConceptRow);
}

/**
 * Atomically claims a concept for asset generation.
 * @param input - Concept identity plus the prompt and run metadata for this attempt.
 * @returns `true` when the concept was claimed by this worker, otherwise `false`.
 * @remarks The conditional update is the race-safety mechanism that prevents duplicate workers from generating the same asset.
 */
export async function tryMarkConceptProcessing(input: {
  id: string;
  userId: string;
  prompt: string;
  runId: string;
}) {
  const concepts = await getConceptsCollection();
  const now = new Date();
  const result = await concepts.updateOne(
    {
      _id: new ObjectId(input.id),
      ...getNeedsAssetFilter(input.userId),
    },
    {
      $set: {
        asset: {
          status: "processing",
          provider: "s3",
          source: "trellis",
          prompt: input.prompt,
          styleVersion: ASSET_STYLE_VERSION,
          startedAt: now,
          completedAt: null,
          updatedAt: now,
        },
        updatedAt: now,
      },
    },
  );

  return result.modifiedCount === 1;
}

/**
 * Marks a concept as successfully generated and uploaded.
 * @param input - Storage metadata and prompt/job information for the completed concept.
 * @returns A promise that resolves once the concept row has been updated.
 * @remarks Preserves the original processing `startedAt` when available so duration can be reconstructed later.
 */
export async function markConceptDone(input: {
  id: string;
  userId: string;
  prompt: string;
  jobId: string;
  key: string;
  url: string;
  previewKey?: string;
  previewUrl?: string;
  mimeType: string;
}) {
  const concepts = await getConceptsCollection();
  const existing = await concepts.findOne({
    _id: new ObjectId(input.id),
    userId: input.userId,
  });

  if (!existing) {
    throw new Error(`Concept ${input.id} was not found for the current user.`);
  }

  const now = new Date();
  await concepts.updateOne(
    {
      _id: existing._id,
      userId: input.userId,
    },
    {
      $set: {
        asset: {
          status: "ready",
          provider: "s3",
          source: "trellis",
          key: input.key,
          url: input.url,
          previewKey: input.previewKey,
          previewUrl: input.previewUrl,
          mimeType: input.mimeType,
          prompt: input.prompt,
          styleVersion: ASSET_STYLE_VERSION,
          jobId: input.jobId,
          startedAt: existing.asset?.startedAt ?? now,
          completedAt: now,
          updatedAt: now,
        },
        updatedAt: now,
      },
    },
  );
}

/**
 * Marks a concept's asset lifecycle as failed.
 * @param input - Concept identity plus the safe failure information to persist.
 * @returns A promise that resolves once the failure state is stored.
 * @remarks Failure state stays on the concept row so later retries can select the concept again without another tracking collection.
 */
export async function markConceptFailed(input: {
  id: string;
  userId: string;
  prompt?: string;
  error: string;
  jobId?: string;
}) {
  const concepts = await getConceptsCollection();
  const existing = await concepts.findOne({
    _id: new ObjectId(input.id),
    userId: input.userId,
  });

  if (!existing) {
    throw new Error(`Concept ${input.id} was not found for the current user.`);
  }

  const now = new Date();
  await concepts.updateOne(
    {
      _id: existing._id,
      userId: input.userId,
    },
    {
      $set: {
        asset: {
          status: "failed",
          provider: "s3",
          source: "trellis",
          prompt: input.prompt ?? existing.asset?.prompt,
          styleVersion: ASSET_STYLE_VERSION,
          jobId: input.jobId,
          error: input.error,
          startedAt: existing.asset?.startedAt ?? now,
          completedAt: now,
          updatedAt: now,
        },
        updatedAt: now,
      },
    },
  );
}
