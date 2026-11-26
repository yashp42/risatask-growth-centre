import assert from 'node:assert/strict';
import test from 'node:test';
import type { NextFunction, Request, Response } from 'express';
import type { Pool, PoolClient } from 'pg';
import {
  getVerifiedActor,
  requireAuth,
  type AuthDependencies,
} from '../server/auth.ts';
import {
  setDefaultDatabasePoolState,
  withActorTransaction,
  type DatabasePoolState,
} from '../server/db.ts';
import { AppApiError } from '../server/errors.ts';

interface RecordedQuery {
  sql: string;
  params: unknown[] | undefined;
}

function createMockPgPool(options?: {
  memberRows?: Array<{ member_id: string }>;
  onQuery?: (sql: string, params?: unknown[]) => void;
}) {
  const queries: RecordedQuery[] = [];
  let releaseCount = 0;

  const mockClient = {
    async query(sql: string, params?: unknown[]) {
      queries.push({ sql, params });
      options?.onQuery?.(sql, params);
      return { rows: [], rowCount: 0 };
    },
    release() {
      releaseCount += 1;
    },
  } as unknown as PoolClient;

  const mockPool = {
    async connect() {
      return mockClient;
    },
    async query(sql: string, params?: unknown[]) {
      queries.push({ sql, params });
      options?.onQuery?.(sql, params);
      if (sql.includes('FROM public.team_member')) {
        return {
          rows: options?.memberRows ?? [],
          rowCount: options?.memberRows?.length ?? 0,
        };
      }
      return { rows: [], rowCount: 0 };
    },
  } as unknown as Pool;

  return {
    mockPool,
    mockClient,
    queries,
    getReleaseCount: () => releaseCount,
  };
}

test('withActorTransaction calls BEGIN and set_config with verified actor before fn, then COMMIT and release', async () => {
  const { mockPool, queries, getReleaseCount } = createMockPgPool();
  const dbState: DatabasePoolState = {
    pool: mockPool,
    configured: true,
    initErrorCode: null,
  };
  setDefaultDatabasePoolState(dbState);

  const actor = {
    authUserId: '11111111-1111-4111-8111-111111111111',
    memberId: 'MEM-CL-001',
  };

  let queryCountBeforeFn = -1;
  try {
    const result = await withActorTransaction(actor, async (client) => {
      queryCountBeforeFn = queries.length;
      await client.query('INSERT INTO public.dummy VALUES ($1)', ['ok']);
      return { saved: true };
    });

    assert.deepEqual(result, { saved: true });
    assert.equal(queryCountBeforeFn, 2);
    assert.equal(queries[0]?.sql, 'BEGIN');
    assert.match(
      queries[1]?.sql ?? '',
      /SELECT\s+set_config\('app\.actor_member_id',\s*\$1,\s*true\),\s*set_config\('app\.actor_auth_uid',\s*\$2,\s*true\)/i
    );
    assert.deepEqual(queries[1]?.params, ['MEM-CL-001', '11111111-1111-4111-8111-111111111111']);
    assert.equal(queries[2]?.sql, 'INSERT INTO public.dummy VALUES ($1)');
    assert.equal(queries[3]?.sql, 'COMMIT');
    assert.equal(getReleaseCount(), 1);
  } finally {
    setDefaultDatabasePoolState(null);
  }
});

test('withActorTransaction executes ROLLBACK, rethrows error, and releases client when fn fails', async () => {
  const { mockPool, queries, getReleaseCount } = createMockPgPool();
  const actor = {
    authUserId: '22222222-2222-4222-8222-222222222222',
    memberId: 'MEM-FIN-002',
  };

  await assert.rejects(
    () =>
      withActorTransaction(
        actor,
        async (client) => {
          await client.query('UPDATE public.dummy SET x = 1');
          throw new Error('simulated business failure');
        },
        mockPool
      ),
    (err: unknown) =>
      err instanceof Error && err.message === 'simulated business failure'
  );

  assert.equal(queries[0]?.sql, 'BEGIN');
  assert.deepEqual(queries[1]?.params, ['MEM-FIN-002', '22222222-2222-4222-8222-222222222222']);
  assert.equal(queries[2]?.sql, 'UPDATE public.dummy SET x = 1');
  assert.equal(queries[3]?.sql, 'ROLLBACK');
  assert.equal(
    queries.some((q) => q.sql === 'COMMIT'),
    false
  );
  assert.equal(getReleaseCount(), 1);
});

