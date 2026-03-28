import { Outlet, createFileRoute } from "@tanstack/react-router";
import { requireAuthenticatedRoute } from "@/features/auth/auth-guard";

export const Route = createFileRoute("/_authenticated")({
  beforeLoad: ({ context, location }) => {
    const user = requireAuthenticatedRoute(context.auth, location.href);
    return { user };
  },
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  return <Outlet />;
}
