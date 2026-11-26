import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { ServerConfig } from './config.ts';
import {
  classifyPgError,
  type DatabasePoolState,
  type VerifiedActor,
} from './db.ts';
import { AppApiError } from './errors.ts';
import {
  isCanonicalRole,
  type CanonicalRole,
  type PermissionDecision,
} from './permissions.ts';

export interface AuthenticatedUser {
  auth_user_id: string;
  email: string | null;
  email_confirmed: boolean;
}

export interface ResolvedMemberRecord {
  member_id: string;
  full_name: string | null;
  email: string | null;
  roles: CanonicalRole[];
  unrecognized_roles: string[];
  edition_id: string | null;
  verified_by_server: true;
}

declare global {
  namespace Express {
    interface Request {
      authUser?: AuthenticatedUser;
      actor?: VerifiedActor;
      resolvedMember?: ResolvedMemberRecord;
      permissionDecision?: PermissionDecision;
    }
  }
}

export interface AuthDependencies {
  supabaseClient: SupabaseClient | null;
  createSessionClient?: (accessToken?: string) => SupabaseClient | null;
  authConfigured: boolean;
  dbState: DatabasePoolState;
  defaultEditionId: string;
}

export function createAuthDependencies(
  config: ServerConfig,
  dbState: DatabasePoolState
): AuthDependencies {
  if (!config.supabaseUrl || !config.supabasePublishableKey) {
    return {
      supabaseClient: null,
      createSessionClient: () => null,
      authConfigured: false,
      dbState,
      defaultEditionId: config.editionIdDefault,
    };
  }

  const supabaseUrl = config.supabaseUrl;
  const supabasePublishableKey = config.supabasePublishableKey;

  const createSessionClient = (accessToken?: string): SupabaseClient =>
    createClient(supabaseUrl, supabasePublishableKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      ...(accessToken
        ? {
            global: {
              headers: {
                Authorization: `Bearer ${accessToken}`,
              },
            },
          }
        : {}),
    });

  // Server-only client using public publishable key solely to verify user access
  // tokens via Supabase Auth (`/auth/v1/user`). Never uses service_role credentials.
  const supabaseClient = createSessionClient();

  return {
    supabaseClient,
    createSessionClient,
    authConfigured: true,
    dbState,
    defaultEditionId: config.editionIdDefault,
  };
}

export function extractBearerToken(req: Request): string | null {
  const header = req.header('authorization');
  if (!header) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  if (!match || !match[1]) return null;
  return match[1];
}

export type ActorResolutionResult =
  | {
      status: 'resolved';
      actor: VerifiedActor;
    }
  | {
      status: 'unavailable';
      httpStatus: 503;
      code: string;
      message: string;
    }
  | {
      status: 'forbidden';
      httpStatus: 403;
      code: string;
      message: string;
    };

/**
 * Resolves { authUserId, memberId } strictly from the verified Supabase
 * user id against active, non-deleted rows in public.team_member.
 * Never reads member_id, actor_id, or auth_user_id from request inputs.
 */
export async function resolveActor(
  dbState: DatabasePoolState,
  authUserId: string
): Promise<ActorResolutionResult> {
  if (!dbState.configured || !dbState.pool) {
    return {
      status: 'unavailable',
      httpStatus: 503,
      code: dbState.configured ? 'DB_UNAVAILABLE' : 'DATABASE_NOT_CONFIGURED',
      message: dbState.configured
        ? 'PostgreSQL connection pool is unavailable; actor identity cannot be resolved.'
        : 'DATABASE_URL is not configured; actor identity cannot be resolved.',
    };
  }

  try {
    const res = await dbState.pool.query<{ member_id: string }>(
      `SELECT member_id
         FROM public.team_member
        WHERE auth_user_id = $1
          AND is_active
          AND NOT is_deleted
        LIMIT 1`,
      [authUserId]
    );

    const memberId = res.rows[0]?.member_id;
    if (!memberId) {
      return {
        status: 'forbidden',
        httpStatus: 403,
        code: 'MEMBER_NOT_FOUND',
        message:
          'Authenticated account is not linked to an active team_member record.',
      };
    }

    return {
      status: 'resolved',
      actor: {
        authUserId,
        memberId,
      },
    };
  } catch (err) {
    const safeErr = classifyPgError(err);
    return {
      status: 'unavailable',
      httpStatus: 503,
      code: safeErr.code,
      message: safeErr.message,
    };
  }
}

