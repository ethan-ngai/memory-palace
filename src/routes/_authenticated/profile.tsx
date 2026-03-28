import { createFileRoute } from "@tanstack/react-router";
import { useAuth } from "@/features/auth/hooks/use-auth";

export const Route = createFileRoute("/_authenticated/profile")({
  component: ProfilePage,
});

function ProfilePage() {
  const auth = useAuth();

  return (
    <main className="page">
      <section className="panel card stack">
        <div className="eyebrow">Authenticated profile</div>
        <h1>{auth.user?.name}</h1>
        <div className="feature-card">
          <strong>Email</strong>
          <p className="muted">{auth.user?.email}</p>
        </div>
        <div className="feature-card">
          <strong>Auth0 subject</strong>
          <p className="muted">{auth.user?.auth0Sub}</p>
        </div>
      </section>
    </main>
  );
}
