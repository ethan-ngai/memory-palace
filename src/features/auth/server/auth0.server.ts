/**
 * @file auth0.server.ts
 * @description Wraps Auth0's OIDC flow behind app-specific helpers.
 * @module auth
 */
import * as client from "openid-client";
import { getRequestUrl } from "@tanstack/react-start/server";
import { getServerEnv } from "@/lib/env/server";

let auth0ConfigurationPromise: Promise<client.Configuration> | undefined;

function getIssuerUrl() {
  const serverEnv = getServerEnv();
  return new URL(`https://${serverEnv.AUTH0_DOMAIN}`);
}

export function getAuthCallbackUrl() {
  const serverEnv = getServerEnv();
  return new URL("/api/auth/callback", serverEnv.APP_BASE_URL);
}

export async function getAuth0Configuration() {
  const serverEnv = getServerEnv();

  auth0ConfigurationPromise ??= client.discovery(
    getIssuerUrl(),
    serverEnv.AUTH0_CLIENT_ID,
    undefined,
    client.ClientSecretPost(serverEnv.AUTH0_CLIENT_SECRET),
  );

  return auth0ConfigurationPromise;
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
