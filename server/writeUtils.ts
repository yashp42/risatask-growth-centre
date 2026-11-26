import crypto from 'node:crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { PoolClient } from 'pg';
import { resolveMemberRoles, type AuthDependencies } from './auth.ts';
import {
  withActorTransaction,
  type DatabasePoolState,
  type VerifiedActor,
} from './db.ts';
import { AppApiError, mapPgErrorToAppError } from './errors.ts';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function generatePrefixedId(prefix: string, length = 10): string {
  const bytes = crypto.randomBytes(length);
  let suffix = '';
  for (let i = 0; i < length; i += 1) {
    suffix += BASE32_ALPHABET[bytes[i] % BASE32_ALPHABET.length];
  }
  return `${prefix}${suffix}`;
}

export interface WritableEditionInfo {
  editionId: string;
  recordClass: 'live' | 'simulated';
}

export function extractRequestedEditionAndClass(
  req: Request,
  defaultEditionId: string
): {
  editionId: string;
  requestedRecordClass: string | null;
} {
  const body =
    req.body && typeof req.body === 'object' && !Array.isArray(req.body)
      ? (req.body as Record<string, unknown>)
      : {};

  const bodyEdition =
    typeof body.editionId === 'string' && body.editionId.trim()
      ? body.editionId.trim()
      : typeof body.edition_id === 'string' && body.edition_id.trim()
        ? body.edition_id.trim()
        : null;

  const queryEdition =
    typeof req.query.editionId === 'string' && req.query.editionId.trim()
      ? req.query.editionId.trim()
      : typeof req.query.edition_id === 'string' && req.query.edition_id.trim()
        ? req.query.edition_id.trim()
        : null;

  const bodyClass =
    typeof body.recordClass === 'string' && body.recordClass.trim()
      ? body.recordClass.trim()
      : typeof body.record_class === 'string' && body.record_class.trim()
        ? body.record_class.trim()
        : null;

  const queryClass =
    typeof req.query.recordClass === 'string' && req.query.recordClass.trim()
      ? req.query.recordClass.trim()
      : typeof req.query.record_class === 'string' && req.query.record_class.trim()
        ? req.query.record_class.trim()
        : null;

  const requestedRecordClass = bodyClass ?? queryClass;
  let editionId = bodyEdition ?? queryEdition ?? '';

  if (!editionId) {
    if (requestedRecordClass === 'historical_synthetic') {
      editionId = 'ED-2025';
    } else if (requestedRecordClass === 'live') {
      editionId = 'ED-2026-LIVE';
    } else if (requestedRecordClass === 'simulated') {
      editionId = 'ED-2026-DEMO';
    } else {
      editionId = defaultEditionId;
    }
  }

  return { editionId, requestedRecordClass };
}

export function rejectHistoricalWriteRequest(
  editionId: string | null | undefined,
  recordClass: string | null | undefined
): void {
  if (
    editionId === 'ED-2025' ||
    recordClass === 'historical_synthetic' ||
    recordClass === 'external_research'
  ) {
    throw new AppApiError(
      403,
      'READ_ONLY_EDITION',
      'Writes are prohibited for historical synthetic or read-only editions (ED-2025).'
    );
  }
}

export async function resolveWritableEdition(
  client: PoolClient,
  editionId: string,
  requestedRecordClass?: string | null
): Promise<WritableEditionInfo> {
  rejectHistoricalWriteRequest(editionId, requestedRecordClass);

  const res = await client.query<{
    edition_id: string;
    record_class: string;
  }>(
    `SELECT edition_id, record_class
       FROM public.festival_edition
      WHERE edition_id = $1
        AND NOT is_deleted
      LIMIT 1`,
    [editionId]
  );

  const row = res.rows[0];
  if (!row) {
    throw new AppApiError(
      404,
      'EDITION_NOT_FOUND',
      `Festival edition "${editionId}" was not found.`
    );
  }

  rejectHistoricalWriteRequest(row.edition_id, row.record_class);

  if (row.record_class !== 'live' && row.record_class !== 'simulated') {
    throw new AppApiError(
      403,
      'READ_ONLY_EDITION',
      `Edition ${row.edition_id} (${row.record_class}) does not accept operational writes.`
    );
  }

  if (requestedRecordClass && requestedRecordClass !== row.record_class) {
    throw new AppApiError(
      422,
      'RECORD_CLASS_MISMATCH',
      `Edition ${row.edition_id} holds record_class "${row.record_class}", not "${requestedRecordClass}".`
    );
  }

  return {
    editionId: row.edition_id,
    recordClass: row.record_class,
  };
}

export async function resolveWritableEditionByClass(
  client: PoolClient,
  recordClass: string,
  defaultEditionId: string
): Promise<WritableEditionInfo> {
  rejectHistoricalWriteRequest(null, recordClass);

  if (recordClass !== 'live' && recordClass !== 'simulated') {
    throw new AppApiError(
      403,
      'READ_ONLY_EDITION',
      `Record class "${recordClass}" is read-only.`
    );
  }

  const res = await client.query<{ edition_id: string; record_class: string }>(
    `SELECT edition_id, record_class
       FROM public.festival_edition
      WHERE record_class = $1
        AND NOT is_deleted
      ORDER BY (edition_id = $2) DESC, is_current DESC, edition_id ASC
      LIMIT 1`,
    [recordClass, defaultEditionId]
  );

  const row = res.rows[0];
  if (!row) {
    throw new AppApiError(
      404,
      'EDITION_NOT_FOUND',
      `No writable festival edition found for record_class "${recordClass}".`
    );
  }

  return {
    editionId: row.edition_id,
    recordClass: row.record_class as 'live' | 'simulated',
  };
}