/**
 * Returns the verified actor attached to req by requireAuth.
 * Never reads member_id, actor_id, or auth_user_id from body, query, or headers.
 */
export function getVerifiedActor(req: Request): VerifiedActor {
  if (!req.actor || !req.actor.memberId || !req.actor.authUserId) {
    throw new AppApiError(
      401,
      'AUTH_REQUIRED',
      'Verified actor identity is not present on the request.'
    );
  }
  return req.actor;
}

/**
 * Verifies the Bearer token server-side via Supabase Auth, then resolves
 * req.actor from public.team_member by verified auth_user_id.
 * Never trusts a decoded-but-unverified JWT, request body/query/headers,
 * and never invents default permissions.
 */
export function requireAuth(deps: AuthDependencies): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const token = extractBearerToken(req);
    if (!token) {
      next(
        new AppApiError(
          401,
          'AUTH_REQUIRED',
          'Authentication required. Provide a valid Authorization: Bearer token.'
        )
      );
      return;
    }

    if (!deps.authConfigured || !deps.supabaseClient) {
      next(
        new AppApiError(
          503,
          'AUTH_NOT_CONFIGURED',
          'Supabase authentication is not configured on the server; token cannot be verified.'
        )
      );
      return;
    }

    let authUser: AuthenticatedUser;
    try {
      const { data, error } = await deps.supabaseClient.auth.getUser(token);
      if (error || !data?.user?.id) {
        next(
          new AppApiError(
            401,
            'INVALID_TOKEN',
            'Authentication token is invalid or expired.'
          )
        );
        return;
      }

      authUser = {
        auth_user_id: data.user.id,
        email: data.user.email ?? null,
        email_confirmed: Boolean(data.user.email_confirmed_at),
      };
    } catch {
      next(
        new AppApiError(
          503,
          'AUTH_VERIFICATION_UNAVAILABLE',
          'Unable to verify authentication token against Supabase Auth.'
        )
      );
      return;
    }

    const actorResult = await resolveActor(deps.dbState, authUser.auth_user_id);
    if (actorResult.status !== 'resolved') {
      next(
        new AppApiError(
          actorResult.httpStatus,
          actorResult.code,
          actorResult.message
        )
      );
      return;
    }

    req.authUser = authUser;
    req.actor = actorResult.actor;
    next();
  };
}

export type RoleResolutionResult =
  | {
      status: 'resolved';
      member: ResolvedMemberRecord;
    }
  | {
      status: 'unavailable';
      httpStatus: 503;
      code: string;
      message: string;
    }
  | {
      status: 'unassigned';
      httpStatus: 403;
      code: string;
      message: string;
    };

/**
 * Resolves canonical roles from `team_member` joined to `role_assignment`.
 * Fails honestly when the database or canonical role directory is not provisioned,
 * and never invents default permissions.
 */
