/**
 * @file concept-persistence.server.ts
 * @description Validates, classifies, and persists extracted concepts into user-owned rooms.
 * @module concept-extraction
 */
import { z } from "zod";
import { getMongoClient } from "@/lib/server/mongodb.server";
import { requireAuthUser } from "@/features/auth/server/auth-session.server";
import { conceptMetaphorSchema } from "@/features/concept-extraction/server/concept-metaphor.server";
import { classifyConceptRoomsWithGemini } from "@/features/concept-extraction/server/gemini-room-classifier.server";
import { createConceptForUser } from "@/features/concept-extraction/server/concept.repository.server";
import {
  createRoomForUser,
  incrementRoomConceptCount,
  listRoomsByUserId,
} from "@/features/concept-extraction/server/room.repository.server";
import type {
  ExtractedConcept,
  PersistConceptsInput,
  PersistConceptsResult,
  RoomSummary,
} from "@/features/concept-extraction/types";

/**
 * Developer-editable prompt template used for room classification.
 * @description Lives in server code on purpose so developers can tune categorization behavior without introducing a user-facing settings surface yet.
 */
export const ROOM_CLASSIFICATION_PROMPT = `
You classify memory-palace concepts into user-owned rooms.

Rules:
- Prefer an existing room when the concept clearly belongs there.
- Create a new room only when no existing room is a strong fit.
- Keep new room names broad enough to group future related concepts.
- Avoid near-duplicate room names.
- Return exactly one assignment per concept.
- Return strict JSON only.
`;

export const extractedConceptSchema = z.object({
  name: z.string().trim().min(1),
  description: z.string().trim().min(1),
});

export const conceptAssetSchema = z.object({
  status: z.enum(["pending", "processing", "ready", "failed"]),
  provider: z.literal("s3"),
  source: z.literal("hunyuan"),
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

const geminiExistingAssignmentSchema = z.object({
  conceptName: z.string().min(1),
  decisionType: z.literal("existing"),
  roomId: z.string().min(1).optional(),
  roomSlug: z.string().min(1).optional(),
});

const geminiNewAssignmentSchema = z.object({
  conceptName: z.string().min(1),
  decisionType: z.literal("new"),
  roomName: z.string().min(1),
  roomDescription: z.string().min(1).optional(),
});

export const geminiRoomAssignmentSchema = z.discriminatedUnion("decisionType", [
  geminiExistingAssignmentSchema,
  geminiNewAssignmentSchema,
]);

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
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Resolves an existing room reference from Gemini output.
 * @param assignment - Existing-room assignment emitted by Gemini.
 * @param roomsById - Current user rooms keyed by id for direct roomId matching.
 * @param roomsBySlug - Current user rooms keyed by slug for slug-based matching.
 * @returns The matched room summary owned by the current user.
 * @remarks Fails closed when Gemini references a room that does not exist for the current user.
 */
function resolveExistingRoom(
  assignment: z.infer<typeof geminiExistingAssignmentSchema>,
  roomsById: Map<string, RoomSummary>,
  roomsBySlug: Map<string, RoomSummary>,
) {
  if (assignment.roomId) {
    const room = roomsById.get(assignment.roomId);

    if (room) {
      return room;
    }
  }

  if (assignment.roomSlug) {
    const room = roomsBySlug.get(assignment.roomSlug);

    if (room) {
      return room;
    }
  }

  throw new Error(`Gemini referenced an unknown room for concept "${assignment.conceptName}".`);
}

/**
 * Validates Gemini output shape and concept coverage.
 * @param concepts - Input concepts being persisted in the current request.
 * @param assignments - Raw assignments returned by the Gemini classifier.
 * @returns Parsed assignments guaranteed to cover the input array one-for-one.
 * @remarks The workflow rejects duplicate or missing concept coverage before any database write begins.
 */
function validateAssignments(concepts: ExtractedConcept[], assignments: unknown[]) {
  if (assignments.length !== concepts.length) {
    throw new Error("Gemini returned the wrong number of room assignments.");
  }

  const conceptNames = new Set(concepts.map((concept) => concept.name));
  const seen = new Set<string>();

  return assignments.map((assignment) => {
    const parsed = geminiRoomAssignmentSchema.parse(assignment);

    if (!conceptNames.has(parsed.conceptName)) {
      throw new Error(`Gemini returned an unknown concept name "${parsed.conceptName}".`);
    }

    if (seen.has(parsed.conceptName)) {
      throw new Error(`Gemini returned a duplicate assignment for "${parsed.conceptName}".`);
    }

    seen.add(parsed.conceptName);
    return parsed;
  });
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
  const existingRooms = await listRoomsByUserId(user.id);
  const assignments = validateAssignments(
    parsedInput.concepts,
    await classifyConceptRoomsWithGemini({
      concepts: parsedInput.concepts,
      existingRooms,
      prompt: ROOM_CLASSIFICATION_PROMPT,
    }),
  );

  const roomsById = new Map(existingRooms.map((room) => [room.id, room]));
  const roomsBySlug = new Map(existingRooms.map((room) => [room.slug, room]));
  const conceptRoomIds = new Map<string, string>();
  const client = await getMongoClient();
  const session = client.startSession();

  try {
    const concepts: PersistConceptsResult["concepts"] = [];

    await session.withTransaction(async () => {
      for (const assignment of assignments) {
        if (assignment.decisionType === "existing") {
          const room = resolveExistingRoom(assignment, roomsById, roomsBySlug);
          conceptRoomIds.set(assignment.conceptName, room.id);
          continue;
        }

        const slug = slugifyRoomName(assignment.roomName);
        let room = roomsBySlug.get(slug);

        if (!room) {
          room = await createRoomForUser(
            {
              userId: user.id,
              name: assignment.roomName.trim(),
              slug,
              description: assignment.roomDescription?.trim() || "",
            },
            session,
          );
          roomsById.set(room.id, room);
          roomsBySlug.set(room.slug, room);
        }

        conceptRoomIds.set(assignment.conceptName, room.id);
      }

      const roomCounts = new Map<string, number>();

      for (const concept of parsedInput.concepts) {
        const roomId = conceptRoomIds.get(concept.name);
        const room = roomId ? roomsById.get(roomId) : null;

        if (!room) {
          throw new Error(`No room was resolved for concept "${concept.name}".`);
        }

        const storedConcept = await createConceptForUser(
          {
            userId: user.id,
            name: concept.name.trim(),
            description: concept.description.trim(),
            normalizedName: normalizeConceptName(concept.name),
            room: {
              roomId: room.id,
              name: room.name,
              slug: room.slug,
            },
            metaphor: null,
            embedding: null,
            asset: null,
          },
          session,
        );

        concepts.push(storedConceptSchema.parse(storedConcept));
        roomCounts.set(room.id, (roomCounts.get(room.id) || 0) + 1);
      }

      for (const [roomId, count] of roomCounts) {
        const updatedRoom = await incrementRoomConceptCount(roomId, count, session);
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
