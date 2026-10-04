import "server-only";

import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import type { GetToken } from "@/lib/api/client";
import { ADMIN_ROLE, ROLE_HOME, isUserRole, type UserRole } from "@/lib/roles";

export { USER_ROLES, ROLE_HOME, ROLE_LABEL, type UserRole } from "@/lib/roles";

export type UserContext =
  | { ok: true; getToken: GetToken; role: UserRole; isAdmin: boolean }
  | { ok: false; error: string; reason: "signed-out" | "no-org" | "no-role" };

/**
 * Verifies on the server that the caller is a signed-in organization user
 * with one of the Waypoint roles.
 *
 * Every mutating server action must call this: actions are public HTTP endpoints,
 * so hiding buttons in the UI is not access control.
 */
export async function getUserContext(): Promise<UserContext> {
  const { userId, orgId, orgRole, getToken } = await auth();

  if (!userId) {
    return { ok: false, reason: "signed-out", error: "You need to sign in first." };
  }
  if (!orgId) {
    return { ok: false, reason: "no-org", error: "Select an organization to continue." };
  }

  const isAdmin = orgRole === ADMIN_ROLE;

  // An admin has no role app of their own; treat them as a dispatcher by default.
  if (isAdmin) {
    return { ok: true, role: "org:dispatcher", isAdmin, getToken };
  }
  if (!isUserRole(orgRole)) {
    return { ok: false, reason: "no-role", error: "You don't have permission." };
  }

  return { ok: true, role: orgRole, isAdmin, getToken };
}

/**
 * Guard for a role's route segment. Redirects rather than throwing so a user who
 * lands on the wrong app is quietly moved to their own one.
 */
export async function requireRole(role: UserRole): Promise<UserContext & { ok: true }> {
  const context = await getUserContext();

  if (!context.ok) {
    if (context.reason === "no-org") redirect("/select-org");
    if (context.reason === "no-role") redirect("/no-access");
    // Keeps the requested path so the user lands back here after signing in.
    const { redirectToSignIn } = await auth();
    return redirectToSignIn();
  }
  if (!context.isAdmin && context.role !== role) {
    redirect(ROLE_HOME[context.role]);
  }

  return context;
}
