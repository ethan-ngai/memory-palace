import { createFileRoute } from "@tanstack/react-router";
import { SpzGlbViewer } from "@/features/game/components/spz-glb-viewer";

export const Route = createFileRoute("/viewer")({
  component: ViewerPage,
});

/**
 * Renders the public SPZ + GLB viewer page without authentication requirements.
 * @returns A standalone page that hosts the combined scene viewer.
 */
function ViewerPage() {
  return (
    <main className="page">
      <div className="stack">
        <section className="panel card">
          <div className="eyebrow">Public splat viewer</div>
          <h1>Viewer</h1>
          <p className="muted">Open the SPZ + placed GLB scene without signing in.</p>
        </section>
        <SpzGlbViewer />
      </div>
    </main>
  );
}
