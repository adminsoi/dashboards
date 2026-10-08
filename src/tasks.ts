/**
 * RFQ task tracker — the dashboard's own small store.
 *
 * This is NOT Pentagon 2000 and never writes to it. It is a work list the
 * dashboard keeps for itself in one JSON file on a mounted volume
 * (TASKS_DATA_DIR), written atomically (temp file + rename) and serialised
 * through a single in-process queue. One container, one writer.
 *
 * Who may do what — enforced here, server-side, never trusted from a form:
 *   - Managers (DEPT_GROUP_MANAGERS) see every task in a department, may
 *     assign a task to anyone, and may edit or delete any task.
 *   - Everyone else sees only the tasks assigned to them. They may create
 *     tasks, but only for themselves, and may edit or delete only the tasks
 *     they created. Tasks a manager assigned them are read-only.
 */
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { config } from "./config.js";
import type { Viewer } from "./access.js";

export interface Task {
  id: string;
  department: string;
  partNumber: string;
  customer: string;
  /** Lower-cased UPN of the person doing the work. */
  assignee: string;
  assigneeName: string;
  /** YYYY-MM-DD, or "" when none was given. */
  dueDate: string;
  done: boolean;
  notes: string;
  /** Lower-cased UPN of whoever created the task. */
  createdBy: string;
  createdByName: string;
  /** Whether the creator was a manager at the time — drives "assigned by". */
  createdByManager: boolean;
  createdAt: string;
  updatedAt: string;
}

interface StoreFile {
  version: 1;
  tasks: Task[];
  /** Everyone who has signed in, UPN -> display name. Feeds the assignee picker. */
  people: Record<string, string>;
}

export const LIMITS = { partNumber: 64, customer: 120, notes: 1000, email: 254 } as const;

/**
 * Every refusal the tracker can give, by code. Redirects carry only the code,
 * so a crafted link can never put arbitrary text on the page.
 */
export const TASK_MESSAGES = {
  invalid: "That form could not be accepted. Reload the page and try again.",
  partRequired: "Part number is required.",
  partTooLong: `Part number must be ${LIMITS.partNumber} characters or fewer.`,
  customerRequired: "Customer is required.",
  customerTooLong: `Customer must be ${LIMITS.customer} characters or fewer.`,
  notesTooLong: `Notes must be ${LIMITS.notes} characters or fewer.`,
  badAssignee: "Assign to must be the person's SOI email address.",
  badDate: "Due date must be a valid date.",
  missing: "That task no longer exists.",
  readOnly: "This task was assigned by a manager and is read-only for you.",
} as const;

export type TaskErrorCode = keyof typeof TASK_MESSAGES;

/** A user-facing refusal, identified by code. */
export class TaskError extends Error {
  constructor(readonly code: TaskErrorCode) {
    super(TASK_MESSAGES[code]);
  }
}

const FILE = join(config.tasks.dataDir, "tasks.json");

let store: StoreFile | null = null;
let queue: Promise<unknown> = Promise.resolve();

async function load(): Promise<StoreFile> {
  if (store) return store;
  try {
    const parsed = JSON.parse(await readFile(FILE, "utf8")) as StoreFile;
    if (parsed.version !== 1 || !Array.isArray(parsed.tasks)) {
      throw new Error(`${FILE} is not a version-1 task store.`);
    }
    store = { version: 1, tasks: parsed.tasks, people: parsed.people ?? {} };
  } catch (err) {
    // A missing file is a fresh install. Anything else (corrupt JSON, wrong
    // permissions) must stop us rather than be silently overwritten.
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    store = { version: 1, tasks: [], people: {} };
  }
  return store;
}

