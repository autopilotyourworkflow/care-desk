"use client";

import { useSyncExternalStore } from "react";

export type Role = "agent" | "clinician" | "lead";

export interface RoleInfo {
  id: Role;
  label: string; // shown in "Viewing as"
  home: string; // where switching to this role goes
  description: string;
  /** The fictional signed-in person for this view. */
  user: { name: string; firstName: string; title: string };
}

/** Fictional staff. Screens should use these names so the signed-in person is consistent everywhere. */
export const ROLES: Record<Role, RoleInfo> = {
  agent: {
    id: "agent",
    label: "Agent",
    home: "/desk/",
    description: "Answer the patient queue",
    user: { name: "Jess Morgan", firstName: "Jess", title: "Patient support" },
  },
  clinician: {
    id: "clinician",
    label: "Clinician",
    home: "/clinician/",
    description: "Escalations and orders on hold",
    user: { name: "Dr Anika Rao", firstName: "Anika", title: "Clinician" },
  },
  lead: {
    id: "lead",
    label: "Team lead",
    home: "/insights/",
    description: "Impact, safety and what to automate next",
    user: { name: "Tom Reilly", firstName: "Tom", title: "Support team lead" },
  },
};

export const ROLE_ORDER: Role[] = ["agent", "clinician", "lead"];

const KEY = "caredesk.role";
const listeners = new Set<() => void>();

function read(): Role {
  try {
    const v = window.localStorage.getItem(KEY);
    if (v === "agent" || v === "clinician" || v === "lead") return v;
  } catch {
    /* storage blocked: fall back to the default */
  }
  return "agent";
}

let memory: Role | null = null;

export function getRole(): Role {
  if (typeof window === "undefined") return "agent";
  return memory ?? (memory = read());
}

export function setRole(role: Role): void {
  memory = role;
  try {
    window.localStorage.setItem(KEY, role);
  } catch {
    /* storage blocked: keep it in memory for this visit */
  }
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) {
      memory = null;
      cb();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

/** The "Viewing as" role, persisted in localStorage (safely). Renders "agent" on the server, then the stored value. */
export function useRole(): [Role, (r: Role) => void] {
  const role = useSyncExternalStore(subscribe, getRole, () => "agent" as Role);
  return [role, setRole];
}

/** Which role a path belongs to, if it is a role's home area. */
export function roleForPath(pathname: string): Role | null {
  const p = normalizePath(pathname);
  if (p.startsWith("/desk")) return "agent";
  if (p.startsWith("/clinician")) return "clinician";
  if (p.startsWith("/insights")) return "lead";
  return null;
}

export function normalizePath(pathname: string): string {
  if (!pathname) return "/";
  return pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
}

/** Fired on window by "Replay the tour". The tour calls preventDefault() when it handles it. */
export const TOUR_EVENT = "caredesk:replay-tour";
/** When no tour is mounted, the shell navigates here instead. */
export const TOUR_URL = "/?tour=1";
