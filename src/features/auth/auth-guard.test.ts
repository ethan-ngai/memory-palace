import { describe, expect, it } from "vitest";
import { requireAuthenticatedRoute } from "@/features/auth/auth-guard";

describe("requireAuthenticatedRoute", () => {
  it("redirects anonymous users to login", () => {
    expect(() =>
      requireAuthenticatedRoute({ isAuthenticated: false, user: null }, "/play"),
    ).toThrow();
  });
});
