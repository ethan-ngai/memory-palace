import { createFileRoute } from "@tanstack/react-router";
import { useAuth } from "@/features/auth/hooks/use-auth";

export const Route = createFileRoute("/_authenticated/profile")({
  component: ProfilePage,
});

function ProfilePage() {
  const auth = useAuth();

  return (
    <main className="page">
      <section className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_340px]">
        <article className="surface-spotlight rounded-[30px] border border-white/[0.08] bg-[linear-gradient(180deg,rgba(255,255,255,0.08),rgba(255,255,255,0.03))] p-8 shadow-[0_0_0_1px_rgba(255,255,255,0.06),0_28px_80px_rgba(0,0,0,0.38)] backdrop-blur-xl md:p-10">
          <div className="text-xs font-medium uppercase tracking-[0.28em] text-[var(--accent-bright)]">
            Authenticated Profile
          </div>
          <h1 className="text-gradient mt-5 text-4xl font-semibold tracking-tight md:text-5xl">
            {auth.user?.name}
          </h1>
          <p className="mt-4 max-w-2xl text-sm leading-7 text-[var(--foreground-muted)]">
            Your identity record is resolved at the route boundary so the profile page can render
            account details directly without duplicating session checks in the UI.
          </p>

          <div className="mt-8 grid gap-4 md:grid-cols-2">
            <div className="surface-spotlight rounded-[24px] border border-white/[0.08] bg-black/20 p-6">
              <div className="text-xs uppercase tracking-[0.24em] text-[var(--foreground-subtle)]">
                Email
              </div>
              <p className="mt-3 text-sm leading-7 text-[var(--foreground-muted)]">
                {auth.user?.email}
              </p>
            </div>
            <div className="surface-spotlight rounded-[24px] border border-white/[0.08] bg-black/20 p-6">
              <div className="text-xs uppercase tracking-[0.24em] text-[var(--foreground-subtle)]">
                Auth0 Subject
              </div>
              <p className="mt-3 break-all text-sm leading-7 text-[var(--foreground-muted)]">
                {auth.user?.auth0Sub}
              </p>
            </div>
          </div>
        </article>

        <aside className="grid gap-4">
          <div className="surface-spotlight rounded-[24px] border border-[rgba(94,106,210,0.22)] bg-[rgba(94,106,210,0.08)] p-6 shadow-[0_0_0_1px_rgba(94,106,210,0.12),0_24px_64px_rgba(0,0,0,0.22)] backdrop-blur-xl">
            <div className="text-xs uppercase tracking-[0.24em] text-[var(--accent-bright)]">
              Account State
            </div>
            <p className="mt-3 text-sm leading-7 text-[var(--foreground-muted)]">
              Session is active and this route was admitted by the server-side auth guard.
            </p>
          </div>

          <div className="surface-spotlight rounded-[24px] border border-white/[0.08] bg-[linear-gradient(180deg,rgba(255,255,255,0.07),rgba(255,255,255,0.03))] p-6 shadow-[var(--shadow-card)] backdrop-blur-xl">
            <div className="text-xs uppercase tracking-[0.24em] text-[var(--foreground-subtle)]">
              Identity Timestamps
            </div>
            <p className="mt-3 text-sm leading-7 text-[var(--foreground-muted)]">
              Created {auth.user ? new Date(auth.user.createdAt).toLocaleString() : "—"}
            </p>
            <p className="mt-2 text-sm leading-7 text-[var(--foreground-muted)]">
              Updated {auth.user ? new Date(auth.user.updatedAt).toLocaleString() : "—"}
            </p>
          </div>
        </aside>
      </section>
    </main>
  );
}