test('request body, query, and custom headers containing actor_id/member_id/auth_user_id never change set_config values', async () => {
  const verifiedTokenUid = '33333333-3333-4333-8333-333333333333';
  const verifiedMemberId = 'MEM-OPS-003';
  const { mockPool, queries } = createMockPgPool({
    memberRows: [{ member_id: verifiedMemberId }],
  });

  const deps: AuthDependencies = {
    authConfigured: true,
    defaultEditionId: 'ED-2026-DEMO',
    dbState: {
      pool: mockPool,
      configured: true,
      initErrorCode: null,
    },
    supabaseClient: {
      auth: {
        async getUser(token: string) {
          assert.equal(token, 'valid-jwt-token');
          return {
            data: {
              user: {
                id: verifiedTokenUid,
                email: 'ops@example.com',
                email_confirmed_at: '2026-01-01T00:00:00Z',
              },
            },
            error: null,
          };
        },
      },
    } as unknown as AuthDependencies['supabaseClient'],
  };

  const reqHeaders: Record<string, string> = {
    authorization: 'Bearer valid-jwt-token',
    'x-actor-id': 'SPOOFED-HEADER-ACTOR',
    'x-member-id': 'SPOOFED-HEADER-MEMBER',
    'x-auth-user-id': '77777777-7777-4777-8777-777777777777',
  };

  const req = {
    body: {
      actor_id: 'SPOOFED-ACTOR-999',
      member_id: 'SPOOFED-MEMBER-999',
      auth_user_id: '99999999-9999-4999-8999-999999999999',
    },
    query: {
      actor_id: 'SPOOFED-QUERY-ACTOR',
      member_id: 'SPOOFED-QUERY-MEMBER',
      auth_user_id: '88888888-8888-4888-8888-888888888888',
    },
    headers: reqHeaders,
    header(name: string) {
      return reqHeaders[name.toLowerCase()];
    },
  } as unknown as Request;

  let nextErr: unknown;
  const middleware = requireAuth(deps);
  await middleware(req, {} as Response, ((err?: unknown) => {
    nextErr = err;
  }) as NextFunction);

  assert.equal(nextErr, undefined);
  assert.deepEqual(req.actor, {
    authUserId: verifiedTokenUid,
    memberId: verifiedMemberId,
  });

  await withActorTransaction(
    getVerifiedActor(req),
    async (client) => {
      await client.query('SELECT 1');
    },
    mockPool
  );

  const memberLookupQuery = queries.find((q) =>
    q.sql.includes('FROM public.team_member')
  );
  assert.ok(memberLookupQuery);
  assert.match(memberLookupQuery.sql, /WHERE\s+auth_user_id\s*=\s*\$1/i);
  assert.match(memberLookupQuery.sql, /AND\s+is_active/i);
  assert.match(memberLookupQuery.sql, /AND\s+NOT\s+is_deleted/i);
  assert.deepEqual(memberLookupQuery.params, [verifiedTokenUid]);

  const setConfigQuery = queries.find((q) => q.sql.includes('set_config'));
  assert.ok(setConfigQuery);
  assert.deepEqual(setConfigQuery.params, [verifiedMemberId, verifiedTokenUid]);
});

test('requireAuth returns 403 when no active non-deleted team_member matches verified auth_user_id', async () => {
  const { mockPool } = createMockPgPool({ memberRows: [] });

  const deps: AuthDependencies = {
    authConfigured: true,
    defaultEditionId: 'ED-2026-DEMO',
    dbState: {
      pool: mockPool,
      configured: true,
      initErrorCode: null,
    },
    supabaseClient: {
      auth: {
        async getUser() {
          return {
            data: {
              user: {
                id: '44444444-4444-4444-8444-444444444444',
                email: 'unlinked@example.com',
                email_confirmed_at: '2026-01-01T00:00:00Z',
              },
            },
            error: null,
          };
        },
      },
    } as unknown as AuthDependencies['supabaseClient'],
  };

  const reqHeaders: Record<string, string> = {
    authorization: 'Bearer valid-jwt-token',
  };

  const req = {
    body: { member_id: 'MEM-CL-001', actor_id: 'MEM-CL-001' },
    headers: reqHeaders,
    header(name: string) {
      return reqHeaders[name.toLowerCase()];
    },
  } as unknown as Request;

  let capturedError: unknown;
  const middleware = requireAuth(deps);
  await middleware(req, {} as Response, ((err?: unknown) => {
    capturedError = err;
  }) as NextFunction);

  assert.ok(capturedError instanceof AppApiError);
  assert.equal(capturedError.status, 403);
  assert.equal(capturedError.code, 'MEMBER_NOT_FOUND');
  assert.equal(req.actor, undefined);
});
