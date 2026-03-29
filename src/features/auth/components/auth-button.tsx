import { ButtonLink } from "@/components/ui/button";

/**
 * Renders the Auth0 login entry point with an optional post-login redirect.
 * @param props - Optional redirect target forwarded to the server login route.
 * @returns Anchor-styled button that starts the authentication flow.
 */
export function AuthButton({ redirectTo }: { redirectTo?: string }) {
  const href = redirectTo
    ? `/api/auth/login?redirect=${encodeURIComponent(redirectTo)}`
    : "/api/auth/login";

  return <ButtonLink href={href}>Sign In With Auth0</ButtonLink>;
}
