/**
 * Page renderers.
 *
 * The one rule that shapes all of this: a tile only ever shows a number when
 * that number came from a live source in this request. Anything else shows an
 * em dash plus the reason, and the page carries a banner saying some figures
 * are placeholders. Someone glancing at a screen should never mistake an
 * unwired integration for a real business figure.
 */
import { esc, layout, safeHref } from "./html.js";
import { SOURCE_LABELS, type Department, type TileDef, type TileFormat } from "./../departments.js";
import type { DepartmentData, Metric } from "./../sources/metrics.js";
import type { Viewer } from "./../access.js";
import { config } from "./../config.js";
import { LIMITS, type Task } from "./../tasks.js";

function formatValue(value: number | string, format: TileFormat): string {
  if (typeof value === "string") return value;
  switch (format) {
    case "currency":
      return value.toLocaleString("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
      });
    case "percent":
      return `${value.toLocaleString("en-US", { maximumFractionDigits: 1 })}%`;
    case "days":
      return `${value.toLocaleString("en-US", { maximumFractionDigits: 0 })} days`;
    default:
      return value.toLocaleString("en-US");
  }
}

/** Provenance footer: a coloured dot plus where the figure came from. */
function tileFoot(tile: TileDef, metric: Metric): string {
  const source = SOURCE_LABELS[tile.source];
  const dot =
    metric.state === "live" ? "dot-live" : metric.state === "error" ? "dot-error" : "dot-pending";
  const label =
    metric.state === "live"
      ? `${source} · live`
      : metric.state === "error"
        ? `${source} · unavailable`
        : `${source} · not connected`;
  return `<div class="tile-foot"><span class="dot ${dot}"></span>${esc(label)}</div>`;
}

function renderTile(tile: TileDef, metric: Metric | undefined): string {
  const m: Metric = metric ?? { state: "error", note: "No loader is defined for this tile." };
  const live = m.state === "live" && m.value !== undefined;

  const valueClass = ["tile-value"];
  if (!live) valueClass.push("is-empty");
  if (tile.format === "status") valueClass.push("is-status");

  const value = live ? esc(formatValue(m.value as number | string, tile.format)) : "&mdash;";
  const hint = live ? tile.hint : (m.note ?? tile.hint);

  return `<div class="tile">
    <div class="tile-label">${esc(tile.label)}</div>
    <div class="${valueClass.join(" ")}">${value}</div>
    <div class="tile-hint">${esc(hint)}</div>
    ${tileFoot(tile, m)}
  </div>`;
}

function renderTable(table: NonNullable<DepartmentData["table"]>): string {
  const head = table.headers.map((h) => `<th>${esc(h)}</th>`).join("");

  const body = table.rows.length
    ? table.rows
        .map((row) => {
          const cells = row.cells.map((cell, i) => {
            const text = esc(cell);
            const href = i === 0 ? safeHref(row.href) : undefined;
            const inner = href ? `<a href="${esc(href)}" rel="noopener noreferrer" target="_blank">${text}</a>` : text;
            return `<td${i === 1 ? ' class="wrap-cell"' : ""}>${inner}</td>`;
          });
          return `<tr>${cells.join("")}</tr>`;
        })
        .join("")
    : "";

  const table_ = body
    ? `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`
    : `<div class="table-empty">Nothing to show right now.</div>`;

  return `<section class="panel">
    <div class="panel-head">
      <h2>${esc(table.title)}</h2>
      ${table.note ? `<span class="panel-note">${esc(table.note)}</span>` : ""}
    </div>
    ${table_}
  </section>`;
}

// --- Home ------------------------------------------------------------------

export function renderHome(opts: {
  viewer: Viewer;
  visible: Department[];
  restricted: Department[];
  enforcing: boolean;
}): string {
  const card = (d: Department, locked: boolean) => {
    const inner = `<h2>${esc(d.name)}</h2><p>${esc(locked ? "You do not have access to this dashboard." : d.tagline)}</p>`;
    return locked
      ? `<div class="dept-card locked accent-${d.accent}">${inner}</div>`
      : `<a class="dept-card accent-${d.accent}" href="/d/${esc(d.slug)}">${inner}</a>`;
  };

  const accessNotice = opts.enforcing
    ? ""
    : `<div class="notice"><strong>Department access is not being enforced.</strong>
         Every signed-in SOI user can currently open every dashboard. Set
         <code>DEPT_ACCESS_ENFORCE=true</code> once the Entra department groups exist.</div>`;

  const restrictedBlock = opts.restricted.length
    ? `<h2 class="section-head">Not available to you</h2>
       <div class="grid">${opts.restricted.map((d) => card(d, true)).join("")}</div>`
    : "";

  const body = `
    <div class="page-head">
      <div class="eyebrow">Dashboards</div>
      <h1>Good day${opts.viewer.name ? `, ${esc(opts.viewer.name.split(" ")[0] ?? "")}` : ""}</h1>
      <p>Pick a department. Figures are read-only; Procurement and Purchasing carry an RFQ task tracker.</p>
    </div>
    ${accessNotice}
    <div class="grid">${opts.visible.map((d) => card(d, false)).join("")}</div>
    ${restrictedBlock}`;

  return layout({
    title: "Dashboards",
    body,
    user: { name: opts.viewer.name, username: opts.viewer.username },
  });
}

