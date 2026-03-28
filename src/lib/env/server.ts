/**
 * @file server.ts
 * @description Validates and exposes server-only environment configuration.
 * @module env
 */
import { z } from "zod";

const commonServerEnvSchema = z.object({
  AUTH0_DOMAIN: z.string().min(1),
  AUTH0_CLIENT_ID: z.string().min(1),
  AUTH0_CLIENT_SECRET: z.string().min(1),
  AUTH0_AUDIENCE: z.string().optional().default(""),
  APP_BASE_URL: z.string().url(),
  GEMINI_API_KEY: z.string().min(1),
  AI_PROVIDER: z.enum(["gemini", "openai-compatible"]).optional().default("gemini"),
  GEMINI_API_BASE_URL: z
    .string()
    .url()
    .optional()
    .default("https://generativelanguage.googleapis.com/v1beta"),
  GEMINI_MODEL: z.string().optional().default("gemini-2.5-flash"),
  OPENAI_COMPATIBLE_API_BASE_URL: z.string().url().optional(),
  OPENAI_COMPATIBLE_API_KEY: z.string().optional(),
  OPENAI_COMPATIBLE_MODEL: z.string().optional(),
  MONGODB_URI: z.string().min(1),
  MONGODB_DB_NAME: z.string().min(1),
  SESSION_COOKIE_SECRET: z.string().min(32),
});

const serverEnvSchema = commonServerEnvSchema.superRefine((env, ctx) => {
  if (env.AI_PROVIDER === "gemini") {
    if (!env.GEMINI_API_KEY || env.GEMINI_API_KEY.trim().length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["GEMINI_API_KEY"],
        message: "GEMINI_API_KEY is required when AI_PROVIDER is gemini.",
      });
    }

    return;
  }

  if (!env.OPENAI_COMPATIBLE_API_BASE_URL) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["OPENAI_COMPATIBLE_API_BASE_URL"],
      message: "OPENAI_COMPATIBLE_API_BASE_URL is required when AI_PROVIDER is openai-compatible.",
    });
  }

  if (!env.OPENAI_COMPATIBLE_API_KEY || env.OPENAI_COMPATIBLE_API_KEY.trim().length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["OPENAI_COMPATIBLE_API_KEY"],
      message: "OPENAI_COMPATIBLE_API_KEY is required when AI_PROVIDER is openai-compatible.",
    });
  }

  if (!env.OPENAI_COMPATIBLE_MODEL || env.OPENAI_COMPATIBLE_MODEL.trim().length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["OPENAI_COMPATIBLE_MODEL"],
      message: "OPENAI_COMPATIBLE_MODEL is required when AI_PROVIDER is openai-compatible.",
    });
  }
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
