import { createServerFn } from "@tanstack/react-start";
import { getAuthStateFromSession } from "@/features/auth/server/auth-session.server";

export const getAuthState = createServerFn({ method: "GET" }).handler(async () => {
  return getAuthStateFromSession();
});
