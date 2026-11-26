import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import express from 'express';
import type { Pool } from 'pg';
import type { AuthDependencies } from '../server/auth.ts';
import { loadServerConfig, type ServerConfig } from '../server/config.ts';
import {
  checkDatabaseHealth,
  createDatabasePool,
  sanitizePgErrorDetail,
  type DatabasePoolState,
} from '../server/db.ts';
import { apiErrorHandler } from '../server/errors.ts';
import { createFoundationApiRouter } from '../server/routes/foundation.ts';

function createConfig(overrides?: {
  demoLoginEmail?: string | null;
  demoLoginPassword?: string | null;
}): ServerConfig {
  const email =
    overrides && 'demoLoginEmail' in overrides
      ? overrides.demoLoginEmail ?? null
      : 'demo-sim-lead@example.invalid';
  const password =
    overrides && 'demoLoginPassword' in overrides
      ? overrides.demoLoginPassword ?? null
      : 'demo-secret-password-value';

  return {
    port: 3000,
    nodeEnv: 'test',
    appEnv: 'demo',
    editionIdDefault: 'ED-2026-DEMO',
    databaseUrl: 'postgres://mock:mock@127.0.0.1:5432/mock',
    supabaseUrl: 'https://example.supabase.co',
    supabasePublishableKey: 'sb_publishable_test_key',
    openrouterApiKey: null,
    openrouterModel: null,
    demoLoginEmail: email,
    demoLoginPassword: password,
    validationErrors: [],
    validationWarnings: [],
    readiness: {
      databaseConfigured: true,
      authConfigured: true,
      demoLoginEnabled: Boolean(email && password),
      openrouterKeyConfigured: false,
      openrouterModelConfigured: false,
      openrouterFreeTierValid: false,
      paidFallbackAllowed: false,
      autoRoutingAllowed: false,
    },
  };
}

function createMockDbPool() {
  let currentFullName = 'Demo Coordination Lead';
  const queries: Array<{ sql: string; params?: unknown[] }> = [];

  async function runQuery(sql: string, params?: unknown[]) {
    queries.push({ sql, params });
    if (sql.includes('FROM information_schema.tables')) {
      return {
        rows: [
          { table_name: 'team_member' },
          { table_name: 'role_assignment' },
        ],
        rowCount: 2,
      };
    }
    if (sql.includes('FROM information_schema.columns')) {
      return {
        rows: [
          { table_name: 'team_member', column_name: 'member_id' },
          { table_name: 'team_member', column_name: 'auth_user_id' },
          { table_name: 'team_member', column_name: 'full_name' },
          { table_name: 'team_member', column_name: 'email' },
          { table_name: 'team_member', column_name: 'is_active' },
          { table_name: 'team_member', column_name: 'is_deleted' },
          { table_name: 'role_assignment', column_name: 'member_id' },
          { table_name: 'role_assignment', column_name: 'edition_id' },
          { table_name: 'role_assignment', column_name: 'role' },
          { table_name: 'role_assignment', column_name: 'is_current' },
          { table_name: 'role_assignment', column_name: 'valid_to' },
          { table_name: 'role_assignment', column_name: 'is_deleted' },
        ],
        rowCount: 12,
      };
    }
    if (sql.includes('UPDATE public.team_member')) {
      currentFullName = String(params?.[0] ?? currentFullName);
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes('FROM public.team_member')) {
      return {
        rows: [
          {
            member_id: 'SIM-LEAD',
            full_name: currentFullName,
            email: 'demo-sim-lead@example.invalid',
            record_class: 'simulated',
            import_batch_id: 'IB-SIM-2026',
          },
        ],
        rowCount: 1,
      };
    }
    if (sql.includes('FROM public.app_state')) {
      return { rows: [{ data_version: 2 }], rowCount: 1 };
    }
    if (sql.includes('FROM public.role_assignment')) {
      return {
        rows: [{ role: 'coordination_lead' }, { role: 'admin' }],
        rowCount: 2,
      };
    }
    return { rows: [], rowCount: 0 };
  }

  return {
    queries,
    async connect() {
      return {
        query: runQuery,
        release() {},
      };
    },
    query: runQuery,
  } as unknown as Pool & { queries: Array<{ sql: string; params?: unknown[] }> };
}

