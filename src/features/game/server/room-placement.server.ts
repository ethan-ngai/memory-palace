/**
 * @file room-placement.server.ts
 * @description Validates imported room anchors and derives generated-asset placements for the Three.js room viewer.
 * @module game
 */
import { z } from "zod";
import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { requireAuthUser } from "@/features/auth/server/auth-session.server";
import { listConceptsByRoomIdForUser } from "@/features/concept-extraction/server/concept.repository.server";
import {
  findRoomByIdForUser,
  getRoomAnchorSetByRoomId,
  listRoomsByUserId,
  replaceRoomAnchorSet,
} from "@/features/concept-extraction/server/room.repository.server";
import type { RoomSummary, StoredConcept } from "@/features/concept-extraction/types";
import type {
  BundledViewerRoom,
  GenerateRoomPlacementsInput,
  GenerateRoomPlacementsResult,
  RoomAnchorSet,
  RoomPlacementItem,
} from "@/features/game/types";

/**
 * Validates one 3D position inside the imported anchor payload.
 * @description Keeps the accepted anchor format explicit so the viewer only consumes the Lavender-room JSON contract.
 */
export const roomAnchorPositionSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  z: z.number().finite(),
});

/**
 * Validates one anchor candidate in the imported room payload.
 * @description Requires labels and surfaces to stay non-empty so the sidebar can render meaningful metadata without fallback guessing.
 */
export const roomAnchorSchema = z.object({
  id: z.number().int().nonnegative(),
  label: z.string().trim().min(1),
  surface: z.string().trim().min(1),
  position: roomAnchorPositionSchema,
});

/**
 * Validates the only supported imported room anchor-set format.
 * @description Rejects partial or alternate JSON shapes up front so server persistence and viewer rendering share one stable contract.
 */
