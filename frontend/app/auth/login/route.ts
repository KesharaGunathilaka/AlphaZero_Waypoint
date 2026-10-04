import { NextResponse } from "next/server";
import { AUTH_MODE, SESSION_COOKIE } from "@/lib/auth-mode";

/** Local sign-in: forwards email + password to the API and keeps the session token in an httpOnly cookie. */
export async function POST(request: Request) {
  if (AUTH_MODE !== "local") return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { email, password } = (await request.json().catch(() => ({}))) as { email?: string; password?: string };
  if (!email || !password) return NextResponse.json({ error: "Enter your email and password." }, { status: 400 });

  const base = (process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/+$/, "");
  let res: Response;
  try {
    res = await fetch(`${base}/api/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
      cache: "no-store",
    });
  } catch {
    return NextResponse.json({ error: "Can't reach the Waypoint server. Is it running?" }, { status: 502 });
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const detail = typeof data?.detail === "string" ? data.detail : "Sign-in failed. Try again.";
    return NextResponse.json({ error: detail }, { status: res.status });
  }

  const response = NextResponse.json({ ok: true, role: data.user.role });
  response.cookies.set(SESSION_COOKIE, data.token, {
    httpOnly: true,
    sameSite: "lax",
    secure: new URL(request.url).protocol === "https:",
    path: "/",
    expires: new Date(data.expires_at),
  });
  return response;
}
