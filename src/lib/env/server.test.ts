import { describe, expect, it } from "vitest";
import { parseServerEnv } from "@/lib/env/server";

describe("parseServerEnv", () => {
  it("rejects missing required secrets", () => {
    expect(() =>
      parseServerEnv({
        APP_BASE_URL: "http://localhost:3000",
        AI_PROVIDER: "gemini",
        AUTH0_AUDIENCE: "",
        AUTH0_CLIENT_ID: "",
        AUTH0_CLIENT_SECRET: "",
        AUTH0_DOMAIN: "",
        GEMINI_API_BASE_URL: "https://generativelanguage.googleapis.com/v1beta",
        GEMINI_API_KEY: "",
        GEMINI_MODEL: "gemini-2.5-flash",
        MONGODB_DB_NAME: "",
        MONGODB_URI: "",
        OPENAI_COMPATIBLE_API_BASE_URL: "https://example.com/v1",
        OPENAI_COMPATIBLE_API_KEY: "unused",
        OPENAI_COMPATIBLE_MODEL: "unused",
        SESSION_COOKIE_SECRET: "",
      }),
    ).toThrow();
  });
});
