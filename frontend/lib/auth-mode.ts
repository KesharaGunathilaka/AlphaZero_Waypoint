/**
 * How people sign in. Baked in at build time.
 *
 * - "clerk": the deployed app (Clerk accounts and organizations).
 * - "local": the Docker delivery. The Waypoint API checks email + password against its own users and
 *   signs a session token; the web app keeps it in an httpOnly cookie. No outside account needed.
 */
export const AUTH_MODE: "clerk" | "local" = process.env.NEXT_PUBLIC_AUTH_MODE === "local" ? "local" : "clerk";

/** httpOnly cookie that holds the local session token. */
export const SESSION_COOKIE = "wp_session";

/** Password of every seeded demo account in local mode (set by demo_reset() in the database). */
export const DEMO_PASSWORD = "waypoint-demo";
