import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const connectMock = vi.fn();

vi.mock("@gradio/client", () => ({
  Client: {
    connect: connectMock,
  },
}));

describe("trellis client", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    vi.resetAllMocks();
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
      MONGODB_DB_NAME: "memory-palace",
      MONGODB_URI: "mongodb://localhost:27017",
      OPENAI_COMPATIBLE_API_BASE_URL: "https://example.com/v1",
      OPENAI_COMPATIBLE_API_KEY: "unused",
      OPENAI_COMPATIBLE_MODEL: "unused",
      SESSION_COOKIE_SECRET: "x".repeat(32),
      TRELLIS_GRADIO_URL: "https://trellis-live.example.com/",
      TRELLIS_REQUEST_TIMEOUT_MINUTES: "30",
    };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("connects to the configured live app and returns the completed model URL", async () => {
    const predict = vi.fn().mockResolvedValue({
      type: "data",
      time: "2026-03-29T08:16:49.022Z",
      data: ["https://render.example.com/models/mesh_stack.glb"],
      endpoint: "/generate_and_extract_glb",
      fn_index: 0,
    });
    connectMock.mockResolvedValue({ predict });

    const { generateTrellisModel } =
      await import("@/features/asset-generation/server/trellis-client.server");
    const result = await generateTrellisModel("a stack of gumballs");

    expect(connectMock).toHaveBeenCalledWith("https://trellis-live.example.com/", {
      events: ["data", "status"],
    });
    expect(predict).toHaveBeenCalledWith("/generate_and_extract_glb", {
      prompt: "a stack of gumballs",
      seed: 0,
      ss_guidance_strength: 7.5,
      ss_sampling_steps: 25,
      slat_guidance_strength: 7.5,
      slat_sampling_steps: 25,
      mesh_simplify: 0.95,
      texture_size: 1024,
    });
    expect(result).toEqual({
      modelUrl: "https://render.example.com/models/mesh_stack.glb",
      providerFileUrl: "https://render.example.com/models/mesh_stack.glb",
      mimeType: "model/gltf-binary",
      fileExtension: "glb",
    });
  });

  it("normalizes file payloads that only include a path", async () => {
    const predict = vi.fn().mockResolvedValue({
      data: [{ path: "/tmp/gradio/model.glb", url: null }],
    });
    connectMock.mockResolvedValue({ predict });

    const { generateTrellisModel } =
      await import("@/features/asset-generation/server/trellis-client.server");
    const result = await generateTrellisModel("a stack of gumballs");

    expect(result.modelUrl).toBe("https://trellis-live.example.com/file=/tmp/gradio/model.glb");
    expect(result.providerFileUrl).toBe(
      "https://trellis-live.example.com/file=/tmp/gradio/model.glb",
    );
  });

  it("preserves provider errors from the gradio client", async () => {
    const predict = vi
      .fn()
      .mockRejectedValue({ title: "ZeroGPU worker error", message: "GPU task aborted" });
    connectMock.mockResolvedValue({ predict });

    const { generateTrellisModel } =
      await import("@/features/asset-generation/server/trellis-client.server");

    await expect(generateTrellisModel("a stack of gumballs")).rejects.toThrow(
      "Trellis generation failed. ZeroGPU worker error: GPU task aborted",
    );
  });

  it("surfaces connection failures distinctly", async () => {
    connectMock.mockRejectedValue(new Error("connect failed"));
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("<html><title>No interface is running</title></html>", {
          status: 404,
          headers: { "content-type": "text/html" },
        }),
      ),
    );

    const { generateTrellisModel } =
      await import("@/features/asset-generation/server/trellis-client.server");

    await expect(generateTrellisModel("a stack of gumballs")).rejects.toThrow(
      "Failed to connect to the Trellis app. No interface is running right now.",
    );
  });
});