// --- Department ------------------------------------------------------------

/** What the RFQ tracker needs to render, prepared by the route. */
export interface TrackerView {
  tasks: Array<{ task: Task; editable: boolean }>;
  /** Assignee suggestions — managers only; empty for everyone else. */
  people: Array<{ email: string; name: string }>;
  csrf: string;
  error?: string;
}

/** Today as YYYY-MM-DD, for overdue checks. Server time, which is fine at day grain. */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function renderTracker(dept: Department, viewer: Viewer, tracker: TrackerView): string {
  const base = `/d/${esc(dept.slug)}/tasks`;
  const csrf = `<input type="hidden" name="csrf" value="${esc(tracker.csrf)}">`;
  const anyEditable = tracker.tasks.some((t) => t.editable);
  const now = today();

  const rows = tracker.tasks
    .map(({ task, editable }) => {
      const id = esc(task.id);
      const mark = task.done
        ? `<span class="mark mark-done" aria-hidden="true">&#10003;</span>`
        : `<span class="mark mark-open" aria-hidden="true">&#10007;</span>`;
      const statusText = task.done ? "Done" : "Open";

      const status = editable
        ? `<form method="post" action="${base}/${id}/status">${csrf}
             <button class="mark-btn" type="submit" title="${task.done ? "Mark as open" : "Mark as done"}">
               ${mark}<span class="sr-only">${statusText} — toggle</span></button></form>`
        : `${mark}<span class="sr-only">${statusText}</span>`;

      const notes = editable
        ? `<form class="inline-form" method="post" action="${base}/${id}/notes">${csrf}
             <input type="text" name="notes" value="${esc(task.notes)}" maxlength="${LIMITS.notes}" aria-label="Notes">
             <button class="btn-small" type="submit">Save</button></form>`
        : esc(task.notes) || `<span class="muted">&mdash;</span>`;

      const who = esc(task.assigneeName || task.assignee);
      const assignedBy =
        task.createdByManager && task.createdBy !== task.assignee
          ? `<div class="cell-sub">Assigned by ${esc(task.createdByName || task.createdBy)}</div>`
          : "";

      const overdue = !task.done && task.dueDate && task.dueDate < now;
      const due = task.dueDate
        ? `<span class="${overdue ? "overdue" : ""}">${esc(task.dueDate)}</span>`
        : `<span class="muted">&mdash;</span>`;

      const actions = anyEditable
        ? `<td>${
            editable
              ? `<form method="post" action="${base}/${id}/delete">${csrf}
                   <button class="btn-link" type="submit">Delete</button></form>`
              : `<span class="cell-sub">Read-only</span>`
          }</td>`
        : "";

      return `<tr class="${task.done ? "is-done" : ""}">
        <td class="mono">${esc(task.partNumber)}</td>
        <td>${esc(task.customer)}</td>
        <td>${who}${assignedBy}</td>
        <td>${due}</td>
        <td>${status}</td>
        <td class="wrap-cell">${notes}</td>
        ${actions}
      </tr>`;
    })
    .join("");

  const table = rows
    ? `<div class="table-scroll"><table>
         <thead><tr><th>Part number</th><th>Customer</th><th>Assigned to</th><th>Due date</th><th>Status</th><th>Notes</th>${
           anyEditable ? "<th></th>" : ""
         }</tr></thead>
         <tbody>${rows}</tbody></table></div>`
    : `<div class="table-empty">${
        viewer.manager ? "No RFQ tasks yet." : "No RFQ tasks assigned to you yet."
      }</div>`;

  const datalist = tracker.people.length
    ? `<datalist id="people-${esc(dept.slug)}">${tracker.people
        .map((p) => `<option value="${esc(p.email)}">${esc(p.name)}</option>`)
        .join("")}</datalist>`
    : "";

  const assigneeField = viewer.manager
    ? `<label>Assign to
         <input type="email" name="assignee" maxlength="${LIMITS.email}" placeholder="Leave blank for yourself"
           list="people-${esc(dept.slug)}" autocomplete="off">
       </label>${datalist}`
    : `<label>Assign to<input type="text" value="You" disabled></label>`;

  const form = `<form class="task-form" method="post" action="${base}">${csrf}
      <label>Part number<input type="text" name="partNumber" required maxlength="${LIMITS.partNumber}"></label>
      <label>Customer<input type="text" name="customer" required maxlength="${LIMITS.customer}"></label>
      ${assigneeField}
      <label>Due date<input type="date" name="dueDate"></label>
      <label class="span-2">Notes<input type="text" name="notes" maxlength="${LIMITS.notes}"></label>
      <div class="task-form-actions"><button class="btn" type="submit">Add RFQ task</button></div>
    </form>`;

  const scope = viewer.manager
    ? "Manager view: every RFQ task in this department. You can assign tasks to anyone."
    : "Showing the RFQ tasks assigned to you. Tasks a manager assigned are read-only.";

  return `<section class="panel" id="rfqs">
    <div class="panel-head">
      <h2>RFQs</h2>
      <span class="panel-note">${esc(scope)}</span>
    </div>
    ${tracker.error ? `<div class="notice panel-notice">${esc(tracker.error)}</div>` : ""}
    ${table}
    <div class="panel-foot">
      <h3>New RFQ task</h3>
      ${form}
      <p class="cell-sub">Tracked by this dashboard, not Pentagon 2000. Do not enter
        export-controlled technical data, certification numbers, or pricing here.</p>
    </div>
  </section>`;
}

