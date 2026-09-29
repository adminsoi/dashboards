/**
 * Health probes for the SOI service fleet, powering the IT dashboard.
 *
 * Probes run over the internal Docker network by container name, so they test
 * the services themselves rather than the public DNS + TLS path, and they work
 * even if a DNS record or certificate is broken. /healthz on every service is
 * unauthenticated by design (see ../../src/server.ts), so no token is needed.
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
 * Container name -> friendly label. Matches docker-compose.multi.yml. Override
 * with SERVICE_PROBES="label=host:port,…" if the fleet changes.
 */
const DEFAULT_PROBES: Array<[string, string]> = [
  ["SAM.gov connector", "proxy-samgov:3000"],
  ["PartsBase connector", "proxy-partsbase:3000"],
  ["Pentagon 2000 connector", "proxy-pentagon:3000"],
  ["ILS connector", "proxy-ils:3000"],
  ["Locatory connector", "proxy-locatory:3000"],
  ["Manuals connector", "proxy-manuals:3000"],
];

function probeList(): Array<[string, string]> {
  const raw = process.env.SERVICE_PROBES;
  if (!raw) return DEFAULT_PROBES;
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
