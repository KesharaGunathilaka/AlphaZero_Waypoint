/**
 * Clerk organization roles and the app each one lands in.
 *
 * The keys must match the role keys in the Clerk Dashboard exactly
 * (Configure → Organizations → Roles & Permissions).
 *
 * No `server-only` here: `proxy.ts` and client components both import this.
 */

export const USER_ROLES = [
  "org:dispatcher",
  "org:driver",
  "org:loader",
  "org:store_manager",
] as const;

export type UserRole = (typeof USER_ROLES)[number];

/** Org admins can open every role's app; they are not a role app of their own. */
export const ADMIN_ROLE = "org:admin";

/** The route each role is sent to after sign-in. */
export const ROLE_HOME: Record<UserRole, string> = {
  "org:dispatcher": "/dispatcher",
  "org:driver": "/driver",
  "org:loader": "/loader",
  "org:store_manager": "/store-manager",
};

export const ROLE_LABEL: Record<UserRole, string> = {
  "org:dispatcher": "Dispatcher",
  "org:driver": "Driver",
  "org:loader": "Loader",
  "org:store_manager": "Store manager",
};

export function isUserRole(value: string | null | undefined): value is UserRole {
  return USER_ROLES.includes(value as UserRole);
}
