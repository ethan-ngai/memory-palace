/**
 * @file room.repository.server.ts
 * @description MongoDB data access for user-owned concept rooms.
 * @module concept-extraction
 */
import { ObjectId, type ClientSession, type Collection } from "mongodb";
import { getDatabase } from "@/lib/server/mongodb.server";
import type { RoomSummary } from "@/features/concept-extraction/types";

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
