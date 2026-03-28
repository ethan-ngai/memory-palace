import { createFileRoute } from "@tanstack/react-router";
import * as client from "openid-client";
import { buildAuth0AuthorizeUrl } from "@/features/auth/server/auth0.server";
import { createAuthTransaction } from "@/features/auth/server/auth-session.server";
import { redirectResponse } from "@/lib/server/response.server";

export const Route = createFileRoute("/api/auth/login")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const currentUrl = new URL(request.url);
        const redirectTo = currentUrl.searchParams.get("redirect") || "/play";
        const state = client.randomState();
        const codeVerifier = client.randomPKCECodeVerifier();
        const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier);

        await createAuthTransaction({
          codeVerifier,
          redirectTo,
          state,
        });

        const authorizationUrl = await buildAuth0AuthorizeUrl({
          codeChallenge,
          state,
        });

        return redirectResponse(authorizationUrl);
      },
    },
  },
});
