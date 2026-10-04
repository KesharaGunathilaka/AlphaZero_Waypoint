"use client";

import { useAuth } from "@clerk/nextjs";
import { createContext, useCallback, useContext, type ReactNode } from "react";
import type { GetToken } from "@/lib/api/client";
import { AUTH_MODE } from "@/lib/auth-mode";

type LocalSessionValue = { token: string | null; name: string | null };

const LocalSessionContext = createContext<LocalSessionValue>({ token: null, name: null });

/** Local mode only: the root layout reads the session cookie on the server and hands the token down. */
export function LocalSessionProvider({ token, name, children }: LocalSessionValue & { children: ReactNode }) {
  return <LocalSessionContext.Provider value={{ token, name }}>{children}</LocalSessionContext.Provider>;
}

export function useLocalSession(): LocalSessionValue {
  return useContext(LocalSessionContext);
}

function useLocalToken(): GetToken {
  const { token } = useContext(LocalSessionContext);
  return useCallback(async () => token, [token]);
}

function useClerkToken(): GetToken {
  const { getToken } = useAuth();
  return useCallback(() => getToken(), [getToken]);
}

/** The signed-in user's API token, whichever way they signed in. AUTH_MODE never changes at runtime. */
export const useGetToken: () => GetToken = AUTH_MODE === "local" ? useLocalToken : useClerkToken;
