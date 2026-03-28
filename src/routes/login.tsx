import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { AuthButton } from "@/features/auth/components/auth-button";
import { useAuth } from "@/features/auth/hooks/use-auth";

const loginSearchSchema = z.object({
  redirect: z.string().optional(),
});

export const Route = createFileRoute("/login")({
  component: LoginPage,
  validateSearch: loginSearchSchema,
});

function LoginPage() {
  const { redirect } = Route.useSearch();
  const auth = useAuth();

  return (
    <main className="page auth-grid">
      <section className="panel card">
        <div className="eyebrow">Auth0 session flow</div>
        <h1>Login gateway</h1>
        <p className="muted">
          This route stays public, while the actual login redirect is handled by the server route at{" "}
          <code>/api/auth/login</code>.
        </p>
        <AuthButton redirectTo={redirect} />
      </section>
      <aside className="panel card stack">
        <div className="feature-card">
          <strong>Current status</strong>
          <p className="muted">
            {auth.isAuthenticated
              ? "You already have an active session."
              : "No active session found."}
          </p>
        </div>
        <div className="feature-card">
          <strong>After login</strong>
          <p className="muted">
            You will be redirected to {redirect || "/play"} after Auth0 completes the callback.
          </p>
        </div>
      </aside>
    </main>
  );
}
