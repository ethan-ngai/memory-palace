/**
 * @file s3-storage.server.ts
 * @description Downloads generated model artifacts and uploads them to S3-compatible storage.
 * @module asset-generation
 */
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getServerEnv } from "@/lib/env/server";

let s3Client: S3Client | undefined;

function getS3Client() {
  const env = getServerEnv();
  if (
    !env.ASSET_S3_ENDPOINT ||
    !env.ASSET_S3_REGION ||
    !env.ASSET_S3_ACCESS_KEY_ID ||
    !env.ASSET_S3_SECRET_ACCESS_KEY
  ) {
    throw new Error("S3 asset storage is not configured.");
  }

  s3Client ??= new S3Client({
    endpoint: env.ASSET_S3_ENDPOINT,
    region: env.ASSET_S3_REGION,
    credentials: {
      accessKeyId: env.ASSET_S3_ACCESS_KEY_ID,
      secretAccessKey: env.ASSET_S3_SECRET_ACCESS_KEY,
    },
    forcePathStyle: true,
  });

  return s3Client;
}

function toPublicUrl(key: string) {
  const env = getServerEnv();
  if (!env.ASSET_S3_PUBLIC_BASE_URL) {
    throw new Error("S3 asset storage is not configured.");
  }
  return new URL(
    key,
    env.ASSET_S3_PUBLIC_BASE_URL.endsWith("/")
      ? env.ASSET_S3_PUBLIC_BASE_URL
      : `${env.ASSET_S3_PUBLIC_BASE_URL}/`,
  ).toString();
}

async function downloadAssetBuffer(url: string) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error("Failed to download generated asset.");
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

function normalizeFileExtension(fileExtension?: string) {
  return fileExtension?.replace(/^\./, "").toLowerCase() || "glb";
}

function inferMimeType(fileExtension: string) {
  switch (fileExtension) {
    case "obj":
      return "model/obj";
    case "fbx":
      return "model/fbx";
    case "glb":
      return "model/gltf-binary";
    default:
      return "application/octet-stream";
  }
}

/**
 * Downloads a Hunyuan result and uploads it to S3-compatible storage.
 * @param input - User, concept, and job metadata plus the Hunyuan result URLs.
 * @returns The durable storage keys and public URLs written for the generated files.
 * @remarks Uses deterministic object keys so retries on the same job overwrite cleanly instead of creating orphaned files.
 */
export async function uploadGeneratedAssetToS3(input: {
  userId: string;
  conceptId: string;
  jobId: string;
  modelUrl: string;
  previewUrl?: string;
  mimeType?: string;
  fileExtension?: string;
}) {
  const env = getServerEnv();
  if (!env.ASSET_S3_BUCKET) {
    throw new Error("S3 asset storage is not configured.");
  }
  const client = getS3Client();
  const fileExtension = normalizeFileExtension(input.fileExtension);
  const modelKey = `concept-assets/${input.userId}/${input.conceptId}/${input.jobId}.${fileExtension}`;
  const previewKey = input.previewUrl
    ? `concept-assets/${input.userId}/${input.conceptId}/${input.jobId}-preview.png`
    : undefined;
  const mimeType = input.mimeType || inferMimeType(fileExtension);

  try {
    const modelBuffer = await downloadAssetBuffer(input.modelUrl);

    await client.send(
      new PutObjectCommand({
        Bucket: env.ASSET_S3_BUCKET,
        Key: modelKey,
        Body: modelBuffer,
        ContentType: mimeType,
      }),
    );

    let previewPublicUrl: string | undefined;

    if (input.previewUrl && previewKey) {
      const previewBuffer = await downloadAssetBuffer(input.previewUrl);
      await client.send(
        new PutObjectCommand({
          Bucket: env.ASSET_S3_BUCKET,
          Key: previewKey,
          Body: previewBuffer,
          ContentType: "image/png",
        }),
      );
      previewPublicUrl = toPublicUrl(previewKey);
    }

    return {
      key: modelKey,
      url: toPublicUrl(modelKey),
      previewKey,
      previewUrl: previewPublicUrl,
      mimeType,
    };
  } catch (error) {
    if (error instanceof Error && error.message === "Failed to download generated asset.") {
      throw error;
    }

    throw new Error("Failed to upload generated asset to storage.");
  }
}
