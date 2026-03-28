import { describe, expect, it } from "vitest";
import { getMongoClient } from "@/lib/server/mongodb.server";

describe("getMongoClient", () => {
  it("returns the same singleton instance", async () => {
    process.env.AUTH0_DOMAIN = "test.us.auth0.com";
    process.env.AUTH0_CLIENT_ID = "client-id";
    process.env.AUTH0_CLIENT_SECRET = "client-secret";
    process.env.APP_BASE_URL = "http://localhost:3000";
    process.env.GEMINI_API_KEY = "gemini-key";
    process.env.MONGODB_URI = "mongodb://127.0.0.1:27017";
    process.env.MONGODB_DB_NAME = "memory_palace_test";
    process.env.SESSION_COOKIE_SECRET = "x".repeat(32);

    const [clientA, clientB] = await Promise.all([getMongoClient(), getMongoClient()]);
    expect(clientA).toBe(clientB);
  });
});
