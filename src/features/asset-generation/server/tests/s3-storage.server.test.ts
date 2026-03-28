import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const send = vi.fn();
const S3Client = vi.fn(function S3ClientMock() {
  return { send };
});
const PutObjectCommand = vi.fn(function PutObjectCommandMock(input) {
  return input;
});

vi.mock("@aws-sdk/client-s3", () => ({
  PutObjectCommand,
  S3Client,
}));

describe("uploadGeneratedAssetToS3", () => {
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
    send.mockReset().mockResolvedValue({});
    S3Client.mockClear();
    PutObjectCommand.mockClear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it("uploads a GLB and preview to S3-compatible storage", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), { status: 200 }))
      .mockResolvedValueOnce(new Response(new Uint8Array([4, 5, 6]), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const { uploadGeneratedAssetToS3 } =
      await import("@/features/asset-generation/server/s3-storage.server");
    const result = await uploadGeneratedAssetToS3({
      userId: "user-1",
      conceptId: "concept-1",
      jobId: "job-1",
      modelUrl: "https://example.com/model.glb",
      previewUrl: "https://example.com/preview.png",
    });

    expect(result.key).toBe("concept-assets/user-1/concept-1/job-1.glb");
    expect(result.previewKey).toBe("concept-assets/user-1/concept-1/job-1-preview.png");
    expect(result.url).toBe("https://cdn.example.com/concept-assets/user-1/concept-1/job-1.glb");
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("throws on failed generated asset download", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 500 })));

    const { uploadGeneratedAssetToS3 } =
      await import("@/features/asset-generation/server/s3-storage.server");

    await expect(
      uploadGeneratedAssetToS3({
        userId: "user-1",
        conceptId: "concept-1",
        jobId: "job-1",
        modelUrl: "https://example.com/model.glb",
      }),
    ).rejects.toThrow("Failed to download generated asset.");
  });

  it("throws on failed upload", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { status: 200 })),
    );
    send.mockRejectedValueOnce(new Error("upload failed"));

    const { uploadGeneratedAssetToS3 } =
      await import("@/features/asset-generation/server/s3-storage.server");

    await expect(
      uploadGeneratedAssetToS3({
        userId: "user-1",
        conceptId: "concept-1",
        jobId: "job-1",
        modelUrl: "https://example.com/model.glb",
      }),
    ).rejects.toThrow("Failed to upload generated asset to storage.");
  });
});
