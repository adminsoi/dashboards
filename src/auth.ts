/**
 * Microsoft Entra ID sign-in (OpenID Connect authorization-code flow + PKCE).
 *
 * The same tenant and the same SSO/MFA policy as M365, so there is no separate
 * password for this app and every sign-in is attributable in Entra's sign-in
 * logs. This app is a *confidential* client: the code-for-token exchange
 * happens server-side with ENTRA_CLIENT_SECRET, and no token ever reaches the
 * browser.
 *
 * Department membership comes from the `groups` claim, which requires the
 * "groups" optional claim on the app registration (see ENTRA_DASHBOARD_SETUP.md).
 * If that claim is absent the user simply has no groups, which is safe: with
 * DEPT_ACCESS_ENFORCE=true they would see nothing rather than everything.
 */
import { createHash } from "node:crypto";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { config } from "./config.js";
import type { Session } from "./session.js";
import { nowSeconds } from "./session.js";

const entra = config.auth.entra;

const ISSUER = `https://login.microsoftonline.com/${entra.tenantId}/v2.0`;
const AUTHORIZE_URL = `https://login.microsoftonline.com/${entra.tenantId}/oauth2/v2.0/authorize`;
const TOKEN_URL = `https://login.microsoftonline.com/${entra.tenantId}/oauth2/v2.0/token`;
const JWKS_URI = `https://login.microsoftonline.com/${entra.tenantId}/discovery/v2.0/keys`;

// Lazily created so AUTH_MODE=none (local dev) never reaches out to Entra.
let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;
function getJwks() {
  if (!jwks) jwks = createRemoteJWKSet(new URL(JWKS_URI));
  return jwks;
}

export class SignInError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SignInError";
  }
}

/** S256 PKCE challenge for a verifier. */
function challengeFor(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

/** The Entra URL to send the browser to, for one specific in-flight sign-in. */
export function authorizeUrl(params: {
  state: string;
  nonce: string;
  verifier: string;
}): string {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("client_id", entra.clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("response_mode", "query");
  // Identity only. This app reads SOI data through its own backend, not Graph.
  url.searchParams.set("scope", "openid profile email");
  url.searchParams.set("state", params.state);
  url.searchParams.set("nonce", params.nonce);
  url.searchParams.set("code_challenge", challengeFor(params.verifier));
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

interface TokenResponse {
  id_token?: string;
  error?: string;
  error_description?: string;
}

/**
 * Exchange the authorization code for an id_token, verify it, and build the
 * session. Throws SignInError with a message safe to show the user.
 */
export async function completeSignIn(code: string, nonce: string, verifier: string): Promise<Session> {
  const body = new URLSearchParams({
    client_id: entra.clientId,
    client_secret: entra.clientSecret,
    grant_type: "authorization_code",
    code,
    redirect_uri: config.redirectUri,
    code_verifier: verifier,
    scope: "openid profile email",
  });

  let res: Response;
  try {
    res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new SignInError("Could not reach Microsoft Entra ID to complete sign-in.");
  }

  const payload = (await res.json().catch(() => ({}))) as TokenResponse;
  if (!res.ok || !payload.id_token) {
    // Log the Entra error code server-side; show the user something plain.
    console.error(
      JSON.stringify({
        at: "auth.tokenExchange",
        status: res.status,
        error: payload.error ?? "unknown",
        // error_description carries an AADSTS code, useful and not secret.
        description: payload.error_description?.slice(0, 300) ?? "",
      }),
    );
    throw new SignInError("Microsoft Entra ID rejected the sign-in.");
  }

  let claims: JWTPayload;
  try {
    const verified = await jwtVerify(payload.id_token, getJwks(), {
      issuer: ISSUER,
      audience: entra.clientId,
      clockTolerance: 60,
    });
    claims = verified.payload;
  } catch {
    throw new SignInError("The identity token from Entra could not be verified.");
  }

  // Binding the nonce is what stops a replayed or injected id_token.
  if (claims["nonce"] !== nonce) {
    throw new SignInError("Sign-in could not be verified. Please try again.");
  }

  const oid = typeof claims["oid"] === "string" ? claims["oid"] : claims.sub;
  if (!oid) throw new SignInError("Entra did not return a user identifier.");

  return {
    oid,
    username: firstString(claims["preferred_username"], claims["upn"], claims["email"]) ?? "",
    name: firstString(claims["name"]) ?? "",
    groups: groupsFrom(claims),
    exp: nowSeconds() + config.auth.sessionTtlSeconds,
  };
}

/**
 * Entra emits group object ids in `groups` when the optional claim is
 * configured. `roles` is also accepted so app-role assignment works as an
 * alternative to security groups without a code change.
 */
function groupsFrom(claims: JWTPayload): string[] {
  const out = new Set<string>();
  for (const key of ["groups", "roles"]) {
    const value = claims[key];
    if (Array.isArray(value)) {
      for (const v of value) if (typeof v === "string" && v) out.add(v);
    }
  }
  return [...out];
}

function firstString(...values: unknown[]): string | undefined {
  for (const v of values) if (typeof v === "string" && v) return v;
  return undefined;
}

/** The sign-out URL that also ends the Entra session, not just ours. */
export function signOutUrl(): string {
  const url = new URL(`https://login.microsoftonline.com/${entra.tenantId}/oauth2/v2.0/logout`);
  url.searchParams.set("post_logout_redirect_uri", `${config.publicBaseUrl}/signed-out`);
  return url.toString();
}
