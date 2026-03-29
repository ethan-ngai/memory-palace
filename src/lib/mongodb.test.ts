import { describe, expect, it } from "vitest";
import { getMongoClient } from "@/lib/server/mongodb.server";

describe("getMongoClient", () => {
  it("returns the same singleton instance", async () => {
    process.env.AUTH0_DOMAIN = "test.us.auth0.com";
    process.env.AUTH0_CLIENT_ID = "client-id";
    process.env.AUTH0_CLIENT_SECRET = "client-secret";
    process.env.APP_BASE_URL = "http://localhost:3000";
    process.env.AI_PROVIDER = "gemini";
    process.env.ASSET_S3_ACCESS_KEY_ID = "access-key";
    process.env.ASSET_S3_BUCKET = "memory-palace-assets";
    process.env.ASSET_S3_ENDPOINT = "https://s3.example.com";
    process.env.ASSET_S3_PUBLIC_BASE_URL = "https://cdn.example.com";
    process.env.ASSET_S3_REGION = "us-east-1";
    process.env.ASSET_S3_SECRET_ACCESS_KEY = "secret-key";
    process.env.GEMINI_API_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
    process.env.GEMINI_API_KEY = "secret";
    process.env.GEMINI_MODEL = "gemini-2.5-flash";
    process.env.MONGODB_URI = "mongodb://127.0.0.1:27017";
    process.env.MONGODB_DB_NAME = "memory_palace_test";
    process.env.SESSION_COOKIE_SECRET = "x".repeat(32);

    const [clientA, clientB] = await Promise.all([getMongoClient(), getMongoClient()]);
    expect(clientA).toBe(clientB);
  });
});
