import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { AUTH_MODE } from "@/lib/auth-mode";

/**
 * Next 16 renamed `middleware.ts` to `proxy.ts`; `clerkMiddleware` is unchanged.
 *
 * This only makes the session available to `auth()`. It deliberately protects
 * nothing: Clerk now recommends resource-based checks, so each route enforces
 * its own access in its layout via `requireRole` (see `lib/auth.ts`). Path
 * matching in the proxy can diverge from how Next actually routes a request.
 */
export default AUTH_MODE === "local" ? () => NextResponse.next() : clerkMiddleware();

export const config = {
  matcher: [
    // Everything except Next internals and static files, unless a search param is present.
    "/((?!_next|[^?]*\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes.
    "/(api|trpc)(.*)",
  ],
};
