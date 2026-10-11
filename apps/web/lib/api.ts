'use client';

// Central REST client. The access token lives ONLY in memory (a module
// -level variable) — never in localStorage/sessionStorage, matching the
// security model in ARCHITECTURE.md §1: the long-lived credential is the
// HttpOnly cookie the browser holds automatically; this token is a
// deliberately short-lived (15 min), disposable value.

const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL ?? 'http://localhost:4000';

let accessToken: string | null = null;
let currentUser: { id: string; displayName: string } | null = null;
let refreshPromise: Promise<string | null> | null = null;

export function getAccessToken(): string | null {
  return accessToken;
}

export function getCurrentUser(): { id: string; displayName: string } | null {
  return currentUser;
}

async function refreshAccessToken(): Promise<string | null> {
  // Coalesce concurrent refresh attempts (e.g. two requests 401 at once)
  // into a single network call.
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    try {
      const res = await fetch(`${SERVER_URL}/api/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) return null;
      const body = await res.json();
      accessToken = body.accessToken;
      return accessToken;
    } catch {
      return null;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

/**
 * Establishes (or restores) the guest session. Safe to call on every app
 * load — the server resumes the existing user via the HttpOnly cookie if
 * one is present and valid, and only creates a new guest user otherwise.
 * See ARCHITECTURE.md §1.
 */
export async function bootstrapGuestSession(): Promise<{ id: string; displayName: string }> {
  const res = await fetch(`${SERVER_URL}/api/auth/guest`, {
    method: 'POST',
    credentials: 'include',
  });
  if (!res.ok) throw new Error('auth_failed');
  const body = await res.json();
  accessToken = body.accessToken;
  currentUser = body.user;
  return body.user;
}

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function parseErrorBody(res: Response): Promise<{ code: string; message: string }> {
  try {
    const body = await res.json();
    return { code: body.code ?? 'UNKNOWN', message: body.message ?? 'خطای غیرمنتظره رخ داد' };
  } catch {
    return { code: 'UNKNOWN', message: 'خطای غیرمنتظره رخ داد' };
  }
}

/** Fetch wrapper: attaches the bearer token, retries once through a silent refresh on 401. */
export async function apiFetch(path: string, init?: RequestInit, _isRetry = false): Promise<Response> {
  const headers = new Headers(init?.headers);
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
  if (init?.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');

  const res = await fetch(`${SERVER_URL}${path}`, { ...init, headers, credentials: 'include' });

  if (res.status === 401 && !_isRetry) {
    const refreshed = await refreshAccessToken();
    if (refreshed) return apiFetch(path, init, true);
  }

  return res;
}

export async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await apiFetch(path, init);
  if (!res.ok) {
    const { code, message } = await parseErrorBody(res);
    throw new ApiError(code, message, res.status);
  }
  return res.json();
}
