/**
 * @file auth0.server.ts
 * @description Wraps Auth0's OIDC flow behind app-specific helpers.
 * @module auth
 */
import * as client from "openid-client";
import { getRequestUrl } from "@tanstack/react-start/server";
import { getServerEnv } from "@/lib/env/server";

let auth0ConfigurationCache:
  | {
      domain: string;
      promise: Promise<client.Configuration>;
    }
  | undefined;

/**
 * Resolves the Auth0 issuer URL from the validated server environment.
 * @returns The tenant issuer base URL used for OIDC discovery.
 */
function getIssuerUrl() {
  const serverEnv = getServerEnv();
  return new URL(`https://${serverEnv.AUTH0_DOMAIN}`);
}

/**
 * Builds the absolute callback URL registered with Auth0.
 * @returns The local callback endpoint URL.
 */
export function getAuthCallbackUrl() {
  const serverEnv = getServerEnv();
  return new URL("/api/auth/callback", serverEnv.APP_BASE_URL);
}

/**
 * Converts low-level discovery failures into actionable Auth0 configuration errors.
 * @param error - Original discovery error raised by `openid-client`.
 * @returns A wrapped error with guidance for local development.
 */
function toAuth0DiscoveryError(error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown Auth0 discovery error.";

  return new Error(
    [
      "Auth0 discovery failed.",
      "Check AUTH0_DOMAIN in your running server environment and restart the dev server after editing .env.",
      `Underlying error: ${message}`,
    ].join(" "),
    { cause: error instanceof Error ? error : undefined },
  );
}

/**
 * Loads and caches the Auth0 OIDC configuration for the active tenant.
 * @returns The discovered Auth0 client configuration.
 * @remarks
 * - The cache is keyed by domain so dev-server restarts or env changes do not keep using a stale tenant.
 * - Failed discovery attempts clear the cache so a later retry can succeed without restarting the process.
 */
export async function getAuth0Configuration() {
  const serverEnv = getServerEnv();
  const domain = serverEnv.AUTH0_DOMAIN;

  if (!auth0ConfigurationCache || auth0ConfigurationCache.domain !== domain) {
    const promise = client
      .discovery(
        getIssuerUrl(),
        serverEnv.AUTH0_CLIENT_ID,
        undefined,
        client.ClientSecretPost(serverEnv.AUTH0_CLIENT_SECRET),
      )
      .catch((error) => {
        if (auth0ConfigurationCache?.domain === domain) {
          auth0ConfigurationCache = undefined;
        }
        throw toAuth0DiscoveryError(error);
      });

    auth0ConfigurationCache = {
      domain,
      promise,
    };
  }

  return auth0ConfigurationCache.promise;
}

/**
 * Builds the Auth0 authorization URL for the current login attempt.
 * @param input - The PKCE challenge and state tied to the pending login transaction.
 * @returns The provider authorization URL to redirect the browser to.
 * @remarks
 * - Built server-side so PKCE values and provider-specific parameters never need to leak into client UI code.
 * - Centralizing this logic keeps future provider tuning isolated from routes and components.
 */
export async function buildAuth0AuthorizeUrl(input: { codeChallenge: string; state: string }) {
  const serverEnv = getServerEnv();
  const config = await getAuth0Configuration();

  const parameters: Record<string, string> = {
    redirect_uri: getAuthCallbackUrl().toString(),
    response_type: "code",
    scope: "openid profile email",
    code_challenge: input.codeChallenge,
    code_challenge_method: "S256",
    state: input.state,
  };

  if (serverEnv.AUTH0_AUDIENCE) {
    parameters.audience = serverEnv.AUTH0_AUDIENCE;
  }

  return client.buildAuthorizationUrl(config, parameters);
}

/**
 * Exchanges the Auth0 callback for normalized identity claims.
 * @param input - The expected state and PKCE verifier captured before redirecting away from the app.
 * @returns The subset of claims the app persists into its own user model.
 * @remarks
 * - Normalizes the provider response once so the rest of the app can work against local users and sessions instead of raw OIDC payloads.
 * - Rejects callbacks without a usable `sub` because the local user model cannot be anchored safely without it.
 */
export async function exchangeCallbackForClaims(input: {
  expectedState: string;
  pkceCodeVerifier: string;
}) {
  const config = await getAuth0Configuration();
  const requestUrl = getRequestUrl();

  const tokens = await client.authorizationCodeGrant(config, requestUrl, {
    expectedState: input.expectedState,
    pkceCodeVerifier: input.pkceCodeVerifier,
  });

  const claims = tokens.claims();
  if (!claims?.sub) {
    throw new Error("Auth0 callback did not return a usable subject claim.");
  }

  return {
    email: typeof claims.email === "string" ? claims.email : undefined,
    name: typeof claims.name === "string" ? claims.name : undefined,
    picture: typeof claims.picture === "string" ? claims.picture : undefined,
    sub: claims.sub,
  };
}
