import { Button } from "@/components/ui/button";
import { useKeyboardInput } from "@/features/game/hooks/use-keyboard-input";
import type { GameSnapshot } from "@/features/game/types";

export function GameHud(props: {
  isSaving: boolean;
  lastPlayedAt: string | null;
  onSave: () => void;
  snapshot: GameSnapshot;
}) {
  const controlHints = useKeyboardInput();

  return (
    <aside className="panel card hud">
      <div className="status-badge">Authenticated chamber</div>
      <div className="hud-stat">
        <div className="stat-label">Rotation</div>
        <div className="stat-value">{props.snapshot.cubeRotation.toFixed(2)} rad</div>
      </div>
      <div className="hud-stat">
        <div className="stat-label">Position</div>
        <div className="stat-value">
          {props.snapshot.playerX.toFixed(2)}, {props.snapshot.playerZ.toFixed(2)}
        </div>
      </div>
      <div className="hud-stat">
        <div className="stat-label">Last save</div>
        <div className="stat-value">
          {props.lastPlayedAt ? new Date(props.lastPlayedAt).toLocaleString() : "Not saved yet"}
        </div>
      </div>
      <div className="stack">
        {controlHints.map((hint) => (
          <div className="feature-card" key={hint}>
            {hint}
          </div>
        ))}
      </div>
      <Button disabled={props.isSaving} onClick={props.onSave}>
        {props.isSaving ? "Saving..." : "Save Progress"}
      </Button>
    </aside>
  );
}
