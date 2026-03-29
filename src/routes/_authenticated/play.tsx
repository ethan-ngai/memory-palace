import { createFileRoute } from "@tanstack/react-router";
import { SpzGlbViewer } from "@/features/game/components/spz-glb-viewer";

export const Route = createFileRoute("/_authenticated/play")({
  component: PlayPage,
});

function PlayPage() {
  return (
    <main className="page">
      <div className="stack">
        <section className="panel card">
          <div className="eyebrow">Gaussian splat + mesh viewer</div>
          <h1>Play</h1>
          <p className="muted">
            This viewer combines a high-fidelity SPZ visual layer with a GLB layer that contains
            your generated object placements.
          </p>
        </section>
        <SpzGlbViewer />
      </div>
    </main>
  );
}
