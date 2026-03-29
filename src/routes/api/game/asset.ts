import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { requireAuthUser } from "@/features/auth/server/auth-session.server";
import { getServerEnv } from "@/lib/env/server";

const assetUrlSearchSchema = z.object({
  url: z.string().url(),
});

/**
 * Returns whether the requested remote asset URL is allowed for same-origin proxying.
 * @param assetUrl - Absolute remote asset URL requested by the client.
 * @returns `true` when the URL matches the configured public asset base or when no base is configured.
 * @remarks Prevents this route from becoming a generic authenticated open proxy while still supporting the configured asset storage origin.
 */
function isAllowedAssetUrl(assetUrl: string) {
  const env = getServerEnv();
  const configuredBaseUrl = env.ASSET_S3_PUBLIC_BASE_URL?.trim();
  if (!configuredBaseUrl) {
    return true;
  }

  const configuredOrigin = new URL(configuredBaseUrl).origin;
  return new URL(assetUrl).origin === configuredOrigin;
}

export const Route = createFileRoute("/api/game/asset")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        await requireAuthUser();

        const requestUrl = new URL(request.url);
        const { url } = assetUrlSearchSchema.parse({
          url: requestUrl.searchParams.get("url"),
        });

        if (!isAllowedAssetUrl(url)) {
          return new Response("Asset URL is not allowed.", { status: 403 });
        }

        const upstreamResponse = await fetch(url);
        if (!upstreamResponse.ok) {
          return new Response("Failed to fetch proxied asset.", {
            status: upstreamResponse.status,
          });
        }

        const headers = new Headers();
        const contentType = upstreamResponse.headers.get("content-type");
        if (contentType) {
          headers.set("content-type", contentType);
        }

        const cacheControl = upstreamResponse.headers.get("cache-control");
        if (cacheControl) {
          headers.set("cache-control", cacheControl);
        }

        const contentLength = upstreamResponse.headers.get("content-length");
        if (contentLength) {
          headers.set("content-length", contentLength);
        }

        return new Response(upstreamResponse.body, {
          status: 200,
          headers,
        });
      },
    },
  },
});
