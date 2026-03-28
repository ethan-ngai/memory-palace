import { getResponseHeaders } from "@tanstack/react-start/server";

export function mergeCurrentResponseHeaders(headers?: HeadersInit) {
  const merged = new Headers(headers);

  for (const [key, value] of getResponseHeaders().entries()) {
    merged.append(key, value);
  }

  return merged;
}

export function redirectResponse(location: string | URL, status = 302, headers?: HeadersInit) {
  const merged = mergeCurrentResponseHeaders(headers);
  merged.set("location", typeof location === "string" ? location : location.toString());

  return new Response(null, {
    status,
    headers: merged,
  });
}

export function jsonResponse(body: unknown, init?: ResponseInit) {
  const headers = mergeCurrentResponseHeaders(init?.headers);
  headers.set("content-type", "application/json; charset=utf-8");

  return new Response(JSON.stringify(body), {
    ...init,
    headers,
  });
}
