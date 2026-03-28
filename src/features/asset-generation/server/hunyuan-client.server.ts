/**
 * @file hunyuan-client.server.ts
 * @description Wraps Tencent Cloud HunYuan 3D's signed async job API behind validated submit and polling helpers.
 * @module asset-generation
 */
import { createHash, createHmac } from "node:crypto";
import { z } from "zod";
import { getServerEnv } from "@/lib/env/server";
import type {
  HunyuanPollingResponse,
  HunyuanSubmitResponse,
} from "@/features/asset-generation/types";

const tencentJobStatusSchema = z.enum(["WAIT", "RUN", "DONE", "FAIL"]);
const hunyuanJobStatusSchema = z.enum(["queued", "running", "succeeded", "failed"]);

const tencentSubmitEnvelopeSchema = z.object({
  Response: z.object({
    JobId: z.string().min(1),
    RequestId: z.string().min(1),
  }),
});

const file3DSchema = z.object({
  Type: z.string().min(1).optional(),
  Url: z.string().url().optional(),
  PreviewImageUrl: z.string().url().optional(),
});

const tencentPollingEnvelopeSchema = z.object({
  Response: z.object({
    Status: tencentJobStatusSchema,
    ErrorCode: z.string().optional().default(""),
    ErrorMessage: z.string().optional().default(""),
    ResultFile3Ds: z.array(file3DSchema).optional().default([]),
    RequestId: z.string().min(1),
  }),
});

const TENCENT_HUNYUAN_SERVICE = "hunyuan";
const TENCENT_HUNYUAN_ACTION_SUBMIT = "SubmitHunyuanTo3DProJob";
const TENCENT_HUNYUAN_ACTION_QUERY = "QueryHunyuanTo3DProJob";

