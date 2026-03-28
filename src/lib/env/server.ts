/**
 * @file server.ts
 * @description Validates and exposes server-only environment configuration.
 * @module env
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const commonServerEnvSchema = z.object({
  AUTH0_DOMAIN: z.string().min(1),
  AUTH0_CLIENT_ID: z.string().min(1),
  AUTH0_CLIENT_SECRET: z.string().min(1),
  AUTH0_AUDIENCE: z.string().optional().default(""),
  APP_BASE_URL: z.string().url(),
  AI_PROVIDER: z.enum(["k2", "gemini", "openai-compatible"]).optional().default("k2"),
  K2_API_BASE_URL: z.string().url().optional(),
  K2_API_KEY: z.string().optional(),
  K2_MODEL: z.string().optional(),
  GEMINI_API_BASE_URL: z
    .string()
    .url()
    .optional()
    .default("https://generativelanguage.googleapis.com/v1beta"),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().optional().default("gemini-2.5-flash"),
  TENCENTCLOUD_SECRET_ID: z.string().optional(),
  TENCENTCLOUD_SECRET_KEY: z.string().optional(),
  HUNYUAN_API_ENDPOINT: z.string().min(1).default("hunyuan.intl.tencentcloudapi.com"),
  HUNYUAN_API_REGION: z.string().min(1).default("ap-singapore"),
  HUNYUAN_API_VERSION: z.string().min(1).default("2023-09-01"),
  HUNYUAN_MODEL: z.string().min(1).default("3.0"),
  ASSET_S3_ENDPOINT: z.string().url().optional(),
  ASSET_S3_REGION: z.string().optional(),
  ASSET_S3_BUCKET: z.string().optional(),
  ASSET_S3_ACCESS_KEY_ID: z.string().optional(),
  ASSET_S3_SECRET_ACCESS_KEY: z.string().optional(),
  ASSET_S3_PUBLIC_BASE_URL: z.string().url().optional(),
  OPENAI_COMPATIBLE_API_BASE_URL: z.string().url().optional(),
  OPENAI_COMPATIBLE_API_KEY: z.string().optional(),
  OPENAI_COMPATIBLE_MODEL: z.string().optional(),
  MONGODB_URI: z.string().min(1),
  MONGODB_DB_NAME: z.string().min(1),
  SESSION_COOKIE_SECRET: z.string().min(32),
});

const serverEnvSchema = commonServerEnvSchema.superRefine((env, ctx) => {
  if (env.AI_PROVIDER === "k2") {
    if (!env.K2_API_BASE_URL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["K2_API_BASE_URL"],
        message: "K2_API_BASE_URL is required when AI_PROVIDER is k2.",
      });
    }

    if (!env.K2_API_KEY || env.K2_API_KEY.trim().length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["K2_API_KEY"],
        message: "K2_API_KEY is required when AI_PROVIDER is k2.",
      });
    }

    if (!env.K2_MODEL || env.K2_MODEL.trim().length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["K2_MODEL"],
        message: "K2_MODEL is required when AI_PROVIDER is k2.",
      });
    }

    return;
  }

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
 * Parses a simple dotenv-style file into a key/value record.
 * @param filePath - Absolute path to the env file.
 * @returns Parsed env pairs or an empty object when the file is absent.
 * @remarks This local fallback keeps ad hoc server scripts working even when the shell has not preloaded env vars.
 */
function readEnvFile(filePath: string) {
  if (!existsSync(filePath)) {
    return {} as Record<string, string>;
  }

  const content = readFileSync(filePath, "utf8");
  const values: Record<string, string> = {};

  for (const rawLine of content.split(/\r?\n/u)) {
    const line = rawLine.trim();

    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");

    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    values[key] = value;
  }

  return values;
}

/**
 * Resolves repo-local env file values for server-only scripts and tests.
 * @returns Env pairs loaded from `.env`, falling back to `.env.example` when needed.
 * @remarks Process env still wins so deployed environments and shell exports override local files.
 */
function getEnvFileFallbacks() {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(currentDir, "../../..");
  const envExample = readEnvFile(path.join(repoRoot, ".env.example"));
  const envFile = readEnvFile(path.join(repoRoot, ".env"));

  return {
    ...envExample,
    ...envFile,
  };
}

/**
 * Resolves the active server environment on demand.
 * @returns The validated server environment for the current process.
 * @remarks
 * - Kept lazy so route generation, builds, and isolated tests can import server modules without failing before configuration is actually needed.
 * - Validation still happens at the first real use site, so misconfiguration is surfaced close to runtime entry points.
 */
export function getServerEnv() {
  return parseServerEnv({
    ...getEnvFileFallbacks(),
    ...process.env,
  });
}
