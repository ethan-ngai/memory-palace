import { createServerFn } from "@tanstack/react-start";
import {
  gameProgressSchema,
  getAuthedGameProfile,
  saveAuthedGameProgress,
} from "@/features/game/server/game-progress.server";

export const getGameProfile = createServerFn({ method: "GET" }).handler(async () => {
  return getAuthedGameProfile();
});

export const saveGameProgress = createServerFn({ method: "POST" })
  .inputValidator(gameProgressSchema)
  .handler(async ({ data }) => {
    return saveAuthedGameProgress(data);
  });
