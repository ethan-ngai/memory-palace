/**
 * @file server.ts
 * @description Validates and exposes server-only environment configuration.
 * @module env
 */
import { z } from "zod";

const serverEnvSchema = z.object({
  AUTH0_DOMAIN: z.string().min(1),
  AUTH0_CLIENT_ID: z.string().min(1),
  AUTH0_CLIENT_SECRET: z.string().min(1),
  AUTH0_AUDIENCE: z.string().optional().default(""),
  APP_BASE_URL: z.string().url(),
  GEMINI_API_KEY: z.string().min(1),
  GEMINI_MODEL: z.string().optional().default(""),
  MONGODB_URI: z.string().min(1),
  MONGODB_DB_NAME: z.string().min(1),
  SESSION_COOKIE_SECRET: z.string().min(32),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export function parseServerEnv(env: Record<string, string | undefined>) {
  return serverEnvSchema.parse(env);
}

/**
 * Resolves the active server environment on demand.
 * @returns The validated server environment for the current process.
 * @remarks
 * - Kept lazy so route generation, builds, and isolated tests can import server modules without failing before configuration is actually needed.
 * - Validation still happens at the first real use site, so misconfiguration is surfaced close to runtime entry points.
 */
export function getServerEnv() {
  return parseServerEnv(process.env);
}