function sha256Hex(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function hmacSha256(key: Buffer | string, value: string) {
  return createHmac("sha256", key).update(value, "utf8").digest();
}

function formatUtcDate(timestampSeconds: number) {
  return new Date(timestampSeconds * 1000).toISOString().slice(0, 10);
}

function mapTencentStatus(
  status: z.infer<typeof tencentJobStatusSchema>,
): z.infer<typeof hunyuanJobStatusSchema> {
  switch (status) {
    case "WAIT":
      return "queued";
    case "RUN":
      return "running";
    case "DONE":
      return "succeeded";
    case "FAIL":
      return "failed";
  }
}

function inferFileExtension(url?: string, fileType?: string) {
  if (fileType) {
    return fileType.toLowerCase();
  }

  if (!url) {
    return undefined;
  }

  try {
    const pathname = new URL(url).pathname;
    const extension = pathname.split(".").pop()?.toLowerCase();
    return extension || undefined;
  } catch {
    return undefined;
  }
}

function inferMimeType(fileExtension?: string) {
  switch (fileExtension) {
    case "obj":
      return "model/obj";
    case "glb":
      return "model/gltf-binary";
    case "fbx":
      return "model/fbx";
    case "gif":
      return "image/gif";
    default:
      return undefined;
  }
}

async function callTencentHunyuanApi<TOutput>(
  action: string,
  payload: Record<string, unknown>,
  schema: z.ZodType<TOutput>,
) {
  const env = getServerEnv();
  if (!env.TENCENTCLOUD_SECRET_ID || !env.TENCENTCLOUD_SECRET_KEY) {
    throw new Error("Tencent Cloud asset generation credentials are not configured.");
  }
  const timestamp = Math.floor(Date.now() / 1000);
  const date = formatUtcDate(timestamp);
  const contentType = "application/json; charset=utf-8";
  const host = env.HUNYUAN_API_ENDPOINT;
  const payloadJson = JSON.stringify(payload);
  const canonicalHeaders = `content-type:${contentType}\nhost:${host}\n`;
  const signedHeaders = "content-type;host";
  const canonicalRequest = [
    "POST",
    "/",
    "",
    canonicalHeaders,
    signedHeaders,
    sha256Hex(payloadJson),
  ].join("\n");
  const credentialScope = `${date}/${TENCENT_HUNYUAN_SERVICE}/tc3_request`;
  const stringToSign = [
    "TC3-HMAC-SHA256",
    String(timestamp),
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");
  const secretDate = hmacSha256(`TC3${env.TENCENTCLOUD_SECRET_KEY}`, date);
  const secretService = hmacSha256(secretDate, TENCENT_HUNYUAN_SERVICE);
  const secretSigning = hmacSha256(secretService, "tc3_request");
  const signature = createHmac("sha256", secretSigning).update(stringToSign, "utf8").digest("hex");
  const authorization = [
    "TC3-HMAC-SHA256",
    `Credential=${env.TENCENTCLOUD_SECRET_ID}/${credentialScope},`,
    `SignedHeaders=${signedHeaders},`,
    `Signature=${signature}`,
  ].join(" ");

  const response = await fetch(`https://${host}/`, {
    method: "POST",
    headers: {
      Authorization: authorization,
      "Content-Type": contentType,
      Host: host,
      "X-TC-Action": action,
      "X-TC-Region": env.HUNYUAN_API_REGION,
      "X-TC-Timestamp": String(timestamp),
      "X-TC-Version": env.HUNYUAN_API_VERSION,
    },
    body: payloadJson,
  });

  if (!response.ok) {
    if (action === TENCENT_HUNYUAN_ACTION_SUBMIT) {
      throw new Error("Hunyuan job submission failed.");
    }

    throw new Error("Malformed Hunyuan response.");
  }

  try {
    return schema.parse(await response.json());
  } catch {
    throw new Error("Malformed Hunyuan response.");
  }
}

function toSubmitResponse(
  payload: z.infer<typeof tencentSubmitEnvelopeSchema>,
): HunyuanSubmitResponse {
  return {
    jobId: payload.Response.JobId,
    status: "queued",
  };
}

function toPollingResponse(
  payload: z.infer<typeof tencentPollingEnvelopeSchema>,
): HunyuanPollingResponse {
  const files = payload.Response.ResultFile3Ds;
  const modelFile =
    files.find((file) => file.Type?.toUpperCase() !== "GIF" && file.Url) ??
    files.find((file) => file.Url);
  const fileExtension = inferFileExtension(modelFile?.Url, modelFile?.Type);

  return {
    jobId: "",
    status: mapTencentStatus(payload.Response.Status),
    modelUrl: modelFile?.Url,
    previewUrl: modelFile?.PreviewImageUrl,
    mimeType: inferMimeType(fileExtension),
    fileExtension,
    error: payload.Response.ErrorMessage || payload.Response.ErrorCode || undefined,
  };
}

/**
 * Sleeps for the requested duration while polling Hunyuan.
 * @param delayMs - Number of milliseconds to wait before resuming.
 * @returns A promise that resolves after the timeout elapses.
 */
function sleep(delayMs: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

/**
 * Submits a single Hunyuan generation job.
 * @param prompt - Fully built generation prompt for one concept.
 * @returns The validated submit response containing the new job id.
 * @remarks All Hunyuan API shape assumptions are isolated here so the rest of the feature only consumes parsed results.
 */
export async function submitHunyuanJob(prompt: string): Promise<HunyuanSubmitResponse> {
  const env = getServerEnv();
  const payload: Record<string, unknown> = {
    Model: env.HUNYUAN_MODEL,
    Prompt: prompt,
    EnablePBR: false,
    FaceCount: 300000,
  };

  if (env.HUNYUAN_MODEL === "3.0") {
    payload.GenerateType = "LowPoly";
    payload.PolygonType = "triangle";
  }

  const response = await callTencentHunyuanApi(
    TENCENT_HUNYUAN_ACTION_SUBMIT,
    payload,
    tencentSubmitEnvelopeSchema,
  );

  return toSubmitResponse(response);
}

/**
 * Fetches the current status of one Hunyuan generation job.
 * @param jobId - Job id returned by the submit endpoint.
 * @returns The validated polling payload for that job.
 * @remarks Throws a safe error when the API shape is unusable so callers can store a concise failure message.
 */
export async function getHunyuanJobStatus(jobId: string): Promise<HunyuanPollingResponse> {
  const response = await callTencentHunyuanApi(
    TENCENT_HUNYUAN_ACTION_QUERY,
    { JobId: jobId },
    tencentPollingEnvelopeSchema,
  );

  return {
    ...toPollingResponse(response),
    jobId,
  };
}

/**
 * Polls Hunyuan until a job succeeds, fails, or times out.
 * @param jobId - Job id to poll.
 * @param options - Optional polling interval and timeout overrides.
 * @returns The final successful polling payload including the model URL.
 * @remarks Keeps timeout and completion handling centralized so callers only deal with success or a safe thrown error.
 */
export async function pollHunyuanJobUntilComplete(
  jobId: string,
  options?: { pollIntervalMs?: number; timeoutMs?: number },
): Promise<HunyuanPollingResponse> {
  const pollIntervalMs = options?.pollIntervalMs ?? 5_000;
  const timeoutMs = options?.timeoutMs ?? 15 * 60_000;
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const status = await getHunyuanJobStatus(jobId);

    if (status.status === "succeeded") {
      if (!status.modelUrl) {
        throw new Error("Hunyuan job completed without a model URL.");
      }

      return status;
    }

    if (status.status === "failed") {
      throw new Error(status.error ? `Hunyuan job failed. ${status.error}` : "Hunyuan job failed.");
    }

    await sleep(pollIntervalMs);
  }

  throw new Error("Hunyuan polling timed out.");
}
