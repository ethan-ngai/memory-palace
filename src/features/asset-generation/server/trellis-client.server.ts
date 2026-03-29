/**
 * @file trellis-client.server.ts
 * @description Wraps the configured live TRELLIS Gradio app behind one validated text-to-3D generation call.
 * @module asset-generation
 */
import { Client } from "@gradio/client";
import { z } from "zod";
import { getServerEnv } from "@/lib/env/server";

type TrellisClientLike = {
  predict: (endpoint: string, payload: Record<string, unknown>) => Promise<unknown>;
};

const urlSchema = z.string().url();
let trellisClientPromise: Promise<TrellisClientLike> | undefined;

/**
 * Checks whether an unknown value is a non-null record.
 * @param value - Arbitrary value returned by Gradio or thrown from the client.
 * @returns `true` when the value can be accessed with string keys.
 * @remarks Keeps the response parsing defensive without spreading cast noise across the file.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Reads one trimmed string property from a record.
 * @param record - Object that may contain the field.
 * @param key - Candidate field name.
 * @returns A trimmed string when present, otherwise `undefined`.
 * @remarks Gradio error payloads and file objects both expose useful details as optional string fields.
 */
function readStringField(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

/**
 * Normalizes a thrown Gradio or fetch error into one readable sentence fragment.
 * @param error - Unknown error from the provider client.
 * @returns A best-effort human-readable detail string, or an empty string when nothing useful is available.
 * @remarks Preserves provider-side queue and runtime details instead of collapsing everything into a generic message.
 */
function describeUnknownError(error: unknown) {
  if (error instanceof Error) {
    return error.message.trim();
  }

  if (!isRecord(error)) {
    return "";
  }

  const parts = [
    readStringField(error, "title"),
    readStringField(error, "message"),
    readStringField(error, "original_msg"),
    readStringField(error, "detail"),
  ].filter((value): value is string => Boolean(value));

  return parts.join(": ");
}

/**
 * Appends provider-specific detail text to a stable error prefix.
 * @param baseMessage - Safe error prefix controlled by this codebase.
 * @param error - Unknown provider error that may include additional detail.
 * @returns A combined error message that preserves useful provider context when available.
 * @remarks Used for both connection and generation failures so Mongo stores enough context to debug live-app issues later.
 */
function appendErrorDetail(baseMessage: string, error: unknown) {
  const detail = describeUnknownError(error);
  return detail.length > 0 ? `${baseMessage} ${detail}`.trim() : baseMessage;
}

/**
 * Applies a hard timeout to one async provider request chain.
 * @param promise - Provider work promise to guard.
 * @param timeoutMs - Maximum allowed runtime in milliseconds.
 * @returns The original promise result when it settles before the timeout.
 * @remarks The live Gradio app can queue for a long time, so this keeps one worker from blocking the whole batch forever.
 */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  return new Promise<T>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error("Trellis generation timed out."));
    }, timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timeoutId);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeoutId);
        reject(error);
      },
    );
  });
}

/**
 * Removes the trailing slash from the configured live app URL.
 * @param baseUrl - Raw env value for the TRELLIS live app.
 * @returns The normalized base URL.
 * @remarks File download URLs are joined manually, so avoiding duplicate slashes keeps the output stable.
 */
function normalizeBaseUrl(baseUrl: string) {
  return baseUrl.replace(/\/+$/u, "");
}

/**
 * Ensures the Gradio client receives a URL with a trailing slash.
 * @param baseUrl - Raw configured live app URL.
 * @returns The URL shape expected by `Client.connect`.
 * @remarks The current live app resolves config reliably only when the root URL ends with a slash.
 */
function normalizeClientUrl(baseUrl: string) {
  return baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
}

/**
 * Probes the live app root after a connection failure to produce a clearer outage message.
 * @param baseUrl - Configured live TRELLIS app URL.
 * @returns A short human-readable outage detail when one can be inferred, otherwise an empty string.
 * @remarks Gradio live links can expire and return an HTML "No interface is running" page, which is more actionable than the client library's generic config error.
 */
async function inspectConnectionFailure(baseUrl: string) {
  try {
    const response = await fetch(`${normalizeBaseUrl(baseUrl)}/config`);
    const body = await response.text();

    if (body.includes("No interface is running")) {
      return "No interface is running right now.";
    }

    if (!response.ok) {
      return `Config request failed with status ${response.status}.`;
    }
  } catch {
    return "";
  }

  return "";
}

/**
 * Unwraps the common Gradio `{ data }` envelope returned by `@gradio/client`.
 * @param payload - Raw `predict` return value.
 * @returns The nested `data` field when present, otherwise the original payload.
 * @remarks The live app currently returns a data event object, but tests still mock the already-unwrapped shape in some cases.
 */
function unwrapPredictData(payload: unknown): unknown {
  if (isRecord(payload) && "data" in payload) {
    return payload.data;
  }

  return payload;
}

