import type { Metadata } from "next";
import { Geist, Geist_Mono, Inter } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";
import { LocalSessionProvider } from "@/lib/auth-client";
import { AUTH_MODE } from "@/lib/auth-mode";
import { getLocalSession } from "@/lib/local-session";
import { cn } from "@/lib/utils";

const inter = Inter({subsets:['latin'],variable:'--font-sans'});

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Waypoint",
  description: "Delivery planning, loading and run tracking",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const page = (
    <html
      lang="en"
      className={cn("h-full", "antialiased", geistSans.variable, geistMono.variable, "font-sans", inter.variable)}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );

  if (AUTH_MODE === "local") {
    const session = await getLocalSession();
    return (
      <LocalSessionProvider token={session?.token ?? null} name={session?.name ?? null}>
        {page}
      </LocalSessionProvider>
    );
  }
  return <ClerkProvider>{page}</ClerkProvider>;
}
