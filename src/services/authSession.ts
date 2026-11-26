export interface AuthSessionTokens {
  access_token: string;
  refresh_token: string;
  expires_at: number | null;
}

export interface PublicAppConfig {
  supabase_url: string | null;
  supabase_publishable_key: string | null;
  app_env: string;
  edition_id_default: string;
  auth_configured: boolean;
  demo_login_enabled: boolean;
}

export interface AuthenticatedMember {
  member_id: string;
  full_name: string | null;
  email: string | null;
  roles: string[];
  unrecognized_roles?: string[];
  edition_id: string | null;
  verified_by_server: boolean;
}

export interface AdminHealthResponse {
  status: 'ok' | 'degraded' | 'unhealthy';
  stage?: string;
  ready_for_operations: boolean;
  server: {
    status: string;
    node_env: string;
    app_env: string;
    edition_id_default: string;
    uptime_seconds: number;
  };
  database: {
    configured: boolean;
    connected: boolean;
    status: string;
    tls?: string | null;
    schema_ready: boolean;
    metrics_schema_ready: boolean;
    metrics_function_count: number;
    tables: Record<string, boolean>;
    missing_tables: string[];
    error_code: string | null;
    error_detail?: {
      code: string | null;
      message: string;
      hint?: string;
    } | null;
    reason: string;
  };
  metrics: {
    status: string;
    healthy: boolean;
    count: number;
    expected: number;
  };
  auth: {
    provider: string;
    configured: boolean;
    service_role_exposed: boolean;
    role_directory_provisioned: boolean;
  };
  llm?: {
    provider: string;
    orchestration_implemented: boolean;
    api_key_configured: boolean;
    model_configured: boolean;
    free_tier_verified: boolean;
  };
}

export interface ParityCheckResponse {
  passed: number;
  total: number;
  rows: Array<Record<string, unknown>>;
}

const SESSION_STORAGE_KEY = 'sgp.auth.session';
const SIGNED_OUT_TAB_KEY = 'sgp.auth.signed_out_in_tab';

let memorySession: AuthSessionTokens | null = null;
let memorySignedOutInTab = false;
let inFlightRefresh: Promise<AuthSessionTokens | null> | null = null;
let inFlightDemoSignIn: Promise<AuthSessionTokens> | null = null;
const sessionListeners = new Set<(session: AuthSessionTokens | null) => void>();

function notifySessionListeners(session: AuthSessionTokens | null): void {
  for (const listener of sessionListeners) {
    listener(session);
  }
}

export function subscribeAuthSession(
  listener: (session: AuthSessionTokens | null) => void
): () => void {
  sessionListeners.add(listener);
  return () => {
    sessionListeners.delete(listener);
  };
}

function isValidTokenPayload(value: unknown): value is AuthSessionTokens {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.access_token === 'string' &&
    candidate.access_token.trim().length > 0 &&
    typeof candidate.refresh_token === 'string' &&
    candidate.refresh_token.trim().length > 0
  );
}

export function getAuthSession(): AuthSessionTokens | null {
  if (memorySession) {
    return memorySession;
  }
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    const raw = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isValidTokenPayload(parsed)) {
      window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
      return null;
    }
    memorySession = {
      access_token: parsed.access_token,
      refresh_token: parsed.refresh_token,
      expires_at:
        typeof parsed.expires_at === 'number' ? parsed.expires_at : null,
    };
    return memorySession;
  } catch {
    return null;
  }
}

export function setAuthSession(session: AuthSessionTokens | null): void {
  memorySession = session;
  if (typeof window !== 'undefined') {
    try {
      if (session) {
        window.sessionStorage.setItem(
          SESSION_STORAGE_KEY,
          JSON.stringify(session)
        );
      } else {
        window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
      }
    } catch {
      // Ignore sessionStorage availability constraints; memorySession remains active.
    }
  }
  notifySessionListeners(session);
}

export function clearAuthSession(): void {
  setAuthSession(null);
}

export function hasSignedOutInTab(): boolean {
  if (memorySignedOutInTab) {
    return true;
  }
  if (typeof window === 'undefined') {
    return false;
  }
  try {
    const flag = window.sessionStorage.getItem(SIGNED_OUT_TAB_KEY) === '1';
    if (flag) {
      memorySignedOutInTab = true;
    }
    return flag;
  } catch {
    return memorySignedOutInTab;
  }
}

export function markSignedOutInTab(signedOut: boolean): void {
  memorySignedOutInTab = signedOut;
  if (typeof window !== 'undefined') {
    try {
      if (signedOut) {
        window.sessionStorage.setItem(SIGNED_OUT_TAB_KEY, '1');
      } else {
        window.sessionStorage.removeItem(SIGNED_OUT_TAB_KEY);
      }
    } catch {
      // Ignore sessionStorage availability constraints; memorySignedOutInTab remains active.
    }
  }
}

