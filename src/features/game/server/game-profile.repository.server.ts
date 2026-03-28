import { getDatabase } from "@/lib/server/mongodb.server";
import type { GameProfile, GameSnapshot } from "@/features/game/types";

type GameProgressDocument = {
  userId: string;
  snapshot: GameSnapshot;
  createdAt: Date;
  updatedAt: Date;
};

const defaultSnapshot: GameSnapshot = {
  cubeRotation: 0,
  playerX: 0,
  playerZ: 0,
};

function toGameProfile(document: GameProgressDocument | null, userId: string): GameProfile {
  return {
    userId,
    lastPlayedAt: document ? document.updatedAt.toISOString() : null,
    snapshot: document?.snapshot ?? defaultSnapshot,
  };
}

async function getGameProgressCollection() {
  const database = await getDatabase();
  return database.collection<GameProgressDocument>("game_progress");
}

export async function getGameProfileByUserId(userId: string) {
  const progress = await getGameProgressCollection();
  const document = await progress.findOne({ userId });
  return toGameProfile(document, userId);
}

export async function saveGameProfileByUserId(userId: string, snapshot: GameSnapshot) {
  const progress = await getGameProgressCollection();
  const now = new Date();

  await progress.updateOne(
    { userId },
    {
      $set: {
        snapshot,
        updatedAt: now,
      },
      $setOnInsert: {
        createdAt: now,
      },
    },
    { upsert: true },
  );

  const updated = await progress.findOne({ userId });
  return toGameProfile(updated, userId);
}
