import { createFileRoute } from "@tanstack/react-router";
import {
  clearAuthTransactionCookie,
  deleteUserSession,
} from "@/features/auth/server/auth-session.server";
import { redirectResponse } from "@/lib/server/response.server";

export const Route = createFileRoute("/api/auth/logout")({
  server: {
    handlers: {
      GET: async () => {
        clearAuthTransactionCookie();
        await deleteUserSession();
        return redirectResponse("/");
      },
    },
  },
});
