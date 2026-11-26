import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import {
  getPublicConfig,
  UNRESOLVED_DECISIONS,
  type ServerConfig,
} from '../config.ts';
import {
  extractBearerToken,
  getVerifiedActor,
  requireAuth,
  requireResolvedRoles,
  resolveMemberRoles,
  type AuthDependencies,
} from '../auth.ts';
import {
  checkDatabaseHealth,
  classifyPgError,
  withActorTransaction,
  type DatabasePoolState,
} from '../db.ts';
import { AppApiError, asyncHandler, sendJsonError } from '../errors.ts';

const DOCUMENTED_PENDING_PREFIXES = [
  '/metrics/query',
  '/reference',
  '/sponsors',
  '/contacts',
  '/campaigns',
  '/outreach',
  '/interactions',
  '/meetings',
  '/qualifications',
  '/opportunities',
  '/contracts',
  '/contract-lines',
  '/payment-schedule',
  '/invoices',
  '/receipts',
  '/receipt-allocations',
  '/tasks',
  '/task-dependencies',
  '/escalations',
  '/proposals',
  '/team-members',
  '/referrals',
  '/experiments',
  '/experiment-results',
  '/forecasts',
  '/exports',
  '/audit',
  '/ai',
  '/actions',
  '/overview',
  '/collections',
  '/search',
  '/attention-queue',
  '/pipeline',
] as const;

