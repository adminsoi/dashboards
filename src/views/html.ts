/**
 * Tiny HTML helpers.
 *
 * Everything rendered here is escaped by default. That matters beyond the
 * usual: this app renders third-party data (SAM.gov notice titles and agency
 * names), which is untrusted input, alongside Entra display names. `esc` is
 * applied at every interpolation site and `safeHref` refuses any URL that is
 * not plain http(s), so a javascript: or data: link from an upstream feed
 * cannot become a live link in the page.
 */
import { config } from "./../config.js";

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** Escape text for HTML body or attribute context. */
export function esc(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c);
}

/** Allow only absolute http(s) URLs; anything else renders as no link. */
export function safeHref(raw: unknown): string | undefined {
  if (typeof raw !== "string" || !raw) return undefined;
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

export interface LayoutOptions {
  title: string;
  /** Rendered inside <main>. Must already be escaped. */
  body: string;
  /** Signed-in user shown top-right, when there is one. */
  user?: { name: string; username: string };
  /** Adds the department accent class to <main>. */
  accent?: "red" | "blue";
  /** Chrome-free pages (sign-in, errors). */
  bare?: boolean;
}

export function layout(opts: LayoutOptions): string {
  const claudeLink = opts.user
    ? `<a class="topbar-link" href="${esc(config.claude.chatUrl)}" target="_blank" rel="noopener noreferrer">Claude</a>`
    : "";
  const userBlock = opts.user
    ? `<div class="topbar-user"><strong>${esc(opts.user.name || opts.user.username)}</strong>
         <a href="/signout">Sign out</a></div>`
    : "";

  const topbar = opts.bare
    ? ""
    : `<header class="topbar"><div class="wrap topbar-inner">
         <a class="brand" href="/"><span class="brand-mark"></span>SOI Aviation
           <span class="brand-sub">Department dashboards</span></a>
         <div class="topbar-spacer"></div>
         ${claudeLink}
         ${userBlock}
       </div></header>`;

  const footer = opts.bare
    ? ""
    : `<footer><div class="wrap">
         <span>Internal use only.</span>
         <span class="topbar-spacer"></span>
         <a href="/healthz">Status</a>
       </div></footer>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(opts.title)} · SOI Aviation</title>
<link rel="stylesheet" href="/assets/app.css">
</head>
<body>
${topbar}
<main class="${opts.accent ? `accent-${opts.accent}` : ""}"><div class="wrap">${opts.body}</div></main>
${footer}
</body>
</html>`;
}
