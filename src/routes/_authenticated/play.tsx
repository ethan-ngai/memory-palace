import { createFileRoute } from "@tanstack/react-router";
import { GameCanvas } from "@/features/game/components/game-canvas";
import { getGameProfile } from "@/features/game/functions";

export const Route = createFileRoute("/_authenticated/play")({
  component: PlayPage,
  loader: async () => {
    return getGameProfile();
  },
});

function PlayPage() {
  const profile = Route.useLoaderData();

  return (
    <main className="page">
      <div className="stack">
        <section className="panel card">
          <div className="eyebrow">Three.js game chamber</div>
          <h1>Play</h1>
          <p className="muted">
            The game scene is feature-owned and persists progress through a TanStack Start server
            function.
          </p>
        </section>
        <GameCanvas initialProfile={profile} />
      </div>
    </main>
  );
}
