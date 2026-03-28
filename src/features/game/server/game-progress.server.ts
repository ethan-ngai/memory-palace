/**
 * @file game-progress.server.ts
 * @description Validates and persists authenticated gameplay progress.
 * @module game
 */
import { z } from "zod";
import { requireAuthUser } from "@/features/auth/server/auth-session.server";
import {
  getGameProfileByUserId,
  saveGameProfileByUserId,
} from "@/features/game/server/game-profile.repository.server";
import type { GameProgress } from "@/features/game/types";

export const gameSnapshotSchema = z.object({
  cubeRotation: z.number().finite(),
  playerX: z.number().finite(),
  playerZ: z.number().finite(),
});

export const gameProgressSchema = z.object({
  snapshot: gameSnapshotSchema,
});

/**
 * Loads the saved game profile for the current authenticated user.
 * @returns The user's persisted game profile, or the feature default when none exists yet.
 * @remarks
 * - Persistence is keyed by the app's local user id so the game feature stays independent from Auth0-specific identifiers.
 * - Authentication happens here once, which keeps downstream repository code focused on data access rather than access control.
 */
export async function getAuthedGameProfile() {
  const user = await requireAuthUser();
  return getGameProfileByUserId(user.id);
}

/**
 * Validates and saves gameplay progress for the current authenticated user.
 * @param progress - The transport-safe gameplay snapshot sent from the client.
 * @returns The updated stored game profile after persistence.
 * @remarks Validation is enforced at this boundary so the repository only ever receives finite numeric state suitable for long-term storage.
 */
export async function saveAuthedGameProgress(progress: GameProgress) {
  const user = await requireAuthUser();
  const parsed = gameProgressSchema.parse(progress);
  return saveGameProfileByUserId(user.id, parsed.snapshot);
}
