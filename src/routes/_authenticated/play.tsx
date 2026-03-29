import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { StudyMaterialImporter } from "@/features/concept-extraction/components/study-material-importer";
import { GameCanvas } from "@/features/game/components/game-canvas";

export const Route = createFileRoute("/_authenticated/play")({
  component: PlayPage,
});

function PlayPage() {
  const [roomRefreshToken, setRoomRefreshToken] = useState(0);
  const [placementRefreshToken, setPlacementRefreshToken] = useState(0);

  return (
    <main className="page">
      <div className="grid gap-6">
        <section className="surface-spotlight rounded-[30px] border border-white/[0.08] bg-[linear-gradient(180deg,rgba(255,255,255,0.08),rgba(255,255,255,0.03))] p-8 shadow-[0_0_0_1px_rgba(255,255,255,0.06),0_28px_80px_rgba(0,0,0,0.38)] backdrop-blur-xl md:p-10">
          <div className="text-xs font-medium uppercase tracking-[0.28em] text-[var(--accent-bright)]">
            Memory Palace MVP
          </div>
          <h1 className="text-gradient mt-5 text-4xl font-semibold tracking-tight md:text-5xl">
            Single-Room Placement Viewer
          </h1>
          <p className="mt-4 max-w-3xl text-sm leading-7 text-[var(--foreground-muted)]">
            Import study material into the single palace room, choose a preloaded room bundle from
            `public/rooms`, and preview generated concept assets placed into that room with its
            matching anchors.
          </p>
        </section>

        <StudyMaterialImporter
          onImported={() => {
            setRoomRefreshToken((value) => value + 1);
          }}
          onPlacementReady={() => {
            setPlacementRefreshToken((value) => value + 1);
          }}
        />
        <GameCanvas
          placementRefreshToken={placementRefreshToken}
          roomRefreshToken={roomRefreshToken}
        />
      </div>
    </main>
  );
}
