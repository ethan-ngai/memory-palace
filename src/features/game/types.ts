/**
 * @file types.ts
 * @description Shared transport types for the game and room-placement viewer feature.
 * @module game
 */

/**
 * Serializable gameplay snapshot saved for the legacy cube prototype.
 * @description Keeps the original play-state transport contract intact while the room-placement viewer evolves alongside it.
 */
export interface GameSnapshot {
  cubeRotation: number;
  playerX: number;
  playerZ: number;
}

/**
 * Payload used when persisting legacy gameplay progress.
 * @description Wraps the snapshot so future game metadata can be added without changing the save function shape.
 */
export interface GameProgress {
  snapshot: GameSnapshot;
}

/**
 * Persisted gameplay profile for one authenticated user.
 * @description Exists for the original prototype loop and remains part of the public game feature contract.
 */
export interface GameProfile {
  userId: string;
  lastPlayedAt: string | null;
  snapshot: GameSnapshot;
}

/**
 * Legacy canvas props used by the original cube prototype.
 * @description Preserved so older game-engine tests and helpers can continue to compile unchanged.
 */
export interface GameCanvasProps {
  initialProfile: GameProfile;
}

/**
 * One 3D coordinate stored in the imported room anchor payload.
 * @description Uses JSON-safe scalars so the viewer, server functions, and Mongo persistence can share one shape without leaking Three.js types.
 */
export interface RoomAnchorPosition {
  x: number;
  y: number;
  z: number;
}

/**
 * One validated anchor candidate imported for a room.
 * @description Mirrors the Lavender anchor JSON contract exactly so the import path has a single strict source of truth.
 */
export interface RoomAnchor {
  id: number;
  label: string;
  surface: string;
  position: RoomAnchorPosition;
}

/**
 * Full imported anchor payload owned by one room.
 * @description Stored wholesale on the room so re-imports replace one stable document field rather than introducing versioned child records.
 */
export interface RoomAnchorSet {
  version: "1.0";
  created: string;
  description: string;
  totalCandidates: number;
  anchors: RoomAnchor[];
}

/**
 * One generated concept asset assigned to one anchor for viewer rendering.
 * @description Joins room anchor data with concept asset metadata so the client can render placements without additional lookups.
 */
export interface RoomPlacementItem {
  anchorId: number;
  conceptId: string;
  conceptName: string;
  conceptDescription: string;
  metaphorObjectName?: string;
  metaphorRationale?: string;
  assetUrl: string;
  previewUrl?: string;
  position: RoomAnchorPosition;
  surface: string;
  label: string;
}

/**
 * User-facing inspection payload for one clicked placed object.
 * @description Keeps popup content decoupled from Three.js internals so React can render a stable modal from clicked placement metadata.
 */
export interface RoomPlacementInspection {
  anchorId: number;
  conceptId: string;
  conceptName: string;
  conceptDescription: string;
  metaphorObjectName?: string;
  metaphorRationale?: string;
  label: string;
  surface: string;
}

/**
 * Prebundled viewer room discovered from `public/rooms`.
 * @description Encodes the file-pair naming convention so the client can preload room choices and auto-pair each scene with its matching anchor JSON.
 */
export interface BundledViewerRoom {
  id: string;
  name: string;
  sceneUrl: string;
  anchorUrl: string;
}

/**
 * Input accepted by the room-placement generation server function.
 * @description Keeps the API explicit and room-scoped so placement derivation can remain stateless.
 */
export interface GenerateRoomPlacementsInput {
  roomId: string;
}

/**
 * JSON-safe placement result returned to the viewer.
 * @description Includes both coverage counts and leftover concept ids so the client can explain why some concepts were not placed.
 */
export interface GenerateRoomPlacementsResult {
  roomId: string;
  anchorSetCreated: string;
  totalAnchors: number;
  totalReadyConcepts: number;
  placements: RoomPlacementItem[];
  unplacedConceptIds: string[];
}
