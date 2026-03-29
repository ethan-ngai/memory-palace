/**
 * @file concept.repository.server.ts
 * @description MongoDB data access for persisted concepts and their room references.
 * @module concept-extraction
 */
import { ObjectId, type ClientSession, type Collection } from "mongodb";
import { getDatabase } from "@/lib/server/mongodb.server";
import type {
  ConceptAsset,
  ConceptEmbedding,
  ConceptMetaphor,
  ConceptRoomRef,
  StoredConcept,
} from "@/features/concept-extraction/types";

/**
 * MongoDB representation of a persisted concept.
 * @description Stores denormalized room metadata on the concept document so common reads stay single-collection.
 */
export type ConceptDocument = {
  _id: ObjectId;
  userId: string;
  name: string;
  description: string;
  normalizedName: string;
  roomId: string;
  roomName: string;
  roomSlug: string;
  embedding: {
    model: string;
    dimensions: number;
    values: number[];
    createdAt: Date;
  } | null;
  metaphor: {
    status: "pending" | "ready" | "failed";
    objectName: string;
    prompt: string;
    rationale: string;
    generatedAt: Date | null;
    errorMessage?: string;
  } | null;
  asset: {
    status: "pending" | "processing" | "ready" | "failed";
    provider: "s3";
    source: "hunyuan" | "shap-e" | "cube3d" | "trellis" | "embodiedgen";
    key?: string;
    url?: string;
    previewKey?: string;
    previewUrl?: string;
    mimeType?: string;
    prompt?: string;
    styleVersion: string;
    jobId?: string;
    error?: string;
    startedAt?: Date | null;
    completedAt?: Date | null;
    updatedAt: Date;
  } | null;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * Payload required to create a stored concept.
 * @description Keeps repository inputs explicit so higher-level orchestration decides room assignment and validation before hitting MongoDB.
 */
export type CreateConceptDocumentInput = {
  userId: string;
  name: string;
  description: string;
  normalizedName: string;
  room: ConceptRoomRef;
  embedding?: ConceptEmbedding | null;
  metaphor?: ConceptMetaphor | null;
  asset?: ConceptAsset | null;
};

let conceptIndexesPromise: Promise<unknown> | undefined;

/**
 * Converts an optional transport embedding into the database representation.
 * @param embedding - Optional embedding payload from the orchestration layer.
 * @returns A Mongo-safe embedding document or null when semantic vectors have not been generated yet.
 * @remarks Keeps date parsing in one place so repositories do not duplicate transport-to-storage mapping logic.
 */
function toEmbeddingDocument(embedding?: ConceptEmbedding | null) {
  if (!embedding) {
    return null;
  }

  return {
    model: embedding.model,
    dimensions: embedding.dimensions,
    values: embedding.values,
    createdAt: new Date(embedding.createdAt),
  };
}

/**
 * Converts an optional transport metaphor into the database representation.
 * @param metaphor - Optional metaphor payload from the orchestration layer.
 * @returns A Mongo-safe metaphor document or null when no metaphor has been generated yet.
 * @remarks Centralizes Date conversion so write paths stay consistent between initial persistence and regeneration.
 */
function toMetaphorDocument(metaphor?: ConceptMetaphor | null) {
  if (!metaphor) {
    return null;
  }

  return {
    status: metaphor.status,
    objectName: metaphor.objectName,
    prompt: metaphor.prompt,
    rationale: metaphor.rationale,
    generatedAt: metaphor.generatedAt ? new Date(metaphor.generatedAt) : null,
    errorMessage: metaphor.errorMessage,
  };
}

/**
 * Converts an optional transport asset lifecycle object into the database representation.
 * @param asset - Optional asset payload from orchestration or persistence code.
 * @returns A Mongo-safe asset document or null when no asset lifecycle exists yet.
 * @remarks Centralizes date parsing so generation workers and repository tests both use one write shape.
 */
function toAssetDocument(asset?: ConceptAsset | null) {
  if (!asset) {
    return null;
  }

  return {
    status: asset.status,
    provider: asset.provider,
    source: asset.source,
    key: asset.key,
    url: asset.url,
    previewKey: asset.previewKey,
    previewUrl: asset.previewUrl,
    mimeType: asset.mimeType,
    prompt: asset.prompt,
    styleVersion: asset.styleVersion,
    jobId: asset.jobId,
    error: asset.error,
    startedAt:
      asset.startedAt === undefined
        ? undefined
        : asset.startedAt === null
          ? null
          : new Date(asset.startedAt),
    completedAt:
      asset.completedAt === undefined
        ? undefined
        : asset.completedAt === null
          ? null
          : new Date(asset.completedAt),
    updatedAt: new Date(asset.updatedAt),
  };
}

/**
 * Converts a MongoDB concept document into the feature transport shape.
 * @param document - Persisted concept document from Atlas.
 * @returns A JSON-safe concept payload suitable for server function responses.
 * @remarks Centralizes denormalized room mapping so all reads expose the same response shape.
 */
function toStoredConcept(document: ConceptDocument): StoredConcept {
  return {
    id: document._id.toHexString(),
    userId: document.userId,
    name: document.name,
    description: document.description,
    normalizedName: document.normalizedName,
    room: {
      roomId: document.roomId,
      name: document.roomName,
      slug: document.roomSlug,
    },
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
    embedding: document.embedding
      ? {
          model: document.embedding.model,
          dimensions: document.embedding.dimensions,
          values: document.embedding.values,
          createdAt: document.embedding.createdAt.toISOString(),
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
    createdAt: document.createdAt.toISOString(),
    updatedAt: document.updatedAt.toISOString(),
  };
}

/**
 * Creates the required MongoDB indexes for the concepts collection.
 * @param concepts - Concepts collection handle for the current database.
 * @returns A promise that resolves once the expected indexes exist.
 * @remarks The promise is cached per process so repeated repository calls do not reissue index creation work.
 */
async function ensureConceptIndexes(concepts: Collection<ConceptDocument>) {
  conceptIndexesPromise ??= Promise.all([
    concepts.createIndex({ userId: 1, roomId: 1, updatedAt: -1 }),
    concepts.createIndex({ userId: 1, normalizedName: 1 }),
  ]);

  return conceptIndexesPromise;
}

/**
 * Resolves the concepts collection for the configured application database.
 * @returns The typed MongoDB collection used for concept persistence.
 * @remarks Ensures indexes lazily so startup does not pay DB costs before the feature is used.
 */
export async function getConceptsCollection() {
  const database = await getDatabase();
  const concepts = database.collection<ConceptDocument>("concepts");
  await ensureConceptIndexes(concepts);
  return concepts;
}

/**
 * Inserts a concept for the owning user.
 * @param input - Fully validated concept payload with a resolved room reference.
 * @param session - Optional MongoDB session when the caller wants room and concept writes to share a transaction.
 * @returns The persisted concept as a JSON-safe transport object.
 * @remarks Assumes auth and room ownership have already been enforced by the orchestration layer.
 */
export async function createConceptForUser(
  input: CreateConceptDocumentInput,
  session?: ClientSession,
) {
  const concepts = await getConceptsCollection();
  const now = new Date();

  const document: ConceptDocument = {
    _id: new ObjectId(),
    userId: input.userId,
    name: input.name,
    description: input.description,
    normalizedName: input.normalizedName,
    roomId: input.room.roomId,
    roomName: input.room.name,
    roomSlug: input.room.slug,
    embedding: toEmbeddingDocument(input.embedding),
    metaphor: toMetaphorDocument(input.metaphor),
    asset: toAssetDocument(input.asset),
    createdAt: now,
    updatedAt: now,
  };

  await concepts.insertOne(document, { session });
  return toStoredConcept(document);
}

/**
 * Lists all concepts for a single user ordered by most recent updates first.
 * @param userId - Local application user id used to scope reads to one palace owner.
 * @param session - Optional MongoDB session used when reading inside a larger transactional workflow.
 * @returns Persisted concepts for the user in newest-first order.
 * @remarks Leaves dedupe and filtering decisions to higher layers so this repository remains a thin data access abstraction.
 */
export async function listConceptsByUserId(userId: string, session?: ClientSession) {
  const concepts = await getConceptsCollection();
  const documents = await concepts.find({ userId }, { session }).sort({ updatedAt: -1 }).toArray();
  return documents.map(toStoredConcept);
}

/**
 * Lists all concepts assigned to one room for a single user.
 * @param userId - Local application user id used to scope reads.
 * @param roomId - Stable room id whose concepts should be returned.
 * @param session - Optional MongoDB session used when this read participates in a wider workflow.
 * @returns Persisted concepts for the requested room in newest-first order.
 * @remarks Powers room placement generation without forcing the caller to fetch all rooms' concepts and filter in memory.
 */
export async function listConceptsByRoomIdForUser(
  userId: string,
  roomId: string,
  session?: ClientSession,
) {
  const concepts = await getConceptsCollection();
  const documents = await concepts
    .find({ userId, roomId }, { session })
    .sort({ updatedAt: -1 })
    .toArray();
  return documents.map(toStoredConcept);
}

/**
 * Loads a specific ordered set of concepts for one user.
 * @param userId - Local application user id used to scope reads.
 * @param conceptIds - Concept ids whose order should be preserved in the returned array.
 * @param session - Optional MongoDB session used when the read participates in a larger workflow.
 * @returns Matching stored concepts in the same order as the requested ids.
 * @remarks Filters by user ownership and then reorders in memory because MongoDB does not preserve `$in` order.
 */
export async function findConceptsByIdsForUser(
  userId: string,
  conceptIds: string[],
  session?: ClientSession,
) {
  const concepts = await getConceptsCollection();
  const objectIds = conceptIds.map((conceptId) => new ObjectId(conceptId));
  const documents = await concepts
    .find(
      {
        userId,
        _id: { $in: objectIds },
      },
      { session },
    )
    .toArray();
  const documentsById = new Map(
    documents.map((document) => [document._id.toHexString(), document]),
  );

  return conceptIds
    .map((conceptId) => documentsById.get(conceptId))
    .filter((document): document is ConceptDocument => Boolean(document))
    .map(toStoredConcept);
}

/**
 * Replaces the current metaphor object for one concept.
 * @param input - Concept id and the metaphor payload that should become current.
 * @param session - Optional MongoDB session used when the update participates in a wider write workflow.
 * @returns The updated stored concept.
 * @remarks Keeps metaphor state on the concept document so later game reads do not require a second collection lookup.
 */
export async function updateConceptMetaphorById(
  input: {
    conceptId: string;
    metaphor: ConceptMetaphor;
  },
  session?: ClientSession,
) {
  const concepts = await getConceptsCollection();
  const document = await concepts.findOneAndUpdate(
    { _id: new ObjectId(input.conceptId) },
    {
      $set: {
        metaphor: toMetaphorDocument(input.metaphor),
        updatedAt: new Date(),
      },
    },
    {
      returnDocument: "after",
      includeResultMetadata: false,
      session,
    },
  );

  if (!document) {
    throw new Error(`Concept ${input.conceptId} no longer exists.`);
  }

  return toStoredConcept(document);
}
