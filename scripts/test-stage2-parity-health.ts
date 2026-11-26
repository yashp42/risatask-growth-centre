import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import express from 'express';
import type { Pool } from 'pg';
import type { AuthDependencies } from '../server/auth.ts';
import type { ServerConfig } from '../server/config.ts';
import type { DatabasePoolState } from '../server/db.ts';
import { apiErrorHandler } from '../server/errors.ts';
import { createFoundationApiRouter } from '../server/routes/foundation.ts';

interface RecordedPoolQuery {
  sql: string;
  params: unknown[] | undefined;
}

function createTestServerConfig(): ServerConfig {
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
    demoLoginEmail: null,
    demoLoginPassword: null,
    validationErrors: [],
    validationWarnings: [],
    readiness: {
      databaseConfigured: true,
      authConfigured: true,
      demoLoginEnabled: false,
      openrouterKeyConfigured: false,
      openrouterModelConfigured: false,
      openrouterFreeTierValid: false,
      paidFallbackAllowed: false,
      autoRoutingAllowed: false,
    },
  };
}

function createMockPgPool(options: {
  memberId?: string;
  fullName?: string;
  roles?: string[];
  parityRows?: Array<Record<string, unknown>>;
  metricsProcCount?: number | string;
  onParityError?: Error;
}) {
  const queries: RecordedPoolQuery[] = [];
  let connectCallCount = 0;

  const mockPool = {
    async connect() {
      connectCallCount += 1;
      throw new Error(
        'pool.connect() / withActorTransaction must NOT be called for read-only parity or health checks.'
      );
    },
    async query(sql: string, params?: unknown[]) {
      queries.push({ sql, params });

      if (sql === 'SELECT 1 AS ok') {
        return { rows: [{ ok: 1 }], rowCount: 1 };
      }

      if (
        sql.includes('FROM information_schema.tables') &&
        sql.includes("table_schema = 'public'")
      ) {
        return {
          rows: [
            { table_name: 'team_member' },
            { table_name: 'role_assignment' },
            { table_name: 'app_state' },
            { table_name: 'festival_edition' },
            { table_name: 'audit_event' },
            { table_name: 'metric_definition' },
          ],
          rowCount: 6,
        };
      }

      if (
        sql.includes('FROM pg_proc p') &&
        sql.includes('JOIN pg_namespace n ON n.oid = p.pronamespace')
      ) {
        return {
          rows: [{ count: String(options.metricsProcCount ?? 30) }],
          rowCount: 1,
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

      if (sql.includes('FROM public.team_member')) {
        const memberId = options.memberId ?? 'MEM-TEST-001';
        return {
          rows: [
            {
              member_id: memberId,
              full_name: options.fullName ?? 'Test Member',
              email: 'member@example.com',
            },
          ],
          rowCount: 1,
        };
      }

      if (sql.includes('FROM public.role_assignment')) {
        const rows = (options.roles ?? []).map((role) => ({ role }));
        return { rows, rowCount: rows.length };
      }

      if (sql === 'SELECT * FROM metrics.parity_2025();') {
        if (options.onParityError) {
          throw options.onParityError;
        }
        const rows = options.parityRows ?? [];
        return { rows, rowCount: rows.length };
      }

      return { rows: [], rowCount: 0 };
    },
  } as unknown as Pool;

  return {
    mockPool,
    queries,
    getConnectCallCount: () => connectCallCount,
  };
}

async function withTestApiServer(
  mockPool: Pool,
  fn: (baseUrl: string) => Promise<void>
) {
  const dbState: DatabasePoolState = {
    pool: mockPool,
    configured: true,
    initErrorCode: null,
  };
  const authDeps: AuthDependencies = {
    authConfigured: true,
    defaultEditionId: 'ED-2026-DEMO',
    dbState,
    supabaseClient: {
      auth: {
        async getUser(token: string) {
          if (token !== 'valid-jwt-token') {
            return {
              data: { user: null },
              error: { message: 'Invalid token' },
            };
          }
          return {
            data: {
              user: {
                id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
                email: 'member@example.com',
                email_confirmed_at: '2026-11-01T00:00:00Z',
              },
            },
            error: null,
          };
        },
      },
    } as unknown as AuthDependencies['supabaseClient'],
  };

  const app = express();
  app.use(express.json());
  app.use('/api', createFoundationApiRouter(createTestServerConfig(), dbState, authDeps));
  app.use('/api', apiErrorHandler);

  const server = http.createServer(app);
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('Failed to bind ephemeral HTTP server address.');
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

test('POST /api/admin/parity returns 403 for non-admin roles and never runs parity SQL', async () => {
  for (const role of ['viewer', 'pipeline_ops', 'partnerships', 'finance_collections']) {
    const { mockPool, queries, getConnectCallCount } = createMockPgPool({
      memberId: 'MEM-NON-ADMIN',
      roles: [role],
      parityRows: [{ metric_id: 'M-01', passed: true }],
    });

    await withTestApiServer(mockPool, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/admin/parity`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer valid-jwt-token',
          'content-type': 'application/json',
        },
      });
      const body = (await res.json()) as Record<string, unknown>;

      assert.equal(res.status, 403, `Expected 403 for role=${role}`);
      assert.equal(body.code, 'FORBIDDEN');
      assert.equal(
        queries.some((q) => q.sql.includes('parity_2025')),
        false,
        `parity_2025 must not be queried for role=${role}`
      );
      assert.equal(getConnectCallCount(), 0);
    });
  }
});

test('POST /api/admin/parity runs exact parity_2025() for coordination_lead/admin with zero arithmetic or actor transaction', async () => {
  const sampleRows = [
    {
      metric_id: 'M-01',
      label: 'Cash collected (INR)',
      expected: null,
      actual: null,
      computable: false,
      decimals: 2,
      passed: true,
      note: '2025 has no payment records; returns computable=false.',
      meta: { tolerance: 0.0001 },
    },
    {
      metric_id: 'M-06',
      label: 'Win rate',
      expected: 0.7894736842105263,
      actual: 0.7894736842105263,
      computable: true,
      decimals: 4,
      passed: true,
      note: 'Exact floating precision preserved',
      meta: { raw_numerator: 45, raw_denominator: 57 },
    },
    {
      metric_id: 'M-14',
      label: 'Cold conversion',
      expected: 0.123456789,
      actual: 0.129999999,
      computable: true,
      decimals: 4,
      passed: false,
      note: 'Simulated failure row to verify passed count vs total',
      meta: { raw_numerator: 13, raw_denominator: 100 },
    },
  ];

  for (const allowedRole of ['coordination_lead', 'admin']) {
    const { mockPool, queries, getConnectCallCount } = createMockPgPool({
      memberId: 'SIM-LEAD',
      roles: [allowedRole],
      parityRows: sampleRows,
    });

    await withTestApiServer(mockPool, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/admin/parity`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer valid-jwt-token',
          'content-type': 'application/json',
        },
      });
      const body = (await res.json()) as {
        passed: number;
        total: number;
        rows: Array<Record<string, unknown>>;
      };

      assert.equal(res.status, 200, `Expected 200 for role=${allowedRole}`);
      assert.equal(body.passed, 2);
      assert.equal(body.total, 3);
      assert.deepEqual(body.rows, sampleRows);
      assert.equal(body.rows[1]?.expected, 0.7894736842105263);
      assert.equal(body.rows[1]?.actual, 0.7894736842105263);

      const parityQuery = queries.find((q) =>
        q.sql.includes('metrics.parity_2025')
      );
      assert.ok(parityQuery);
      assert.equal(parityQuery.sql, 'SELECT * FROM metrics.parity_2025();');
      assert.equal(getConnectCallCount(), 0);
      assert.equal(
        queries.some((q) => /BEGIN|set_config|COMMIT/i.test(q.sql)),
        false
      );
    });
  }
});

