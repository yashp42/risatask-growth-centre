import { Pool, type PoolClient, type PoolConfig } from 'pg';
import type { ServerConfig } from './config.ts';
import { AppApiError } from './errors.ts';

export interface VerifiedActor {
  authUserId: string;
  memberId: string;
}

export interface DatabasePoolState {
  pool: Pool | null;
  configured: boolean;
  initErrorCode: string | null;
}

export interface DatabaseErrorDetail {
  code: string | null;
  message: string;
  hint?: string;
}

export interface DatabaseHealthReport {
  configured: boolean;
  connected: boolean;
  status: 'not_configured' | 'connection_failed' | 'schema_missing' | 'ready';
  tls: string | null;
  schema_ready: boolean;
  metrics_schema_ready: boolean;
  metrics_function_count: number;
  tables: {
    team_member: boolean;
    role_assignment: boolean;
    app_state: boolean;
    festival_edition: boolean;
    audit_event: boolean;
    metric_definition: boolean;
  };
  missing_tables: string[];
  error_code: string | null;
  error_detail: DatabaseErrorDetail | null;
  reason: string;
}

const REQUIRED_STAGE1_TABLES = [
  'team_member',
  'role_assignment',
  'app_state',
  'festival_edition',
  'audit_event',
  'metric_definition',
] as const;

export interface SafePgErrorInfo {
  code: string;
  message: string;
}

/**
 * Maps pg/network error codes to safe category messages that never reveal
 * connection strings, credentials, hostnames, or raw SQL.
 */
export function classifyPgError(err: unknown): SafePgErrorInfo {
  const rawCode =
    err && typeof err === 'object' && 'code' in err
      ? String((err as { code?: unknown }).code ?? '')
      : '';
  const rawMessage =
    err && typeof err === 'object' && 'message' in err
      ? String((err as { message?: unknown }).message ?? '')
      : '';

  if (rawCode === 'ECONNREFUSED') {
    return {
      code: 'CONNECTION_REFUSED',
      message: 'PostgreSQL connection was refused by the configured host.',
    };
  }
  if (
    rawCode === 'ENOTFOUND' ||
    rawCode === 'EAI_AGAIN' ||
    rawCode === 'ENETUNREACH' ||
    rawCode === 'EHOSTUNREACH'
  ) {
    return {
      code: 'HOST_UNREACHABLE',
      message: 'Configured PostgreSQL host could not be reached.',
    };
  }
  if (
    rawCode === 'SELF_SIGNED_CERT_IN_CHAIN' ||
    rawCode === 'DEPTH_ZERO_SELF_SIGNED_CERT' ||
    rawCode === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' ||
    rawCode === 'ERR_TLS_CERT_ALTNAME_INVALID'
  ) {
    return {
      code: 'TLS_ERROR',
      message: 'PostgreSQL TLS handshake failed.',
    };
  }
  if (
    rawCode === 'ETIMEDOUT' ||
    rawCode === 'ECONNRESET' ||
    /timeout/i.test(rawMessage)
  ) {
    return {
      code: 'CONNECTION_TIMEOUT',
      message: 'PostgreSQL connection attempt timed out.',
    };
  }
  if (rawCode === '28P01' || rawCode === '28000') {
    return {
      code: 'AUTH_FAILED',
      message: 'PostgreSQL rejected the configured database credentials.',
    };
  }
  if (rawCode === '3D000') {
    return {
      code: 'DATABASE_NOT_FOUND',
      message: 'Configured PostgreSQL database does not exist.',
    };
  }
  if (rawCode === '42P01') {
    return {
      code: 'TABLE_NOT_FOUND',
      message: 'Required database table has not been provisioned.',
    };
  }
  if (rawCode === '42883') {
    return {
      code: 'FUNCTION_NOT_FOUND',
      message: 'Required database function has not been provisioned.',
    };
  }
  if (rawCode === '42703') {
    return {
      code: 'COLUMN_NOT_FOUND',
      message: 'Expected schema column has not been provisioned.',
    };
  }
  if (rawCode === '42501') {
    return {
      code: 'PERMISSION_DENIED',
      message: 'Database role lacks permission for the requested query.',
    };
  }
  return {
    code: 'DB_UNAVAILABLE',
    message: 'PostgreSQL database is currently unreachable or unavailable.',
  };
}

interface PoolDiagnosticMeta {
  tlsLabel: string;
  isDirectSupabaseHost: boolean;
  redactTerms: string[];
}

const poolMetaMap = new WeakMap<DatabasePoolState, PoolDiagnosticMeta>();

