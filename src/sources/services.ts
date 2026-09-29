/**
 * Health probes for the SOI service fleet, powering the IT dashboard.
 *
 * /healthz on every SOI service is unauthenticated by design, so no token is
 * needed to probe one.
 *
 * What is probeable depends on where this app runs. The private backend is
 * always probed. The connector containers are only reachable when they share a
 * Docker network with this app — on a separate host they are not, so they are
 * probed ONLY when SERVICE_PROBES names them explicitly.
 *
 * That default matters: reporting six connectors as "down" because this host
 * cannot see them would be a false alarm, and an IT dashboard that cries wolf
 * is worse than one that admits it cannot see something.
 */
import { config } from "./../config.js";
import { DEPARTMENTS, SOURCE_LABELS, type SourceId } from "./../departments.js";
import { backendGet } from "./backend.js";

export interface ServiceProbe {
  name: string;
  healthy: boolean;
  detail: string;
}

export interface FleetStatus {
  services: ServiceProbe[];
  healthy: number;
  total: number;
  backendHealthy: boolean;
  /** False when no backend is configured — absence, not failure. */
  backendConfigured: boolean;
  pendingIntegrations: string[];
}

/**
 * Extra services to probe, as "Label=host:port,Label=host:port".
 *
 * Empty by default. When this app shares a Docker network with the connector
 * stack, set it to the container names:
 *   SAM.gov connector=proxy-samgov:3000,PartsBase connector=proxy-partsbase:3000,…
 * When it runs on a separate host, use the reachable addresses instead, or
 * leave it unset and the IT dashboard will show the backend alone.
 */
function probeList(): Array<[string, string]> {
  const raw = process.env.SERVICE_PROBES;
  if (!raw) return [];
  return raw
    .split(",")
    .map((entry) => entry.split("="))
    .filter((parts): parts is [string, string] => parts.length === 2 && !!parts[0] && !!parts[1])
    .map(([label, host]) => [label.trim(), host.trim()] as [string, string]);
}

async function probeOne(label: string, host: string): Promise<ServiceProbe> {
  try {
    const res = await fetch(`http://${host}/healthz`, {
      signal: AbortSignal.timeout(3_000),
    });
    return {
      name: label,
      healthy: res.ok,
      detail: res.ok ? "healthz ok" : `HTTP ${res.status}`,
    };
  } catch {
    return { name: label, healthy: false, detail: "no response" };
  }
}

export async function probeServices(user: string): Promise<FleetStatus> {
  const probes = probeList();
  const [services, backend] = await Promise.all([
    Promise.all(probes.map(([label, host]) => probeOne(label, host))),
    backendGet<{ status?: string; samGov?: string; partsBase?: string }>("/healthz", { user }),
  ]);

  const backendConfigured = config.backend.enabled;
  const backendHealthy = backendConfigured && backend.state === "ok" && backend.data?.status === "ok";

  // Derive this from the department registry rather than hard-coding a list,
  // so it stays true as tiles and sources change. Without a backend every data
  // source is pending, which is the honest answer for a standalone deployment.
  const dataSources = new Set<SourceId>();
  for (const dept of DEPARTMENTS) {
    for (const tile of dept.tiles) {
      if (tile.source !== "services") dataSources.add(tile.source);
    }
  }
  const pendingIntegrations = backendConfigured
    ? [...dataSources].filter((s) => s !== "samgov").map((s) => SOURCE_LABELS[s])
    : [...dataSources].map((s) => SOURCE_LABELS[s]);

  // Only list the backend when there is one. An unconfigured backend is not a
  // down service, and listing it as such would be a standing false alarm.
  const all: ServiceProbe[] = [...services];
  if (backendConfigured) {
    all.push({
      name: "Data backend",
      healthy: backendHealthy,
      detail: backendHealthy ? "healthz ok" : (backend.note ?? "no response"),
    });
  }

  return {
    services: all,
    healthy: all.filter((s) => s.healthy).length,
    total: all.length,
    backendHealthy,
    backendConfigured,
    pendingIntegrations,
  };
}
