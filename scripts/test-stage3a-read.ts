import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import express from 'express';
import type { Pool } from 'pg';
import type { AuthDependencies } from '../server/auth.ts';
import type { ServerConfig } from '../server/config.ts';
import type { DatabasePoolState } from '../server/db.ts';
import { AppApiError, apiErrorHandler, mapPgErrorToAppError } from '../server/errors.ts';
import {
  addDaysIso,
  computeCashGateStatus,
  computeGateStatus,
  computeWeekEndDates,
  extractIstDateFromTimestamp,
  formatShortDisplayDate,
  getTodayIstIso,
} from '../server/gates.ts';
import {
  buildEnrichedReceipts,
  coerceMetricRow,
  createReadApiRouter,
  evaluateScopeAndRedaction,
  sanitizeMetricFilters,
} from '../server/routes/readApi.ts';
import { evaluateRuleBand } from '../server/ruleBands.ts';

function createTestConfig(): ServerConfig {
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

function createReadMockPool(options?: {
  userRole?: 'lead' | 'viewer';
  onMetricCall?: (metricId: string, recordClass: string, editionId: string, asOf: string) => unknown;
}) {
  const metricCalls: Array<{
    metricId: string;
    recordClass: string;
    editionId: string;
    asOf: string;
    filters: string;
  }> = [];

  async function runQuery(sql: string, params?: unknown[]) {
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
    if (sql.includes('FROM public.team_member')) {
      return {
        rows: [
          {
            member_id: 'SIM-LEAD',
            full_name: 'Demo Lead',
            email: 'lead@example.invalid',
            record_class: 'simulated',
            import_batch_id: 'IB-SIM-2026',
          },
        ],
        rowCount: 1,
      };
    }
    if (sql.includes('FROM public.role_assignment')) {
      return {
        rows: [{ role: options?.userRole === 'viewer' ? 'viewer' : 'coordination_lead' }],
        rowCount: 1,
      };
    }
    if (sql.includes('FROM public.festival_edition') && sql.includes('WHERE edition_id = $1')) {
      const edId = String(params?.[0] ?? 'ED-2026-DEMO');
      if (edId === 'ED-2025') {
        return {
          rows: [
            {
              edition_id: 'ED-2025',
              name: 'CampusFest 2025',
              record_class: 'historical_synthetic',
              starts_at: '2025-11-10',
              season_start: '2025-09-01',
              preseason_start: '2025-08-01',
              is_current: false,
            },
          ],
          rowCount: 1,
        };
      }
      return {
        rows: [
          {
            edition_id: 'ED-2026-DEMO',
            name: 'Demo season 2026-27',
            record_class: 'simulated',
            starts_at: '2027-01-09 10:00:00+05:30',
            season_start: '2026-10-26',
            preseason_start: '2026-09-28',
            is_current: true,
          },
        ],
        rowCount: 1,
      };
    }
    if (sql.includes('FROM public.festival_edition')) {
      return {
        rows: [
          {
            edition_id: 'ED-2026-DEMO',
            name: 'Demo season 2026-27',
            record_class: 'simulated',
            starts_at: '2027-01-09 10:00:00+05:30',
            season_start: '2026-10-26',
            preseason_start: '2026-09-28',
            is_current: true,
          },
          {
            edition_id: 'ED-2025',
            name: 'CampusFest 2025',
            record_class: 'historical_synthetic',
            starts_at: '2025-04-12 10:00:00+05:30',
            season_start: '2025-01-15',
            preseason_start: '2025-01-01',
            is_current: false,
          },
        ],
        rowCount: 2,
      };
    }
    if (sql.includes('FROM public.target_version')) {
      return {
        rows: [
          {
            target_id: 'TV-KG02',
            edition_id: 'ED-2026-DEMO',
            kpi_id: 'K-G-02',
            kpi_name: 'T-7 cash collection gate',
            metric_id: 'M-06',
            scenario_id: null,
            scenario_name: null,
            period: 'T-7',
            target_value: '0.85',
            decision_id: 'D-010',
            record_class: 'simulated',
          },
        ],
        rowCount: 1,
      };
    }
    if (sql.includes('FROM public.threshold_rule')) {
      return {
        rows: [
          {
            rule_id: 'EX-B2 (gate)',
            kpi_id: 'K-G-02',
            evaluate_at: 'T-7',
            keep_if: '>= 0.85',
            change_if: null,
            escalate_if: '< 0.85',
            response: 'Cash gate check',
            owner_role: 'finance_collections',
            decision_id: 'D-010',
            rule_status: 'active',
            kpi_name: 'T-7 cash collection gate',
            bet_id: 'B2',
            metric_id: 'M-06',
          },
          {
            rule_id: 'EX-B2',
            kpi_id: 'K-EX-B2',
            evaluate_at: 'weekly',
            keep_if: '>= 0.85',
            change_if: '0.74-0.85',
            escalate_if: '< 0.74',
            response: 'Follow up advance',
            owner_role: 'finance_collections',
            decision_id: 'D-010',
            rule_status: 'active',
            kpi_name: 'Advance within 7d',
            bet_id: 'B2',
            metric_id: 'M-25',
          },
        ],
        rowCount: 2,
      };
    }
    if (sql.includes('SELECT * FROM metrics.get_metric')) {
      const literalMatch = sql.match(/metrics\.get_metric\('([^']+)'/);
      let metricId: string;
      let recordClass: string;
      let editionId: string;
      let asOf: string;
      let filters: string;
      if (literalMatch) {
        metricId = literalMatch[1];
        [recordClass, editionId, asOf] = (params ?? []) as string[];
        filters = '{}';
      } else {
        [metricId, recordClass, editionId, asOf, filters] = (params ?? []) as string[];
      }
      metricCalls.push({ metricId, recordClass, editionId, asOf, filters });
      if (options?.onMetricCall) {
        options.onMetricCall(metricId, recordClass, editionId, asOf);
      }
      if (metricId === 'M-30') {
        return {
          rows: [
            {
              metric_id: 'M-30',
              value: '21.23',
              unit: '₹ lakh',
              numerator: null,
              denominator: null,
              computable: true,
              reason: null,
              applied_filters: {},
              series_key: 'SC-01',
              data_version: '4',
              as_of: asOf,
              edition_id: editionId,
              record_class: recordClass,
            },
            {
              metric_id: 'M-30',
              value: '26.10',
              unit: '₹ lakh',
              numerator: null,
              denominator: null,
              computable: true,
              reason: null,
              applied_filters: {},
              series_key: 'SC-02',
              data_version: '4',
              as_of: asOf,
              edition_id: editionId,
              record_class: recordClass,
            },
            {
              metric_id: 'M-30',
              value: '28.64',
              unit: '₹ lakh',
              numerator: null,
              denominator: null,
              computable: true,
              reason: null,
              applied_filters: {},
              series_key: 'SC-03',
              data_version: '4',
              as_of: asOf,
              edition_id: editionId,
              record_class: recordClass,
            },
          ],
          rowCount: 3,
        };
      }
      if (metricId === 'M-06' || metricId === 'M-25') {
        return {
          rows: [
            {
              metric_id: metricId,
              value: '0.35',
              unit: 'ratio',
              numerator: '222500',
              denominator: '640000',
              computable: true,
              reason: null,
              data_version: '4',
              as_of: asOf,
              edition_id: editionId,
              record_class: recordClass,
            },
          ],
          rowCount: 1,
        };
      }
      return {
        rows: [
          {
            metric_id: metricId,
            value: metricId === 'M-08' ? '1550000' : '900000',
            unit: 'INR',
            numerator: '1550000',
            denominator: null,
            computable: true,
            reason: null,
            data_version: '4',
            as_of: asOf,
            edition_id: editionId,
            record_class: recordClass,
          },
        ],
        rowCount: 1,
      };
    }
    return { rows: [], rowCount: 0 };
  }

  return {
    metricCalls,
    async connect() {
      return { query: runQuery, release() {} };
    },
    query: runQuery,
  } as unknown as Pool & {
    metricCalls: Array<{
      metricId: string;
      recordClass: string;
      editionId: string;
      asOf: string;
      filters: string;
    }>;
  };
}

async function withReadServer(
  options: {
    userRole?: 'lead' | 'viewer';
    onMetricCall?: (metricId: string, recordClass: string, editionId: string, asOf: string) => unknown;
  },
  fn: (baseUrl: string, pool: ReturnType<typeof createReadMockPool>) => Promise<void>
) {
  const pool = createReadMockPool({
    userRole: options.userRole,
    onMetricCall: options.onMetricCall,
  });
  const dbState: DatabasePoolState = {
    pool,
    configured: true,
    initErrorCode: null,
  };

  const mockSupabaseClient = {
    auth: {
      async getUser(token: string) {
        if (token === 'test-token') {
          return {
            data: {
              user: {
                id: '55555555-5555-4555-8555-555555555555',
                email: 'lead@example.invalid',
                email_confirmed_at: '2026-11-01T00:00:00Z',
              },
            },
            error: null,
          };
        }
        return { data: { user: null }, error: { message: 'Invalid token' } };
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
  app.use('/api', express.json());
  app.use('/api', createReadApiRouter(createTestConfig(), dbState, authDeps));
  app.use('/api', apiErrorHandler);

  const server = http.createServer(app);
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const addr = server.address();
  if (!addr || typeof addr === 'string') {
    server.close();
    throw new Error('Failed to bind server');
  }
  const baseUrl = `http://127.0.0.1:${addr.port}`;
  try {
    await fn(baseUrl, pool);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
}

test('sanitizeMetricFilters accepts allowed keys, drops "all"/null, and rejects unknown or invalid keys', () => {
  assert.deepEqual(sanitizeMetricFilters(undefined), {});
  assert.deepEqual(sanitizeMetricFilters(null), {});
  assert.deepEqual(
    sanitizeMetricFilters({
      campaign_id: 'CMP-01',
      channel_group: 'warm',
      bet_id: 'all',
      scenario_id: null,
    }),
    {
      campaign_id: 'CMP-01',
      channel_group: 'warm',
    }
  );

  for (const chGroup of ['warm', 'inbound', 'cold', 'renewal', 'premium']) {
    assert.deepEqual(sanitizeMetricFilters({ channel_group: chGroup }), {
      channel_group: chGroup,
    });
  }

  for (const badKey of ['owner_id', 'channel_id', 'category_id']) {
    assert.throws(
      () => sanitizeMetricFilters({ [badKey]: 'VAL-1' }),
      (err: unknown) => err instanceof AppApiError && err.status === 400
    );
  }

  assert.throws(
    () => sanitizeMetricFilters({ channel_group: 'unknown_channel' }),
    (err: unknown) => err instanceof AppApiError && err.status === 400
  );

  assert.throws(
    () => sanitizeMetricFilters(['campaign_id']),
    (err: unknown) => err instanceof AppApiError && err.status === 400
  );
});

test('mapPgErrorToAppError maps PostgreSQL SQLSTATE codes cleanly to HTTP errors', () => {
  const err42501 = mapPgErrorToAppError(Object.assign(new Error('permission denied for schema metrics'), { code: '42501' }));
  assert.equal(err42501.status, 403);
  assert.equal(err42501.code, 'PERMISSION_DENIED');

  const err22023 = mapPgErrorToAppError(Object.assign(new Error('invalid parameter value: owner_id'), { code: '22023' }));
  assert.equal(err22023.status, 400);
  assert.equal(err22023.code, 'INVALID_ARGUMENT');
  assert.match(err22023.message, /invalid parameter value/i);

  for (const code of ['23502', '23503', '23505', '23514']) {
    const mapped = mapPgErrorToAppError(
      Object.assign(
        new Error(`constraint ${code} failed for user "secret_role" postgres://u:p@host/db`),
        { code }
      )
    );
    assert.equal(mapped.status, 422);
    assert.equal(mapped.code, 'CONSTRAINT_VIOLATION');
    assert.equal(mapped.message.includes('secret_role'), false);
    assert.equal(mapped.message.includes('postgres://'), false);
  }
});

test('gates.ts computes IST week-end dates and evaluates gate statuses across all bands', () => {
  const weeks = computeWeekEndDates('2026-10-26', 10);
  assert.equal(weeks.length, 10);
  assert.equal(weeks[0]?.week_end, '2026-11-01');
  assert.equal(weeks[3]?.week_end, '2026-11-22');
  assert.equal(weeks[8]?.week_end, '2026-12-27');
  assert.equal(addDaysIso('2026-10-26', 6), '2026-11-01');

  assert.equal(computeGateStatus(2000000, 1200000, 1800000), 'on plan');
  assert.equal(computeGateStatus(1800000, 1200000, 1800000), 'on plan');
  assert.equal(
    computeGateStatus(1500000, 1200000, 1800000),
    'base trajectory: trigger B3/B4 contingencies'
  );
  assert.equal(
    computeGateStatus(1200000, 1200000, 1800000),
    'base trajectory: trigger B3/B4 contingencies'
  );
  assert.equal(computeGateStatus(1000000, 1200000, 1800000), 'below base gate');
  assert.equal(computeGateStatus(960000, 1200000, 1800000), 'below base gate');
  assert.equal(computeGateStatus(959999, 1200000, 1800000), 're-plan to downside');
  assert.equal(computeGateStatus(null, 1200000, 1800000), 'unavailable');

  assert.equal(
    extractIstDateFromTimestamp('2027-01-09 10:00:00+05:30'),
    '2027-01-09'
  );
  assert.equal(addDaysIso('2027-01-09', -7), '2027-01-02');
  assert.equal(formatShortDisplayDate('2027-01-02'), '2 Jan 2027');

  assert.equal(
    computeCashGateStatus(0.35, 0.85, {
      asOf: '2026-11-26',
      dueDate: '2027-01-02',
      isHistorical: false,
    }),
    'Not yet due: evaluated on 2 Jan 2027'
  );
  assert.equal(computeCashGateStatus(0.85, 0.85), 'keep');
  assert.equal(computeCashGateStatus(0.80, 0.85), 'escalate');
  assert.equal(computeCashGateStatus(0.74, 0.85), 'escalate');
  assert.equal(computeCashGateStatus(0.739, 0.85), 'escalate');
  assert.equal(computeCashGateStatus(null, 0.85), 'unavailable');

  assert.match(getTodayIstIso(new Date('2026-11-26T20:00:00Z')), /^2026-11-27$/);
});

test('ruleBands.ts evaluates canonical D-010 threshold bands and unmetricized rules', () => {
  // EX-B1a (M-19)
  assert.equal(
    evaluateRuleBand('EX-B1a', { metric_id: 'M-19', value: 0.8, computable: true, reason: null }).band,
    'keep'
  );
  assert.equal(
    evaluateRuleBand('EX-B1a', { metric_id: 'M-19', value: 0.63, computable: true, reason: null }).band,
    'change'
  );
  assert.equal(
    evaluateRuleBand('EX-B1a', { metric_id: 'M-19', value: 0.62, computable: true, reason: null }).band,
    'escalate'
  );

  // EX-B2 (M-25)
  assert.equal(
    evaluateRuleBand('EX-B2', { metric_id: 'M-25', value: 0.85, computable: true, reason: null }).band,
    'keep'
  );
  assert.equal(
    evaluateRuleBand('EX-B2', { metric_id: 'M-25', value: 0.74, computable: true, reason: null }).band,
    'change'
  );
  assert.equal(
    evaluateRuleBand('EX-B2', { metric_id: 'M-25', value: 0.73, computable: true, reason: null }).band,
    'escalate'
  );

  // EX-B2 (gate) (M-06): Not yet due before T-7; >= 0.85 keep / < 0.85 escalate when due
  const notDue = evaluateRuleBand(
    'EX-B2 (gate)',
    { metric_id: 'M-06', value: 0.35, computable: true, reason: null },
    { notDueMessage: 'Not yet due: evaluated on 2 Jan 2027' }
  );
  assert.equal(notDue.band, 'not_due');
  assert.equal(notDue.status_label, 'Not yet due: evaluated on 2 Jan 2027');
  assert.equal(notDue.severity, 'neutral');

  assert.equal(
    evaluateRuleBand('EX-B2 (gate)', { metric_id: 'M-06', value: 0.85, computable: true, reason: null }).band,
    'keep'
  );
  assert.equal(
    evaluateRuleBand('EX-B2 (gate)', { metric_id: 'M-06', value: 0.78, computable: true, reason: null }).status_label,
    'escalate (< 0.85)'
  );
  assert.equal(
    evaluateRuleBand('EX-B2 (gate)', { metric_id: 'M-06', value: 0.7, computable: true, reason: null }).status_label,
    'escalate (< 0.85)'
  );

  // EX-B4a (M-28)
  assert.equal(
    evaluateRuleBand('EX-B4a', { metric_id: 'M-28', value: 8, computable: true, reason: null }).band,
    'keep'
  );
  assert.equal(
    evaluateRuleBand('EX-B4a', { metric_id: 'M-28', value: 4, computable: true, reason: null }).band,
    'change'
  );
  assert.equal(
    evaluateRuleBand('EX-B4a', { metric_id: 'M-28', value: 3, computable: true, reason: null }).band,
    'stop'
  );

  // EX-B3a (M-29)
  assert.equal(
    evaluateRuleBand('EX-B3a', { metric_id: 'M-29', value: 12, computable: true, reason: null }).band,
    'keep'
  );
  assert.equal(
    evaluateRuleBand('EX-B3a', { metric_id: 'M-29', value: 6, computable: true, reason: null }).band,
    'change'
  );
  assert.equal(
    evaluateRuleBand('EX-B3a', { metric_id: 'M-29', value: 5, computable: true, reason: null }).band,
    'stop'
  );

  // Non-computable & unmetricized rules
  const uncomp = evaluateRuleBand('EX-B1a', {
    metric_id: 'M-19',
    value: null,
    computable: false,
    reason: 'Insufficient denominator',
  });
  assert.equal(uncomp.band, 'unavailable');
  assert.equal(uncomp.status_label, 'Insufficient denominator');

  for (const manualRule of ['EX-B1b', 'EX-B3b', 'EX-B4b', 'EX-B5a']) {
    const manual = evaluateRuleBand(manualRule, {
      metric_id: null,
      value: null,
      computable: false,
      reason: null,
    });
    assert.equal(manual.band, 'manual_review');
    assert.equal(manual.status_label, 'manual review: no metric defined');
  }
});

test('buildEnrichedReceipts reconciles allocations, flags unreconciled, and enforces bank reference redaction', () => {
  const receipts = [
    {
      receipt_id: 'RCPT-1',
      sponsor_id: 'SP-1',
      sponsor_name: 'Alpha Corp',
      received_at: '2026-11-10',
      amount: '500000',
      method: 'neft',
      bank_reference: 'UTR-998877',
      reconciled: true,
      reconciled_at: '2026-11-11',
      recorded_by: 'TM-FIN',
      recorded_by_name: 'Finance Member',
      record_class: 'simulated',
    },
    {
      receipt_id: 'RCPT-2',
      sponsor_id: 'SP-2',
      sponsor_name: 'Beta Labs',
      received_at: '2026-11-12',
      amount: '300000',
      method: 'upi',
      bank_reference: 'UTR-445566',
      reconciled: false,
      reconciled_at: null,
      recorded_by: 'TM-FIN',
      recorded_by_name: 'Finance Member',
      record_class: 'simulated',
    },
  ];
  const allocations = [
    {
      allocation_id: 'AL-1',
      receipt_id: 'RCPT-1',
      invoice_id: 'INV-1',
      schedule_item_id: 'PSI-1',
      contract_id: 'CTR-1',
      amount: '350000',
      created_at: '2026-11-11',
    },
    {
      allocation_id: 'AL-2',
      receipt_id: 'RCPT-2',
      invoice_id: 'INV-2',
      schedule_item_id: 'PSI-2',
      contract_id: 'CTR-2',
      amount: '300000',
      created_at: '2026-11-12',
    },
  ];

  const unredacted = buildEnrichedReceipts(receipts, allocations, false);
  assert.equal(unredacted[0]?.allocated_amount, 350000);
  assert.equal(unredacted[0]?.unallocated_amount, 150000);
  assert.equal(unredacted[0]?.unreconciled, false);
  assert.equal(unredacted[0]?.counted_as_collected, true);
  assert.equal(unredacted[0]?.bank_reference, 'UTR-998877');
  assert.equal(unredacted[0]?.contract_id, 'CTR-1');
  assert.equal((unredacted[0]?.allocations as unknown[]).length, 1);

  assert.equal(unredacted[1]?.unreconciled, true);
  assert.equal(unredacted[1]?.counted_as_collected, false);
  assert.equal(unredacted[1]?.unallocated_amount, 0);

  const redacted = buildEnrichedReceipts(receipts, allocations, true);
  assert.equal(redacted[0]?.bank_reference, null);
  assert.equal(redacted[0]?.contract_id, null);
  assert.equal(redacted[0]?.bank_reference_redacted, true);
  assert.deepEqual(redacted[0]?.allocations, []);
});

test('evaluateScopeAndRedaction restricts viewer financials/PII and restricts bank_reference for non-all receipt roles', () => {
  const viewer = evaluateScopeAndRedaction(['viewer']);
  assert.equal(viewer.isViewerOnly, true);
  assert.equal(viewer.redactFinancials, true);
  assert.equal(viewer.redactPii, true);
  assert.equal(viewer.redactBankReference, true);
  assert.equal(viewer.canViewAudit, false);

  const lead = evaluateScopeAndRedaction(['coordination_lead']);
  assert.equal(lead.isViewerOnly, false);
  assert.equal(lead.redactFinancials, false);
  assert.equal(lead.redactBankReference, false);
  assert.equal(lead.canViewAudit, true);
});

test('readApi routes serve /api/editions, enforce allowed metric filters & viewer restrictions, and map DB SQLSTATEs', async () => {
  await withReadServer({ userRole: 'lead' }, async (baseUrl, pool) => {
    const edRes = await fetch(`${baseUrl}/api/editions`, {
      headers: { Authorization: 'Bearer test-token' },
    });
    assert.equal(edRes.status, 200);
    const edBody = (await edRes.json()) as {
      editions: Array<{ edition_id: string; record_class: string }>;
    };
    assert.equal(edBody.editions.length, 2);
    assert.equal(edBody.editions[0]?.edition_id, 'ED-2026-DEMO');
    assert.equal(edBody.editions[1]?.edition_id, 'ED-2025');

    const okMetrics = await fetch(`${baseUrl}/api/metrics/query`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        metricIds: ['M-08'],
        editionId: 'ED-2026-DEMO',
        recordClass: 'simulated',
        asOf: '2026-11-22',
        filters: { channel_group: 'warm', bet_id: 'all' },
      }),
    });
    assert.equal(okMetrics.status, 200);
    const okJson = (await okMetrics.json()) as {
      results: Array<{ metric_id: string; value: number; unit: string; computable: boolean }>;
    };
    assert.equal(okJson.results[0]?.metric_id, 'M-08');
    assert.equal(okJson.results[0]?.value, 1550000);
    assert.equal(pool.metricCalls[0]?.filters, '{"channel_group":"warm"}');

    const badFilterRes = await fetch(`${baseUrl}/api/metrics/query`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        metricIds: ['M-08'],
        editionId: 'ED-2026-DEMO',
        asOf: '2026-11-22',
        filters: { owner_id: 'TM-01' },
      }),
    });
    assert.equal(badFilterRes.status, 400);

    // M-30 multi-row series_key lookup
    const m30Res = await fetch(`${baseUrl}/api/metrics/query`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        metricIds: ['M-30'],
        editionId: 'ED-2026-DEMO',
        recordClass: 'simulated',
        asOf: '2026-11-26',
      }),
    });
    assert.equal(m30Res.status, 200);
    const m30Json = (await m30Res.json()) as {
      results: Array<{ metric_id: string; series_key: string | null; value: number; unit: string }>;
    };
    assert.deepEqual(
      m30Json.results.map((r) => [r.series_key, r.value]),
      [
        ['SC-01', 21.23],
        ['SC-02', 26.1],
        ['SC-03', 28.64],
      ]
    );
    assert.equal(
      coerceMetricRow({ metric_id: 'M-30', series_key: 'SC-01', value: '21.23', unit: '₹ lakh', computable: true }).series_key,
      'SC-01'
    );

    // T-7 cash gate before due date vs on due date
    const gatesBefore = await fetch(
      `${baseUrl}/api/gates?editionId=ED-2026-DEMO&asOf=2026-11-26`,
      { headers: { Authorization: 'Bearer test-token' } }
    );
    assert.equal(gatesBefore.status, 200);
    const gatesBeforeJson = (await gatesBefore.json()) as {
      cash_gate: { status: string; is_due: boolean; due_date: string; actual_value: number };
      gates: Array<{ kpi_id: string; status: string; pass: boolean | null }>;
    };
    assert.equal(gatesBeforeJson.cash_gate.is_due, false);
    assert.equal(gatesBeforeJson.cash_gate.due_date, '2027-01-02');
    assert.equal(
      gatesBeforeJson.cash_gate.status,
      'Not yet due: evaluated on 2 Jan 2027'
    );
    assert.equal(gatesBeforeJson.cash_gate.actual_value, 0.35);
    assert.equal(gatesBeforeJson.gates[0]?.pass, null);

    const gatesOnDue = await fetch(
      `${baseUrl}/api/gates?editionId=ED-2026-DEMO&asOf=2027-01-02`,
      { headers: { Authorization: 'Bearer test-token' } }
    );
    assert.equal(gatesOnDue.status, 200);
    const gatesOnDueJson = (await gatesOnDue.json()) as {
      cash_gate: { status: string; is_due: boolean };
    };
    assert.equal(gatesOnDueJson.cash_gate.is_due, true);
    assert.equal(gatesOnDueJson.cash_gate.status, 'escalate');

    const rulesBefore = await fetch(
      `${baseUrl}/api/rules?editionId=ED-2026-DEMO&asOf=2026-11-26`,
      { headers: { Authorization: 'Bearer test-token' } }
    );
    assert.equal(rulesBefore.status, 200);
    const rulesBeforeJson = (await rulesBefore.json()) as {
      rules: Array<{ rule_id: string; band: string; status_label: string }>;
    };
    const exB2Gate = rulesBeforeJson.rules.find((r) => r.rule_id === 'EX-B2 (gate)');
    const exB2Rule = rulesBeforeJson.rules.find((r) => r.rule_id === 'EX-B2');
    assert.equal(exB2Gate?.band, 'not_due');
    assert.equal(exB2Gate?.status_label, 'Not yet due: evaluated on 2 Jan 2027');
    assert.equal(exB2Rule?.band, 'escalate');
  });

  // Viewer role restriction on M-01
  await withReadServer({ userRole: 'viewer' }, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/metrics/query`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        metricIds: ['M-01'],
        editionId: 'ED-2026-DEMO',
        asOf: '2026-11-22',
      }),
    });
    assert.equal(res.status, 403);
  });

  // SQLSTATE 22023 mapped cleanly to HTTP 400
  await withReadServer(
    {
      userRole: 'lead',
      onMetricCall() {
        throw Object.assign(new Error('invalid parameter supplied'), { code: '22023' });
      },
    },
    async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/metrics/query`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer test-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          metricIds: ['M-08'],
          editionId: 'ED-2026-DEMO',
          asOf: '2026-11-22',
        }),
      });
      assert.equal(res.status, 400);
    }
  );
});