function matchesDocumentedPendingRoute(path: string): boolean {
  return DOCUMENTED_PENDING_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`)
  );
}

export function createFoundationApiRouter(
  config: ServerConfig,
  dbState: DatabasePoolState,
  authDeps: AuthDependencies,
  getLlmHealth?: () => Promise<Record<string, unknown>>
): Router {
  const router = Router();
  const authMiddleware = requireAuth(authDeps);
  const demoRateLimitBuckets = new Map<string, number[]>();
  const DEMO_RATE_LIMIT_MAX = 10;
  const DEMO_RATE_LIMIT_WINDOW_MS = 60_000;

  function checkDemoRateLimit(req: Request): {
    allowed: boolean;
    retryAfterSeconds: number;
  } {
    const clientIp =
      (typeof req.ip === 'string' && req.ip.trim()) ||
      req.socket?.remoteAddress ||
      'unknown';
    const now = Date.now();
    const cutoff = now - DEMO_RATE_LIMIT_WINDOW_MS;

    // Opportunistic cleanup so stale IP entries do not accumulate unboundedly.
    if (demoRateLimitBuckets.size > 500) {
      for (const [ip, timestamps] of demoRateLimitBuckets.entries()) {
        if (timestamps.every((ts) => ts <= cutoff)) {
          demoRateLimitBuckets.delete(ip);
        }
      }
    }

    const recent = (demoRateLimitBuckets.get(clientIp) ?? []).filter(
      (ts) => ts > cutoff
    );

    if (recent.length >= DEMO_RATE_LIMIT_MAX) {
      demoRateLimitBuckets.set(clientIp, recent);
      const oldest = recent[0] ?? now;
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((oldest + DEMO_RATE_LIMIT_WINDOW_MS - now) / 1000)
      );
      return { allowed: false, retryAfterSeconds };
    }

    recent.push(now);
    demoRateLimitBuckets.set(clientIp, recent);
    return { allowed: true, retryAfterSeconds: 0 };
  }

  router.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  // ---------------------------------------------------------------------------
  // 1. GET /api/config (public safe settings only; never secrets)
  // ---------------------------------------------------------------------------
  router.get('/config', (_req: Request, res: Response) => {
    res.status(200).json(getPublicConfig(config));
  });

  // ---------------------------------------------------------------------------
  // 1b. Auth session endpoints (server-side Supabase Auth; never exposes credentials)
  // ---------------------------------------------------------------------------
  router.post(
    '/auth/demo',
    asyncHandler(async (req: Request, res: Response) => {
      if (!config.demoLoginEmail || !config.demoLoginPassword) {
        sendJsonError(
          res,
          404,
          'DEMO_LOGIN_DISABLED',
          'Demo sign-in is not enabled on this server.'
        );
        return;
      }

      const rateStatus = checkDemoRateLimit(req);
      if (!rateStatus.allowed) {
        res.setHeader('Retry-After', String(rateStatus.retryAfterSeconds));
        sendJsonError(
          res,
          429,
          'RATE_LIMIT_EXCEEDED',
          'Too many demo sign-in attempts. Please wait a minute and try again.'
        );
        return;
      }

      const sessionClient =
        authDeps.createSessionClient?.() ?? authDeps.supabaseClient;
      if (!authDeps.authConfigured || !sessionClient) {
        res.status(502).json({ error: 'demo_login_failed' });
        return;
      }

      try {
        // Intentionally ignore req.body and req.query; always authenticate strictly
        // with server-configured DEMO_LOGIN_EMAIL / DEMO_LOGIN_PASSWORD.
        const { data, error } = await sessionClient.auth.signInWithPassword({
          email: config.demoLoginEmail,
          password: config.demoLoginPassword,
        });

        if (
          error ||
          !data?.session?.access_token ||
          !data?.session?.refresh_token
        ) {
          res.status(502).json({ error: 'demo_login_failed' });
          return;
        }

        res.status(200).json({
          access_token: data.session.access_token,
          refresh_token: data.session.refresh_token,
          expires_at: data.session.expires_at ?? null,
        });
      } catch {
        res.status(502).json({ error: 'demo_login_failed' });
      }
    })
  );

  router.post(
    '/auth/refresh',
    asyncHandler(async (req: Request, res: Response) => {
      const refreshToken =
        req.body &&
        typeof req.body === 'object' &&
        typeof (req.body as { refresh_token?: unknown }).refresh_token ===
          'string'
          ? (req.body as { refresh_token: string }).refresh_token.trim()
          : '';

      if (!refreshToken) {
        sendJsonError(
          res,
          400,
          'INVALID_REQUEST',
          'refresh_token is required.'
        );
        return;
      }

      const sessionClient =
        authDeps.createSessionClient?.() ?? authDeps.supabaseClient;
      if (!authDeps.authConfigured || !sessionClient) {
        sendJsonError(
          res,
          503,
          'AUTH_NOT_CONFIGURED',
          'Supabase authentication is not configured on the server.'
        );
        return;
      }

      try {
        const { data, error } = await sessionClient.auth.refreshSession({
          refresh_token: refreshToken,
        });

        if (
          error ||
          !data?.session?.access_token ||
          !data?.session?.refresh_token
        ) {
          sendJsonError(
            res,
            401,
            'REFRESH_FAILED',
            'Session could not be refreshed. Please sign in again.'
          );
          return;
        }

        res.status(200).json({
          access_token: data.session.access_token,
          refresh_token: data.session.refresh_token,
          expires_at: data.session.expires_at ?? null,
        });
      } catch {
        sendJsonError(
          res,
          401,
          'REFRESH_FAILED',
          'Session could not be refreshed. Please sign in again.'
        );
      }
    })
  );

  router.post(
    '/auth/logout',
    asyncHandler(async (req: Request, res: Response) => {
      const accessToken = extractBearerToken(req) ?? undefined;
      const sessionClient =
        authDeps.createSessionClient?.(accessToken) ?? authDeps.supabaseClient;
      if (authDeps.authConfigured && sessionClient) {
        try {
          await sessionClient.auth.signOut();
        } catch {
          // Best-effort signOut; always complete with 204.
        }
      }
      res.status(204).send();
    })
  );

  // ---------------------------------------------------------------------------
  // 2. GET /api/admin/health (server, DB connectivity, missing schema, readiness)
  // ---------------------------------------------------------------------------
  router.get(
    '/admin/health',
    asyncHandler(async (_req: Request, res: Response) => {
      const dbHealth = await checkDatabaseHealth(dbState);
      const readyForOperations =
        config.validationErrors.length === 0 &&
        config.readiness.authConfigured &&
        dbHealth.connected &&
        dbHealth.schema_ready;

      const overallStatus =
        dbHealth.configured && !dbHealth.connected
          ? 'unhealthy'
          : readyForOperations
            ? 'ok'
            : 'degraded';

      const httpStatus =
        dbHealth.configured && !dbHealth.connected ? 503 : 200;

      res.status(httpStatus).json({
        status: overallStatus,
        stage: '1A',
        ready_for_operations: readyForOperations,
        server: {
          status: 'ok',
          node_env: config.nodeEnv,
          app_env: config.appEnv,
          edition_id_default: config.editionIdDefault,
          uptime_seconds: Math.round(process.uptime()),
        },
        database: dbHealth,
        metrics: {
          status: !dbHealth.connected
            ? 'unavailable'
            : dbHealth.metrics_schema_ready
              ? 'healthy'
              : 'unhealthy',
          healthy: dbHealth.connected && dbHealth.metrics_schema_ready,
          count: dbHealth.metrics_function_count,
          expected: 30,
        },
        auth: {
          provider: 'supabase',
          configured: config.readiness.authConfigured,
          service_role_exposed: false,
          role_directory_provisioned:
            dbHealth.tables.team_member && dbHealth.tables.role_assignment,
        },
        llm: getLlmHealth
          ? await getLlmHealth()
          : {
              provider: 'openrouter',
              orchestration_implemented: false,
              api_key_configured: config.readiness.openrouterKeyConfigured,
              model_configured: config.readiness.openrouterModelConfigured,
              free_tier_verified: config.readiness.openrouterFreeTierValid,
              tools_supported: false,
              fallback_verified: config.readiness.openrouterFallbackValid ?? false,
              paid_fallback_allowed: false,
              auto_routing_allowed: false,
            },
        config_validation: {
          valid: config.validationErrors.length === 0,
          error_count: config.validationErrors.length,
          warning_count: config.validationWarnings.length,
          errors: config.validationErrors,
          warnings: config.validationWarnings,
        },
        open_decisions_count: UNRESOLVED_DECISIONS.length,
      });
    })
  );

  // ---------------------------------------------------------------------------
  // 3. GET /api/me (protected; verifies token & resolves role_assignment only when provisioned)
  // ---------------------------------------------------------------------------
  router.get(
    '/me',
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const authUser = req.authUser!;
      const requestedEdition =
        typeof req.query.edition_id === 'string' && req.query.edition_id.trim()
          ? req.query.edition_id.trim()
          : config.editionIdDefault;

      const resolution = await resolveMemberRoles(
        dbState,
        authUser,
        requestedEdition
      );

      if (resolution.status === 'unavailable') {
        sendJsonError(
          res,
          resolution.httpStatus,
          resolution.code,
          resolution.message,
          {
            authenticated: true,
            auth_user_id: authUser.auth_user_id,
            role_directory_provisioned: false,
            roles: null,
          }
        );
        return;
      }

      if (resolution.status === 'unassigned') {
        sendJsonError(
          res,
          resolution.httpStatus,
          resolution.code,
          resolution.message,
          {
            authenticated: true,
            auth_user_id: authUser.auth_user_id,
            role_directory_provisioned: true,
            roles: [],
          }
        );
        return;
      }

      res.status(200).json(resolution.member);
    })
  );

  const UpdateProfileBodySchema = z.object({
    full_name: z
      .string()
      .trim()
      .min(1, 'Name cannot be empty.')
      .max(120, 'Name must be 120 characters or fewer.'),
  });

  router.patch(
    '/me',
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const parsed = UpdateProfileBodySchema.safeParse(req.body);
      if (!parsed.success) {
        sendJsonError(
          res,
          400,
          'INVALID_REQUEST',
          parsed.error.issues[0]?.message || 'A valid full_name is required.'
        );
        return;
      }

      const actor = getVerifiedActor(req);
      const nextFullName = parsed.data.full_name;
      const requestedEdition =
        typeof req.query.edition_id === 'string' && req.query.edition_id.trim()
          ? req.query.edition_id.trim()
          : config.editionIdDefault;

      try {
        await withActorTransaction(
          actor,
          async (client) => {
            const currentRes = await client.query<{
              full_name: string;
              record_class: string;
              import_batch_id: string;
            }>(
              `SELECT full_name, record_class, import_batch_id
                 FROM public.team_member
                WHERE member_id = $1
                  AND is_active = true
                  AND is_deleted = false
                LIMIT 1`,
              [actor.memberId]
            );

            const existing = currentRes.rows[0];
            if (!existing) {
              throw new AppApiError(
                404,
                'MEMBER_NOT_FOUND',
                'Active team member record could not be found.'
              );
            }

            if (existing.full_name !== nextFullName) {
              await client.query(
                `UPDATE public.team_member
                    SET full_name = $1
                  WHERE member_id = $2
                    AND is_deleted = false`,
                [nextFullName, actor.memberId]
              );

              if (
                existing.record_class === 'live' ||
                existing.record_class === 'simulated'
              ) {
                const verRes = await client.query<{ data_version: string | number }>(
                  `SELECT data_version FROM public.app_state WHERE id = 1`
                );
                const dataVersion = Number(verRes.rows[0]?.data_version ?? 1);
                const auditId = `AUD-${crypto.randomUUID().replace(/-/g, '')}`;
                await client.query(
                  `INSERT INTO public.audit_event (
                     audit_id, actor_id, channel, entity, entity_id,
                     operation, after, data_version, record_class,
                     import_batch_id, source_ref, evidence_class, created_by
                   ) VALUES (
                     $1, $2, 'ui', 'TEAM_MEMBER', $3,
                     'update', $4::jsonb, $5, $6,
                     $7, 'ui:team_profile_update', 'T', $2
                   )`,
                  [
                    auditId,
                    actor.memberId,
                    actor.memberId,
                    JSON.stringify({
                      full_name: nextFullName,
                      previous_full_name: existing.full_name,
                    }),
                    dataVersion,
                    existing.record_class,
                    existing.import_batch_id,
                  ]
                );
              }
            }
          },
          dbState
        );
      } catch (err) {
        if (err instanceof AppApiError) {
          throw err;
        }
        const safeErr = classifyPgError(err);
        throw new AppApiError(503, safeErr.code, safeErr.message);
      }

      const resolution = await resolveMemberRoles(
        dbState,
        req.authUser!,
        requestedEdition
      );
      if (resolution.status !== 'resolved') {
        sendJsonError(
          res,
          resolution.httpStatus,
          resolution.code,
          resolution.message
        );
        return;
      }

      res.status(200).json(resolution.member);
    })
  );

  // ---------------------------------------------------------------------------
  // 4. GET /api/version (protected; returns data_version only when app_state exists)
  // ---------------------------------------------------------------------------
  router.get(
    '/version',
    authMiddleware,
    asyncHandler(async (_req: Request, res: Response) => {
      if (!dbState.configured || !dbState.pool) {
        sendJsonError(
          res,
          503,
          dbState.configured ? 'DB_UNAVAILABLE' : 'DATABASE_NOT_CONFIGURED',
          dbState.configured
            ? 'PostgreSQL connection pool is unavailable; data_version cannot be queried.'
            : 'DATABASE_URL is not configured; data_version is unavailable.',
          { data_version: null }
        );
        return;
      }

      try {
        const tableCheck = await dbState.pool.query<{ exists: boolean }>(
          `SELECT EXISTS (
             SELECT 1
               FROM information_schema.tables
              WHERE table_schema = 'public'
                AND table_name = 'app_state'
           ) AS exists`
        );

        if (!tableCheck.rows[0]?.exists) {
          sendJsonError(
            res,
            503,
            'APP_STATE_NOT_PROVISIONED',
            'Canonical app_state table is not provisioned; data_version is unavailable.',
            { data_version: null }
          );
          return;
        }

        const versionRes = await dbState.pool.query<{
          data_version: string | number | null;
          updated_at?: string | null;
        }>('SELECT data_version, updated_at FROM public.app_state LIMIT 1');

        const row = versionRes.rows[0];
        if (
          !row ||
          row.data_version === null ||
          row.data_version === undefined
        ) {
          sendJsonError(
            res,
            503,
            'APP_STATE_EMPTY',
            'app_state table has no initialized data_version row.',
            { data_version: null }
          );
          return;
        }

        res.status(200).json({
          data_version: row.data_version,
          updated_at: row.updated_at ?? null,
        });
      } catch (err) {
        const safeErr = classifyPgError(err);
        sendJsonError(res, 503, safeErr.code, safeErr.message, {
          data_version: null,
        });
      }
    })
  );

  // ---------------------------------------------------------------------------
  // 5. POST /api/admin/parity (Acceptance test A1; coordination_lead or admin)
  // ---------------------------------------------------------------------------
  router.post(
    '/admin/parity',
    authMiddleware,
    requireResolvedRoles(authDeps),
    asyncHandler(async (req: Request, res: Response) => {
      const roles = req.resolvedMember?.roles ?? [];
      if (!roles.includes('coordination_lead') && !roles.includes('admin')) {
        throw new AppApiError(
          403,
          'FORBIDDEN',
          'Requires coordination_lead or admin role to run parity checks.'
        );
      }

      if (!dbState.configured || !dbState.pool) {
        sendJsonError(
          res,
          503,
          dbState.configured ? 'DB_UNAVAILABLE' : 'DATABASE_NOT_CONFIGURED',
          dbState.configured
            ? 'PostgreSQL connection pool is unavailable; parity check cannot run.'
            : 'DATABASE_URL is not configured; parity check is unavailable.'
        );
        return;
      }

      try {
        const parityRes = await dbState.pool.query<Record<string, unknown>>(
          'SELECT * FROM metrics.parity_2025();'
        );
        const rows = parityRes.rows;
        const total = rows.length;
        const passed = rows.filter((row) => row?.passed === true).length;

        res.status(200).json({
          passed,
          total,
          rows,
        });
      } catch (err) {
        const safeErr = classifyPgError(err);
        sendJsonError(res, 503, safeErr.code, safeErr.message);
      }
    })
  );

  // ---------------------------------------------------------------------------
  // 6. Consistent JSON responses for hard-delete prohibitions, pending routes, & 404s
  // ---------------------------------------------------------------------------
  router.delete('/*', (req: Request, res: Response, next) => {
    if (!matchesDocumentedPendingRoute(req.path)) {
      sendJsonError(
        res,
        404,
        'NOT_FOUND',
        'Requested API endpoint does not exist.',
        { path: `/api${req.path}` }
      );
      return;
    }

    authMiddleware(req, res, (err?: unknown) => {
      if (err) {
        next(err);
        return;
      }
      sendJsonError(
        res,
        405,
        'HARD_DELETE_PROHIBITED',
        'Hard delete APIs are prohibited by platform data governance; use status archiving or versioning when implemented.'
      );
    });
  });

  router.all('/*', (req: Request, res: Response, next) => {
    if (!matchesDocumentedPendingRoute(req.path)) {
      sendJsonError(
        res,
        404,
        'NOT_FOUND',
        'Requested API endpoint does not exist.',
        { path: `/api${req.path}` }
      );
      return;
    }

    authMiddleware(req, res, (err?: unknown) => {
      if (err) {
        next(err);
        return;
      }
      sendJsonError(
        res,
        501,
        'NOT_IMPLEMENTED',
        'This endpoint belongs to a subsequent backend stage and is not yet provisioned.',
        { path: `/api${req.path}` }
      );
    });
  });

  return router;
}
