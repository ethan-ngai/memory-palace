import { describe, expect, it } from "vitest";
import { gameProgressSchema } from "@/features/game/server/game-progress.server";

describe("gameProgressSchema", () => {
  it("rejects invalid payloads", () => {
    const result = gameProgressSchema.safeParse({
      snapshot: {
        cubeRotation: Number.NaN,
        playerX: 0,
        playerZ: 0,
      },
    });

    expect(result.success).toBe(false);
  });
});
