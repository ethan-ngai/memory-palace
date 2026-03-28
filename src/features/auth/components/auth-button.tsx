import { ButtonLink } from "@/components/ui/button";

export function AuthButton({ redirectTo }: { redirectTo?: string }) {
  const href = redirectTo
    ? `/api/auth/login?redirect=${encodeURIComponent(redirectTo)}`
    : "/api/auth/login";

  return <ButtonLink href={href}>Sign In with Auth0</ButtonLink>;
}
