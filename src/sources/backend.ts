/**
 * Client for the private SOI backend (../../backend/server.mjs).
 *
 * The backend is the only component holding downstream credentials and is not
 * reachable from the internet; this app talks to it over the internal Docker
 * network with BACKEND_SERVICE_TOKEN, exactly as the MCP proxies do. The
 * signed-in user's identity is forwarded as `x-soi-user` so backend logs stay
 * attributable to a person rather than to "the dashboard".
 *
 * The backend answers 501 for integrations that exist but are not wired
 * (Pentagon 2000, ILS). That is a first-class outcome here, not an error: it
 * becomes `not_integrated`, which the UI renders as "—" rather than a zero.
 * A zero would be a factual claim we cannot support.
 */
import { config } from "./../config.js";

export type FetchState = "ok" | "not_integrated" | "not_configured" | "error";

export interface BackendResult<T> {
  state: FetchState;
  data?: T;
  /** Short, user-safe explanation when state is not "ok". */
  note?: string;
}

export async function backendGet<T>(
  path: string,
  opts: { user: string; query?: Record<string, string | number | undefined> } = { user: "unknown" },
): Promise<BackendResult<T>> {
  const url = new URL(path, config.backend.baseUrl);
  for (const [k, v] of Object.entries(opts.query ?? {})) {
    if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
  }

  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        accept: "application/json",
        authorization: `Bearer ${config.backend.serviceToken}`,
        "x-soi-user": opts.user,
      },
      signal: AbortSignal.timeout(config.backend.timeoutMs),
    });
  } catch {
    return { state: "error", note: "The SOI backend did not respond." };
  }

  if (res.status === 501) {
    const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
    return {
      state: "not_integrated",
      note: body.message ?? body.error ?? "This integration is not wired up yet.",
    };
  }

  if (res.status === 503) {
    return { state: "not_configured", note: "This data source has no credentials configured." };
  }

  if (!res.ok) {
    console.error(JSON.stringify({ at: "backendGet", path, status: res.status }));
    return { state: "error", note: `The SOI backend returned HTTP ${res.status}.` };
  }

  try {
    return { state: "ok", data: (await res.json()) as T };
  } catch {
    return { state: "error", note: "The SOI backend returned a malformed response." };
  }
}

/** Liveness of the backend itself, used by the IT dashboard. */
export async function backendHealth(user: string): Promise<BackendResult<{ status?: string }>> {
  return backendGet<{ status?: string }>("/healthz", { user });
}
