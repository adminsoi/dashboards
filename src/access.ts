/**
 * Department authorization.
 *
 * Maps a signed-in user's Entra group ids to the departments they may open.
 * Enforcement is gated on DEPT_ACCESS_ENFORCE so the app can ship before IT
 * has finished creating the six security groups; while it is off, access is
 * permissive but the UI states plainly that it is not being enforced, so the
 * state is never silently misread as locked down.
 */
import { config } from "./config.js";
import { DEPARTMENTS, type Department } from "./departments.js";

export interface Viewer {
  oid: string;
  username: string;
  name: string;
  groups: string[];
}

/** True when the viewer belongs to a group granting every department. */
function hasAllAccess(viewer: Viewer): boolean {
  return config.access.allDepartments.some((g) => viewer.groups.includes(g));
}

export function canView(viewer: Viewer, dept: Department): boolean {
  if (!config.access.enforce) return true;
  if (hasAllAccess(viewer)) return true;
  const allowed = config.access.groups[dept.slug] ?? [];
  return allowed.some((g) => viewer.groups.includes(g));
}

export function visibleDepartments(viewer: Viewer): Department[] {
  return DEPARTMENTS.filter((d) => canView(viewer, d));
}

/**
 * Departments the viewer cannot open. Shown greyed out with a "request access"
 * hint rather than hidden, so people can see what exists and who to ask.
 */
export function restrictedDepartments(viewer: Viewer): Department[] {
  return DEPARTMENTS.filter((d) => !canView(viewer, d));
}

/** Whether group mapping is actually configured, surfaced in /healthz and the UI. */
export function accessPosture(): {
  enforcing: boolean;
  configuredDepartments: string[];
  unconfiguredDepartments: string[];
} {
  const configured: string[] = [];
  const unconfigured: string[] = [];
  for (const d of DEPARTMENTS) {
    const ids = config.access.groups[d.slug] ?? [];
    (ids.length > 0 ? configured : unconfigured).push(d.slug);
  }
  return {
    enforcing: config.access.enforce,
    configuredDepartments: configured,
    unconfiguredDepartments: unconfigured,
  };
}
