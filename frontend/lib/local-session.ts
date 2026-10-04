import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/lib/auth-mode";

/** A verified local session (AUTH_MODE=local). The API checks the same token on every request. */
export type LocalSession = { token: string; userId: number; role: string; name: string; expiresAt: number };

function decode(part: string): Record<string, unknown> | null {
  try {
    return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

/** Checks the HS256 signature (LOCAL_AUTH_SECRET, shared with the API), issuer, audience and expiry. */
export function verifyLocalToken(token: string): LocalSession | null {
  const secret = process.env.LOCAL_AUTH_SECRET;
  const [header, payload, signature] = token.split(".");
  if (!secret || !header || !payload || !signature) return null;
  const expected = Buffer.from(createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url"));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  if (decode(header)?.alg !== "HS256") return null;
  const claims = decode(payload);
  if (!claims || claims.iss !== "waypoint-local" || claims.aud !== "waypoint") return null;
  if (typeof claims.exp !== "number" || claims.exp * 1000 <= Date.now()) return null;
  return {
    token,
    userId: Number(claims.sub),
    role: String(claims.role),
    name: String(claims.name ?? ""),
    expiresAt: claims.exp * 1000,
  };
}

export async function getLocalSession(): Promise<LocalSession | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return token ? verifyLocalToken(token) : null;
}
