/**
 * SOI Aviation department dashboards.
 *
 * A small, read-only, server-rendered web app:
 *   - every page except /healthz, /assets/* and the auth routes requires a
 *     Microsoft Entra ID sign-in (same SSO/MFA as M365);
 *   - department visibility comes from Entra group membership (src/access.ts);
 *   - data is read from the private SOI backend that the MCP connectors
 *     already use, so downstream credentials stay in one place.
 *
 * It ships no client-side JavaScript, which is why the CSP below can deny
 * scripts entirely.
 */
import express from "express";
import { config } from "./config.js";
import { authorizeUrl, completeSignIn, signOutUrl, SignInError } from "./auth.js";
import {
  clearFlow,
  clearSession,
  readFlow,
  readSession,
  safeReturnTo,
  setSession,
  startFlow,
  type Session,
} from "./session.js";
import { accessPosture, canView, restrictedDepartments, visibleDepartments, type Viewer } from "./access.js";
import { findDepartment } from "./departments.js";
import { loadDepartmentData } from "./sources/metrics.js";
import { renderDepartment, renderError, renderHome, renderSignedOut, renderSignIn } from "./views/pages.js";
import { STYLESHEET } from "./views/styles.js";

const app = express();

// Behind Caddy. Lets Express see the real client IP and scheme for logging.
app.set("trust proxy", 1);
app.disable("x-powered-by");

// --- Security headers ------------------------------------------------------

app.use((req, res, next) => {
  res.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'none'",
      "style-src 'self'",
      "img-src 'self' data:",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "base-uri 'none'",
    ].join("; "),
  );
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  // Nothing here should ever be cached by a shared proxy.
  res.setHeader("Cache-Control", "no-store");
  if (config.publicBaseUrl.startsWith("https://")) {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  next();
});

// --- Unauthenticated routes ------------------------------------------------

// Health check for Caddy / container orchestration. Reports posture but no
// secrets: never the client secret, never a group id's membership.
app.get("/healthz", (_req, res) => {
  res.json({
    status: "ok",
    authMode: config.auth.mode,
    access: accessPosture(),
    backend: config.backend.baseUrl,
  });
});

app.get("/assets/app.css", (_req, res) => {
  res.setHeader("Content-Type", "text/css; charset=utf-8");
  // Safe to cache: the file changes only on deploy, and carries no user data.
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.send(STYLESHEET);
});

// --- Sign-in ---------------------------------------------------------------

app.get("/auth/start", (req, res) => {
  if (config.auth.mode === "none") {
    res.redirect("/");
    return;
  }
  const returnTo = safeReturnTo(req.query["returnTo"]);
  const flow = startFlow(res, returnTo);
  res.redirect(authorizeUrl(flow));
});

app.get("/auth/callback", async (req, res) => {
  const flow = readFlow(req);
  clearFlow(res);

  // Entra reports user-facing failures (consent declined, blocked) here.
  if (typeof req.query["error"] === "string") {
    const description =
      typeof req.query["error_description"] === "string" ? req.query["error_description"] : "";
    console.error(
      JSON.stringify({ at: "auth.callback", error: req.query["error"], description: description.slice(0, 300) }),
    );
    res.status(400).send(renderSignIn({ returnTo: "/", error: "Microsoft Entra ID did not complete the sign-in." }));
    return;
  }

  const code = req.query["code"];
  if (!flow || typeof code !== "string") {
    res
      .status(400)
      .send(renderSignIn({ returnTo: "/", error: "That sign-in link has expired. Please try again." }));
    return;
  }

  // State check: the value we minted must come back unchanged (CSRF defence).
  if (req.query["state"] !== flow.state) {
    res
      .status(400)
      .send(renderSignIn({ returnTo: "/", error: "Sign-in could not be verified. Please try again." }));
    return;
  }

  try {
    const session = await completeSignIn(code, flow.nonce, flow.verifier);
    setSession(res, session);
    console.log(JSON.stringify({ at: "auth.signedIn", oid: session.oid, user: session.username }));
    res.redirect(safeReturnTo(flow.returnTo));
  } catch (err) {
    const message =
      err instanceof SignInError ? err.message : "Sign-in failed. Please try again.";
    if (!(err instanceof SignInError)) console.error(err);
    res.status(401).send(renderSignIn({ returnTo: flow.returnTo, error: message }));
  }
});

app.get("/signout", (_req, res) => {
  clearSession(res);
  // End the Entra session too, not just ours.
  res.redirect(config.auth.mode === "entra" ? signOutUrl() : "/signed-out");
});

app.get("/signed-out", (_req, res) => {
  res.send(renderSignedOut());
});

// --- Authentication gate ---------------------------------------------------

/** Local-dev identity used only when AUTH_MODE=none (refused in production). */
const DEV_VIEWER: Viewer = {
  oid: "dev",
  username: "dev@localhost",
  name: "Local Dev",
  groups: [],
};

declare module "express-serve-static-core" {
  interface Request {
    viewer?: Viewer;
  }
}

app.use((req, res, next) => {
  if (config.auth.mode === "none") {
    req.viewer = DEV_VIEWER;
    next();
    return;
  }

  const session: Session | null = readSession(req);
  if (!session) {
    // Show the sign-in page rather than bouncing straight to Microsoft, so the
    // user can see where they are before being redirected off-site.
    res.status(401).send(renderSignIn({ returnTo: req.originalUrl }));
    return;
  }

  req.viewer = {
    oid: session.oid,
    username: session.username,
    name: session.name,
    groups: session.groups,
  };
  next();
});

// --- Authenticated routes --------------------------------------------------

app.get("/", (req, res) => {
  const viewer = req.viewer as Viewer;
  res.send(
    renderHome({
      viewer,
      visible: visibleDepartments(viewer),
      restricted: restrictedDepartments(viewer),
      enforcing: config.access.enforce,
    }),
  );
});

app.get("/d/:slug", async (req, res, next) => {
  const viewer = req.viewer as Viewer;
  const dept = findDepartment(String(req.params.slug));

  if (!dept) {
    res.status(404).send(renderError({ title: "Not found", message: "No such dashboard.", status: 404 }));
    return;
  }

  if (!canView(viewer, dept)) {
    console.log(
      JSON.stringify({ at: "access.denied", oid: viewer.oid, department: dept.slug }),
    );
    res.status(403).send(
      renderError({
        title: "No access",
        message: `You are not a member of the Entra group for ${dept.name}. Ask IT to add you.`,
        status: 403,
      }),
    );
    return;
  }

  try {
    // Attribute the backend read to the signed-in person, not to the app.
    const data = await loadDepartmentData(dept.slug, viewer.username || viewer.oid);
    res.send(renderDepartment({ viewer, dept, data }));
  } catch (err) {
    next(err);
  }
});

// --- Fallbacks -------------------------------------------------------------

app.use((_req, res) => {
  res.status(404).send(renderError({ title: "Not found", message: "That page does not exist.", status: 404 }));
});

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).send(
    renderError({
      title: "Something went wrong",
      message: "The dashboard could not be rendered. The error has been logged.",
      status: 500,
    }),
  );
});

app.listen(config.port, () => {
  const posture = accessPosture();
  console.log(
    `SOI dashboards listening on :${config.port} — auth ${config.auth.mode}; ` +
      `department access ${posture.enforcing ? "ENFORCED" : "PERMISSIVE (not enforced)"}; ` +
      `backend ${config.backend.baseUrl}.`,
  );
  if (posture.unconfiguredDepartments.length) {
    console.log(
      `Departments without an Entra group configured: ${posture.unconfiguredDepartments.join(", ")}.`,
    );
  }
});
