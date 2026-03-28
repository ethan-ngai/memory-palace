import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { useGameEngine } from "@/features/game/hooks/use-game-engine";
import { saveGameProgress } from "@/features/game/functions";
import { GameHud } from "@/features/game/components/hud";
import type { GameCanvasProps } from "@/features/game/types";

export function GameCanvas({ initialProfile }: GameCanvasProps) {
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  const snapshot = useGameEngine({
    canvas,
    initialSnapshot: initialProfile.snapshot,
  });

  const saveProgressMutation = useMutation({
    mutationFn: async () =>
      saveGameProgress({
        data: {
          snapshot,
        },
      }),
  });

  return (
    <div className="game-shell">
      <section className="panel game-stage">
        <canvas className="game-canvas" ref={setCanvas} />
      </section>
      <GameHud
        isSaving={saveProgressMutation.isPending}
        lastPlayedAt={saveProgressMutation.data?.lastPlayedAt ?? initialProfile.lastPlayedAt}
        onSave={() => {
          void saveProgressMutation.mutateAsync();
        }}
        snapshot={snapshot}
      />
    </div>
  );
}
