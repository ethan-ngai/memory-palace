/**
 * @file auth-session.server.ts
 * @description Manages the app-owned auth session and transient Auth0 login transaction.
 * @module auth
 */
import { SignJWT, jwtVerify } from "jose";
import { ObjectId } from "mongodb";
import { deleteCookie, getCookie, setCookie } from "@tanstack/react-start/server";
import { getServerEnv } from "@/lib/env/server";
import { getDatabase } from "@/lib/server/mongodb.server";
import { findAuthUserById } from "@/features/auth/server/auth-user.repository.server";
import type { AuthState, SessionRecord } from "@/features/auth/types";

const SESSION_COOKIE_NAME = "mp_session";
const AUTH_TRANSACTION_COOKIE_NAME = "mp_auth_tx";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;
const AUTH_TRANSACTION_TTL_SECONDS = 60 * 10;

type SessionDocument = {
  _id: ObjectId;
  sid: string;
  userId: string;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
};

type SessionTokenPayload = {
  sid: string;
};

type AuthTransactionPayload = {
  codeVerifier: string;
  redirectTo: string;
  state: string;
};

function getSecretKey() {
  const serverEnv = getServerEnv();
  return new TextEncoder().encode(serverEnv.SESSION_COOKIE_SECRET);
}

function getCookieBaseOptions(maxAge: number) {
  const serverEnv = getServerEnv();
  return {
    httpOnly: true,
    maxAge,
    path: "/",
    sameSite: "lax" as const,
    secure: new URL(serverEnv.APP_BASE_URL).protocol === "https:",
  };
}

/**
 * Signs a compact token used in auth-related cookies.
 * @param payload - The small server-controlled payload to embed in the cookie.
 * @param expiresInSeconds - Cookie lifetime in seconds.
 * @returns A signed JWT string suitable for an HTTP-only cookie.
 * @remarks
 * - The cookie only carries session or transaction identifiers, not user profile data.
 * - Revocation and expiry stay enforceable on the server because MongoDB remains the source of truth.
 */
async function signToken(payload: Record<string, string>, expiresInSeconds: number) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${expiresInSeconds}s`)
    .sign(getSecretKey());
}

async function verifyToken<TPayload extends Record<string, unknown>>(token: string) {
  const result = await jwtVerify(token, getSecretKey());
  return result.payload as TPayload;
}

async function getSessionsCollection() {
  const database = await getDatabase();
  return database.collection<SessionDocument>("sessions");
}

function toSessionRecord(document: SessionDocument): SessionRecord {
  return {
    sid: document.sid,
    userId: document.userId,
    expiresAt: document.expiresAt.toISOString(),
  };
}

export function clearSessionCookie() {
  deleteCookie(SESSION_COOKIE_NAME, getCookieBaseOptions(0));
}

export function clearAuthTransactionCookie() {
  deleteCookie(AUTH_TRANSACTION_COOKIE_NAME, getCookieBaseOptions(0));
}

/**
 * Persists the in-flight Auth0 login transaction in a signed cookie.
 * @param input - The PKCE verifier, redirect target, and state generated before redirecting to Auth0.
 * @returns A promise that resolves once the transaction cookie has been written.
 * @remarks
 * - This avoids introducing a separate persistence layer just to survive the Auth0 redirect round-trip.
 * - The cookie exists only long enough to validate the callback and restore the user's intended destination.
 */
export async function createAuthTransaction(input: AuthTransactionPayload) {
  const token = await signToken(input, AUTH_TRANSACTION_TTL_SECONDS);

  setCookie(
    AUTH_TRANSACTION_COOKIE_NAME,
    token,
    getCookieBaseOptions(AUTH_TRANSACTION_TTL_SECONDS),
  );
}

export async function readAuthTransaction() {
  const token = getCookie(AUTH_TRANSACTION_COOKIE_NAME);
  if (!token) {
    return null;
  }

  try {
    const payload = await verifyToken<AuthTransactionPayload>(token);

    return {
      codeVerifier: payload.codeVerifier,
      redirectTo: payload.redirectTo,
      state: payload.state,
    };
  } catch {
    clearAuthTransactionCookie();
    return null;
  }
}

/**
 * Creates a durable app session for the authenticated user.
 * @param userId - The local application user id, not the raw Auth0 subject.
 * @returns A promise that resolves once the MongoDB session record and cookie are written.
 * @remarks
 * - Sessions are stored server-side so logout and expiration remain enforceable even if a signed cookie still exists in the browser.
 * - The cookie only points at the session record; it does not carry the user payload itself.
 */
export async function createUserSession(userId: string) {
  const sessions = await getSessionsCollection();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_SECONDS * 1000);
  const sid = crypto.randomUUID();

  await sessions.insertOne({
    _id: new ObjectId(),
    sid,
    userId,
    expiresAt,
    createdAt: now,
    updatedAt: now,
  });

  const token = await signToken({ sid }, SESSION_TTL_SECONDS);
  setCookie(SESSION_COOKIE_NAME, token, getCookieBaseOptions(SESSION_TTL_SECONDS));
}

export async function deleteUserSession() {
  const token = getCookie(SESSION_COOKIE_NAME);
  if (token) {
    try {
      const payload = await verifyToken<SessionTokenPayload>(token);
      const sessions = await getSessionsCollection();
      await sessions.deleteOne({ sid: payload.sid });
    } catch {
      // Ignore invalid session cookies and clear them below.
    }
  }

  clearSessionCookie();
}

export async function readSessionRecord() {
  const token = getCookie(SESSION_COOKIE_NAME);
  if (!token) {
    return null;
  }

  try {
    const payload = await verifyToken<SessionTokenPayload>(token);
    const sessions = await getSessionsCollection();
    const session = await sessions.findOne({
      sid: payload.sid,
      expiresAt: { $gt: new Date() },
    });

    if (!session) {
      clearSessionCookie();
      return null;
    }

    return toSessionRecord(session);
  } catch {
    clearSessionCookie();
    return null;
  }
}

/**
 * Reconstructs the current auth state from the app session.
 * @returns The normalized auth state for the current request, including the local user when authenticated.
 * @remarks
 * - Route guards and server functions read the same reconstructed state instead of trusting client-held auth assumptions.
 * - Missing users invalidate the session eagerly so stale session ids do not linger after user cleanup.
 */
export async function getAuthStateFromSession(): Promise<AuthState> {
  const session = await readSessionRecord();
  if (!session) {
    return {
      isAuthenticated: false,
      user: null,
    };
  }

  const user = await findAuthUserById(session.userId);
  if (!user) {
    await deleteUserSession();

    return {
      isAuthenticated: false,
      user: null,
    };
  }

  return {
    isAuthenticated: true,
    user,
  };
}

/**
 * Resolves the authenticated local user for server-side feature code.
 * @returns The authenticated application user.
 * @remarks Throws when the current request is anonymous so feature code can fail closed by default.
 */
export async function requireAuthUser() {
  const authState = await getAuthStateFromSession();
  if (!authState.isAuthenticated || !authState.user) {
    throw new Error("Unauthorized");
  }

  return authState.user;
}
