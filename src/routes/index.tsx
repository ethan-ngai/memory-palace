import { createFileRoute } from "@tanstack/react-router";
import { useAuth } from "@/features/auth/hooks/use-auth";
import { LandingHero } from "@/features/home/components/landing-hero";
import { clientEnv } from "@/lib/env/client";

export const Route = createFileRoute("/")({
  component: HomePage,
});

function HomePage() {
  const auth = useAuth();

  return (
    <main className="page">
      <LandingHero
        homeState={{
          appName: clientEnv.appName,
          isAuthenticated: auth.isAuthenticated,
        }}
      />
    </main>
  );
}
