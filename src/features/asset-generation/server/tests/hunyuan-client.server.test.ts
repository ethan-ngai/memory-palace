import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("hunyuan client", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      AI_PROVIDER: "gemini",
      APP_BASE_URL: "http://localhost:3000",
      ASSET_S3_ACCESS_KEY_ID: "access-key",
      ASSET_S3_BUCKET: "bucket",
      ASSET_S3_ENDPOINT: "https://s3.example.com",
      ASSET_S3_PUBLIC_BASE_URL: "https://cdn.example.com",
      ASSET_S3_REGION: "us-east-1",
      ASSET_S3_SECRET_ACCESS_KEY: "secret-key",
      AUTH0_AUDIENCE: "",
      AUTH0_CLIENT_ID: "client-id",
      AUTH0_CLIENT_SECRET: "client-secret",
      AUTH0_DOMAIN: "example.auth0.com",
      GEMINI_API_BASE_URL: "https://generativelanguage.googleapis.com/v1beta",
      GEMINI_API_KEY: "gemini-key",
      GEMINI_MODEL: "gemini-2.5-flash",
      HUNYUAN_API_ENDPOINT: "hunyuan.intl.tencentcloudapi.com",
      HUNYUAN_API_REGION: "ap-singapore",
      HUNYUAN_API_VERSION: "2023-09-01",
      HUNYUAN_MODEL: "3.0",
      MONGODB_DB_NAME: "memory-palace",
      MONGODB_URI: "mongodb://localhost:27017",
      OPENAI_COMPATIBLE_API_BASE_URL: "https://example.com/v1",
      OPENAI_COMPATIBLE_API_KEY: "unused",
      OPENAI_COMPATIBLE_MODEL: "unused",
      SESSION_COOKIE_SECRET: "x".repeat(32),
      TENCENTCLOUD_SECRET_ID: "secret-id",
      TENCENTCLOUD_SECRET_KEY: "secret-key",
    };
    vi.restoreAllMocks();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it("parses a successful submit response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            Response: { JobId: "job-1", RequestId: "request-1" },
          }),
          { status: 200 },
        ),
      ),
    );

    const { submitHunyuanJob } =
      await import("@/features/asset-generation/server/hunyuan-client.server");
    const result = await submitHunyuanJob("Generate a cube.");

    expect(result).toEqual({ jobId: "job-1", status: "queued" });
  });

  it("parses a successful polling response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            Response: {
              Status: "DONE",
              ErrorCode: "",
              ErrorMessage: "",
              RequestId: "request-1",
              ResultFile3Ds: [
                {
                  Type: "OBJ",
                  Url: "https://example.com/model.obj",
                  PreviewImageUrl: "https://example.com/preview.png",
                },
              ],
            },
          }),
          { status: 200 },
        ),
      ),
    );

    const { getHunyuanJobStatus } =
      await import("@/features/asset-generation/server/hunyuan-client.server");
    const result = await getHunyuanJobStatus("job-1");

    expect(result.status).toBe("succeeded");
    expect(result.modelUrl).toBe("https://example.com/model.obj");
    expect(result.previewUrl).toBe("https://example.com/preview.png");
    expect(result.fileExtension).toBe("obj");
  });

  it("throws on malformed submit response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ nope: true }), { status: 200 })),
    );

    const { submitHunyuanJob } =
      await import("@/features/asset-generation/server/hunyuan-client.server");

    await expect(submitHunyuanJob("Generate a cube.")).rejects.toThrow(
      "Malformed Hunyuan response.",
    );
  });

  it("throws on malformed polling response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ nope: true }), { status: 200 })),
    );

    const { getHunyuanJobStatus } =
      await import("@/features/asset-generation/server/hunyuan-client.server");

    await expect(getHunyuanJobStatus("job-1")).rejects.toThrow("Malformed Hunyuan response.");
  });

  it("throws on polling timeout", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(
        async () =>
          new Response(
            JSON.stringify({
              Response: {
                Status: "RUN",
                ErrorCode: "",
                ErrorMessage: "",
                RequestId: "request-1",
                ResultFile3Ds: [],
              },
            }),
            {
              status: 200,
            },
          ),
      ),
    );

    const { pollHunyuanJobUntilComplete } =
      await import("@/features/asset-generation/server/hunyuan-client.server");

    await expect(
      pollHunyuanJobUntilComplete("job-1", { pollIntervalMs: 1, timeoutMs: 5 }),
    ).rejects.toThrow("Hunyuan polling timed out.");
  });

  it("throws when a succeeded job has no model url", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            Response: {
              Status: "DONE",
              ErrorCode: "",
              ErrorMessage: "",
              RequestId: "request-1",
              ResultFile3Ds: [],
            },
          }),
          { status: 200 },
        ),
      ),
    );

    const { pollHunyuanJobUntilComplete } =
      await import("@/features/asset-generation/server/hunyuan-client.server");

    await expect(
      pollHunyuanJobUntilComplete("job-1", { pollIntervalMs: 1, timeoutMs: 100 }),
    ).rejects.toThrow("Hunyuan job completed without a model URL.");
  });
});