async function persist(s: StoreFile): Promise<void> {
  await mkdir(config.tasks.dataDir, { recursive: true });
  const tmp = `${FILE}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(s, null, 2), "utf8");
  await rename(tmp, FILE);
}

/** Run one read-modify-write at a time, so concurrent requests cannot interleave. */
function mutate<T>(fn: (s: StoreFile) => T): Promise<T> {
  const run = queue.then(async () => {
    const s = await load();
    const result = fn(s);
    await persist(s);
    return result;
  });
  queue = run.catch(() => undefined);
  return run;
}

function me(viewer: Viewer): string {
  return (viewer.username || viewer.oid).toLowerCase();
}

// --- Permissions -----------------------------------------------------------

export function canSee(viewer: Viewer, task: Task): boolean {
  return viewer.manager || task.assignee === me(viewer);
}

export function canEdit(viewer: Viewer, task: Task): boolean {
  if (viewer.manager) return true;
  // Self-made tasks only; anything a manager assigned stays read-only.
  return task.createdBy === me(viewer) && task.assignee === me(viewer);
}

// --- Reads -----------------------------------------------------------------

/** Tasks in a department the viewer may see: open first, then by due date. */
export async function listTasks(viewer: Viewer, department: string): Promise<Task[]> {
  const s = await load();
  return s.tasks
    .filter((t) => t.department === department && canSee(viewer, t))
    .sort(
      (a, b) =>
        Number(a.done) - Number(b.done) ||
        (a.dueDate || "9999").localeCompare(b.dueDate || "9999") ||
        a.createdAt.localeCompare(b.createdAt),
    );
}

/** Known people for the manager's assignee picker. */
export async function listPeople(): Promise<Array<{ email: string; name: string }>> {
  const s = await load();
  return Object.entries(s.people)
    .map(([email, name]) => ({ email, name }))
    .sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email));
}

// --- Writes ----------------------------------------------------------------

/** Remember who has signed in. Writes only when something changed. */
export async function rememberPerson(viewer: Viewer): Promise<void> {
  if (!viewer.username) return;
  const s = await load();
  const email = me(viewer);
  if (s.people[email] === viewer.name) return;
  await mutate((st) => {
    st.people[email] = viewer.name;
  });
}

export interface NewTask {
  partNumber: string;
  customer: string;
  assignee: string;
  dueDate: string;
  notes: string;
}

export async function createTask(viewer: Viewer, department: string, input: NewTask): Promise<Task> {
  const partNumber = clean(input.partNumber, LIMITS.partNumber, "partTooLong");
  if (!partNumber) throw new TaskError("partRequired");
  const customer = clean(input.customer, LIMITS.customer, "customerTooLong");
  if (!customer) throw new TaskError("customerRequired");
  const dueDate = cleanDate(input.dueDate);
  const notes = clean(input.notes, LIMITS.notes, "notesTooLong");

  // Only managers choose the assignee. For everyone else the form field is
  // ignored outright, whatever was submitted.
  let assignee = me(viewer);
  if (viewer.manager && input.assignee.trim()) {
    assignee = input.assignee.trim().toLowerCase();
    if (assignee.length > LIMITS.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(assignee)) {
      throw new TaskError("badAssignee");
    }
  }

  return mutate((s) => {
    const now = new Date().toISOString();
    const task: Task = {
      id: randomUUID(),
      department,
      partNumber,
      customer,
      assignee,
      assigneeName: assignee === me(viewer) ? viewer.name : (s.people[assignee] ?? ""),
      dueDate,
      done: false,
      notes,
      createdBy: me(viewer),
      createdByName: viewer.name,
      createdByManager: viewer.manager,
      createdAt: now,
      updatedAt: now,
    };
    s.tasks.push(task);
    return task;
  });
}

export async function toggleDone(viewer: Viewer, department: string, id: string): Promise<void> {
  await mutate((s) => {
    const task = editable(s, viewer, department, id);
    task.done = !task.done;
    task.updatedAt = new Date().toISOString();
  });
}

export async function updateNotes(
  viewer: Viewer,
  department: string,
  id: string,
  notes: string,
): Promise<void> {
  const cleaned = clean(notes, LIMITS.notes, "notesTooLong");
  await mutate((s) => {
    const task = editable(s, viewer, department, id);
    task.notes = cleaned;
    task.updatedAt = new Date().toISOString();
  });
}

export async function deleteTask(viewer: Viewer, department: string, id: string): Promise<void> {
  await mutate((s) => {
    const task = editable(s, viewer, department, id);
    s.tasks = s.tasks.filter((t) => t !== task);
  });
}

/** Look a task up and check the viewer may change it, or refuse. */
function editable(s: StoreFile, viewer: Viewer, department: string, id: string): Task {
  const task = s.tasks.find((t) => t.id === id && t.department === department);
  // Same answer for "missing" and "not yours", so ids cannot be probed.
  if (!task || !canSee(viewer, task)) throw new TaskError("missing");
  if (!canEdit(viewer, task)) throw new TaskError("readOnly");
  return task;
}

function clean(raw: string, max: number, tooLong: TaskErrorCode): string {
  // Collapse control characters; keep the text otherwise as typed.
  const value = raw.replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
  if (value.length > max) throw new TaskError(tooLong);
  return value;
}

function cleanDate(raw: string): string {
  const value = raw.trim();
  if (!value) return "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new TaskError("badDate");
  }
  return value;
}