export async function resolveMemberRoles(
  dbState: DatabasePoolState,
  authUser: AuthenticatedUser,
  editionId: string
): Promise<RoleResolutionResult> {
  if (!dbState.configured || !dbState.pool) {
    return {
      status: 'unavailable',
      httpStatus: 503,
      code: dbState.configured
        ? 'DB_UNAVAILABLE'
        : 'DATABASE_NOT_CONFIGURED',
      message: dbState.configured
        ? 'PostgreSQL connection pool is unavailable; canonical role directory cannot be queried.'
        : 'DATABASE_URL is not configured; canonical role directory cannot be queried.',
    };
  }

  try {
    const tablesRes = await dbState.pool.query<{ table_name: string }>(
      `SELECT table_name
         FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = ANY($1::text[])`,
      [['team_member', 'role_assignment']]
    );

    const present = new Set(tablesRes.rows.map((r) => r.table_name));
    if (!present.has('team_member') || !present.has('role_assignment')) {
      return {
        status: 'unavailable',
        httpStatus: 503,
        code: 'ROLE_DIRECTORY_NOT_PROVISIONED',
        message:
          'Canonical team_member and role_assignment tables are not yet provisioned; role resolution is unavailable.',
      };
    }

    const colRes = await dbState.pool.query<{
      table_name: string;
      column_name: string;
    }>(
      `SELECT table_name, column_name
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = ANY($1::text[])`,
      [['team_member', 'role_assignment']]
    );

    const tmCols = new Set(
      colRes.rows
        .filter((r) => r.table_name === 'team_member')
        .map((r) => r.column_name)
    );
    const raCols = new Set(
      colRes.rows
        .filter((r) => r.table_name === 'role_assignment')
        .map((r) => r.column_name)
    );

    const hasAuthUserIdCol = tmCols.has('auth_user_id');
    const hasEmailCol = tmCols.has('email');
    const hasIsActiveCol = tmCols.has('is_active');
    const hasIsDeletedTm = tmCols.has('is_deleted');

    let memberRow:
      | {
          member_id: string;
          full_name: string | null;
          email: string | null;
        }
      | undefined;

    const tmFilters: string[] = [];
    if (hasIsActiveCol) tmFilters.push('COALESCE(is_active, true) = true');
    if (hasIsDeletedTm) tmFilters.push('COALESCE(is_deleted, false) = false');
    const tmActiveClause =
      tmFilters.length > 0 ? ` AND ${tmFilters.join(' AND ')}` : '';

    if (!hasAuthUserIdCol) {
      return {
        status: 'unavailable',
        httpStatus: 503,
        code: 'ROLE_DIRECTORY_LINK_UNAVAILABLE',
        message: 'team_member auth_user_id column is unavailable.',
      };
    }

    const res = await dbState.pool.query<{
      member_id: string;
      full_name: string | null;
      email: string | null;
    }>(
      `SELECT member_id,
              full_name,
              ${hasEmailCol ? 'email' : 'NULL::text AS email'}
         FROM public.team_member
        WHERE auth_user_id = $1${tmActiveClause}
        LIMIT 1`,
      [authUser.auth_user_id]
    );
    memberRow = res.rows[0];

    if (!memberRow) {
      return {
        status: 'unassigned',
        httpStatus: 403,
        code: 'MEMBER_NOT_FOUND',
        message:
          'Authenticated account is not linked to an active team_member record.',
      };
    }

    const raFilters: string[] = ['member_id = $1'];
    const raParams: unknown[] = [memberRow.member_id];

    if (raCols.has('edition_id')) {
      raParams.push(editionId);
      raFilters.push(`edition_id = $${raParams.length}`);
    }
    if (raCols.has('is_current')) {
      raFilters.push('COALESCE(is_current, true) = true');
    }
    if (raCols.has('valid_to')) {
      raFilters.push('valid_to IS NULL');
    }
    if (raCols.has('is_deleted')) {
      raFilters.push('COALESCE(is_deleted, false) = false');
    }

    const rolesRes = await dbState.pool.query<{ role: string }>(
      `SELECT role
         FROM public.role_assignment
        WHERE ${raFilters.join(' AND ')}`,
      raParams
    );

    const canonicalRoles: CanonicalRole[] = [];
    const unrecognizedRoles: string[] = [];

    for (const row of rolesRes.rows) {
      const normalized = String(row.role ?? '')
        .trim()
        .toLowerCase();
      if (!normalized) continue;
      if (isCanonicalRole(normalized)) {
        if (!canonicalRoles.includes(normalized)) {
          canonicalRoles.push(normalized);
        }
      } else {
        unrecognizedRoles.push(normalized);
      }
    }

    if (canonicalRoles.length === 0) {
      return {
        status: 'unassigned',
        httpStatus: 403,
        code: 'ROLE_NOT_ASSIGNED',
        message:
          'No canonical role assignment exists for this team member in the requested edition.',
      };
    }

    return {
      status: 'resolved',
      member: {
        member_id: memberRow.member_id,
        full_name: memberRow.full_name,
        email: memberRow.email,
        roles: canonicalRoles,
        unrecognized_roles: unrecognizedRoles,
        edition_id: editionId,
        verified_by_server: true,
      },
    };
  } catch (err) {
    const safeErr = classifyPgError(err);
    return {
      status: 'unavailable',
      httpStatus: 503,
      code: safeErr.code,
      message: safeErr.message,
    };
  }
}

export function requireResolvedRoles(deps: AuthDependencies): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction) => {
    if (!req.authUser) {
      next(
        new AppApiError(
          401,
          'AUTH_REQUIRED',
          'Authentication required before resolving roles.'
        )
      );
      return;
    }

    const editionParam =
      typeof req.query.edition_id === 'string' && req.query.edition_id.trim()
        ? req.query.edition_id.trim()
        : deps.defaultEditionId;

    const resolution = await resolveMemberRoles(
      deps.dbState,
      req.authUser,
      editionParam
    );

    if (resolution.status !== 'resolved') {
      next(
        new AppApiError(
          resolution.httpStatus,
          resolution.code,
          resolution.message
        )
      );
      return;
    }

    req.resolvedMember = resolution.member;
    next();
  };
}