export function shouldAutoEnterDemo(params: {
  config: PublicAppConfig | null;
  hasExistingSession: boolean;
  signedOutInTab: boolean;
}): boolean {
  return Boolean(
    params.config?.demo_login_enabled &&
      !params.hasExistingSession &&
      !params.signedOutInTab
  );
}

async function refreshSessionOnce(): Promise<AuthSessionTokens | null> {
  if (inFlightRefresh) {
    return inFlightRefresh;
  }

  const current = getAuthSession();
  if (!current?.refresh_token) {
    clearAuthSession();
    return null;
  }

  inFlightRefresh = (async () => {
    try {
      const response = await fetch('/api/auth/refresh', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ refresh_token: current.refresh_token }),
      });

      if (!response.ok || !isJsonResponse(response)) {
        clearAuthSession();
        return null;
      }

      const body = (await response.json()) as Partial<AuthSessionTokens>;
      if (!isValidTokenPayload(body)) {
        clearAuthSession();
        return null;
      }

      const nextSession: AuthSessionTokens = {
        access_token: body.access_token,
        refresh_token: body.refresh_token,
        expires_at:
          typeof body.expires_at === 'number' ? body.expires_at : null,
      };
      setAuthSession(nextSession);
      return nextSession;
    } catch {
      clearAuthSession();
      return null;
    } finally {
      inFlightRefresh = null;
    }
  })();

  return inFlightRefresh;
}

function isJsonResponse(response: Response): boolean {
  const contentType = response.headers.get('content-type') ?? '';
  return contentType.toLowerCase().includes('application/json');
}

export function buildNonJsonErrorMessage(
  method: string,
  url: string,
  response: Response,
  isDev = Boolean(
    (import.meta as { env?: { DEV?: boolean } }).env?.DEV
  )
): string {
  if (!isDev) {
    return `Server not reachable (HTTP ${response.status})`;
  }
  const ct = (response.headers.get('content-type') ?? '').toLowerCase();
  const kind = ct.includes('text/html') ? 'HTML' : 'non-JSON';
  return `Server not reachable: ${method.toUpperCase()} ${url} returned ${kind} (${response.status})`;
}

async function parseJsonResponse<T>(
  response: Response,
  method = 'GET',
  url = '/api'
): Promise<T> {
  if (!isJsonResponse(response)) {
    throw new Error(buildNonJsonErrorMessage(method, url, response));
  }
  return (await response.json()) as T;
}

function resolveRequestPath(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.pathname;
  return input.url;
}

function assertRelativeApiPath(input: RequestInfo | URL): void {
  if (typeof input === 'string') {
    if (
      input.startsWith('http://') ||
      input.startsWith('https://') ||
      input.startsWith('//')
    ) {
      throw new Error('API requests must use relative same-origin paths.');
    }
  }
}

