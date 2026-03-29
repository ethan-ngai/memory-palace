import { ButtonLink } from "@/components/ui/button";
import type { AuthUser } from "@/features/auth/types";

/**
 * Displays the authenticated user summary and logout action in the site header.
 * @param props - Current authenticated user resolved from the root route context.
 * @returns Compact identity card suitable for both desktop and mobile navigation areas.
 */
export function UserMenu({ user }: { user: AuthUser }) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-[20px] border border-white/[0.08] bg-white/[0.05] px-3 py-2 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.08),0_18px_44px_rgba(0,0,0,0.18)] backdrop-blur-xl">
      {user.picture ? (
        <img
          alt={user.name}
          className="h-10 w-10 rounded-full border border-white/[0.12] object-cover"
          src={user.picture}
        />
      ) : (
        <div className="h-10 w-10 rounded-full border border-white/[0.12] bg-[rgba(94,106,210,0.15)]" />
      )}
      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-[var(--foreground)]">{user.name}</div>
        <div className="truncate text-xs text-[var(--foreground-muted)]">{user.email}</div>
      </div>
      <ButtonLink href="/api/auth/logout" tone="secondary">
        Logout
      </ButtonLink>
    </div>
  );
}
