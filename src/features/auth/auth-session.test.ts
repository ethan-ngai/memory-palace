import { describe, expect, it } from "vitest";
import { jwtVerify } from "jose";

describe("session cookie helpers", () => {
  it("signs and verifies jose tokens with the configured secret", async () => {
    const secret = new TextEncoder().encode("x".repeat(32));
    const { SignJWT } = await import("jose");

    const token = await new SignJWT({ sid: "abc123" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(secret);

    const payload = await jwtVerify(token, secret);
    expect(payload.payload.sid).toBe("abc123");
  });
});
