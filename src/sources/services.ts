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

  const backendHealthy = backend.state === "ok" && backend.data?.status === "ok";

  // Read pending integrations from the backend's own health report rather than
  // hard-coding a list here, so this stays true as integrations land.
  const pendingIntegrations: string[] = [];
  if (backend.state === "ok" && backend.data) {
    if (backend.data.samGov !== "configured") pendingIntegrations.push("SAM.gov");
    if (backend.data.partsBase !== "configured") pendingIntegrations.push("PartsBase");
  }
  // These two are scaffolded-but-unwired in the backend today.
  pendingIntegrations.push("Pentagon 2000", "ILS");

  const all: ServiceProbe[] = [
    ...services,
    {
      name: "Private backend",
      healthy: backendHealthy,
      detail: backendHealthy ? "healthz ok" : (backend.note ?? "no response"),
    },
  ];

  return {
    services: all,
    healthy: all.filter((s) => s.healthy).length,
    total: all.length,
    backendHealthy,
    pendingIntegrations,
  };
}