export const roomAnchorSetSchema = z
  .object({
    version: z.literal("1.0"),
    created: z.string().datetime(),
    description: z.string().trim().min(1),
    totalCandidates: z.number().int().nonnegative(),
    anchors: z.array(roomAnchorSchema).min(1),
  })
  .superRefine((value, context) => {
    if (value.totalCandidates !== value.anchors.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Anchor payload totalCandidates must match anchors.length.",
        path: ["totalCandidates"],
      });
    }

    const seenIds = new Set<number>();
    value.anchors.forEach((anchor, index) => {
      if (seenIds.has(anchor.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate anchor id ${anchor.id} is not allowed.`,
          path: ["anchors", index, "id"],
        });
        return;
      }
      seenIds.add(anchor.id);
    });
  });

/**
 * Input accepted by the room-anchor import server function.
 * @description Keeps the room id validated at the edge while the anchor payload itself is parsed by the strict Lavender schema.
 */
export const importRoomAnchorsInputSchema = z.object({
  roomId: z.string().min(1),
  anchorSet: z.unknown(),
});

/**
 * Input accepted by the room-anchor lookup and placement generation server functions.
 * @description Uses one small room-scoped contract for all room-viewer reads.
 */
export const roomIdInputSchema = z.object({
  roomId: z.string().min(1),
});

/**
 * Random number generator signature used by the placement shuffler.
 * @description Allows tests to inject deterministic output without patching global Math state.
 */
export type PlacementRandom = () => number;

/**
 * Shuffles a copy of the provided array using Fisher-Yates.
 * @param items - Items that should be randomized without mutating the caller's array.
 * @param random - Source of pseudo-random values in the half-open interval [0, 1).
 * @returns A shuffled copy of the input array.
 * @remarks Centralizing shuffle logic keeps placement tests deterministic and avoids multiple slightly different randomization paths.
 */
export function shuffleItems<T>(items: T[], random: PlacementRandom): T[] {
  const next = [...items];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [next[index], next[target]] = [next[target]!, next[index]!];
  }
  return next;
}

/**
 * Maps ready room concepts onto a randomized anchor subset.
 * @param input - Anchors, concepts, and the random source for the current placement derivation.
 * @returns JSON-safe placement output plus leftover concept ids that could not be assigned.
 * @remarks The assignment is intentionally stateless so placement refreshes can always be regenerated from current room state.
 */
export function buildRoomPlacementPlan(input: {
  anchorSet: RoomAnchorSet;
  concepts: StoredConcept[];
  random?: PlacementRandom;
}): Omit<GenerateRoomPlacementsResult, "roomId"> {
  const readyConcepts = input.concepts.filter(
    (concept): concept is StoredConcept & { asset: NonNullable<StoredConcept["asset"]> } =>
      concept.asset?.status === "ready" && Boolean(concept.asset.url),
  );

  if (!input.anchorSet.anchors.length || !readyConcepts.length) {
    return {
      anchorSetCreated: input.anchorSet.created,
      totalAnchors: input.anchorSet.anchors.length,
      totalReadyConcepts: readyConcepts.length,
      placements: [],
      unplacedConceptIds: readyConcepts.map((concept) => concept.id),
    };
  }

  const random = input.random ?? Math.random;
  const shuffledAnchors = shuffleItems(input.anchorSet.anchors, random);
  const shuffledConcepts = shuffleItems(readyConcepts, random);
  const placementCount = Math.min(shuffledAnchors.length, shuffledConcepts.length);
  const placements: RoomPlacementItem[] = [];

  for (let index = 0; index < placementCount; index += 1) {
    const anchor = shuffledAnchors[index];
    const concept = shuffledConcepts[index];
    if (!anchor || !concept?.asset?.url) {
      continue;
    }

    placements.push({
      anchorId: anchor.id,
      conceptId: concept.id,
      conceptName: concept.name,
      conceptDescription: concept.description,
      metaphorObjectName: concept.metaphor?.objectName,
      metaphorRationale: concept.metaphor?.rationale,
      assetUrl: buildPlacementAssetProxyUrl(concept.asset.url),
      previewUrl: concept.asset.previewUrl,
      position: anchor.position,
      surface: anchor.surface,
      label: anchor.label,
    });
  }

  return {
    anchorSetCreated: input.anchorSet.created,
    totalAnchors: input.anchorSet.anchors.length,
    totalReadyConcepts: readyConcepts.length,
    placements,
    unplacedConceptIds: shuffledConcepts.slice(placementCount).map((concept) => concept.id),
  };
}

/**
 * Builds the same-origin asset proxy path used by the Three.js placement loader.
 * @param assetUrl - Durable public asset URL stored on the concept document.
 * @returns Same-origin proxy path that streams the remote model through the app server.
 * @remarks Browser GLTF loading fails against some storage origins due to CORS, so room placements always load models through this proxy.
 */
export function buildPlacementAssetProxyUrl(assetUrl: string) {
  return `/api/game/asset?url=${encodeURIComponent(assetUrl)}`;
}

/**
 * Lists all rooms owned by the current authenticated user.
 * @returns User-scoped room summaries ordered by most recent updates first.
 * @remarks The room viewer needs a fast room picker without reusing the broader concept-persistence workflow.
 */
export async function listRoomsForCurrentUser(): Promise<RoomSummary[]> {
  const user = await requireAuthUser();
  return listRoomsByUserId(user.id);
}

/**
 * Lists prebundled viewer rooms discovered from `public/rooms`.
 * @returns Bundled room descriptors sorted by room name.
 * @remarks A room is recognized only when both `<NAME>.spz` and `<NAME>_ANCHORS.json` exist, which keeps the client contract aligned with the public-file naming convention.
 */
export async function listBundledViewerRooms(): Promise<BundledViewerRoom[]> {
  const roomsDirectory = resolve(process.cwd(), "public", "rooms");
  const files = await readdir(roomsDirectory, { withFileTypes: true }).catch((error: unknown) => {
    if ((error as { code?: string })?.code === "ENOENT") {
      return [];
    }

    throw error;
  });
  const sceneFiles = files
    .filter(
      (entry) =>
        entry.isFile() &&
        (entry.name.toLowerCase().endsWith(".spz") || entry.name.toLowerCase().endsWith(".ply")),
    )
    .map((entry) => entry.name);

  return sceneFiles
    .map((sceneFileName) => {
      const baseName = sceneFileName.replace(/\.(spz|ply)$/iu, "");
      const anchorFileName = `${baseName}_ANCHORS.json`;
      const matchingAnchor = files.find(
        (entry) => entry.isFile() && entry.name.toLowerCase() === anchorFileName.toLowerCase(),
      );

      if (!matchingAnchor) {
        return null;
      }

      return {
        id: baseName,
        name: baseName.replace(/_/gu, " "),
        sceneUrl: `/rooms/${sceneFileName}`,
        anchorUrl: `/rooms/${matchingAnchor.name}`,
      } satisfies BundledViewerRoom;
    })
    .filter((room): room is BundledViewerRoom => room !== null)
    .sort((left, right) => left.name.localeCompare(right.name));
}

/**
 * Validates and stores one active imported anchor payload on the selected room.
 * @param input - Room id plus the raw JSON payload uploaded by the client.
 * @returns The updated room summary after the anchor set replacement.
 * @remarks The payload is re-validated on the server so client-side file parsing cannot bypass the strict Lavender contract.
 */
export async function importRoomAnchorsForCurrentUser(input: {
  roomId: string;
  anchorSet: unknown;
}) {
  const user = await requireAuthUser();
  const parsed = roomAnchorSetSchema.parse(input.anchorSet);
  return replaceRoomAnchorSet({
    userId: user.id,
    roomId: input.roomId,
    anchorSet: parsed,
  });
}

/**
 * Loads the active anchor payload for one room owned by the current authenticated user.
 * @param input - Room id whose current anchors should be returned.
 * @returns The stored anchor set, or null when the room does not yet have imported anchors.
 * @remarks Separates room existence checks from raw anchor retrieval so the viewer can distinguish "empty room" from "invalid room".
 */
export async function getRoomAnchorsForCurrentUser(input: { roomId: string }) {
  const user = await requireAuthUser();
  const room = await findRoomByIdForUser(user.id, input.roomId);
  if (!room) {
    throw new Error("Room not found for the current user.");
  }

  return getRoomAnchorSetByRoomId(user.id, input.roomId);
}

/**
 * Generates a fresh randomized placement view for one owned room.
 * @param input - Room id whose anchors and ready concept assets should be combined.
 * @returns Placement data derived from the current room anchor set and ready generated assets.
 * @remarks Placements are derived on demand rather than persisted so the viewer always reflects current room anchors and asset readiness.
 */
export async function getRoomPlacementsForCurrentUser(
  input: GenerateRoomPlacementsInput,
): Promise<GenerateRoomPlacementsResult> {
  const user = await requireAuthUser();
  const room = await findRoomByIdForUser(user.id, input.roomId);
  if (!room) {
    throw new Error("Room not found for the current user.");
  }

  const anchorSet = await getRoomAnchorSetByRoomId(user.id, input.roomId);
  if (!anchorSet) {
    return {
      roomId: input.roomId,
      anchorSetCreated: "",
      totalAnchors: 0,
      totalReadyConcepts: 0,
      placements: [],
      unplacedConceptIds: [],
    };
  }

  const concepts = await listConceptsByRoomIdForUser(user.id, input.roomId);
  return {
    roomId: input.roomId,
    ...buildRoomPlacementPlan({
      anchorSet,
      concepts,
    }),
  };
}