function buildHeadersWithBearer(
  baseHeaders: HeadersInit | undefined,
  accessToken: string | null
): Headers {
  const headers = new Headers(baseHeaders);
  if (accessToken && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${accessToken}`);
  }
  return headers;
}

/**
 * Authenticated fetch wrapper for all /api/* requests.
 * Uses same-origin relative paths and credentials: 'same-origin',
 * sends Authorization: Bearer from memory/sessionStorage,
 * refreshes once on 401 via POST /api/auth/refresh, and clears session on failure.
 */
export async function apiFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  assertRelativeApiPath(input);
  const path = resolveRequestPath(input);
  const isApiCall = path.startsWith('/api') || path.includes('/api/');
  const isAuthLifecycleEndpoint =
    path.includes('/api/auth/demo') ||
    path.includes('/api/auth/refresh') ||
    path.includes('/api/auth/logout');

  const session = getAuthSession();
  const headers = buildHeadersWithBearer(
    init?.headers,
    isApiCall && session ? session.access_token : null
  );

  const response = await fetch(input, {
    ...init,
    credentials: 'same-origin',
    headers,
  });

  if (
    response.status === 401 &&
    isApiCall &&
    !isAuthLifecycleEndpoint &&
    session?.refresh_token
  ) {
    const refreshed = await refreshSessionOnce();
    if (!refreshed) {
      return response;
    }

    const retryHeaders = new Headers(init?.headers);
    retryHeaders.set('Authorization', `Bearer ${refreshed.access_token}`);
    const retryResponse = await fetch(input, {
      ...init,
      credentials: 'same-origin',
      headers: retryHeaders,
    });

    if (retryResponse.status === 401) {
      clearAuthSession();
    }
    return retryResponse;
  }

  return response;
}

export async function fetchPublicConfig(): Promise<PublicAppConfig> {
  const response = await fetch('/api/config', {
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  });
  if (!isJsonResponse(response)) {
    throw new Error(buildNonJsonErrorMessage('GET', '/api/config', response));
  }
  if (!response.ok) {
    throw new Error(`Server not reachable (HTTP ${response.status})`);
  }
  return parseJsonResponse<PublicAppConfig>(response, 'GET', '/api/config');
}

export async function signInWithDemoAccount(): Promise<AuthSessionTokens> {
  if (inFlightDemoSignIn) {
    return inFlightDemoSignIn;
  }

  inFlightDemoSignIn = (async () => {
    const response = await fetch('/api/auth/demo', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });

    if (!isJsonResponse(response)) {
      throw new Error(
        buildNonJsonErrorMessage('POST', '/api/auth/demo', response)
      );
    }

    if (!response.ok) {
      let message = 'Unable to sign in to the demo workspace.';
      try {
        const body = (await response.json()) as {
          message?: string;
          error?: string;
        };
        if (response.status === 429) {
          message =
            body.message ||
            'Too many demo sign-in attempts. Please wait a minute and try again.';
        } else if (response.status === 404) {
          message = 'Demo sign-in is disabled on this server.';
        } else if (body.error === 'demo_login_failed') {
          message = 'Demo sign-in failed. Check server auth configuration.';
        } else if (body.message) {
          message = body.message;
        }
      } catch {
        // Preserve generic message
      }
      throw new Error(message);
    }

    const tokens = await parseJsonResponse<Partial<AuthSessionTokens>>(
      response,
      'POST',
      '/api/auth/demo'
    );
    if (!isValidTokenPayload(tokens)) {
      throw new Error('Server returned an invalid authentication session.');
    }

    const session: AuthSessionTokens = {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: typeof tokens.expires_at === 'number' ? tokens.expires_at : null,
    };
    markSignedOutInTab(false);
    setAuthSession(session);
    return session;
  })();

  try {
    return await inFlightDemoSignIn;
  } finally {
    inFlightDemoSignIn = null;
  }
}

export async function fetchCurrentMember(): Promise<AuthenticatedMember> {
  const response = await apiFetch('/api/me', {
    headers: { Accept: 'application/json' },
  });

  if (!isJsonResponse(response)) {
    const err = new Error(
      buildNonJsonErrorMessage('GET', '/api/me', response)
    ) as Error & { status?: number };
    err.status = response.status;
    throw err;
  }

  if (!response.ok) {
    let message = 'Unable to verify your team membership.';
    try {
      const errBody = (await response.json()) as {
        message?: string;
        code?: string;
      };
      if (errBody.message) message = errBody.message;
    } catch {
      // Preserve fallback message
    }
    const err = new Error(message) as Error & { status?: number };
    err.status = response.status;
    throw err;
  }

  return parseJsonResponse<AuthenticatedMember>(response, 'GET', '/api/me');
}

export async function updateCurrentMemberName(
  fullName: string
): Promise<AuthenticatedMember> {
  const response = await apiFetch('/api/me', {
    method: 'PATCH',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ full_name: fullName }),
  });

  if (!isJsonResponse(response)) {
    throw new Error(buildNonJsonErrorMessage('PATCH', '/api/me', response));
  }

  if (!response.ok) {
    let message = 'Unable to update team member name.';
    try {
      const errBody = (await response.json()) as { message?: string };
      if (errBody.message) message = errBody.message;
    } catch {
      // Preserve fallback message
    }
    throw new Error(message);
  }

  return parseJsonResponse<AuthenticatedMember>(response, 'PATCH', '/api/me');
}

export async function signOutSession(): Promise<void> {
  markSignedOutInTab(true);
  const session = getAuthSession();
  try {
    await fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'same-origin',
      headers: session?.access_token
        ? { Authorization: `Bearer ${session.access_token}` }
        : undefined,
    });
  } catch {
    // Best-effort server signOut; always clear local tokens immediately.
  } finally {
    clearAuthSession();
  }
}

export async function fetchAdminHealth(): Promise<{
  httpStatus: number;
  payload: AdminHealthResponse;
}> {
  const response = await apiFetch('/api/admin/health', {
    headers: { Accept: 'application/json' },
  });
  const payload = await parseJsonResponse<AdminHealthResponse>(
    response,
    'GET',
    '/api/admin/health'
  );
  return { httpStatus: response.status, payload };
}

export async function runAdminParityCheck(): Promise<ParityCheckResponse> {
  const response = await apiFetch('/api/admin/parity', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
  });

  if (!isJsonResponse(response)) {
    throw new Error(
      buildNonJsonErrorMessage('POST', '/api/admin/parity', response)
    );
  }

  if (!response.ok) {
    let message = 'Parity check could not be completed.';
    try {
      const body = (await response.json()) as { message?: string };
      if (body.message) message = body.message;
    } catch {
      // Keep fallback message
    }
    throw new Error(message);
  }

  return parseJsonResponse<ParityCheckResponse>(
    response,
    'POST',
    '/api/admin/parity'
  );
}
