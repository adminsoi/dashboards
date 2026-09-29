/**
 * Environment configuration for the department dashboard.
 *
 * Two trust boundaries, mirroring the MCP proxy (../src/config.ts):
 *   - Browser -> this app. Every page except /healthz and the login routes
 *     requires a signed session cookie, issued only after a successful
 *     Microsoft Entra ID authorization-code (PKCE) sign-in.
 *   - This app -> SOI backend. The same private backend the MCP proxies use,
 *     reached over the internal Docker network with BACKEND_SERVICE_TOKEN.
 *     The backend remains the only place downstream credentials live.
 *
 * This app is READ-ONLY. It issues GETs to the backend and renders them; it
 * never writes to a system of record.
 */

// Auto-load a local .env if present (Node >= 20.12). Missing file is fine —
// values come from the real environment in production.
try {
  process.loadEnvFile();
} catch {
  // No .env file; rely on the process environment.
}

/** "entra" enforces SSO. "none" is LOCAL DEV ONLY and is refused in prod. */
const authMode = (process.env.AUTH_MODE ?? "entra").toLowerCase();

const publicBaseUrl = stripTrailingSlash(
  process.env.PUBLIC_BASE_URL ?? `http://localhost:${process.env.PORT ?? 3000}`,
);

export const config = {
  port: Number(process.env.PORT ?? 3000),
  /** Public origin this app is reachable at. Must match the Entra redirect URI. */
  publicBaseUrl,
  /** Where Entra sends the user back after sign-in. Register this exact value. */
  redirectUri: `${publicBaseUrl}/auth/callback`,

  /** The private backend shared with the MCP proxies. */
  backend: {
    baseUrl: process.env.BACKEND_BASE_URL ?? "http://backend:8080",
    serviceToken: process.env.BACKEND_SERVICE_TOKEN ?? "",
    timeoutMs: Number(process.env.BACKEND_TIMEOUT_MS ?? 15_000),
  },

  auth: {
    mode: authMode as "entra" | "none",
    entra: {
      tenantId: process.env.ENTRA_TENANT_ID ?? "",
      /** App registration for THIS web app — not the MCP app ids. */
      clientId: process.env.ENTRA_CLIENT_ID ?? "",
      /** Confidential-client secret. Never logged, never sent to the browser. */
      clientSecret: process.env.ENTRA_CLIENT_SECRET ?? "",
    },
    /** HMAC key for the session cookie. Rotate to invalidate all sessions. */
    sessionSecret: process.env.SESSION_SECRET ?? "",
    /** Session lifetime. Users re-authenticate against Entra after this. */
    sessionTtlSeconds: Number(process.env.SESSION_TTL_SECONDS ?? 8 * 60 * 60),
  },

  access: {
    /**
     * When false, any authenticated tenant user may open any department — the
     * group plumbing still runs and is shown in the UI, but is not enforced.
     * Flip to true once IT has created the six Entra security groups and set
     * the DEPT_GROUP_* ids below. Start permissive so sign-in works on day one
     * without a half-populated group directory locking everyone out.
     */
    enforce: (process.env.DEPT_ACCESS_ENFORCE ?? "false").toLowerCase() === "true",
    /**
     * Entra group object ids, one per department slug. Read at startup so an
     * unset group is visible in /healthz rather than failing at request time.
     */
    groups: {
      government: splitIds(process.env.DEPT_GROUP_GOVERNMENT),
      procurement: splitIds(process.env.DEPT_GROUP_PROCUREMENT),
      purchasing: splitIds(process.env.DEPT_GROUP_PURCHASING),
      finance: splitIds(process.env.DEPT_GROUP_FINANCE),
      hr: splitIds(process.env.DEPT_GROUP_HR),
      it: splitIds(process.env.DEPT_GROUP_IT),
      operations: splitIds(process.env.DEPT_GROUP_OPERATIONS),
    } as Record<string, string[]>,
    /** Members of these groups see every department (e.g. leadership, IT admin). */
    allDepartments: splitIds(process.env.DEPT_GROUP_ALL),
  },
} as const;

function splitIds(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function stripTrailingSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

function require_(name: string, value: string): void {
  if (!value) {
    throw new Error(
      `${name} is required when AUTH_MODE=${config.auth.mode}. See dashboard/.env.example.`,
    );
  }
}

if (config.auth.mode === "entra") {
  require_("ENTRA_TENANT_ID", config.auth.entra.tenantId);
  require_("ENTRA_CLIENT_ID", config.auth.entra.clientId);
  require_("ENTRA_CLIENT_SECRET", config.auth.entra.clientSecret);
  require_("SESSION_SECRET", config.auth.sessionSecret);
  if (config.auth.sessionSecret.length < 32) {
    throw new Error("SESSION_SECRET must be at least 32 characters.");
  }
} else if (process.env.NODE_ENV === "production") {
  // Refuse to start unauthenticated in production, whatever the env says.
  throw new Error("AUTH_MODE=none is local-dev only and cannot run with NODE_ENV=production.");
}
