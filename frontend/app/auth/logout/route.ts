import { NextResponse } from "next/server";
import { AUTH_MODE, SESSION_COOKIE } from "@/lib/auth-mode";

/** Local sign-out: drop the session cookie and go back to the sign-in page. */
export async function POST() {
  if (AUTH_MODE !== "local") return NextResponse.json({ error: "Not found" }, { status: 404 });
  // Relative Location: behind Docker the server's own host name is not the one the browser used.
  const response = new NextResponse(null, { status: 303, headers: { Location: "/sign-in" } });
  response.cookies.delete(SESSION_COOKIE);
  return response;
}
