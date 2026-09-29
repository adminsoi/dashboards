/**
 * Client for an optional data backend.
 *
 * BACKEND_BASE_URL is unset by default, and that is a supported configuration:
 * the app runs standalone and every data tile reports "no source connected".
 * Point it at a backend later and the same tiles light up.
 *
 * When one is configured, the signed-in user's identity is forwarded as
 * `x-soi-user` so the backend's logs stay attributable to a person rather than
 * to "the dashboard".
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
  // No backend configured — the standalone default. Say so plainly rather
  // than failing, so tiles render "not connected" instead of an error.
  if (!config.backend.enabled) {
    return { state: "not_configured", note: "No data source is connected yet." };
  }

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
