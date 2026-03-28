import { createFileRoute } from "@tanstack/react-router";
import { exchangeCallbackForClaims } from "@/features/auth/server/auth0.server";
import {
  clearAuthTransactionCookie,
  createUserSession,
  readAuthTransaction,
} from "@/features/auth/server/auth-session.server";
import { upsertAuthUserFromClaims } from "@/features/auth/server/auth-user.repository.server";
import { redirectResponse } from "@/lib/server/response.server";

export const Route = createFileRoute("/api/auth/callback")({
  server: {
    handlers: {
      GET: async () => {
        const transaction = await readAuthTransaction();
        if (!transaction) {
          return redirectResponse("/login");
        }

        const claims = await exchangeCallbackForClaims({
          expectedState: transaction.state,
          pkceCodeVerifier: transaction.codeVerifier,
        });
        const user = await upsertAuthUserFromClaims(claims);
        await createUserSession(user.id);
        clearAuthTransactionCookie();

        return redirectResponse(transaction.redirectTo);
      },
    },
  },
});
