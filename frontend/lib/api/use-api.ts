"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError, apiRequest, type RequestOptions } from "@/lib/api/client";
import { useGetToken } from "@/lib/auth-client";

type Request = <T>(path: string, options?: Omit<RequestOptions, "getToken">) => Promise<T>;

/** `apiRequest` with the signed-in user's token attached (Clerk or local sign-in). */
export function useApi(): Request {
  const getToken = useGetToken();
  return useCallback(
    <T,>(path: string, options: Omit<RequestOptions, "getToken"> = {}) =>
      apiRequest<T>(path, { ...options, getToken: () => getToken() }),
    [getToken],
  );
}

export type ApiData<T> = {
  data: T | undefined;
  error: string | null;
  loading: boolean;
  /** Fetch again (after a change, or on a timer). Keeps the old data on screen while loading. */
  reload: () => Promise<void>;
};

/**
 * Load `path` when the component mounts (and when `path` changes). `null` means "nothing to load yet".
 * `refreshMs` re-fetches on a timer, which is how live screens stay current without websockets.
 */
export function useApiData<T>(path: string | null, refreshMs?: number): ApiData<T> {
  const request = useApi();
  // The result is stored with the path it belongs to, so a new path never shows the old path's data.
  const [state, setState] = useState<{ path: string | null; data?: T; error: string | null }>({ path: null, error: null });

  const settle = useCallback(
    (from: string, result: { data: T } | { error: unknown }) =>
      setState((s) =>
        "data" in result
          ? { path: from, data: result.data, error: null }
          : { path: from, data: s.path === from ? s.data : undefined, error: errorMessage(result.error) },
      ),
    [],
  );

  const reload = useCallback(async () => {
    if (path === null) return;
    try {
      settle(path, { data: await request<T>(path) });
    } catch (error) {
      settle(path, { error });
    }
  }, [path, request, settle]);

  useEffect(() => {
    if (path === null) return;
    let cancelled = false;
    const load = () =>
      request<T>(path).then(
        (data) => !cancelled && settle(path, { data }),
        (error) => !cancelled && settle(path, { error }),
      );
    void load();
    const timer = refreshMs ? setInterval(load, refreshMs) : undefined;
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [path, refreshMs, request, settle]);

  const current = state.path === path;
  return {
    data: current ? state.data : undefined,
    error: current ? state.error : null,
    loading: path !== null && !current,
    reload,
  };
}

/** The message to show for a failed request: the rule the server named, or a plain fallback. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    const detail = error.detail as { message?: string } | string | undefined;
    if (detail && typeof detail === "object" && detail.message) return detail.message;
    return error.message;
  }
  if (error instanceof TypeError) return "Can't reach the server. Check your connection and try again.";
  return "Something went wrong. Try again.";
}

/** Upload a photo or signature (multipart) and get back its id and a short-lived view link. */
export function useUpload() {
  const getToken = useGetToken();
  return useCallback(
    async (file: Blob, fields: Record<string, string>) => {
      const token = await getToken();
      const form = new FormData();
      form.append("file", file, file instanceof File ? file.name : "image.jpg");
      for (const [k, v] of Object.entries(fields)) form.append(k, v);
      const base = (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/+$/, "");
      const res = await fetch(`${base}/api/v1/attachments`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: form,
      });
      if (!res.ok) throw new ApiError(res.status, `Upload failed (${res.status})`);
      return (await res.json()) as { attachment_id: string; url: string };
    },
    [getToken],
  );
}

/** Make a photo small enough for a phone on a weak connection (longest side 1280 px, JPEG). */
export async function shrinkImage(file: File, maxSide = 1280, quality = 0.7): Promise<Blob> {
  if (!file.type.startsWith("image/")) return file;
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b ?? file), "image/jpeg", quality));
}
