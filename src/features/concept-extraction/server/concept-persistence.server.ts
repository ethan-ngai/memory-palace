/**
 * @file concept-persistence.server.ts
 * @description Validates, classifies, and persists extracted concepts into user-owned rooms.
 * @module concept-extraction
 */
import { z } from "zod";
import { getMongoClient } from "@/lib/server/mongodb.server";
import { requireAuthUser } from "@/features/auth/server/auth-session.server";
import { conceptMetaphorSchema } from "@/features/concept-extraction/server/concept-metaphor.server";
import { createConceptForUser } from "@/features/concept-extraction/server/concept.repository.server";
import {
  createRoomForUser,
  incrementRoomConceptCount,
  incrementRoomConceptCountBySlug,
  listRoomsByUserId,
} from "@/features/concept-extraction/server/room.repository.server";
import type {
  PersistConceptsInput,
  PersistConceptsResult,
  RoomSummary,
} from "@/features/concept-extraction/types";

const FALLBACK_ROOM_NAME = "Imported Concepts";
const FALLBACK_ROOM_DESCRIPTION =
  "Temporary catch-all room used while automatic room classification is disabled.";

export const extractedConceptSchema = z.object({
  name: z.string().trim().min(1),
  description: z.string().trim().min(1),
});

export const conceptAssetSchema = z.object({
  status: z.enum(["pending", "processing", "ready", "failed"]),
  provider: z.literal("s3"),
  source: z.enum(["hunyuan", "shap-e", "cube3d", "trellis", "embodiedgen"]),
  key: z.string().min(1).optional(),
  url: z.string().url().optional(),
  previewKey: z.string().min(1).optional(),
  previewUrl: z.string().url().optional(),
  mimeType: z.string().min(1).optional(),
  prompt: z.string().min(1).optional(),
  styleVersion: z.string().min(1),
  jobId: z.string().min(1).optional(),
  error: z.string().min(1).optional(),
  startedAt: z.string().datetime().nullable().optional(),
  completedAt: z.string().datetime().nullable().optional(),
  updatedAt: z.string().datetime(),
});

export const conceptEmbeddingSchema = z.object({
  model: z.string().min(1),
  dimensions: z.number().int().positive(),
  values: z.array(z.number().finite()).min(1),
  createdAt: z.string().datetime(),
});

