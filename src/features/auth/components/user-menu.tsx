import { ButtonLink } from "@/components/ui/button";
import type { AuthUser } from "@/features/auth/types";

export function UserMenu({ user }: { user: AuthUser }) {
  return (
    <div className="user-chip">
      {user.picture ? (
        <img alt={user.name} className="avatar" src={user.picture} />
      ) : (
        <div className="avatar" />
      )}
      <div>
        <div>{user.name}</div>
        <div className="muted">{user.email}</div>
      </div>
      <ButtonLink href="/api/auth/logout" tone="secondary">
        Logout
      </ButtonLink>
    </div>
  );
}
