import { describe, expect, it } from "vitest";
import { parseServerEnv } from "@/lib/env/server";

describe("parseServerEnv", () => {
  it("rejects missing required secrets", () => {
    expect(() =>
      parseServerEnv({
        APP_BASE_URL: "http://localhost:3000",
        AUTH0_AUDIENCE: "",
        AUTH0_CLIENT_ID: "",
        AUTH0_CLIENT_SECRET: "",
        AUTH0_DOMAIN: "",
        MONGODB_DB_NAME: "",
        MONGODB_URI: "",
        SESSION_COOKIE_SECRET: "",
      }),
    ).toThrow();
  });
});
