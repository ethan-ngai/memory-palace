import { Route as RootRoute } from "@/routes/__root";

export function useAuth() {
  return RootRoute.useRouteContext({
    select: (context) => context.auth,
  });
}