async function withServer(
  options: {
    config: ServerConfig;
    signInImpl?: (creds: { email: string; password: string }) => Promise<unknown>;
    refreshImpl?: (args: { refresh_token: string }) => Promise<unknown>;
    signOutImpl?: () => Promise<unknown>;
  },
  fn: (baseUrl: string) => Promise<void>
) {
  const dbState: DatabasePoolState = {
    pool: createMockDbPool(),
    configured: true,
    initErrorCode: null,
  };

  const mockSupabaseClient = {
    auth: {
      async getUser(token: string) {
        if (token === 'demo-access-token' || token === 'refreshed-access-token') {
          return {
            data: {
              user: {
                id: '55555555-5555-4555-8555-555555555555',
                email: 'demo-sim-lead@example.invalid',
                email_confirmed_at: '2026-11-01T00:00:00Z',
              },
            },
            error: null,
          };
        }
        return { data: { user: null }, error: { message: 'Invalid JWT' } };
      },
      async signInWithPassword(creds: { email: string; password: string }) {
        if (options.signInImpl) {
          return options.signInImpl(creds);
        }
        return {
          data: {
            session: {
              access_token: 'demo-access-token',
              refresh_token: 'demo-refresh-token',
              expires_at: 1893456000,
            },
          },
          error: null,
        };
      },
      async refreshSession(args: { refresh_token: string }) {
        if (options.refreshImpl) {
          return options.refreshImpl(args);
        }
        return {
          data: {
            session: {
              access_token: 'refreshed-access-token',
              refresh_token: 'refreshed-refresh-token',
              expires_at: 1893459600,
            },
          },
          error: null,
        };
      },
      async signOut() {
        if (options.signOutImpl) {
          return options.signOutImpl();
        }
        return { error: null };
      },
    },
  } as unknown as AuthDependencies['supabaseClient'];

  const authDeps: AuthDependencies = {
    supabaseClient: mockSupabaseClient,
    createSessionClient: () => mockSupabaseClient,
    authConfigured: true,
    dbState,
    defaultEditionId: 'ED-2026-DEMO',
  };

  const app = express();
  app.set('trust proxy', 1);
  app.use('/api', express.json());
  app.use('/api', createFoundationApiRouter(options.config, dbState, authDeps));
  app.use('/api', apiErrorHandler);

  const server = http.createServer(app);
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('Failed to bind server');
  }
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    await fn(baseUrl);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
}

test('T1 & T2 & T3: unauthenticated /api/me returns 401; /api/auth/demo ignores body and returns tokens for /api/me SIM-LEAD', async () => {
  const capturedCreds: Array<{ email: string; password: string }> = [];
  const config = createConfig();

  await withServer(
    {
      config,
      async signInImpl(creds) {
        capturedCreds.push(creds);
        return {
          data: {
            session: {
              access_token: 'demo-access-token',
              refresh_token: 'demo-refresh-token',
              expires_at: 1893456000,
            },
          },
          error: null,
        };
      },
    },
    async (baseUrl) => {
      // T1: /api/me without session returns 401
      const unauthMe = await fetch(`${baseUrl}/api/me`);
      assert.equal(unauthMe.status, 401);

      // /api/config exposes demo_login_enabled: true and NEVER secrets
      const cfgRes = await fetch(`${baseUrl}/api/config`);
      assert.equal(cfgRes.status, 200);
      const cfgText = await cfgRes.text();
      assert.equal(cfgText.includes('demo-sim-lead@example.invalid'), false);
      assert.equal(cfgText.includes('demo-secret-password-value'), false);
      const cfgJson = JSON.parse(cfgText) as { demo_login_enabled: boolean };
      assert.equal(cfgJson.demo_login_enabled, true);

      // T3: POST /api/auth/demo with spoofed email/password/member_id still uses server DEMO_LOGIN_*
      const loginRes = await fetch(`${baseUrl}/api/auth/demo`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: 'attacker@evil.invalid',
          password: 'wrong-password',
          member_id: 'SPOOFED-MEMBER',
        }),
      });
      assert.equal(loginRes.status, 200);
      const tokens = (await loginRes.json()) as {
        access_token: string;
        refresh_token: string;
        expires_at: number;
      };
      assert.equal(tokens.access_token, 'demo-access-token');
      assert.equal(tokens.refresh_token, 'demo-refresh-token');
      assert.equal(tokens.expires_at, 1893456000);
      assert.deepEqual(capturedCreds, [
        {
          email: 'demo-sim-lead@example.invalid',
          password: 'demo-secret-password-value',
        },
      ]);

      // T2: /api/me with issued access_token returns SIM-LEAD with coordination_lead and admin
      const meRes = await fetch(`${baseUrl}/api/me`, {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      assert.equal(meRes.status, 200);
      const me = (await meRes.json()) as {
        member_id: string;
        roles: string[];
      };
      assert.equal(me.member_id, 'SIM-LEAD');
      assert.deepEqual(me.roles, ['coordination_lead', 'admin']);
    }
  );
});

