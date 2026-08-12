/** Thin typed API client with token handling and error normalisation. */

const TOKEN_KEY = 'kynox.token';
const USER_KEY = 'kynox.user';
const GUEST_SESSION_KEY = 'kynox.guestSession';

export interface SessionUser {
  id: number;
  email: string;
  name: string;
  role: string;
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function getUser(): SessionUser | null {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw) as SessionUser; } catch { return null; }
}

export function setSession(token: string, user: SessionUser): void {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

/** Records the resolved anonymous-guest identity for display/nav purposes only — never a token. */
export function setGuestUser(user: SessionUser): void {
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearSession(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

/** Stable per-browser id for an anonymous public-demo session (PUBLIC_DEMO_MODE only). */
function getOrCreateGuestSessionId(): string {
  let id = localStorage.getItem(GUEST_SESSION_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(GUEST_SESSION_KEY, id);
  }
  return id;
}

let publicConfigPromise: Promise<{ publicDemoMode: boolean }> | null = null;

/** Cached for the life of the tab — whether the backend allows anonymous access at all. */
export function getPublicConfig(): Promise<{ publicDemoMode: boolean }> {
  if (!publicConfigPromise) {
    publicConfigPromise = fetch('/api/config/public')
      .then((r) => (r.ok ? r.json() : { publicDemoMode: false }))
      .catch(() => ({ publicDemoMode: false }));
  }
  return publicConfigPromise;
}

export class ApiError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}

async function handle(res: Response): Promise<unknown> {
  if (res.status === 401) {
    clearSession();
    if (!location.pathname.startsWith('/login')) location.assign('/login');
  }
  const text = await res.text();
  let body: unknown = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!res.ok) {
    const message = (body as { error?: string })?.error ?? `Request failed (${res.status})`;
    throw new ApiError(res.status, message, (body as { details?: unknown })?.details);
  }
  return body;
}

function authHeaders(): Record<string, string> {
  const token = getToken();
  if (token) return { Authorization: `Bearer ${token}` };
  // No-op against a normal (non-demo) deployment — the backend only honours
  // this header when PUBLIC_DEMO_MODE is on; otherwise it's ignored and the
  // request 401s exactly as before.
  return { 'X-Guest-Session': getOrCreateGuestSessionId() };
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: authHeaders() });
  return handle(res) as Promise<T>;
}

export async function apiSend<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: { 'content-type': 'application/json', ...authHeaders() },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return handle(res) as Promise<T>;
}

export async function apiUpload<T>(path: string, file: File, fields: Record<string, string> = {}): Promise<T> {
  const form = new FormData();
  form.append('file', file);
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  const res = await fetch(path, { method: 'POST', headers: authHeaders(), body: form });
  return handle(res) as Promise<T>;
}

/** Downloads an authenticated export and triggers a browser save. */
export async function apiDownload(path: string, filename: string): Promise<void> {
  const res = await fetch(path, { headers: authHeaders() });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, (body as { error?: string }).error ?? 'Download failed');
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ---- Workspace dataset selection (persisted locally) -----------------------

const WS_KEY = 'kynox.workspace';

export interface Workspace {
  stockDatasetId: number | null;
  movementsDatasetId: number | null;
}

export function getWorkspace(): Workspace {
  try {
    return { stockDatasetId: null, movementsDatasetId: null, ...JSON.parse(localStorage.getItem(WS_KEY) ?? '{}') };
  } catch {
    return { stockDatasetId: null, movementsDatasetId: null };
  }
}

export function setWorkspace(ws: Workspace): void {
  localStorage.setItem(WS_KEY, JSON.stringify(ws));
  window.dispatchEvent(new Event('kynox-workspace-changed'));
}
