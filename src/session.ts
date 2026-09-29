/**
 * Stateless sessions.
 *
 * The session is an HMAC-signed, httpOnly cookie — no server-side store, which
 * keeps the container stateless and compatible with a read-only root
 * filesystem. The cookie holds only what the UI needs (identity + group ids);
 * no tokens are stored in it and nothing sensitive is exposed to client JS.
 *
 * Rotating SESSION_SECRET invalidates every session immediately.
 */
import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";
import type { Request, Response } from "express";
import { config } from "./config.js";

export interface Session {
  /** Entra object id — the stable per-user identifier to log for audit. */
  oid: string;
  /** UPN / email, for display and backend attribution. */
  username: string;
  /** Display name. */
  name: string;
  /** Entra group object ids from the token's `groups` claim. */
  groups: string[];
  /** Absolute expiry, epoch seconds. */
  exp: number;
}

const SESSION_COOKIE = "soi_dash_session";
const FLOW_COOKIE = "soi_dash_flow";

/** Transient state for one in-flight sign-in, carried across the Entra redirect. */
export interface FlowState {
  state: string;
  nonce: string;
  verifier: string;
  /** Path to land on after sign-in. Validated to be app-relative. */
  returnTo: string;
  exp: number;
}

function sign(payload: string): string {
  return createHmac("sha256", config.auth.sessionSecret).update(payload).digest("base64url");
}

/** base64url(JSON) + "." + HMAC. */
function encode(value: unknown): string {
  const body = Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${body}.${sign(body)}`;
}

function decode<T>(raw: string | undefined): T | null {
  if (!raw) return null;
  const dot = raw.lastIndexOf(".");
  if (dot <= 0) return null;
  const body = raw.slice(0, dot);
  const mac = raw.slice(dot + 1);
  const expected = sign(body);
  // Constant-time compare; bail if lengths differ (timingSafeEqual throws).
  if (mac.length !== expected.length) return null;
  if (!timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T & {
      exp?: number;
    };
    if (typeof parsed.exp === "number" && parsed.exp < nowSeconds()) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/** True when the public origin is https, so cookies can carry Secure. */
const secureCookies = config.publicBaseUrl.startsWith("https://");

function cookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    secure: secureCookies,
    // Lax (not Strict) so the cookie survives Entra's cross-site redirect back.
    sameSite: "lax" as const,
    path: "/",
    maxAge: maxAgeSeconds * 1000,
  };
}

export function setSession(res: Response, session: Session): void {
  res.cookie(SESSION_COOKIE, encode(session), cookieOptions(config.auth.sessionTtlSeconds));
}

export function readSession(req: Request): Session | null {
  return decode<Session>(readCookie(req, SESSION_COOKIE));
}

export function clearSession(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { path: "/" });
}

export function startFlow(res: Response, returnTo: string): FlowState {
  const flow: FlowState = {
    state: randomBytes(32).toString("base64url"),
    nonce: randomBytes(32).toString("base64url"),
    verifier: randomBytes(32).toString("base64url"),
    returnTo,
    // Ten minutes is ample for an interactive sign-in.
    exp: nowSeconds() + 600,
  };
  res.cookie(FLOW_COOKIE, encode(flow), cookieOptions(600));
  return flow;
}

export function readFlow(req: Request): FlowState | null {
  return decode<FlowState>(readCookie(req, FLOW_COOKIE));
}

export function clearFlow(res: Response): void {
  res.clearCookie(FLOW_COOKIE, { path: "/" });
}

/**
 * Minimal cookie reader — avoids a cookie-parser dependency. Values are
 * base64url + hex only, so no percent-decoding is required.
 */
function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return undefined;
}

/**
 * Only ever redirect to an app-relative path. Blocks open-redirect via
 * ?returnTo=https://evil.example and protocol-relative //evil.example.
 */
export function safeReturnTo(raw: unknown): string {
  if (typeof raw !== "string" || !raw.startsWith("/") || raw.startsWith("//")) return "/";
  return raw;
}