test('T4: 11th POST /api/auth/demo within a minute from same IP returns 429', async () => {
  await withServer({ config: createConfig() }, async (baseUrl) => {
    for (let i = 1; i <= 10; i += 1) {
      const res = await fetch(`${baseUrl}/api/auth/demo`, { method: 'POST' });
      assert.equal(res.status, 200, `Request ${i} should succeed`);
    }
    const eleventh = await fetch(`${baseUrl}/api/auth/demo`, { method: 'POST' });
    assert.equal(eleventh.status, 429);
  });
});

test('T5: with DEMO_LOGIN_* unset, /api/config hides demo button and POST /api/auth/demo returns 404', async () => {
  const cfg = loadServerConfig({
    PORT: '3000',
    NODE_ENV: 'test',
    APP_ENV: 'demo',
    EDITION_ID_DEFAULT: 'ED-2026-DEMO',
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_ANON_KEY: 'sb_publishable_anon_alias',
  });
  assert.equal(cfg.demoLoginEmail, null);
  assert.equal(cfg.demoLoginPassword, null);
  assert.equal(cfg.supabasePublishableKey, 'sb_publishable_anon_alias');

  await withServer({ config: cfg }, async (baseUrl) => {
    const cfgRes = await fetch(`${baseUrl}/api/config`);
    const cfgJson = (await cfgRes.json()) as { demo_login_enabled: boolean };
    assert.equal(cfgJson.demo_login_enabled, false);

    const demoRes = await fetch(`${baseUrl}/api/auth/demo`, { method: 'POST' });
    assert.equal(demoRes.status, 404);
  });
});

test('POST /api/auth/demo returns 502 {error:"demo_login_failed"} without leaking Supabase error or email', async () => {
  await withServer(
    {
      config: createConfig(),
      async signInImpl() {
        return {
          data: { session: null },
          error: {
            message:
              'Invalid login credentials for demo-sim-lead@example.invalid',
          },
        };
      },
    },
    async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/auth/demo`, { method: 'POST' });
      assert.equal(res.status, 502);
      const text = await res.text();
      assert.equal(text.includes('Invalid login credentials'), false);
      assert.equal(text.includes('demo-sim-lead@example.invalid'), false);
      assert.deepEqual(JSON.parse(text), { error: 'demo_login_failed' });
    }
  );
});

test('POST /api/auth/refresh refreshes tokens and POST /api/auth/logout returns 204', async () => {
  let signOutCalled = false;
  await withServer(
    {
      config: createConfig(),
      async signOutImpl() {
        signOutCalled = true;
        return { error: null };
      },
    },
    async (baseUrl) => {
      const refreshRes = await fetch(`${baseUrl}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refresh_token: 'demo-refresh-token' }),
      });
      assert.equal(refreshRes.status, 200);
      const refreshed = (await refreshRes.json()) as {
        access_token: string;
        refresh_token: string;
      };
      assert.equal(refreshed.access_token, 'refreshed-access-token');
      assert.equal(refreshed.refresh_token, 'refreshed-refresh-token');

      const logoutRes = await fetch(`${baseUrl}/api/auth/logout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${refreshed.access_token}` },
      });
      assert.equal(logoutRes.status, 204);
      assert.equal(signOutCalled, true);
    }
  );
});

