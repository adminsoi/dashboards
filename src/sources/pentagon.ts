/**
 * Pentagon 2000 adapter — the one file to change when the ERP is wired up.
 *
 * STATUS: not integrated. The private backend answers HTTP 501 for
 * /v1/inventory and /v1/rfqs/* (see ../../backend/server.mjs). Until that
 * changes, every Pentagon-sourced tile in this dashboard renders as "—" with a
 * visible "not integrated" note. That is deliberate: a zero or a plausible-
 * looking figure would be a claim about SOI's book of business that nothing
 * supports.
 *
 * TO GO LIVE, in this order:
 *   1. In ../../backend/server.mjs, replace the three
 *      `notIntegrated("Pentagon 2000")` handlers with real calls to the
 *      Pentagon 2000 API, reading its base URL and credentials from env
 *      (PENTAGON_API_BASE / PENTAGON_* secrets) and adding them to
 *      docker-compose.multi.yml's `backend` service. Credentials belong in the
 *      backend only — never in this dashboard container.
 *   2. Decide the aggregate shape you want per tile. The cheapest path is to
 *      add purpose-built summary endpoints to the backend (e.g.
 *      /v1/summary/purchasing) that return counts, so the dashboard does not
 *      pull whole record sets over the wire just to length them.
 *   3. Point `metricFrom` below at those fields and delete `notIntegratedNote`.
 *
 * Nothing else in this app needs to change.
 */
import { backendGet } from "./backend.js";
import type { Metric } from "./metrics.js";

/**
 * Short-lived memo so one dashboard render does not issue the same 501 four
 * times over. Keyed by path; cleared after a few seconds.
 */
const memo = new Map<string, { at: number; metric: Metric }>();
const MEMO_MS = 5_000;

const notIntegratedNote =
  "Pentagon 2000 is not connected yet, so this figure has no source. Placeholder only.";

/**
 * Fetch one Pentagon-sourced metric. Returns a non-live Metric while the ERP
 * integration is pending — never a fabricated number.
 */
export async function pentagonMetric(path: string, user: string): Promise<Metric> {
  const cached = memo.get(path);
  if (cached && Date.now() - cached.at < MEMO_MS) return cached.metric;

  const res = await backendGet<Record<string, unknown>>(path, { user });

  let metric: Metric;
  if (res.state === "ok" && res.data) {
    metric = metricFrom(res.data);
  } else if (res.state === "not_integrated") {
    metric = { state: "not_integrated", note: notIntegratedNote };
  } else if (res.state === "not_configured") {
    metric = { state: "not_configured", note: "Pentagon 2000 has no credentials configured." };
  } else {
    metric = { state: "error", note: res.note ?? "Pentagon 2000 could not be reached." };
  }

  memo.set(path, { at: Date.now(), metric });
  return metric;
}

/**
 * Translate a backend Pentagon 2000 payload into a metric value.
 *
 * Unreached today (the backend 501s before we get here). Written against the
 * shape the backend's other list endpoints already use — `{ count, results }`
 * — so wiring step 1 above is likely all that is needed.
 */
function metricFrom(data: Record<string, unknown>): Metric {
  if (typeof data["count"] === "number") return { state: "live", value: data["count"] };
  if (Array.isArray(data["results"])) return { state: "live", value: data["results"].length };
  // A live source that doesn't match the expected shape is an error, not a 0.
  return {
    state: "error",
    note: "Pentagon 2000 returned a shape this dashboard does not recognise.",
  };
}
