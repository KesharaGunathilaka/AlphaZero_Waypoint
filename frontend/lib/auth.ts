import "server-only";

import { auth } from "@clerk/nextjs/server";
import type { GetToken } from "@/lib/api/client";

/** Clerk organization roles. */
export const USER_ROLES = [
  "org:dispatcher",
  "org:driver",
  "org:loader",
  "org:store-manager",
] as const;

export type UserRole = (typeof USER_ROLES)[number];
export type UserContext = { ok: true; getToken: GetToken, role: UserRole } | { ok: false; error: string };

/**
 * Verifies on the server that the caller is a signed-in organization user.
 * Every mutating server action must call this: actions are public HTTP endpoints,
 * so hiding buttons in the UI is not access control.
 */
export async function getUserContext(): Promise<UserContext> {
  const { userId, has, getToken } = await auth();

  if (!userId) return { ok: false, error: "You need to sign in first." };

  const role = USER_ROLES.find((role) => has({ role }));
  if (!role) return { ok: false, error: "You don't have permission." };

  return { ok: true, role, getToken };
}
