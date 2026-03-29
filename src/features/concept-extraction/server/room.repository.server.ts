/**
 * @file room.repository.server.ts
 * @description MongoDB data access for user-owned concept rooms.
 * @module concept-extraction
 */
import { ObjectId, type ClientSession, type Collection } from "mongodb";
import { getDatabase } from "@/lib/server/mongodb.server";
import type { RoomSummary } from "@/features/concept-extraction/types";
import type { RoomAnchorSet } from "@/features/game/types";

/**
 * MongoDB representation of a room summary.
 * @description Stores one user-scoped category that Gemini can reuse across future concept persistence requests.
 */
export type RoomDocument = {
  _id: ObjectId;
  userId: string;
  name: string;
  slug: string;
  description: string;
  conceptCount: number;
  anchorSet?: RoomAnchorSet | null;
  anchorSetImportedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * Payload required to create a user-owned room.
 * @description Keeps room writes explicit so slug generation and Gemini normalization stay outside the repository.
 */
export type CreateRoomInput = {
  userId: string;
  name: string;
  slug: string;
  description: string;
};

let roomIndexesPromise: Promise<unknown> | undefined;

/**
 * Converts a room document into the transport shape returned by server functions.
 * @param document - MongoDB room document.
 * @returns JSON-safe room summary for the current user.
 * @remarks Centralizes ObjectId and Date serialization so repository callers receive consistent room objects.
 */
function toRoomSummary(document: RoomDocument): RoomSummary {
  return {
    id: document._id.toHexString(),
    userId: document.userId,
    name: document.name,
    slug: document.slug,
    description: document.description,
    conceptCount: document.conceptCount,
    anchorSetImportedAt: document.anchorSetImportedAt?.toISOString() ?? null,
    anchorCount: document.anchorSet?.anchors.length ?? 0,
    createdAt: document.createdAt.toISOString(),
    updatedAt: document.updatedAt.toISOString(),
  };
}

/**
 * Creates the required MongoDB indexes for the rooms collection.
 * @param rooms - Rooms collection handle for the current database.
 * @returns A promise that resolves once the expected indexes exist.
 * @remarks Caches the in-flight creation work to avoid repeated index setup attempts in the same process.
 */
async function ensureRoomIndexes(rooms: Collection<RoomDocument>) {
  roomIndexesPromise ??= Promise.all([
    rooms.createIndex({ userId: 1, slug: 1 }, { unique: true }),
    rooms.createIndex({ userId: 1, updatedAt: -1 }),
  ]);

  return roomIndexesPromise;
}

/**
 * Resolves the rooms collection for the configured database.
 * @returns The typed MongoDB collection used for room persistence.
 * @remarks Ensures indexes lazily so startup work is deferred until the feature is actually used.
 */
export async function getRoomsCollection() {
  const database = await getDatabase();
  const rooms = database.collection<RoomDocument>("rooms");
  await ensureRoomIndexes(rooms);
  return rooms;
}

/**
 * Lists all rooms belonging to one local application user.
 * @param userId - Local user id that owns the memory palace.
 * @param session - Optional MongoDB session used when the read participates in a larger transactional flow.
 * @returns Room summaries ordered by most recently updated first.
 * @remarks User scoping happens at the query level so feature code never sees another user's rooms by accident.
 */
export async function listRoomsByUserId(userId: string, session?: ClientSession) {
  const rooms = await getRoomsCollection();
  const documents = await rooms.find({ userId }, { session }).sort({ updatedAt: -1 }).toArray();
  return documents.map(toRoomSummary);
}

/**
 * Finds a room by slug for a single user.
 * @param userId - Local user id that owns the room.
 * @param slug - User-scoped slug used for deterministic Gemini matching and collision handling.
 * @param session - Optional MongoDB session used when part of a wider transactional workflow.
 * @returns The matching room summary, or null when the user has no room with that slug.
 */
export async function findRoomByUserIdAndSlug(
  userId: string,
  slug: string,
  session?: ClientSession,
) {
  const rooms = await getRoomsCollection();
  const document = await rooms.findOne({ userId, slug }, { session });
  return document ? toRoomSummary(document) : null;
}

/**
 * Creates a room for a user or returns the existing room when the slug already exists.
 * @param input - Validated user-owned room payload with a deterministic slug.
 * @param session - Optional MongoDB session so room creation can share a transaction with concept writes.
 * @returns The created or pre-existing room summary.
 * @remarks Uses slug-based upsert behavior to make concurrent classification requests safer without overwriting established room metadata.
 */
export async function createRoomForUser(input: CreateRoomInput, session?: ClientSession) {
  const rooms = await getRoomsCollection();
  const now = new Date();

  const document = await rooms.findOneAndUpdate(
    { userId: input.userId, slug: input.slug },
    {
      $setOnInsert: {
        _id: new ObjectId(),
        userId: input.userId,
        name: input.name,
        slug: input.slug,
        description: input.description,
        conceptCount: 0,
        anchorSet: null,
        anchorSetImportedAt: null,
        createdAt: now,
        updatedAt: now,
      },
    },
    {
      upsert: true,
      returnDocument: "after",
      includeResultMetadata: false,
      session,
    },
  );

  if (!document) {
    throw new Error("Failed to create room.");
  }

  return toRoomSummary(document);
}

/**
 * Increments a room's concept count after concept persistence succeeds.
 * @param roomId - Mongo ObjectId hex string of the room being updated.
 * @param by - Number of concepts added to the room in the current write batch.
 * @param session - Optional MongoDB session used when room and concept writes share a transaction.
 * @returns The updated room summary.
 * @remarks Also touches `updatedAt` so room ordering reflects recent activity in the palace.
 */
export async function incrementRoomConceptCount(roomId: string, by = 1, session?: ClientSession) {
  const rooms = await getRoomsCollection();
  const document = await rooms.findOneAndUpdate(
    { _id: new ObjectId(roomId) },
    {
      $inc: { conceptCount: by },
      $set: { updatedAt: new Date() },
    },
    {
      returnDocument: "after",
      includeResultMetadata: false,
      session,
    },
  );

  if (!document) {
    throw new Error(`Room ${roomId} no longer exists.`);
  }

  return toRoomSummary(document);
}

/**
 * Increments a room's concept count by user-scoped slug.
 * @param userId - Local application user id that owns the room.
 * @param slug - User-scoped room slug.
 * @param by - Number of concepts added to the room in the current write batch.
 * @param session - Optional MongoDB session used when room and concept writes share a transaction.
 * @returns The updated room summary.
 * @remarks Used as a fallback when transaction state makes a freshly created room temporarily unavailable by `_id`.
 */
export async function incrementRoomConceptCountBySlug(
  userId: string,
  slug: string,
  by = 1,
  session?: ClientSession,
) {
  const rooms = await getRoomsCollection();
  const document = await rooms.findOneAndUpdate(
    { userId, slug },
    {
      $inc: { conceptCount: by },
      $set: { updatedAt: new Date() },
    },
    {
      returnDocument: "after",
      includeResultMetadata: false,
      session,
    },
  );

  if (!document) {
    throw new Error(`Room ${slug} no longer exists for user ${userId}.`);
  }

  return toRoomSummary(document);
}

/**
 * Finds one room by id for a specific user.
 * @param userId - Local application user id that owns the room.
 * @param roomId - Mongo ObjectId hex string for the room.
 * @param session - Optional MongoDB session used by wider workflows.
 * @returns The matching room summary, or null when the user does not own that room.
 * @remarks Keeps ownership checks in the repository so higher-level room placement code can fail fast on invalid room ids.
 */
export async function findRoomByIdForUser(userId: string, roomId: string, session?: ClientSession) {
  const rooms = await getRoomsCollection();
  const document = await rooms.findOne({ _id: new ObjectId(roomId), userId }, { session });
  return document ? toRoomSummary(document) : null;
}

/**
 * Reads the active imported anchor set for one owned room.
 * @param userId - Local application user id that owns the room.
 * @param roomId - Mongo ObjectId hex string for the room.
 * @param session - Optional MongoDB session used when this read participates in a wider flow.
 * @returns The active anchor set, or null when the room has none.
 * @remarks Returns only the anchor payload because placement generation does not need the rest of the room document once ownership has been checked.
 */
export async function getRoomAnchorSetByRoomId(
  userId: string,
  roomId: string,
  session?: ClientSession,
) {
  const rooms = await getRoomsCollection();
  const document = await rooms.findOne({ _id: new ObjectId(roomId), userId }, { session });
  return document?.anchorSet ?? null;
}

/**
 * Replaces the active imported anchor set for one owned room.
 * @param input - Room id plus the validated anchor payload that should become current.
 * @param session - Optional MongoDB session used when the replacement participates in a wider write flow.
 * @returns The updated room summary after the new anchor set is stored.
 * @remarks Stores the full imported payload on the room document so room selection and viewer loading can stay single-read.
 */
export async function replaceRoomAnchorSet(
  input: {
    userId: string;
    roomId: string;
    anchorSet: RoomAnchorSet;
  },
  session?: ClientSession,
) {
  const rooms = await getRoomsCollection();
  const now = new Date();
  const document = await rooms.findOneAndUpdate(
    { _id: new ObjectId(input.roomId), userId: input.userId },
    {
      $set: {
        anchorSet: input.anchorSet,
        anchorSetImportedAt: now,
        updatedAt: now,
      },
    },
    {
      returnDocument: "after",
      includeResultMetadata: false,
      session,
    },
  );

  if (!document) {
    throw new Error(`Room ${input.roomId} was not found for the current user.`);
  }

  return toRoomSummary(document);
}

/**
 * Replaces the stored concept count for one owned room.
 * @param input - Room id plus the exact count that should be stored.
 * @param session - Optional MongoDB session used when the update participates in a wider write flow.
 * @returns The updated room summary.
 * @remarks Clearing a room removes all concept documents at once, so the room count needs an explicit reset rather than an increment/decrement delta.
 */
export async function setRoomConceptCount(
  input: {
    userId: string;
    roomId: string;
    conceptCount: number;
  },
  session?: ClientSession,
) {
  const rooms = await getRoomsCollection();
  const now = new Date();
  const document = await rooms.findOneAndUpdate(
    { _id: new ObjectId(input.roomId), userId: input.userId },
    {
      $set: {
        conceptCount: input.conceptCount,
        updatedAt: now,
      },
    },
    {
      returnDocument: "after",
      includeResultMetadata: false,
      session,
    },
  );

  if (!document) {
    throw new Error(`Room ${input.roomId} was not found for the current user.`);
  }

  return toRoomSummary(document);
}