/**
 * Selects the generated file URL or path from the TRELLIS predict response.
 * @param payload - Raw or unwrapped result from `/generate_and_extract_glb`.
 * @returns The direct file URL or server-side file path.
 * @remarks The shortcut endpoint can return a string, an array, or a file payload depending on how Gradio serializes the response.
 */
function findFileCandidate(payload: unknown): string {
  const data = unwrapPredictData(payload);

  if (typeof data === "string" && data.trim().length > 0) {
    return data.trim();
  }

  if (Array.isArray(data) && data.length > 0) {
    return findFileCandidate(data[0]);
  }

  if (isRecord(data)) {
    const candidate = readStringField(data, "url") || readStringField(data, "path");
    if (candidate) {
      return candidate;
    }
  }

  throw new Error("Malformed Trellis response.");
}

/**
 * Resolves a provider file payload into a fully qualified download URL.
 * @param baseUrl - Base URL for the connected live TRELLIS app.
 * @param candidate - URL or server-side file path returned by Gradio.
 * @returns A public URL that can be downloaded for upload to durable storage.
 * @remarks The live app currently returns absolute Render-hosted URLs, but path normalization keeps the integration resilient to Gradio serialization changes.
 */
function normalizeProviderFileUrl(baseUrl: string, candidate: string) {
  const parsed = urlSchema.safeParse(candidate);
  if (parsed.success) {
    return parsed.data;
  }

  const normalizedCandidate = candidate.startsWith("/") ? candidate : `/${candidate}`;
  if (
    normalizedCandidate.startsWith("/file=") ||
    normalizedCandidate.startsWith("/gradio_api/file=")
  ) {
    return `${baseUrl}${normalizedCandidate}`;
  }

  return `${baseUrl}/file=${normalizedCandidate}`;
}

/**
 * Connects to the configured live TRELLIS app URL.
 * @returns The connected Gradio client.
 * @remarks The live link is public, so no Hugging Face token or duplicate-space flow is involved here.
 */
async function createTrellisClient(): Promise<TrellisClientLike> {
  const env = getServerEnv();
  const configuredUrl = env.TRELLIS_GRADIO_URL?.trim();

  if (!configuredUrl) {
    throw new Error("Trellis generation is not configured.");
  }

  try {
    return await Client.connect(normalizeClientUrl(configuredUrl), {
      events: ["data", "status"],
    });
  } catch (error) {
    const outageDetail = await inspectConnectionFailure(configuredUrl);
    if (outageDetail.length > 0) {
      throw new Error(`Failed to connect to the Trellis app. ${outageDetail}`);
    }

    throw new Error(appendErrorDetail("Failed to connect to the Trellis app.", error));
  }
}

/**
 * Returns the cached TRELLIS Gradio client for the current process.
 * @returns The connected Gradio client instance.
 * @remarks Reusing the client avoids paying the connection/setup cost for every batch item in one Node process.
 */
async function getTrellisClient() {
  if (!trellisClientPromise) {
    trellisClientPromise = createTrellisClient().catch((error) => {
      trellisClientPromise = undefined;
      throw error;
    });
  }

  return trellisClientPromise;
}

/**
 * Resets the cached TRELLIS client between isolated tests.
 * @returns Nothing.
 * @remarks Test suites need a clean module-level cache so one mocked connection does not leak into the next case.
 */
export function resetTrellisClientForTests() {
  trellisClientPromise = undefined;
}

/**
 * Generates one 3D model from a prompt using the configured live TRELLIS app.
 * @param prompt - Short object-first prompt to render.
 * @returns Provider download metadata suitable for the existing upload pipeline.
 * @remarks This uses the working `@gradio/client` shortcut endpoint because the raw `/call` SSE path returned provider errors on the same app.
 */
export async function generateTrellisModel(prompt: string) {
  const env = getServerEnv();
  const configuredUrl = env.TRELLIS_GRADIO_URL?.trim();

  if (!configuredUrl) {
    throw new Error("Trellis generation is not configured.");
  }

  const client = await getTrellisClient();
  const baseUrl = normalizeBaseUrl(configuredUrl);

  try {
    const rawResult = await withTimeout(
      client.predict("/generate_and_extract_glb", {
        prompt,
        seed: 0,
        ss_guidance_strength: 7.5,
        ss_sampling_steps: 25,
        slat_guidance_strength: 7.5,
        slat_sampling_steps: 25,
        mesh_simplify: 0.95,
        texture_size: 1024,
      }),
      env.TRELLIS_REQUEST_TIMEOUT_MINUTES * 60_000,
    );
    const providerFileUrl = normalizeProviderFileUrl(baseUrl, findFileCandidate(rawResult));

    return {
      modelUrl: providerFileUrl,
      providerFileUrl,
      previewUrl: undefined,
      mimeType: "model/gltf-binary",
      fileExtension: "glb",
    };
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message === "Trellis generation is not configured." ||
        error.message === "Trellis generation timed out." ||
        error.message === "Malformed Trellis response." ||
        error.message.startsWith("Failed to connect to the Trellis app."))
    ) {
      throw error;
    }

    throw new Error(appendErrorDetail("Trellis generation failed.", error));
  }
}
