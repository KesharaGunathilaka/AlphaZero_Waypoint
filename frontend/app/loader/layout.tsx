import { requireRole } from "@/lib/auth";

/** Signed-out users are sent to sign-in; a wrong role is sent to its own app. Sign-out lives in the app's header. */
export default async function Layout({ children }: LayoutProps<"/loader">) {
  await requireRole("org:loader");

  return children;
}