function preparePgConnectionConfig(databaseUrl: string): {
  sanitizedConnectionString: string;
  ssl: PoolConfig['ssl'];
  meta: PoolDiagnosticMeta;
} {
  const parsed = new URL(databaseUrl);
  const host = parsed.hostname.toLowerCase();
  const isLoopback =
    host === 'localhost' || host === '127.0.0.1' || host === '::1';
  const isDirectSupabaseHost = /^db\.[^.]+\.supabase\.co$/i.test(host);

  const redactTerms: string[] = [];
  for (const raw of [
    parsed.hostname,
    parsed.username,
    parsed.password,
    decodeSafe(parsed.username),
    decodeSafe(parsed.password),
  ]) {
    if (raw && raw.length >= 2 && !redactTerms.includes(raw)) {
      redactTerms.push(raw);
    }
  }

  // Remove sslmode so pg does not override explicit ssl: { rejectUnauthorized: false }.
  parsed.searchParams.delete('sslmode');

  const ssl: PoolConfig['ssl'] = isLoopback
    ? false
    : { rejectUnauthorized: false };
  const tlsLabel = isLoopback
    ? 'disabled (loopback)'
    : 'encrypted, certificate not verified (demo)';

  return {
    sanitizedConnectionString: parsed.toString(),
    ssl,
    meta: {
      tlsLabel,
      isDirectSupabaseHost,
      redactTerms,
    },
  };
}

function decodeSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function sanitizePgErrorDetail(
  err: unknown,
  meta?: PoolDiagnosticMeta
): DatabaseErrorDetail {
  const rawCode =
    err && typeof err === 'object' && 'code' in err && (err as { code?: unknown }).code
      ? String((err as { code?: unknown }).code)
      : err && typeof err === 'object' && 'errno' in err && (err as { errno?: unknown }).errno
        ? String((err as { errno?: unknown }).errno)
        : null;

  let msg =
    err instanceof Error && err.message
      ? err.message
      : typeof err === 'string' && err
        ? err
        : 'PostgreSQL connection error';

  // Strip full connection URIs first.
  msg = msg.replace(/postgres(?:ql)?:\/\/[^\s'"]+/gi, '[redacted-url]');

  // Strip host, username, and password tokens if present.
  if (meta?.redactTerms) {
    for (const term of meta.redactTerms) {
      if (term) {
        msg = msg.split(term).join('[redacted]');
      }
    }
  }
  msg = msg.replace(/\b(user|role)\s+"[^"]+"/gi, '$1 "[redacted]"');

  msg = msg.replace(/\s+/g, ' ').trim().slice(0, 220);

  const detail: DatabaseErrorDetail = {
    code: rawCode,
    message: msg,
  };

  if (meta?.isDirectSupabaseHost) {
    detail.hint = 'direct host is IPv6-only; use the transaction pooler';
  }

  return detail;
}

let activePoolState: DatabasePoolState | null = null;

export function createDatabasePool(config: ServerConfig): DatabasePoolState {
  if (!config.databaseUrl) {
    activePoolState = {
      pool: null,
      configured: false,
      initErrorCode: null,
    };
    return activePoolState;
  }

  let prepared: ReturnType<typeof preparePgConnectionConfig>;
  try {
    prepared = preparePgConnectionConfig(config.databaseUrl);
  } catch (err) {
    const safeErr = classifyPgError(err);
    console.error(`[db] Pool URL parsing failed (${safeErr.code})`);
    activePoolState = {
      pool: null,
      configured: true,
      initErrorCode: safeErr.code,
    };
    return activePoolState;
  }

  try {
    const pool = new Pool({
      connectionString: prepared.sanitizedConnectionString,
      max: 10,
      min: 0,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      statement_timeout: 10_000,
      allowExitOnIdle: true,
      ssl: prepared.ssl,
    });

    pool.on('error', (err) => {
      const safeErr = classifyPgError(err);
      console.error(`[db] Idle pool error (${safeErr.code})`);
    });

    const state: DatabasePoolState = {
      pool,
      configured: true,
      initErrorCode: null,
    };
    poolMetaMap.set(state, prepared.meta);
    activePoolState = state;
    return state;
  } catch (err) {
    const safeErr = classifyPgError(err);
    console.error(`[db] Pool initialization failed (${safeErr.code})`);
    const state: DatabasePoolState = {
      pool: null,
      configured: true,
      initErrorCode: safeErr.code,
    };
    poolMetaMap.set(state, prepared.meta);
    activePoolState = state;
    return state;
  }
}

export function setDefaultDatabasePoolState(
  state: DatabasePoolState | null
): void {
  activePoolState = state;
}

function resolveTransactionPool(
  poolOrState?: Pool | DatabasePoolState
): Pool | null {
  if (!poolOrState) {
    return activePoolState?.pool ?? null;
  }
  if ('pool' in poolOrState) {
    return poolOrState.pool;
  }
  return poolOrState;
}

/**
 * Runs a database callback inside a single PostgreSQL transaction with
 * transaction-local actor identity bound via set_config(..., true).
 * Safe with transaction-mode poolers (port 6543).
 */
export async function withActorTransaction<T>(
  actor: VerifiedActor,
  fn: (client: PoolClient) => Promise<T>,
  poolOrState?: Pool | DatabasePoolState
): Promise<T> {
  if (
    !actor ||
    typeof actor.memberId !== 'string' ||
    actor.memberId.trim() === '' ||
    typeof actor.authUserId !== 'string' ||
    actor.authUserId.trim() === ''
  ) {
    throw new AppApiError(
      403,
      'ACTOR_REQUIRED',
      'A verified actor identity (memberId and authUserId) is required for database transactions.'
    );
  }

  const pool = resolveTransactionPool(poolOrState);
  if (!pool) {
    throw new AppApiError(
      503,
      'DATABASE_NOT_CONFIGURED',
      'PostgreSQL connection pool is unavailable.'
    );
  }

  const client = await pool.connect();
  let inTransaction = false;

  try {
    await client.query('BEGIN');
    inTransaction = true;
    await client.query(
      "SELECT set_config('app.actor_member_id', $1, true), set_config('app.actor_auth_uid', $2, true)",
      [actor.memberId, actor.authUserId]
    );
    const result = await fn(client);
    await client.query('COMMIT');
    inTransaction = false;
    return result;
  } catch (err) {
    if (inTransaction) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Preserve the original error that triggered rollback.
      }
    }
    throw err;
  } finally {
    client.release();
  }
}