export const roomSummarySchema = z.object({
  id: z.string().min(1),
  userId: z.string().min(1),
  name: z.string().min(1),
  slug: z.string().min(1),
  description: z.string(),
  conceptCount: z.number().int().min(0),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const storedConceptSchema = z.object({
  id: z.string().min(1),
  userId: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  normalizedName: z.string().min(1),
  room: z.object({
    roomId: z.string().min(1),
    name: z.string().min(1),
    slug: z.string().min(1),
  }),
  metaphor: conceptMetaphorSchema.nullable(),
  embedding: conceptEmbeddingSchema.nullable(),
  asset: conceptAssetSchema.nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const persistConceptsInputSchema = z.object({
  concepts: z.array(extractedConceptSchema).min(1),
});

/**
 * Normalizes room names into stable user-scoped slugs.
 * @param value - Raw room name proposed by Gemini or stored in the database.
 * @returns Lowercase slug text suitable for deterministic matching and unique indexes.
 * @remarks Collapses punctuation noise so near-identical names do not create accidental duplicate rooms.
 */
export function slugifyRoomName(value: string) {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "room";
}

/**
 * Normalizes concept names for future user-scoped lookup and dedupe work.
 * @param value - Raw extracted concept name.
 * @returns A lower-noise normalized concept name.
 * @remarks Uses a conservative normalization strategy so display names stay intact while storage keys stay comparable.
 */
export function normalizeConceptName(value: string) {
  return value
    .normalize("NFKC")
    .replace(/[\u2010-\u2015\u2212]/gu, "-")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ");
}

/**
 * Resolves the deterministic fallback room used when automatic room classification is disabled.
 * @param userId - Local application user id that owns the room.
 * @param existingRooms - Current user rooms loaded before the write transaction begins.
 * @param session - MongoDB session shared with concept writes.
 * @returns The reused or newly created fallback room summary.
 * @remarks This preserves the room column in stored concepts without depending on Gemini availability.
 */
async function resolveFallbackRoom(
  userId: string,
  existingRooms: RoomSummary[],
  session: Parameters<typeof createRoomForUser>[1],
) {
  const fallbackSlug = slugifyRoomName(FALLBACK_ROOM_NAME);
  const existingRoom = existingRooms.find((room) => room.slug === fallbackSlug);

  if (existingRoom) {
    return existingRoom;
  }

  return createRoomForUser(
    {
      userId,
      name: FALLBACK_ROOM_NAME,
      slug: fallbackSlug,
      description: FALLBACK_ROOM_DESCRIPTION,
    },
    session,
  );
}

/**
 * Persists extracted concepts for the current authenticated user.
 * @param input - Already-extracted concepts ready for room assignment and storage.
 * @returns Stored concepts plus updated room summaries after classification and persistence.
 * @remarks
 * - Authentication is enforced once at the boundary so repositories remain focused on data access.
 * - Gemini classification happens before writes so malformed model output cannot leave partial room state behind.
 */
export async function persistConceptsForCurrentUser(
  input: PersistConceptsInput,
): Promise<PersistConceptsResult> {
  const parsedInput = persistConceptsInputSchema.parse(input);
  const user = await requireAuthUser();
  return persistConceptsForUser(user.id, parsedInput);
}

/**
 * Persists extracted concepts for one explicit user id.
 * @param userId - Local application user id that should own the stored concepts and rooms.
 * @param input - Already-extracted concepts ready for room assignment and storage.
 * @returns Stored concepts plus updated room summaries after classification and persistence.
 * @remarks Exported so manual server-side scripts can bootstrap end-to-end data without a browser session.
 */
export async function persistConceptsForUser(
  userId: string,
  input: PersistConceptsInput,
): Promise<PersistConceptsResult> {
  const parsedInput = persistConceptsInputSchema.parse(input);
  const existingRooms = await listRoomsByUserId(userId);
  const roomsById = new Map(existingRooms.map((room) => [room.id, room]));
  const roomsBySlug = new Map(existingRooms.map((room) => [room.slug, room]));
  const client = await getMongoClient();
  const session = client.startSession();

  try {
    const concepts: PersistConceptsResult["concepts"] = [];

    await session.withTransaction(async () => {
      const fallbackRoom = await resolveFallbackRoom(userId, existingRooms, session);
      roomsById.set(fallbackRoom.id, fallbackRoom);
      roomsBySlug.set(fallbackRoom.slug, fallbackRoom);

      const roomCounts = new Map<string, number>();

      for (const concept of parsedInput.concepts) {
        const storedConcept = await createConceptForUser(
          {
            userId,
            name: concept.name.trim(),
            description: concept.description.trim(),
            normalizedName: normalizeConceptName(concept.name),
            room: {
              roomId: fallbackRoom.id,
              name: fallbackRoom.name,
              slug: fallbackRoom.slug,
            },
            metaphor: null,
            embedding: null,
            asset: null,
          },
          session,
        );

        concepts.push(storedConceptSchema.parse(storedConcept));
        roomCounts.set(fallbackRoom.id, (roomCounts.get(fallbackRoom.id) || 0) + 1);
      }

      for (const [roomId, count] of roomCounts) {
        const room = roomsById.get(roomId);
        let updatedRoom;

        try {
          updatedRoom = await incrementRoomConceptCount(roomId, count, session);
        } catch (error) {
          if (!(error instanceof Error) || !error.message.includes("no longer exists") || !room) {
            throw error;
          }

          updatedRoom = await incrementRoomConceptCountBySlug(userId, room.slug, count, session);
        }

        roomsById.set(updatedRoom.id, updatedRoom);
        roomsBySlug.set(updatedRoom.slug, updatedRoom);
      }
    });

    return {
      concepts,
      rooms: Array.from(roomsById.values())
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .map((room) => roomSummarySchema.parse(room)),
    };
  } finally {
    await session.endSession();
  }
}
