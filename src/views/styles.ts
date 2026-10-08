/**
 * The whole stylesheet, served once from /assets/app.css and cached.
 *
 * Deliberately one small file with no framework and no external fonts or CDN
 * links: it keeps the Content-Security-Policy tight (no third-party origins),
 * survives an air-gapped or egress-restricted host, and stays auditable.
 *
 * Two accents only — SOI red and SOI blue — used to distinguish departments.
 */
export const STYLESHEET = `
:root {
  --soi-navy: #0b2545;
  --soi-blue: #14528c;
  --soi-blue-bright: #1f6fb2;
  --soi-red: #c8102e;
  --soi-red-bright: #e01b38;

  --bg: #ffffff;
  --surface: #ffffff;
  --text: #16202e;
  --text-muted: #5c6b7f;
  --text-faint: #8492a4;
  --border: #dfe4ea;
  --border-strong: #c3ccd7;
  --warn-bg: #fdf6e6;
  --warn-border: #e8cf95;
  --warn-text: #6b5316;

  --accent: var(--soi-blue);
  --radius: 3px;
  --max-width: 1080px;
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #0e1319;
    --surface: #141b23;
    --text: #e8edf3;
    --text-muted: #9aa8b8;
    --text-faint: #71808f;
    --border: #253039;
    --border-strong: #35424e;
    --warn-bg: #2a2313;
    --warn-border: #5c4a1d;
    --warn-text: #e8d6a3;
    --soi-blue: #4a9ad4;
    --soi-red: #ff5c73;
  }
}

*, *::before, *::after { box-sizing: border-box; }

body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font: 15px/1.55 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
}

a { color: var(--soi-blue); text-decoration: none; }
a:hover { text-decoration: underline; }

.wrap {
  max-width: var(--max-width);
  margin: 0 auto;
  padding: 0 16px;
}

/* --- Header --------------------------------------------------------------- */

.topbar {
  border-bottom: 1px solid var(--border);
  background: var(--surface);
}
.topbar-inner {
  display: flex;
  align-items: center;
  gap: 16px;
  min-height: 56px;
}
.brand {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-weight: 650;
  letter-spacing: -0.01em;
  color: var(--text);
  font-size: 16px;
}
.brand:hover { text-decoration: none; }
.brand-mark {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--soi-red);
  flex: none;
}
.brand-sub {
  color: var(--text-faint);
  font-weight: 450;
  font-size: 13px;
}
.topbar-spacer { flex: 1; }
.topbar-user {
  font-size: 13px;
  color: var(--text-muted);
  text-align: right;
  line-height: 1.3;
}
.topbar-user strong { color: var(--text); font-weight: 550; display: block; }

/* --- Page scaffolding ---------------------------------------------------- */

main { padding: 28px 0 64px; }

.page-head { margin-bottom: 24px; }
.page-head h1 {
  margin: 0 0 4px;
  font-size: 22px;
  font-weight: 650;
  letter-spacing: -0.015em;
}
.page-head p { margin: 0; color: var(--text-muted); font-size: 14px; }

.eyebrow {
  font-size: 11px;
  font-weight: 650;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--accent);
  margin-bottom: 6px;
}

.back-link { font-size: 13px; color: var(--text-muted); }

/* --- Notices ------------------------------------------------------------- */

.notice {
  border: 1px solid var(--warn-border);
  background: var(--warn-bg);
  color: var(--warn-text);
  border-radius: var(--radius);
  padding: 10px 13px;
  font-size: 13px;
  margin-bottom: 20px;
}
.notice strong { font-weight: 650; }
.notice-plain {
  border-color: var(--border);
  background: var(--surface);
  color: var(--text-muted);
}

/* --- Grids --------------------------------------------------------------- */

.grid {
  display: grid;
  gap: 12px;
  grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
}

/* --- Department cards (home) --------------------------------------------- */

.dept-card {
  display: block;
  position: relative;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  padding: 16px 16px 15px;
  overflow: hidden;
}
.dept-card:hover {
  border-color: var(--border-strong);
  text-decoration: none;
}
.dept-card::before {
  content: "";
  position: absolute;
  inset: 0 0 auto 0;
  height: 2px;
  background: var(--accent);
}
.dept-card h2 {
  margin: 0 0 4px;
  font-size: 15px;
  font-weight: 620;
  color: var(--text);
}
.dept-card p { margin: 0; font-size: 13px; color: var(--text-muted); }
.dept-card.locked { opacity: 0.55; }
.dept-card.locked:hover { border-color: var(--border); }

.accent-red { --accent: var(--soi-red); }
.accent-blue { --accent: var(--soi-blue); }

.section-head {
  font-size: 13px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-muted);
  font-weight: 650;
  margin: 32px 0 12px;
}

/* --- Stat tiles ---------------------------------------------------------- */

.tile {
  position: relative;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  padding: 14px 15px 13px;
}
.tile-label {
  font-size: 11px;
  font-weight: 650;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: var(--text-muted);
  margin-bottom: 8px;
}
.tile-value {
  font-size: 27px;
  font-weight: 620;
  letter-spacing: -0.02em;
  line-height: 1.1;
  color: var(--text);
  font-variant-numeric: tabular-nums;
}
.tile-value.is-empty { color: var(--text-faint); font-weight: 450; }
.tile-value.is-status { font-size: 18px; }
.tile-hint {
  margin-top: 7px;
  font-size: 12px;
  color: var(--text-muted);
}
.tile-foot {
  margin-top: 10px;
  padding-top: 9px;
  border-top: 1px solid var(--border);
  font-size: 11px;
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--text-faint);
}
.dot {
  width: 6px; height: 6px; border-radius: 50%;
  flex: none;
  background: var(--text-faint);
}
.dot-live { background: #1e9e62; }
.dot-pending { background: #d9a13b; }
.dot-error { background: var(--soi-red); }

/* --- Table --------------------------------------------------------------- */

.panel {
  margin-top: 28px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  overflow: hidden;
}
.panel-head {
  padding: 12px 15px;
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: baseline;
  gap: 10px;
  flex-wrap: wrap;
}
.panel-head h2 { margin: 0; font-size: 14px; font-weight: 620; }
.panel-head .panel-note { font-size: 12px; color: var(--text-faint); }

table { width: 100%; border-collapse: collapse; }
th, td {
  text-align: left;
  padding: 9px 15px;
  font-size: 13px;
  border-bottom: 1px solid var(--border);
  vertical-align: top;
}
th {
  font-size: 11px;
  font-weight: 650;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-muted);
}
tbody tr:last-child td { border-bottom: none; }
td.wrap-cell { max-width: 420px; }
.table-empty { padding: 18px 15px; color: var(--text-muted); font-size: 13px; }

/* --- RFQ tracker --------------------------------------------------------- */

.table-scroll { overflow-x: auto; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12.5px; }
.muted { color: var(--text-faint); }
.cell-sub { font-size: 12px; color: var(--text-faint); }
.overdue { color: var(--soi-red); font-weight: 600; }
tr.is-done td { color: var(--text-muted); }

.mark { font-size: 16px; font-weight: 700; line-height: 1; }
.mark-done { color: #1e9e62; }
.mark-open { color: var(--soi-red); }
.mark-btn {
  background: none;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 3px 7px;
  cursor: pointer;
}
.mark-btn:hover { border-color: var(--border-strong); }

.sr-only {
  position: absolute;
  width: 1px; height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

input[type="text"], input[type="email"], input[type="date"] {
  font: inherit;
  font-size: 13px;
  color: var(--text);
  background: var(--bg);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius);
  padding: 6px 8px;
  width: 100%;
  min-width: 0;
}
input:disabled { color: var(--text-faint); }
input:focus-visible, button:focus-visible, a:focus-visible {
  outline: 2px solid var(--soi-blue);
  outline-offset: 1px;
}

.inline-form { display: flex; gap: 6px; }
.btn-small {
  font: inherit;
  font-size: 12px;
  background: var(--surface);
  color: var(--text);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius);
  padding: 4px 9px;
  cursor: pointer;
}
.btn-link {
  font: inherit;
  font-size: 12px;
  background: none;
  border: none;
  padding: 0;
  color: var(--soi-red);
  cursor: pointer;
}
.btn-link:hover { text-decoration: underline; }

.panel-notice { margin: 12px 15px 0; }
.panel-foot {
  border-top: 1px solid var(--border);
  padding: 14px 15px 15px;
}
.panel-foot h3 { margin: 0 0 10px; font-size: 13px; font-weight: 620; }
.panel-foot p { margin: 10px 0 0; }

.task-form {
  display: grid;
  gap: 10px 12px;
  grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
  align-items: end;
}
.task-form label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 11px;
  font-weight: 650;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-muted);
}
.task-form .span-2 { grid-column: span 2; }
.task-form-actions { display: flex; }

/* --- Claude -------------------------------------------------------------- */

.claude-body {
  padding: 14px 15px;
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  align-items: center;
}
.btn.btn-secondary {
  background: var(--surface);
  color: var(--soi-blue);
  border-color: var(--border-strong);
}
.btn.btn-secondary:hover { background: var(--surface); border-color: var(--soi-blue); }
.topbar-link { font-size: 13px; font-weight: 550; }

/* --- Sign-in ------------------------------------------------------------- */

.signin {
  max-width: 380px;
  margin: 84px auto;
  text-align: center;
}
.signin .brand { justify-content: center; margin-bottom: 20px; }
.signin h1 { font-size: 19px; margin: 0 0 8px; font-weight: 620; }
.signin p { color: var(--text-muted); font-size: 14px; margin: 0 0 22px; }
.btn {
  display: inline-block;
  background: var(--soi-blue);
  color: #fff;
  border: 1px solid transparent;
  border-radius: var(--radius);
  padding: 9px 18px;
  font-size: 14px;
  font-weight: 550;
  cursor: pointer;
}
.btn:hover { background: var(--soi-navy); text-decoration: none; }
button.btn { font-family: inherit; }

/* --- Footer -------------------------------------------------------------- */

footer {
  border-top: 1px solid var(--border);
  padding: 16px 0 28px;
  font-size: 12px;
  color: var(--text-faint);
}
footer .wrap { display: flex; gap: 14px; flex-wrap: wrap; align-items: center; }
footer .topbar-spacer { flex: 1; }

@media (max-width: 560px) {
  .topbar-inner { min-height: 52px; }
  .brand-sub { display: none; }
  .tile-value { font-size: 24px; }
  td.wrap-cell { max-width: none; }
  .task-form .span-2 { grid-column: auto; }
}
`;