export async function checkDatabaseHealth(
  state: DatabasePoolState
): Promise<DatabaseHealthReport> {
  const meta = poolMetaMap.get(state);
  const tlsLabel = state.configured
    ? meta?.tlsLabel ?? 'encrypted, certificate not verified (demo)'
    : null;

  const emptyTables: DatabaseHealthReport['tables'] = {
    team_member: false,
    role_assignment: false,
    app_state: false,
    festival_edition: false,
    audit_event: false,
    metric_definition: false,
  };

  if (!state.configured || !state.pool) {
    return {
      configured: state.configured,
      connected: false,
      status: state.configured ? 'connection_failed' : 'not_configured',
      tls: tlsLabel,
      schema_ready: false,
      metrics_schema_ready: false,
      metrics_function_count: 0,
      tables: emptyTables,
      missing_tables: [...REQUIRED_STAGE1_TABLES],
      error_code: state.configured
        ? state.initErrorCode ?? 'DB_INIT_FAILED'
        : 'DATABASE_NOT_CONFIGURED',
      error_detail: state.configured
        ? {
            code: state.initErrorCode ?? 'DB_INIT_FAILED',
            message: 'PostgreSQL connection pool could not be initialized.',
            ...(meta?.isDirectSupabaseHost
              ? { hint: 'direct host is IPv6-only; use the transaction pooler' }
              : {}),
          }
        : null,
      reason: state.configured
        ? 'PostgreSQL connection pool could not be initialized.'
        : 'DATABASE_URL is not configured on the server.',
    };
  }

  try {
    await state.pool.query('SELECT 1 AS ok');

    const tableRes = await state.pool.query<{ table_name: string }>(
      `SELECT table_name
         FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = ANY($1::text[])`,
      [[...REQUIRED_STAGE1_TABLES]]
    );

    const presentTables = new Set(tableRes.rows.map((r) => r.table_name));
    const tables: DatabaseHealthReport['tables'] = {
      team_member: presentTables.has('team_member'),
      role_assignment: presentTables.has('role_assignment'),
      app_state: presentTables.has('app_state'),
      festival_edition: presentTables.has('festival_edition'),
      audit_event: presentTables.has('audit_event'),
      metric_definition: presentTables.has('metric_definition'),
    };
    const missingTables = REQUIRED_STAGE1_TABLES.filter(
      (name) => !presentTables.has(name)
    );

    const metricsRes = await state.pool.query<{ count: string | number }>(
      `SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'metrics' AND p.proname ~ '^m_[0-9]{2}$'`
    );
    const metricCount = Number(metricsRes.rows[0]?.count ?? 0);
    const metricsSchemaReady = metricCount === 30;
    const schemaReady = missingTables.length === 0;

    return {
      configured: true,
      connected: true,
      status: schemaReady ? 'ready' : 'schema_missing',
      tls: tlsLabel,
      schema_ready: schemaReady,
      metrics_schema_ready: metricsSchemaReady,
      metrics_function_count: metricCount,
      tables,
      missing_tables: missingTables,
      error_code: schemaReady ? null : 'SCHEMA_NOT_PROVISIONED',
      error_detail: null,
      reason: schemaReady
        ? 'PostgreSQL connected and foundational tables are present.'
        : `PostgreSQL connected, but required canonical tables are not provisioned yet: ${missingTables.join(', ')}.`,
    };
  } catch (err) {
    const safeErr = classifyPgError(err);
    const errorDetail = sanitizePgErrorDetail(err, meta);
    return {
      configured: true,
      connected: false,
      status: 'connection_failed',
      tls: tlsLabel,
      schema_ready: false,
      metrics_schema_ready: false,
      metrics_function_count: 0,
      tables: emptyTables,
      missing_tables: [...REQUIRED_STAGE1_TABLES],
      error_code: safeErr.code,
      error_detail: errorDetail,
      reason: safeErr.message,
    };
  }
}

export async function closeDatabasePool(
  state: DatabasePoolState
): Promise<void> {
  if (activePoolState === state) {
    activePoolState = null;
  }
  if (!state.pool) return;
  try {
    await state.pool.end();
  } catch {
    // Ignore errors during shutdown cleanup.
  }
}
