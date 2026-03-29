import { createFileRoute } from "@tanstack/react-router";
import { GameCanvas } from "@/features/game/components/game-canvas";

export const Route = createFileRoute("/_authenticated/play")({
  component: PlayPage,
});

function PlayPage() {
  return (
    <main className="page">
      <div className="stack">
        <section className="panel card">
          <div className="eyebrow">Memory Palace editor</div>
          <h1>Play</h1>
          <p className="muted">
            The standalone anchor-tagging prototype now runs as a native TanStack Start feature with
            client-owned Three.js lifecycle and route-managed hydration.
          </p>
        </section>
        <GameCanvas />
      </div>
    </main>
  );
}
