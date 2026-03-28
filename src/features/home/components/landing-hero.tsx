import { Link } from "@tanstack/react-router";
import { ButtonLink } from "@/components/ui/button";
import type { HomeState } from "@/features/home/types";

export function LandingHero({ homeState }: { homeState: HomeState }) {
  return (
    <section className="hero-grid">
      <article className="panel hero-panel">
        <div>
          <div className="eyebrow">TanStack Start + Three.js + Auth0</div>
          <h1 className="hero-title">Build a memory palace that actually plays.</h1>
          <p className="hero-copy">
            This boilerplate wires server-rendered routes, Auth0 login, MongoDB Atlas persistence,
            and a raw Three.js game loop into a feature-first TanStack Start app.
          </p>
        </div>
        <div className="nav-actions">
          <ButtonLink href="/play">
            {homeState.isAuthenticated ? "Enter your palace" : "Try the protected route"}
          </ButtonLink>
          <Link className="button button-secondary" to="/login">
            Review login flow
          </Link>
        </div>
      </article>
      <aside className="stack">
        <div className="panel card">
          <div className="eyebrow">Runtime</div>
          <h2>{homeState.appName}</h2>
          <p className="muted">
            Thin TanStack routes delegate UI and server logic into feature folders so auth,
            gameplay, and persistence stay local to their modules.
          </p>
        </div>
        <div className="panel card two-column">
          <div className="feature-card">
            <strong>Auth0</strong>
            <p className="muted">
              Regular web app session flow with signed cookies and Mongo sessions.
            </p>
          </div>
          <div className="feature-card">
            <strong>Game</strong>
            <p className="muted">
              Raw Three.js scene, keyboard input, saveable progress snapshots.
            </p>
          </div>
          <div className="feature-card">
            <strong>Server functions</strong>
            <p className="muted">
              Feature-local `functions.ts` files expose typed client-callable RPC.
            </p>
          </div>
          <div className="feature-card">
            <strong>Atlas</strong>
            <p className="muted">
              Official MongoDB driver singleton with Stable API configuration.
            </p>
          </div>
        </div>
      </aside>
    </section>
  );
}
