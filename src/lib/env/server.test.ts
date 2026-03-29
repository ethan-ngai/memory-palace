import { describe, expect, it } from "vitest";
import { parseServerEnv } from "@/lib/env/server";

describe("parseServerEnv", () => {
  it("rejects missing required secrets", () => {
    expect(() =>
      parseServerEnv({
        APP_BASE_URL: "http://localhost:3000",
        AI_PROVIDER: "k2",
        AUTH0_AUDIENCE: "",
        AUTH0_CLIENT_ID: "",
        AUTH0_CLIENT_SECRET: "",
        AUTH0_DOMAIN: "",
        ASSET_S3_ENDPOINT: "https://s3.example.com",
        GEMINI_API_BASE_URL: "https://generativelanguage.googleapis.com/v1beta",
        GEMINI_API_KEY: "",
        GEMINI_MODEL: "gemini-2.5-flash",
        K2_API_BASE_URL: "https://api.k2.example/v1",
        K2_API_KEY: "",
        K2_MODEL: "",
        MONGODB_DB_NAME: "",
        MONGODB_URI: "",
        OPENAI_COMPATIBLE_API_BASE_URL: "https://example.com/v1",
        OPENAI_COMPATIBLE_API_KEY: "unused",
        OPENAI_COMPATIBLE_MODEL: "unused",
        SESSION_COOKIE_SECRET: "",
      }),
    ).toThrow();
  });

  it("does not require extra provider secrets for the default live TRELLIS path", () => {
    expect(() =>
      parseServerEnv({
        AI_PROVIDER: "gemini",
        APP_BASE_URL: "http://localhost:3000",
        AUTH0_AUDIENCE: "",
        AUTH0_CLIENT_ID: "client-id",
        AUTH0_CLIENT_SECRET: "client-secret",
        AUTH0_DOMAIN: "example.auth0.com",
        ASSET_S3_ACCESS_KEY_ID: "access-key",
        ASSET_S3_BUCKET: "bucket",
        ASSET_S3_ENDPOINT: "https://s3.example.com",
        ASSET_S3_PUBLIC_BASE_URL: "https://cdn.example.com",
        ASSET_S3_REGION: "us-east-1",
        ASSET_S3_SECRET_ACCESS_KEY: "secret-key",
        GEMINI_API_BASE_URL: "https://generativelanguage.googleapis.com/v1beta",
        GEMINI_API_KEY: "gemini-key",
        GEMINI_MODEL: "gemini-2.5-flash",
        MONGODB_DB_NAME: "memory-palace",
        MONGODB_URI: "mongodb://localhost:27017",
        OPENAI_COMPATIBLE_API_BASE_URL: "https://example.com/v1",
        OPENAI_COMPATIBLE_API_KEY: "unused",
        OPENAI_COMPATIBLE_MODEL: "unused",
        SESSION_COOKIE_SECRET: "x".repeat(32),
      }),
    ).not.toThrow();
  });
});
