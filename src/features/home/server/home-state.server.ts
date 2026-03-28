import { clientEnv } from "@/lib/env/client";
import { getAuthStateFromSession } from "@/features/auth/server/auth-session.server";

export async function getServerHomeState() {
  const auth = await getAuthStateFromSession();

  return {
    appName: clientEnv.appName,
    isAuthenticated: auth.isAuthenticated,
  };
}