test('P1: unknown /api/xyz returns JSON 404 { error: "NOT_FOUND" } without auth', async () => {
  await withServer({ config: createConfig() }, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/xyz`);
    assert.equal(res.status, 404);
    assert.match(res.headers.get('content-type') ?? '', /application\/json/i);
    const body = (await res.json()) as { error: string };
    assert.equal(body.error, 'NOT_FOUND');
  });
});

test('Problem 2: sanitizePgErrorDetail strips host/user/password/URL and health reports tls + direct-host hint', async () => {
  const detail = sanitizePgErrorDetail(
    Object.assign(
      new Error(
        'connect ENETUNREACH postgres://app_service.projref:supersecretpass@db.projref.supabase.co:5432/postgres'
      ),
      { code: 'ENETUNREACH' }
    ),
    {
      tlsLabel: 'encrypted, certificate not verified (demo)',
      isDirectSupabaseHost: true,
      redactTerms: [
        'db.projref.supabase.co',
        'app_service.projref',
        'supersecretpass',
      ],
    }
  );

  assert.equal(detail.code, 'ENETUNREACH');
  assert.equal(detail.message.includes('supersecretpass'), false);
  assert.equal(detail.message.includes('app_service.projref'), false);
  assert.equal(detail.message.includes('db.projref.supabase.co'), false);
  assert.equal(
    detail.hint,
    'direct host is IPv6-only; use the transaction pooler'
  );

  // Verify createDatabasePool strips sslmode and sets tls label cleanly
  const cfgWithDirectUrl: ServerConfig = {
    ...createConfig(),
    databaseUrl:
      'postgresql://app_service.projref:supersecretpass@db.projref.supabase.co:5432/postgres?sslmode=require',
  };
  const dbState = createDatabasePool(cfgWithDirectUrl);
  assert.ok(dbState.pool);
  const poolOpts = (dbState.pool as unknown as { options: { connectionString: string; ssl: { rejectUnauthorized: boolean } } }).options;
  assert.equal(poolOpts.connectionString.includes('sslmode='), false);
  assert.deepEqual(poolOpts.ssl, { rejectUnauthorized: false });

  // Mock query failure to inspect checkDatabaseHealth error_detail + tls output
  dbState.pool.query = (async () => {
    throw Object.assign(
      new Error('connect ENETUNREACH db.projref.supabase.co:5432'),
      { code: 'ENETUNREACH' }
    );
  }) as unknown as typeof dbState.pool.query;

  const health = await checkDatabaseHealth(dbState);
  assert.equal(health.connected, false);
  assert.equal(health.tls, 'encrypted, certificate not verified (demo)');
  assert.equal(health.error_detail?.code, 'ENETUNREACH');
  assert.equal(
    health.error_detail?.hint,
    'direct host is IPv6-only; use the transaction pooler'
  );
  assert.equal(
    health.error_detail?.message.includes('db.projref.supabase.co'),
    false
  );
  await dbState.pool.end().catch(() => undefined);

  const authFailDetail = sanitizePgErrorDetail(
    Object.assign(
      new Error('password authentication failed for user "app_service.proj"'),
      { code: '28P01' }
    )
  );
  assert.equal(authFailDetail.code, '28P01');
  assert.equal(authFailDetail.message.includes('app_service.proj'), false);
  assert.match(authFailDetail.message, /user "\[redacted\]"/);
});

test('Client authSession: buildNonJsonErrorMessage formats dev vs prod messages without leaking body, and fetchPublicConfig uses relative URL + credentials: same-origin', async () => {
  const { buildNonJsonErrorMessage, fetchPublicConfig } = await import(
    '../src/services/authSession.ts'
  );

  const htmlResponse = new Response('<html><body>SecretBodyToken</body></html>', {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });

  const devMsg = buildNonJsonErrorMessage(
    'GET',
    '/api/config',
    htmlResponse,
    true
  );
  assert.equal(devMsg, 'Server not reachable: GET /api/config returned HTML (200)');
  assert.equal(devMsg.includes('SecretBodyToken'), false);

  const prodMsg = buildNonJsonErrorMessage(
    'GET',
    '/api/config',
    htmlResponse,
    false
  );
  assert.equal(prodMsg, 'Server not reachable (HTTP 200)');

  const originalFetch = globalThis.fetch;
  let capturedInput: RequestInfo | URL | undefined;
  let capturedInit: RequestInit | undefined;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    capturedInput = input;
    capturedInit = init;
    return new Response(
      JSON.stringify({
        supabase_url: 'https://example.supabase.co',
        supabase_publishable_key: 'sb_key',
        app_env: 'demo',
        edition_id_default: 'ED-2026-DEMO',
        auth_configured: true,
        demo_login_enabled: true,
      }),
      {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }
    );
  }) as typeof fetch;

  try {
    const cfg = await fetchPublicConfig();
    assert.equal(cfg.demo_login_enabled, true);
    assert.equal(capturedInput, '/api/config');
    assert.equal(capturedInit?.credentials, 'same-origin');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('PATCH /api/me requires auth, validates full_name, and updates team_member inside actor transaction', async () => {
  await withServer({ config: createConfig() }, async (baseUrl) => {
    const unauth = await fetch(`${baseUrl}/api/me`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ full_name: 'Yash Patil' }),
    });
    assert.equal(unauth.status, 401);

    const invalid = await fetch(`${baseUrl}/api/me`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        Authorization: 'Bearer demo-access-token',
      },
      body: JSON.stringify({ full_name: '   ' }),
    });
    assert.equal(invalid.status, 400);

    const updatedRes = await fetch(`${baseUrl}/api/me`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        Authorization: 'Bearer demo-access-token',
      },
      body: JSON.stringify({ full_name: 'Yash Patil' }),
    });
    assert.equal(updatedRes.status, 200);
    const updated = (await updatedRes.json()) as {
      member_id: string;
      full_name: string;
    };
    assert.equal(updated.member_id, 'SIM-LEAD');
    assert.equal(updated.full_name, 'Yash Patil');
  });
});

test('Auto-enter demo helper & tab sign-out suppression: auto-enters when unauthenticated and demo enabled, stays signed out after signOutSession until explicit signInWithDemoAccount', async () => {
  const {
    clearAuthSession,
    hasSignedOutInTab,
    markSignedOutInTab,
    shouldAutoEnterDemo,
    signInWithDemoAccount,
    signOutSession,
  } = await import('../src/services/authSession.ts');

  markSignedOutInTab(false);
  clearAuthSession();

  assert.equal(
    shouldAutoEnterDemo({
      config: {
        supabase_url: 'https://example.supabase.co',
        supabase_publishable_key: 'sb_key',
        app_env: 'demo',
        edition_id_default: 'ED-2026-DEMO',
        auth_configured: true,
        demo_login_enabled: true,
      },
      hasExistingSession: false,
      signedOutInTab: hasSignedOutInTab(),
    }),
    true
  );

  assert.equal(
    shouldAutoEnterDemo({
      config: {
        supabase_url: 'https://example.supabase.co',
        supabase_publishable_key: 'sb_key',
        app_env: 'demo',
        edition_id_default: 'ED-2026-DEMO',
        auth_configured: true,
        demo_login_enabled: false,
      },
      hasExistingSession: false,
      signedOutInTab: false,
    }),
    false
  );

  const originalFetch = globalThis.fetch;
  let demoCalls = 0;
  let logoutCalls = 0;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    if (input === '/api/auth/demo') {
      demoCalls += 1;
      return new Response(
        JSON.stringify({
          access_token: 'auto-demo-access',
          refresh_token: 'auto-demo-refresh',
          expires_at: 1893456000,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }
    if (input === '/api/auth/logout') {
      logoutCalls += 1;
      return new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected fetch URL: ${String(input)}`);
  }) as typeof fetch;

  try {
    // Concurrent signInWithDemoAccount calls should dedupe to a single POST /api/auth/demo
    const [s1, s2] = await Promise.all([
      signInWithDemoAccount(),
      signInWithDemoAccount(),
    ]);
    assert.equal(demoCalls, 1);
    assert.equal(s1.access_token, 'auto-demo-access');
    assert.equal(s2.access_token, 'auto-demo-access');
    assert.equal(hasSignedOutInTab(), false);

    // Signing out marks tab as signed out so auto-enter will NOT trigger on reload
    await signOutSession();
    assert.equal(logoutCalls, 1);
    assert.equal(hasSignedOutInTab(), true);
    assert.equal(
      shouldAutoEnterDemo({
        config: {
          supabase_url: 'https://example.supabase.co',
          supabase_publishable_key: 'sb_key',
          app_env: 'demo',
          edition_id_default: 'ED-2026-DEMO',
          auth_configured: true,
          demo_login_enabled: true,
        },
        hasExistingSession: false,
        signedOutInTab: hasSignedOutInTab(),
      }),
      false
    );

    // Explicit Enter demo clears the signed-out flag
    await signInWithDemoAccount();
    assert.equal(demoCalls, 2);
    assert.equal(hasSignedOutInTab(), false);
  } finally {
    globalThis.fetch = originalFetch;
    markSignedOutInTab(false);
    clearAuthSession();
  }
});
