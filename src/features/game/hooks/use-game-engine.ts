import { useEffect, useEffectEvent, useState } from "react";
import { createGameEngine } from "@/features/game/engine/boot";
import type { GameSnapshot } from "@/features/game/types";

export function useGameEngine(options: {
  canvas: HTMLCanvasElement | null;
  initialSnapshot: GameSnapshot;
}) {
  const [snapshot, setSnapshot] = useState<GameSnapshot>(options.initialSnapshot);
  const handleSnapshotChange = useEffectEvent((nextSnapshot: GameSnapshot) => {
    setSnapshot(nextSnapshot);
  });

  useEffect(() => {
    if (!options.canvas) {
      return;
    }

    const engine = createGameEngine({
      canvas: options.canvas,
      initialSnapshot: options.initialSnapshot,
      onSnapshotChange: handleSnapshotChange,
    });

    setSnapshot(options.initialSnapshot);

    return () => {
      engine.dispose();
    };
  }, [handleSnapshotChange, options.canvas, options.initialSnapshot]);

  return snapshot;
}
