/**
 * @file auth-guard.ts
 * @description Guards authenticated routes using normalized route context auth state.
 * @module auth
 */
import { redirect } from "@tanstack/react-router";
import type { AuthState } from "@/features/auth/types";

/**
 * Enforces authentication for a route branch.
 * @param auth - The normalized auth state attached to the router context.
 * @param locationHref - The current location used to restore navigation after login.
 * @returns The authenticated user when access is allowed.
 * @remarks
 * - Consumes route context instead of session primitives so routing stays framework-facing and session plumbing stays server-facing.
 * - Preserves the original destination to support post-login redirects without duplicating logic in each route.
 */
export function requireAuthenticatedRoute(auth: AuthState, locationHref: string) {
  if (!auth.isAuthenticated || !auth.user) {
    throw redirect({
      search: { redirect: locationHref },
      to: "/login",
    });
  }

  return auth.user;
}
