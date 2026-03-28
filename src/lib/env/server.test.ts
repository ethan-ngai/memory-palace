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
        HUNYUAN_API_ENDPOINT: "hunyuan.intl.tencentcloudapi.com",
        HUNYUAN_API_REGION: "ap-singapore",
        HUNYUAN_API_VERSION: "2023-09-01",
        HUNYUAN_MODEL: "3.0",
        K2_API_BASE_URL: "https://api.k2.example/v1",
        K2_API_KEY: "",
        K2_MODEL: "",
        MONGODB_DB_NAME: "",
        MONGODB_URI: "",
        OPENAI_COMPATIBLE_API_BASE_URL: "https://example.com/v1",
        OPENAI_COMPATIBLE_API_KEY: "unused",
        OPENAI_COMPATIBLE_MODEL: "unused",
        SESSION_COOKIE_SECRET: "",
        TENCENTCLOUD_SECRET_ID: "",
        TENCENTCLOUD_SECRET_KEY: "",
      }),
    ).toThrow();
  });
});