export async function ensureUiImportBatch(
  client: PoolClient,
  editionId: string,
  recordClass: 'live' | 'simulated',
  memberId: string
): Promise<string> {
  const batchId = `IB-UI-${editionId}`;
  await client.query(
    `INSERT INTO public.import_batch (import_batch_id, batch_type, record_class, created_by)
     VALUES ($1, 'ui', $2, $3)
     ON CONFLICT (import_batch_id) DO NOTHING`,
    [batchId, recordClass, memberId]
  );
  return batchId;
}

export async function fetchAppDataVersion(client: PoolClient): Promise<number> {
  const res = await client.query<{ data_version: string | number }>(
    `SELECT data_version FROM public.app_state WHERE id = 1`
  );
  if (!res.rows[0]) {
    throw new AppApiError(
      503,
      'APP_STATE_EMPTY',
      'app_state row is missing; data_version could not be read.'
    );
  }
  return Number(res.rows[0].data_version);
}

export async function insertAuditEvent(
  client: PoolClient,
  params: {
    actorId: string;
    entity: string;
    entityId: string;
    operation: 'insert' | 'update' | 'delete' | 'ai_confirm' | 'ai_reject';
    after: Record<string, unknown>;
    dataVersion: number;
    recordClass: 'live' | 'simulated';
    importBatchId: string;
    sourceRef: string;
    evidenceClass?: 'D' | 'B' | 'A' | 'C' | 'T' | 'U';
  }
): Promise<string> {
  const auditId = `AUD-${crypto.randomUUID().replace(/-/g, '')}`;
  await client.query(
    `INSERT INTO public.audit_event (
       audit_id, actor_id, channel, entity, entity_id,
       operation, after, data_version, record_class,
       import_batch_id, source_ref, evidence_class, created_by
     ) VALUES (
       $1, $2, 'ui', $3, $4,
       $5, $6::jsonb, $7, $8,
       $9, $10, $11, $2
     )`,
    [
      auditId,
      params.actorId,
      params.entity,
      params.entityId,
      params.operation,
      JSON.stringify(params.after),
      params.dataVersion,
      params.recordClass,
      params.importBatchId,
      params.sourceRef,
      params.evidenceClass ?? 'T',
    ]
  );
  return auditId;
}

export async function runWriteTransaction<T>(
  actor: VerifiedActor,
  dbState: DatabasePoolState,
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  try {
    return await withActorTransaction(actor, fn, dbState);
  } catch (err) {
    if (err instanceof AppApiError) {
      throw err;
    }
    throw mapPgErrorToAppError(err);
  }
}

export function requireWriteRoles(authDeps: AuthDependencies): RequestHandler {
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

    const { editionId, requestedRecordClass } = extractRequestedEditionAndClass(
      req,
      authDeps.defaultEditionId
    );
    try {
      rejectHistoricalWriteRequest(editionId, requestedRecordClass);
    } catch (err) {
      next(err);
      return;
    }

    const roleEditionId =
      editionId === 'ED-2026-LIVE' ? 'ED-2026-LIVE' : authDeps.defaultEditionId;

    const resolution = await resolveMemberRoles(
      authDeps.dbState,
      req.authUser,
      roleEditionId
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

export async function isSponsorOwner(
  client: PoolClient,
  sponsorId: string,
  memberId: string,
  recordClass?: string
): Promise<boolean> {
  const params: unknown[] = [sponsorId, memberId];
  const classClause = recordClass ? ` AND record_class = $3` : '';
  if (recordClass) params.push(recordClass);

  const res = await client.query<{ owned: boolean }>(
    `SELECT EXISTS (
       SELECT 1
         FROM public.ownership_assignment
        WHERE subject_type = 'sponsor'
          AND subject_id = $1
          AND member_id = $2
          AND role_in_relationship = 'owner'
          AND valid_to IS NULL
          AND NOT is_deleted${classClause}
     ) AS owned`,
    params
  );
  return Boolean(res.rows[0]?.owned);
}

export async function getCurrentSponsorOwnerId(
  client: PoolClient,
  sponsorId: string,
  recordClass: string
): Promise<string | null> {
  const res = await client.query<{ member_id: string }>(
    `SELECT member_id
       FROM public.ownership_assignment
      WHERE subject_type = 'sponsor'
        AND subject_id = $1
        AND record_class = $2
        AND role_in_relationship = 'owner'
        AND valid_to IS NULL
        AND NOT is_deleted
      ORDER BY valid_from DESC, assignment_id DESC
      LIMIT 1`,
    [sponsorId, recordClass]
  );
  return res.rows[0]?.member_id ?? null;
}

export async function getOpportunityOwnerId(
  client: PoolClient,
  opportunityId: string
): Promise<string | null> {
  const res = await client.query<{ owner_member_id: string | null }>(
    `SELECT owner_member_id
       FROM public.opportunity_stage_version
      WHERE opportunity_id = $1
        AND NOT is_deleted
      ORDER BY valid_from DESC, history_id DESC
      LIMIT 1`,
    [opportunityId]
  );
  return res.rows[0]?.owner_member_id ?? null;
}

export function assertNumericFinite(
  value: unknown,
  fieldName: string
): number | null {
  if (value === undefined || value === null || value === '') return null;
  const num = Number(value);
  if (!Number.isFinite(num)) {
    throw new AppApiError(
      400,
      'INVALID_ARGUMENT',
      `${fieldName} must be a finite number.`
    );
  }
  return num;
}