test('GET /api/admin/health reports metrics check healthy iff pg_proc count for metrics.m_[0-9]{2} is 30', async () => {
  // Healthy case: 30 metric functions
  {
    const { mockPool, queries, getConnectCallCount } = createMockPgPool({
      metricsProcCount: '30',
    });

    await withTestApiServer(mockPool, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/admin/health`);
      const body = (await res.json()) as {
        database: { metrics_schema_ready: boolean; metrics_function_count: number };
        metrics: { status: string; healthy: boolean; count: number; expected: number };
      };

      assert.equal(res.status, 200);
      assert.equal(body.database.metrics_schema_ready, true);
      assert.equal(body.database.metrics_function_count, 30);
      assert.deepEqual(body.metrics, {
        status: 'healthy',
        healthy: true,
        count: 30,
        expected: 30,
      });

      const pgProcQuery = queries.find((q) => q.sql.includes('pg_proc'));
      assert.ok(pgProcQuery);
      assert.match(pgProcQuery.sql, /JOIN\s+pg_namespace/i);
      assert.match(pgProcQuery.sql, /n\.nspname\s*=\s*'metrics'/i);
      assert.match(pgProcQuery.sql, /p\.proname\s*~\s*'\^m_\[0-9\]\{2\}\$'/i);
      assert.equal(getConnectCallCount(), 0);
    });
  }

  // Unhealthy case: 29 metric functions
  {
    const { mockPool, getConnectCallCount } = createMockPgPool({
      metricsProcCount: '29',
    });

    await withTestApiServer(mockPool, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/admin/health`);
      const body = (await res.json()) as {
        database: { metrics_schema_ready: boolean; metrics_function_count: number };
        metrics: { status: string; healthy: boolean; count: number; expected: number };
      };

      assert.equal(res.status, 200);
      assert.equal(body.database.metrics_schema_ready, false);
      assert.equal(body.database.metrics_function_count, 29);
      assert.deepEqual(body.metrics, {
        status: 'unhealthy',
        healthy: false,
        count: 29,
        expected: 30,
      });
      assert.equal(getConnectCallCount(), 0);
    });
  }
});
