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
    <main className="page grid gap-6 lg:grid-cols-[0.95fr_minmax(320px,0.85fr)]">
      <section className="surface-spotlight rounded-[30px] border border-white/[0.08] bg-[linear-gradient(180deg,rgba(255,255,255,0.08),rgba(255,255,255,0.03))] p-8 shadow-[0_0_0_1px_rgba(255,255,255,0.06),0_28px_80px_rgba(0,0,0,0.38)] backdrop-blur-xl md:p-10">
        <div className="text-xs font-medium uppercase tracking-[0.28em] text-[var(--accent-bright)]">
          Auth0 Session Flow
        </div>
        <h1 className="text-gradient mt-5 text-4xl font-semibold tracking-tight md:text-5xl">
          Login gateway
        </h1>
        <p className="mt-4 max-w-xl text-sm leading-7 text-[var(--foreground-muted)]">
          This route stays public, while the actual login redirect is handled by the server route at{" "}
          <code>/api/auth/login</code>.
        </p>
        <div className="mt-8">
          <AuthButton redirectTo={redirect} />
        </div>
      </section>

      <aside className="grid gap-4">
        <div className="surface-spotlight rounded-[24px] border border-white/[0.08] bg-[linear-gradient(180deg,rgba(255,255,255,0.07),rgba(255,255,255,0.03))] p-6 shadow-[var(--shadow-card)] backdrop-blur-xl">
          <div className="text-xs uppercase tracking-[0.24em] text-[var(--foreground-subtle)]">
            Current Status
          </div>
          <p className="mt-3 text-sm leading-7 text-[var(--foreground-muted)]">
            {auth.isAuthenticated
              ? "You already have an active session."
              : "No active session found."}
          </p>
        </div>

        <div className="surface-spotlight rounded-[24px] border border-white/[0.08] bg-[linear-gradient(180deg,rgba(255,255,255,0.07),rgba(255,255,255,0.03))] p-6 shadow-[var(--shadow-card)] backdrop-blur-xl">
          <div className="text-xs uppercase tracking-[0.24em] text-[var(--foreground-subtle)]">
            Redirect Target
          </div>
          <p className="mt-3 text-sm leading-7 text-[var(--foreground-muted)]">
            You will be redirected to {redirect || "/play"} after Auth0 completes the callback.
          </p>
        </div>

        <div className="surface-spotlight rounded-[24px] border border-[rgba(94,106,210,0.22)] bg-[rgba(94,106,210,0.08)] p-6 shadow-[0_0_0_1px_rgba(94,106,210,0.12),0_24px_64px_rgba(0,0,0,0.22)] backdrop-blur-xl">
          <div className="text-xs uppercase tracking-[0.24em] text-[var(--accent-bright)]">
            Session Boundary
          </div>
          <p className="mt-3 text-sm leading-7 text-[var(--foreground-muted)]">
            The public login route only launches the server-side Auth0 flow. Protected routes stay
            behind the auth guard.
          </p>
        </div>
      </aside>
    </main>
  );
}
