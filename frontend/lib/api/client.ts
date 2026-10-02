/**
 * Shared HTTP client for the backend API.
 *
 * - Auth is injected via `getToken` (Clerk's `useAuth().getToken` on the client,
 *   `(await auth()).getToken` on the server), so this module has no Clerk dependency.
 * - Every non-2xx response is thrown as an `ApiError`.
 */

export type GetToken = () => Promise<string | null>;

export class ApiError extends Error {
  readonly status: number;
  readonly detail: unknown;

  constructor(status: number, message: string, detail?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
  }
}

export type QueryParams = Record<string, string | number | boolean | null | undefined>;

export interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  query?: QueryParams;
  body?: unknown;
  signal?: AbortSignal;
  /** Omit for public endpoints. */
  getToken?: GetToken;
}

/** Options accepted by every API function that only needs cancellation support. */
export interface CallOptions {
  signal?: AbortSignal;
}

function getBaseUrl(): string {
  const API_BASE_URL =
  typeof window === "undefined"
    ? (process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL)
    : process.env.NEXT_PUBLIC_API_URL;
  if (!API_BASE_URL) {
    throw new Error("API_BASE_URL is not configured");
  }
  return `${API_BASE_URL.replace(/\/+$/, "")}/api/v1`;
}

function buildUrl(path: string, query?: QueryParams): string {
  const url = `${getBaseUrl()}${path}`;
  if (!query) return url;

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null) {
      params.set(key, String(value));
    }
  }
  const queryString = params.toString();
  return queryString ? `${url}?${queryString}` : url;
}

function formatDetail(detail: unknown, status: number): string {
  if (typeof detail === "string") return detail;

  // FastAPI validation errors (422): [{ loc, msg, type }, ...]
  if (Array.isArray(detail)) {
    const messages = detail
      .map((entry) => (entry && typeof entry === "object" && "msg" in entry ? String(entry.msg) : null))
      .filter((message): message is string => message !== null);
    if (messages.length > 0) return messages.join("; ");
  }

  return `Request failed with status ${status}`;
}

async function parseError(res: Response): Promise<ApiError> {
  let detail: unknown;
  try {
    const body: unknown = await res.json();
    if (body && typeof body === "object" && "detail" in body) {
      detail = body.detail;
    }
  } catch {
    // Non-JSON error body; fall back to the generic message.
  }
  return new ApiError(res.status, formatDetail(detail, res.status), detail);
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", query, body, signal, getToken } = options;

  const headers: Record<string, string> = { Accept: "application/json" };

  if (getToken) {
    const token = await getToken();
    if (!token) {
      throw new ApiError(401, "Not authenticated");
    }
    headers.Authorization = `Bearer ${token}`;
  }

  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  const res = await fetch(buildUrl(path, query), {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal,
  });

  if (!res.ok) {
    throw await parseError(res);
  }

  if (res.status === 204) {
    return undefined as T;
  }

  return (await res.json()) as T;
}

/** Like `apiRequest`, but resolves to `null` on 404 (expected "not found" outcome). */
export async function apiRequestOrNull<T>(path: string, options: RequestOptions = {}): Promise<T | null> {
  try {
    return await apiRequest<T>(path, options);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      return null;
    }
    throw error;
  }
}
