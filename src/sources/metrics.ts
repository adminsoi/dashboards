/**
 * Per-department metric loaders.
 *
 * Contract: a loader NEVER invents a number. Every metric comes back in one of
 * four states and the renderer shows provenance for each:
 *   live            — a real figure from a real source, fetched just now
 *   not_integrated  — the source exists but isn't wired (backend answers 501)
 *   not_configured  — the source is wired but has no credentials
 *   error           — the fetch failed
 *
 * Only Government (SAM.gov) and IT (service probes) can currently return live
 * figures. Procurement, Purchasing, Finance, HR and Operations depend on
 * Pentagon 2000 or the HR system, neither of which is integrated, so their
 * tiles render as "—" under a placeholder banner until those land.
 */
import { config } from "./../config.js";
import { DEPARTMENTS, findDepartment, type SourceId } from "./../departments.js";
import { backendGet } from "./backend.js";
import { pentagonMetric } from "./pentagon.js";
import { probeServices } from "./services.js";

export type MetricState = "live" | "not_integrated" | "not_configured" | "error";

export interface Metric {
  state: MetricState;
  /** Present only when state is "live". */
  value?: number | string;
  /** Short explanation shown beneath the tile when not live. */
  note?: string;
}

export type MetricMap = Record<string, Metric>;

/** A row in a department's supporting table, when it has one. */
export interface TableRow {
  cells: string[];
  /** Optional outbound link for the row's first cell. */
  href?: string;
}

export interface DepartmentData {
  metrics: MetricMap;
  /** Optional supporting table (title + headers + rows). */
  table?: { title: string; headers: string[]; rows: TableRow[]; note?: string };
  /** True when any tile is showing something other than a live figure. */
  hasPlaceholders: boolean;
}

/** Metric standing in for an integration that does not exist yet. */
function pending(source: SourceId, note: string): Metric {
  return { state: source === "hris" ? "not_configured" : "not_integrated", note };
}

export async function loadDepartmentData(slug: string, user: string): Promise<DepartmentData> {
  const dept = findDepartment(slug);
  if (!dept) return { metrics: {}, hasPlaceholders: false };

  let data: DepartmentData;
  switch (slug) {
    case "government":
      data = await loadGovernment(user);
      break;
    case "it":
      data = await loadIt(user);
      break;
    default:
      data = await loadPending(slug, user);
      break;
  }

  data.hasPlaceholders = Object.values(data.metrics).some((m) => m.state !== "live");
  return data;
}

// --- Government: live SAM.gov -----------------------------------------------

interface SamSearchResponse {
  total_records?: number;
  count?: number;
  results?: Array<{
    solicitation_number: string | null;
    title: string | null;
    organization: string | null;
    response_deadline: string | null;
    posted_date: string | null;
    set_aside: string | null;
    active: string | boolean | null;
    ui_link: string | null;
  }>;
}

/** NAICS filter for the opportunity feed. Overridable without a code change. */
const GOVERNMENT_NAICS = process.env.GOVERNMENT_NAICS ?? "336413";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

async function loadGovernment(user: string): Promise<DepartmentData> {
  const res = await backendGet<SamSearchResponse>("/v1/gov/opportunities/search", {
    user,
    query: { naicsCode: GOVERNMENT_NAICS, limit: 50 },
  });

  const metrics: MetricMap = {};
  let table: DepartmentData["table"];

  if (res.state === "ok" && res.data) {
    const results = res.data.results ?? [];
    const active = results.filter((r) => r.active === "Yes" || r.active === true);
    const now = Date.now();

    metrics["openSolicitations"] = {
      state: "live",
      value: res.data.total_records ?? results.length,
    };

    metrics["closingSoon"] = {
      state: "live",
      value: active.filter((r) => {
        const due = r.response_deadline ? Date.parse(r.response_deadline) : NaN;
        return Number.isFinite(due) && due > now && due <= now + WEEK_MS;
      }).length,
    };

    metrics["postedThisWeek"] = {
      state: "live",
      value: results.filter((r) => {
        const posted = r.posted_date ? Date.parse(r.posted_date) : NaN;
        return Number.isFinite(posted) && posted >= now - WEEK_MS;
      }).length,
    };

    metrics["setAsideCount"] = {
      state: "live",
      value: active.filter((r) => !!r.set_aside).length,
    };

    table = {
      title: "Latest notices",
      headers: ["Solicitation", "Title", "Agency", "Response due"],
      note: `SAM.gov, NAICS ${GOVERNMENT_NAICS}. Public data.`,
      rows: results.slice(0, 12).map((r) => ({
        href: r.ui_link ?? undefined,
        cells: [
          r.solicitation_number ?? "—",
          r.title ?? "—",
          shortenAgency(r.organization),
          formatDate(r.response_deadline),
        ],
      })),
    };
  } else {
    // One failed fetch backs every tile here, so they all report it.
    const note = res.note ?? "SAM.gov could not be reached.";
    const state = res.state === "ok" ? "error" : res.state;
    for (const key of ["openSolicitations", "closingSoon", "postedThisWeek", "setAsideCount"]) {
      metrics[key] = { state, note };
    }
  }

  return { metrics, table, hasPlaceholders: false };
}

/** SAM.gov returns a long breadcrumb path; show the most specific part. */
function shortenAgency(path: string | null): string {
  if (!path) return "—";
  const parts = path.split(".").map((p) => p.trim()).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

function formatDate(raw: string | null): string {
  if (!raw) return "—";
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) return raw;
  return new Date(ms).toISOString().slice(0, 10);
}

// --- IT: live service probes ------------------------------------------------

async function loadIt(user: string): Promise<DepartmentData> {
  const probe = await probeServices(user);
  const metrics: MetricMap = {
    servicesUp: {
      state: "live",
      value: `${probe.healthy}/${probe.total} up`,
    },
    backendStatus: probe.backendHealthy
      ? { state: "live", value: "Reachable" }
      : { state: "error", note: "The private backend did not answer its health probe." },
    integrationsPending: { state: "live", value: probe.pendingIntegrations.length },
    ssoTenant: {
      state: "live",
      // Tenant id is not a secret and is the fastest way to confirm the right
      // directory is enforcing sign-in.
      value: config.auth.mode === "entra" ? maskTenant(config.auth.entra.tenantId) : "SSO DISABLED",
    },
  };

  return {
    metrics,
    table: {
      title: "Service fleet",
      headers: ["Service", "Status", "Detail"],
      note: "Probed from inside the Docker network just now.",
      rows: probe.services.map((s) => ({
        cells: [s.name, s.healthy ? "Up" : "Down", s.detail],
      })),
    },
    hasPlaceholders: false,
  };
}

function maskTenant(id: string): string {
  return id ? `${id.slice(0, 8)}…` : "unset";
}

// --- Departments whose source is not integrated yet -------------------------

async function loadPending(slug: string, user: string): Promise<DepartmentData> {
  const dept = DEPARTMENTS.find((d) => d.slug === slug);
  const metrics: MetricMap = {};
  for (const tile of dept?.tiles ?? []) {
    if (tile.source === "pentagon") {
      metrics[tile.key] = await pentagonMetric("/v1/inventory", user);
    } else {
      metrics[tile.key] = pending(
        tile.source,
        "No HR system integration exists yet — this figure has no source.",
      );
    }
  }
  return { metrics, hasPlaceholders: true };
}