/**
 * Claude for this department. claude.ai cannot be framed inside another site
 * (it forbids it, as this app does), so this links out to the department's
 * Claude project in a new tab rather than embedding it.
 */
function renderClaude(dept: Department): string {
  const project = config.claude.projects[dept.slug];
  const projectLink = project
    ? `<a class="btn" href="${esc(project)}" target="_blank" rel="noopener noreferrer">Open the ${esc(dept.name)} Claude project</a>`
    : `<span class="cell-sub">No Claude project is linked to ${esc(dept.name)} yet. IT can link one with
         <code>CLAUDE_PROJECT_${esc(dept.slug.toUpperCase())}</code>.</span>`;

  return `<section class="panel">
    <div class="panel-head">
      <h2>Claude</h2>
      <span class="panel-note">Opens claude.ai in a new tab, signed in with your SOI account.</span>
    </div>
    <div class="claude-body">
      ${projectLink}
      <a class="btn btn-secondary" href="${esc(config.claude.chatUrl)}" target="_blank" rel="noopener noreferrer">New chat</a>
    </div>
  </section>`;
}

export function renderDepartment(opts: {
  viewer: Viewer;
  dept: Department;
  data: DepartmentData;
  tracker?: TrackerView;
}): string {
  const { dept, data } = opts;

  const tiles = dept.tiles.map((t) => renderTile(t, data.metrics[t.key])).join("");

  const placeholderNotice = data.hasPlaceholders
    ? `<div class="notice"><strong>Some figures are placeholders.</strong>
         Tiles marked “not connected” have no data source wired up yet and show
         no value — they are not zeros. Do not use this page as a source of
         record until those integrations are live.</div>`
    : "";

  const internalNotice = dept.internalOnly
    ? `<div class="notice notice-plain">Internal figures. Do not reproduce in
         client-facing or government-facing material.</div>`
    : "";

  const body = `
    <div class="page-head">
      <div class="eyebrow"><a class="back-link" href="/">← All dashboards</a></div>
      <h1>${esc(dept.name)}</h1>
      <p>${esc(dept.tagline)}</p>
    </div>
    ${placeholderNotice}
    ${internalNotice}
    ${tiles ? `<div class="grid">${tiles}</div>` : `<div class="notice notice-plain">No figures are wired up for ${esc(dept.name)} yet.</div>`}
    ${opts.tracker ? renderTracker(dept, opts.viewer, opts.tracker) : ""}
    ${data.table ? renderTable(data.table) : ""}
    ${renderClaude(dept)}`;

  return layout({
    title: dept.name,
    body,
    accent: dept.accent,
    user: { name: opts.viewer.name, username: opts.viewer.username },
  });
}

// --- Auth pages ------------------------------------------------------------

export function renderSignIn(opts: { returnTo: string; error?: string }): string {
  const error = opts.error
    ? `<div class="notice">${esc(opts.error)}</div>`
    : "";
  const body = `<div class="signin">
    <div class="brand"><span class="brand-mark"></span>SOI Aviation</div>
    <h1>Department dashboards</h1>
    <p>Sign in with your SOI Microsoft account.</p>
    ${error}
    <a class="btn" href="/auth/start?returnTo=${encodeURIComponent(opts.returnTo)}">Sign in with Microsoft</a>
  </div>`;
  return layout({ title: "Sign in", body, bare: true });
}

export function renderSignedOut(): string {
  const body = `<div class="signin">
    <div class="brand"><span class="brand-mark"></span>SOI Aviation</div>
    <h1>Signed out</h1>
    <p>You have been signed out of the dashboards.</p>
    <a class="btn" href="/">Sign in again</a>
  </div>`;
  return layout({ title: "Signed out", body, bare: true });
}

export function renderError(opts: { title: string; message: string; status: number }): string {
  const body = `<div class="signin">
    <div class="brand"><span class="brand-mark"></span>SOI Aviation</div>
    <h1>${esc(opts.title)}</h1>
    <p>${esc(opts.message)}</p>
    <a class="btn" href="/">Back to dashboards</a>
  </div>`;
  return layout({ title: opts.title, body, bare: true });
}
