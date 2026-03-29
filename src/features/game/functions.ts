/**
 * @file functions.ts
 * @description Client-callable server functions for the game and room-placement viewer feature.
 * @module game
 */
import { createServerFn } from "@tanstack/react-start";
import {
  gameProgressSchema,
  getAuthedGameProfile,
  saveAuthedGameProgress,
} from "@/features/game/server/game-progress.server";
import {
  clearRoomObjectsForCurrentUser,
  getRoomPlacementsForCurrentUser,
  getRoomAnchorsForCurrentUser,
  importRoomAnchorsForCurrentUser,
  importRoomAnchorsInputSchema,
  listBundledViewerRooms,
  listRoomsForCurrentUser,
  roomIdInputSchema,
} from "@/features/game/server/room-placement.server";

/**
 * Loads the saved game profile for the current authenticated user.
 * @remarks Preserves the legacy prototype API alongside the new room-placement viewer endpoints.
 */
export const getGameProfile = createServerFn({ method: "GET" }).handler(async () => {
  return getAuthedGameProfile();
});

/**
 * Persists the latest gameplay snapshot for the current authenticated user.
 * @remarks Validation happens on both client and server boundaries so only finite numeric state reaches MongoDB.
 */
export const saveGameProgress = createServerFn({ method: "POST" })
  .inputValidator(gameProgressSchema)
  .handler(async ({ data }) => {
    return saveAuthedGameProgress(data);
  });

/**
 * Lists the current user's available rooms for the room-placement viewer.
 * @remarks Keeps room selection in the viewer feature so the play route does not need to know concept-persistence internals.
 */
export const listViewerRooms = createServerFn({ method: "GET" }).handler(async () => {
  return listRoomsForCurrentUser();
});

/**
 * Lists prebundled room scene and anchor pairs discovered from `public/rooms`.
 * @remarks Lets the play route preload a room dropdown without hardcoding public asset names into the client bundle.
 */
export const listBundledRooms = createServerFn({ method: "GET" }).handler(async () => {
  return listBundledViewerRooms();
});

/**
 * Imports one validated anchor payload for the selected room.
 * @remarks The server performs the strict Lavender-format validation even when the client already parsed the uploaded JSON.
 */
export const importRoomAnchors = createServerFn({ method: "POST" })
  .inputValidator(importRoomAnchorsInputSchema)
  .handler(async ({ data }) => {
    return importRoomAnchorsForCurrentUser(data);
  });

/**
 * Loads the active imported anchors for one selected room.
 * @remarks Returns null when the room exists but does not yet own an imported anchor set.
 */
export const getRoomAnchors = createServerFn({ method: "POST" })
  .inputValidator(roomIdInputSchema)
  .handler(async ({ data }) => {
    return getRoomAnchorsForCurrentUser(data);
  });

/**
 * Generates a fresh placement view for one selected room.
 * @remarks This stays derived rather than persisted so placement refreshes always reflect current ready assets and room anchors.
 */
export const getRoomPlacements = createServerFn({ method: "POST" })
  .inputValidator(roomIdInputSchema)
  .handler(async ({ data }) => {
    return getRoomPlacementsForCurrentUser(data);
  });

/**
 * Deletes all concept-backed objects associated with one selected room.
 * @remarks The viewer uses this destructive action to clear the current room after explicit user confirmation.
 */
export const clearRoomObjects = createServerFn({ method: "POST" })
  .inputValidator(roomIdInputSchema)
  .handler(async ({ data }) => {
    return clearRoomObjectsForCurrentUser(data);
  });
