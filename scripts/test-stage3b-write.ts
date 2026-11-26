import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import express from 'express';
import type { Pool, PoolClient } from 'pg';
import type { AuthDependencies } from '../server/auth.ts';
import type { ServerConfig } from '../server/config.ts';
import {
  withActorTransaction,
  type DatabasePoolState,
  type VerifiedActor,
} from '../server/db.ts';
import { AppApiError, apiErrorHandler } from '../server/errors.ts';
import {
  CANONICAL_ROLE_SET,
  PERMISSION_MATRIX,
  canConfirmOpportunity,
  evaluatePermission,
  type BusinessEntityDomain,
  type CanonicalRole,
  type PermissionOperation,
} from '../server/permissions.ts';
import { createReadApiRouter } from '../server/routes/readApi.ts';
import { createWriteApiRouter } from '../server/routes/writeApi.ts';

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

interface MockStore {
  dataVersion: number;
  importBatches: Map<string, Record<string, unknown>>;
  sponsors: Map<string, Record<string, unknown>>;
  ownerships: Array<Record<string, unknown>>;
  opportunities: Map<string, Record<string, unknown>>;
  stageVersions: Array<Record<string, unknown>>;
  contracts: Map<string, Record<string, unknown>>;
  contractLines: Array<Record<string, unknown>>;
  auditEvents: Array<Record<string, unknown>>;
  setConfigCalls: Array<{ key: string; value: string }>;
}

function cloneStore(s: MockStore): MockStore {
  return {
    dataVersion: s.dataVersion,
    importBatches: new Map(
      Array.from(s.importBatches.entries()).map(([k, v]) => [k, { ...v }])
    ),
    sponsors: new Map(
      Array.from(s.sponsors.entries()).map(([k, v]) => [k, { ...v }])
    ),
    ownerships: s.ownerships.map((r) => ({ ...r })),
    opportunities: new Map(
      Array.from(s.opportunities.entries()).map(([k, v]) => [k, { ...v }])
    ),
    stageVersions: s.stageVersions.map((r) => ({ ...r })),
    contracts: new Map(
      Array.from(s.contracts.entries()).map(([k, v]) => [k, { ...v }])
    ),
    contractLines: s.contractLines.map((r) => ({ ...r })),
    auditEvents: s.auditEvents.map((r) => ({ ...r })),
    setConfigCalls: s.setConfigCalls.map((r) => ({ ...r })),
  };
}

function createInitialMockStore(): MockStore {
  return {
    dataVersion: 42,
    importBatches: new Map([
      [
        'IB-SIM-2026',
        { import_batch_id: 'IB-SIM-2026', batch_type: 'seed', record_class: 'simulated' },
      ],
    ]),
    sponsors: new Map([
      [
        'SP26-BRAMBLE',
        {
          sponsor_id: 'SP26-BRAMBLE',
          display_name: 'Bramble Active',
          lifecycle_status: 'prospect',
          record_class: 'simulated',
          is_deleted: false,
        },
      ],
      [
        'SP26-OTHER',
        {
          sponsor_id: 'SP26-OTHER',
          display_name: 'Owned By Comm',
          lifecycle_status: 'prospect',
          record_class: 'simulated',
          is_deleted: false,
        },
      ],
    ]),
    ownerships: [
      {
        assignment_id: 'OA-BRAMBLE',
        subject_type: 'sponsor',
        subject_id: 'SP26-BRAMBLE',
        member_id: 'SIM-PART',
        role_in_relationship: 'owner',
        record_class: 'simulated',
        valid_to: null,
        is_deleted: false,
      },
      {
        assignment_id: 'OA-OTHER',
        subject_type: 'sponsor',
        subject_id: 'SP26-OTHER',
        member_id: 'SIM-COMM',
        role_in_relationship: 'owner',
        record_class: 'simulated',
        valid_to: null,
        is_deleted: false,
      },
    ],
    opportunities: new Map([
      [
        'O26-005',
        {
          opportunity_id: 'O26-005',
          sponsor_id: 'SP26-BRAMBLE',
          edition_id: 'ED-2026-DEMO',
          primary_contact_id: 'CT26-BRAMBLE-1',
          originating_campaign_id: 'CA26-WARM',
          bet_id: 'B1',
          support_type: 'cash',
          is_renewal: false,
          name: 'Bramble Active Co-Title',
          record_class: 'simulated',
          is_deleted: false,
        },
      ],
      [
        'O26-OTHER',
        {
          opportunity_id: 'O26-OTHER',
          sponsor_id: 'SP26-OTHER',
          edition_id: 'ED-2026-DEMO',
          primary_contact_id: null,
          originating_campaign_id: 'CA26-COMM',
          bet_id: 'B1',
          support_type: 'cash',
          is_renewal: false,
          name: 'Other Owner Deal',
          record_class: 'simulated',
          is_deleted: false,
        },
      ],
    ]),
    stageVersions: [
      {
        history_id: 'HV26-005-1',
        opportunity_id: 'O26-005',
        stage: 'negotiating',
        owner_member_id: 'SIM-PART',
        proposed_value: 110000,
        confirmed_value: 0,
        version_no: 1,
        valid_from: '2026-10-15T10:00:00Z',
        record_class: 'simulated',
        is_deleted: false,
      },
      {
        history_id: 'HV26-OTHER-1',
        opportunity_id: 'O26-OTHER',
        stage: 'proposal_sent',
        owner_member_id: 'SIM-COMM',
        proposed_value: 80000,
        confirmed_value: 0,
        version_no: 1,
        valid_from: '2026-10-15T10:00:00Z',
        record_class: 'simulated',
        is_deleted: false,
      },
    ],
    contracts: new Map([
      [
        'KC26-EXIST-1',
        {
          contract_id: 'KC26-EXIST-1',
          opportunity_id: 'O26-001',
          signed_value_total: 250000,
          status: 'active',
          valid_to: null,
          record_class: 'simulated',
          is_deleted: false,
        },
      ],
    ]),
    contractLines: [
      {
        contract_line_id: 'KL26-EXIST-1',
        contract_id: 'KC26-EXIST-1',
        consideration_type: 'cash',
        value: 250000,
        is_deleted: false,
      },
    ],
    auditEvents: [],
    setConfigCalls: [],
  };
}

function computeM02(store: MockStore): number {
  let total = 250000; // Existing baseline confirmed partnership (O26-001)
  const latestByOpp = new Map<string, Record<string, unknown>>();
  for (const sv of store.stageVersions) {
    if (sv.is_deleted) continue;
    const oppId = String(sv.opportunity_id);
    const prev = latestByOpp.get(oppId);
    if (!prev || Number(sv.version_no) >= Number(prev.version_no)) {
      latestByOpp.set(oppId, sv);
    }
  }
  for (const sv of latestByOpp.values()) {
    if (sv.stage === 'partner_confirmed') {
      total += Number(sv.confirmed_value ?? 0);
    }
  }
  return total;
}

function createStage3BMockPool(storeRef: { current: MockStore }) {
  const members: Record<
    string,
    { member_id: string; full_name: string; email: string; role: CanonicalRole }
  > = {
    'SIM-LEAD': {
      member_id: 'SIM-LEAD',
      full_name: 'Shantanu Nimbalkar',
      email: 'lead@demo.local',
      role: 'coordination_lead',
    },
    'SIM-VIEW': {
      member_id: 'SIM-VIEW',
      full_name: 'Viewer User',
      email: 'viewer@demo.local',
      role: 'viewer',
    },
    'SIM-PART': {
      member_id: 'SIM-PART',
      full_name: 'Kavya Reddy',
      email: 'part@demo.local',
      role: 'partnerships',
    },
    'SIM-FIN': {
      member_id: 'SIM-FIN',
      full_name: 'Meera Iyer',
      email: 'fin@demo.local',
      role: 'finance_collections',
    },
  };

  function runOnTarget(target: MockStore, sql: string, params?: unknown[]) {
    const norm = sql.replace(/\s+/g, ' ').trim();

    if (norm.startsWith('SELECT set_config')) {
      if (params && params.length >= 2) {
        target.setConfigCalls.push({
          key: 'app.actor_member_id',
          value: String(params[0] ?? ''),
        });
        target.setConfigCalls.push({
          key: 'app.actor_auth_uid',
          value: String(params[1] ?? ''),
        });
      }
      return { rows: [{ set_config: String(params?.[0] ?? '') }], rowCount: 1 };
    }

    if (norm.includes('FROM information_schema.tables')) {
      return {
        rows: [{ table_name: 'team_member' }, { table_name: 'role_assignment' }],
        rowCount: 2,
      };
    }
    if (norm.includes('FROM information_schema.columns')) {
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

    if (norm.includes('FROM public.team_member') && norm.includes('WHERE auth_user_id = $1')) {
      const authUid = String(params?.[0] ?? '');
      const mId = authUid.replace(/^auth-/, '');
      const m = members[mId];
      if (!m) return { rows: [], rowCount: 0 };
      return {
        rows: [
          {
            member_id: m.member_id,
            full_name: m.full_name,
            email: m.email,
            record_class: 'simulated',
            import_batch_id: 'IB-SIM-2026',
          },
        ],
        rowCount: 1,
      };
    }

    if (norm.includes('FROM public.team_member') && norm.includes('WHERE')) {
      const m = members['SIM-LEAD'];
      return {
        rows: [
          {
            member_id: m.member_id,
            full_name: m.full_name,
            email: m.email,
            record_class: 'simulated',
            import_batch_id: 'IB-SIM-2026',
          },
        ],
        rowCount: 1,
      };
    }

    if (norm.includes('FROM public.role_assignment') && norm.includes('SELECT role')) {
      const memberId = String(params?.[0] ?? 'SIM-LEAD');
      const role = members[memberId]?.role ?? 'viewer';
      return { rows: [{ role }], rowCount: 1 };
    }

    if (norm.includes('FROM public.festival_edition') && norm.includes('WHERE edition_id = $1')) {
      const edId = String(params?.[0] ?? 'ED-2026-DEMO');
      if (edId === 'ED-2025') {
        return {
          rows: [
            {
              edition_id: 'ED-2025',
              name: 'CampusFest 2025',
              record_class: 'historical_synthetic',
              starts_at: '2025-04-12',
              season_start: '2025-01-15',
              preseason_start: '2025-01-01',
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
            starts_at: '2027-01-09',
            season_start: '2026-10-26',
            preseason_start: '2026-09-28',
            is_current: true,
          },
        ],
        rowCount: 1,
      };
    }

    if (norm.includes('FROM public.festival_edition') && norm.includes('WHERE record_class = $1')) {
      const rc = String(params?.[0] ?? 'simulated');
      return {
        rows: [{ edition_id: rc === 'live' ? 'ED-2026-LIVE' : 'ED-2026-DEMO', record_class: rc }],
        rowCount: 1,
      };
    }

    if (norm.startsWith('INSERT INTO public.import_batch')) {
      const batchId = String(params?.[0] ?? '');
      if (!target.importBatches.has(batchId)) {
        target.importBatches.set(batchId, {
          import_batch_id: batchId,
          batch_type: 'ui',
          record_class: params?.[1],
          created_by: params?.[2],
        });
      }
      return { rows: [], rowCount: 1 };
    }

    if (norm.includes('FROM public.sponsor') && norm.includes('WHERE sponsor_id = $1')) {
      const sp = target.sponsors.get(String(params?.[0] ?? ''));
      return { rows: sp && !sp.is_deleted ? [sp] : [], rowCount: sp && !sp.is_deleted ? 1 : 0 };
    }

    if (norm.includes('FROM public.ownership_assignment') && norm.includes('subject_id = $2')) {
      const memberId = String(params?.[0] ?? '');
      const subjectId = String(params?.[1] ?? '');
      const row = target.ownerships.find(
        (o) =>
          o.subject_id === subjectId &&
          o.member_id === memberId &&
          o.valid_to === null &&
          !o.is_deleted
      );
      return { rows: row ? [{ assignment_id: row.assignment_id }] : [], rowCount: row ? 1 : 0 };
    }

    if (norm.includes('FROM public.opportunity') && norm.includes('WHERE opportunity_id = $1')) {
      const opp = target.opportunities.get(String(params?.[0] ?? ''));
      return { rows: opp && !opp.is_deleted ? [opp] : [], rowCount: opp && !opp.is_deleted ? 1 : 0 };
    }

    if (
      norm.includes('FROM public.opportunity_stage_version') &&
      norm.includes('WHERE opportunity_id = $1')
    ) {
      const oppId = String(params?.[0] ?? '');
      const list = target.stageVersions
        .filter((s) => s.opportunity_id === oppId && !s.is_deleted)
        .sort((a, b) => Number(b.version_no) - Number(a.version_no));
      return { rows: list.length ? [list[0]] : [], rowCount: list.length ? 1 : 0 };
    }

    if (norm.includes('FROM public.contract') && norm.includes('WHERE opportunity_id = $1')) {
      const oppId = String(params?.[0] ?? '');
      const match = Array.from(target.contracts.values()).find(
        (c) => c.opportunity_id === oppId && c.status === 'active' && !c.is_deleted
      );
      return { rows: match ? [{ contract_id: match.contract_id }] : [], rowCount: match ? 1 : 0 };
    }

    if (norm.startsWith('INSERT INTO public.contract (')) {
      const row = {
        contract_id: String(params?.[0]),
        opportunity_id: String(params?.[1]),
        signed_at: String(params?.[2]),
        signed_value_total: Number(params?.[3]),
        payment_terms: String(params?.[4]),
        signatory_contact_id: params?.[5] ?? null,
        document_uri: params?.[6] ?? null,
        status: 'active',
        valid_to: null,
        record_class: String(params?.[7]),
        import_batch_id: String(params?.[8]),
        created_by: String(params?.[9]),
        is_deleted: false,
      };
      target.contracts.set(row.contract_id, row);
      target.dataVersion += 1;
      return { rows: [row], rowCount: 1 };
    }

    if (norm.startsWith('INSERT INTO public.contract_line (')) {
      const row = {
        contract_line_id: String(params?.[0]),
        contract_id: String(params?.[1]),
        asset_id: params?.[2] ?? null,
        consideration_type: String(params?.[3]),
        value: Number(params?.[4]),
        price_id: params?.[5] ?? null,
        record_class: String(params?.[6]),
        import_batch_id: String(params?.[7]),
        created_by: String(params?.[8]),
        is_deleted: false,
      };
      target.contractLines.push(row);
      target.dataVersion += 1;
      return { rows: [row], rowCount: 1 };
    }

    if (norm.startsWith('INSERT INTO public.opportunity_stage_version (')) {
      const isConfirm = norm.includes("'partner_confirmed'");
      const row = isConfirm
        ? {
            history_id: String(params?.[0]),
            opportunity_id: String(params?.[1]),
            stage: 'partner_confirmed',
            owner_member_id: params?.[2] ?? null,
            proposed_value: params?.[3] ?? null,
            confirmed_value: Number(params?.[4] ?? 0),
            version_no: Number(params?.[5] ?? 1),
            record_class: String(params?.[6]),
            import_batch_id: String(params?.[7]),
            created_by: String(params?.[8]),
            is_deleted: false,
          }
        : {
            history_id: String(params?.[0]),
            opportunity_id: String(params?.[1]),
            stage: String(params?.[2]),
            owner_member_id: params?.[3] ?? null,
            proposed_value: params?.[4] ?? null,
            confirmed_value: 0,
            drop_reason: params?.[5] ?? null,
            loss_reason: params?.[6] ?? null,
            version_no: Number(params?.[7] ?? 1),
            record_class: String(params?.[8]),
            import_batch_id: String(params?.[9]),
            created_by: String(params?.[10]),
            is_deleted: false,
          };
      target.stageVersions.push(row);
      target.dataVersion += 1;
      return { rows: [row], rowCount: 1 };
    }

    if (norm.includes('SELECT data_version FROM public.app_state')) {
      return { rows: [{ data_version: target.dataVersion }], rowCount: 1 };
    }

    if (norm.startsWith('INSERT INTO public.audit_event')) {
      const row = {
        audit_id: String(params?.[0]),
        actor_id: String(params?.[1]),
        channel: 'ui',
        entity: String(params?.[2]),
        entity_id: String(params?.[3]),
        operation: String(params?.[4]),
        after: params?.[5],
        data_version: Number(params?.[6]),
        record_class: String(params?.[7]),
        import_batch_id: String(params?.[8]),
        source_ref: String(params?.[9]),
        created_by: String(params?.[10]),
      };
      target.auditEvents.push(row);
      return { rows: [row], rowCount: 1 };
    }

    if (norm.includes('SELECT * FROM metrics.get_metric')) {
      const metricId = String(params?.[0] ?? 'M-02');
      const m02 = computeM02(target);
      return {
        rows: [
          {
            metric_id: metricId,
            value: metricId === 'M-02' ? m02 : 0,
            unit: '₹',
            numerator: m02,
            denominator: 1,
            computable: true,
            reason: null,
            applied_filters: {},
            record_class: 'simulated',
            edition_id: 'ED-2026-DEMO',
            as_of: '2026-11-26',
            data_version: target.dataVersion,
            definition_version: 'v1',
            series_key: null,
          },
        ],
        rowCount: 1,
      };
    }

    return { rows: [], rowCount: 0 };
  }

  function validateCommitConstraints(txStore: MockStore): void {
    // INV-02: Every active contract must have contract_line sum == signed_value_total
    for (const contract of txStore.contracts.values()) {
      if (contract.is_deleted || contract.status !== 'active') continue;
      const sum = txStore.contractLines
        .filter((l) => l.contract_id === contract.contract_id && !l.is_deleted)
        .reduce((acc, l) => acc + Number(l.value ?? 0), 0);
      if (Math.abs(sum - Number(contract.signed_value_total)) > 0.01) {
        const err = new Error(
          `INV-02 violation: contract ${contract.contract_id} signed_value_total (${contract.signed_value_total}) does not match sum of contract_line values (${sum}).`
        ) as Error & { code: string };
        err.code = 'P0001';
        throw err;
      }
    }
  }

  return {
    pool: {
      async query(sql: string, params?: unknown[]) {
        return runOnTarget(storeRef.current, sql, params);
      },
      async connect(): Promise<PoolClient> {
        let txStore: MockStore | null = null;
        return {
          async query(sql: string, params?: unknown[]) {
            const norm = sql.replace(/\s+/g, ' ').trim();
            if (norm === 'BEGIN') {
              txStore = cloneStore(storeRef.current);
              return { rows: [], rowCount: 0 };
            }
            if (norm === 'COMMIT') {
              if (txStore) {
                validateCommitConstraints(txStore);
                storeRef.current = txStore;
                txStore = null;
              }
              return { rows: [], rowCount: 0 };
            }
            if (norm === 'ROLLBACK') {
              txStore = null;
              return { rows: [], rowCount: 0 };
            }
            return runOnTarget(txStore ?? storeRef.current, sql, params);
          },
          release() {
            // noop
          },
        } as unknown as PoolClient;
      },
    } as unknown as Pool,
  };
}

function buildStage3BTestApp(
  memberHeaderRef: { current: string },
  storeRef: { current: MockStore }
) {
  const config = createTestConfig();
  const mock = createStage3BMockPool(storeRef);
  const dbState: DatabasePoolState = {
    configured: true,
    pool: mock.pool,
    initErrorCode: null,
  };

  const authDeps: AuthDependencies = {
    supabaseClient: {
      auth: {
        getUser: async () => {
          const mId = memberHeaderRef.current;
          return {
            data: {
              user: {
                id: `auth-${mId}`,
                email: `${mId.toLowerCase()}@demo.local`,
                email_confirmed_at: '2026-09-21T00:00:00Z',
              },
            },
            error: null,
          };
        },
      },
    } as unknown as AuthDependencies['supabaseClient'],
    authConfigured: true,
    dbState,
    defaultEditionId: 'ED-2026-DEMO',
  };

  const app = express();
  app.use('/api', express.json());
  app.use('/api', createReadApiRouter(config, dbState, authDeps));
  app.use('/api', createWriteApiRouter(config, dbState, authDeps));
  app.use('/api', apiErrorHandler);
  return { app, dbState };
}

async function sendRequest(
  app: express.Express,
  method: string,
  path: string,
  body?: unknown
): Promise<{ status: number; json: Record<string, unknown> }> {
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: {
        Authorization: 'Bearer mock-jwt',
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    return {
      status: res.status,
      json: text ? (JSON.parse(text) as Record<string, unknown>) : {},
    };
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test('[MOCKED] Stage 3B Test 1: SIM-LEAD confirms O26-005 -> contract + line + partner_confirmed + M-02 rises + audit', async () => {
  const storeRef = { current: createInitialMockStore() };
  const actorRef = { current: 'SIM-LEAD' };
  const { app } = buildStage3BTestApp(actorRef, storeRef);

  const beforeMetric = await sendRequest(app, 'POST', '/api/metrics/query', {
    metric_ids: ['M-02'],
    edition_id: 'ED-2026-DEMO',
    record_class: 'simulated',
  });
  assert.equal(beforeMetric.status, 200);
  const beforeM02 = Number(
    ((beforeMetric.json.metrics as Array<Record<string, unknown>>)[0]?.value) ?? 0
  );
  assert.equal(beforeM02, 250000);

  const confirmRes = await sendRequest(
    app,
    'POST',
    '/api/opportunities/O26-005/confirm',
    {
      signedAt: '2026-11-26T10:00:00+05:30',
      paymentTerms: 'standard_50_50',
      signatoryContactId: 'CT26-BRAMBLE-1',
      lines: [{ considerationType: 'cash', value: 110000, assetId: null }],
      signedValueTotal: 110000,
    }
  );

  assert.equal(confirmRes.status, 201);
  assert.ok(String(confirmRes.json.id).startsWith('KC-'));
  assert.ok(Number(confirmRes.json.dataVersion) > 42);
  assert.equal(storeRef.current.contracts.size, 2);
  assert.equal(storeRef.current.contractLines.length, 2);
  const latestStage = storeRef.current.stageVersions.at(-1);
  assert.equal(latestStage?.stage, 'partner_confirmed');
  assert.equal(latestStage?.confirmed_value, 110000);
  assert.ok(storeRef.current.importBatches.has('IB-UI-ED-2026-DEMO'));

  const audit = storeRef.current.auditEvents.at(-1);
  assert.equal(audit?.actor_id, 'SIM-LEAD');
  assert.equal(audit?.channel, 'ui');
  assert.equal(audit?.entity, 'CONTRACT');
  assert.equal(audit?.import_batch_id, 'IB-UI-ED-2026-DEMO');

  const afterMetric = await sendRequest(app, 'POST', '/api/metrics/query', {
    metric_ids: ['M-02'],
    edition_id: 'ED-2026-DEMO',
    record_class: 'simulated',
  });
  const afterM02 = Number(
    ((afterMetric.json.metrics as Array<Record<string, unknown>>)[0]?.value) ?? 0
  );
  assert.equal(afterM02, beforeM02 + 110000);
});

test('[MOCKED] Stage 3B Test 2: Confirm with mismatched line sum triggers 422 INV-02 and rolls back cleanly', async () => {
  const storeRef = { current: createInitialMockStore() };
  const actorRef = { current: 'SIM-LEAD' };
  const { app } = buildStage3BTestApp(actorRef, storeRef);

  const initialContractCount = storeRef.current.contracts.size;
  const initialStageCount = storeRef.current.stageVersions.length;
  const initialVersion = storeRef.current.dataVersion;

  const res = await sendRequest(
    app,
    'POST',
    '/api/opportunities/O26-005/confirm',
    {
      signedAt: '2026-11-26T10:00:00+05:30',
      paymentTerms: 'standard_50_50',
      lines: [{ considerationType: 'cash', value: 90000 }],
      signedValueTotal: 110000,
    }
  );

  assert.equal(res.status, 422);
  assert.match(String(res.json.message), /INV-02/i);
  assert.equal(storeRef.current.contracts.size, initialContractCount);
  assert.equal(storeRef.current.stageVersions.length, initialStageCount);
  assert.equal(storeRef.current.auditEvents.length, 0);
  assert.equal(storeRef.current.dataVersion, initialVersion);
});

test('[MOCKED] Stage 3B Test 3: SIM-VIEW gets 403 on all writes; sales role gets 403 on another owner sponsor/deal', async () => {
  const storeRef = { current: createInitialMockStore() };
  const actorRef = { current: 'SIM-VIEW' };
  const { app } = buildStage3BTestApp(actorRef, storeRef);

  const viewerCalls: Array<[string, string, unknown]> = [
    ['POST', '/api/sponsors', { displayName: 'Blocked', lifecycleStatus: 'prospect', editionId: 'ED-2026-DEMO' }],
    ['POST', '/api/contacts', { sponsorId: 'SP26-BRAMBLE', fullName: 'Blocked Contact' }],
    ['POST', '/api/ownership', { subjectType: 'sponsor', subjectId: 'SP26-BRAMBLE', memberId: 'SIM-PART' }],
    ['POST', '/api/campaigns', { name: 'Blocked Campaign', channelId: 'CH-1', editionId: 'ED-2026-DEMO' }],
    ['POST', '/api/outreach', { campaignId: 'CA26-WARM', sponsorId: 'SP26-BRAMBLE', rootEventType: 'outreach_sent' }],
    ['POST', '/api/interactions', { attemptId: 'AT-1', eventType: 'replied' }],
    ['POST', '/api/meetings', { sponsorId: 'SP26-BRAMBLE', scheduledAt: '2026-11-28T10:00:00Z', editionId: 'ED-2026-DEMO' }],
    ['POST', '/api/qualifications', { sponsorId: 'SP26-BRAMBLE', status: 'qualified' }],
    ['POST', '/api/opportunities', { sponsorId: 'SP26-BRAMBLE', editionId: 'ED-2026-DEMO', supportType: 'cash' }],
    ['POST', '/api/opportunities/O26-005/stage', { stage: 'negotiating' }],
    ['POST', '/api/opportunities/O26-005/confirm', { signedAt: '2026-11-26', paymentTerms: '100_upfront', lines: [{ considerationType: 'cash', value: 100 }], signedValueTotal: 100 }],
    ['POST', '/api/tasks', { title: 'Blocked Task', taskType: 'follow_up', ownerMemberId: 'SIM-LEAD', dueAt: '2026-12-01', editionId: 'ED-2026-DEMO' }],
    ['PATCH', '/api/escalations/ES-1', { status: 'acknowledged' }],
    ['POST', '/api/time-logs', { hours: 1, loggedDate: '2026-11-26', editionId: 'ED-2026-DEMO' }],
    ['POST', '/api/network-partners', { name: 'Blocked Partner', partnerType: 'creator', ownerMemberId: 'SIM-PART', editionId: 'ED-2026-DEMO' }],
    ['POST', '/api/referrals', { partnerId: 'NP-1', sponsorId: 'SP26-BRAMBLE', status: 'speculative', editionId: 'ED-2026-DEMO' }],
  ];

  for (const [method, path, body] of viewerCalls) {
    const r = await sendRequest(app, method, path, body);
    assert.equal(r.status, 403, `Expected 403 for SIM-VIEW on ${method} ${path}, got ${r.status}`);
  }

  // Sales role SIM-PART cannot edit SP26-OTHER (owned by SIM-COMM) or confirm O26-OTHER
  actorRef.current = 'SIM-PART';
  const patchOtherSponsor = await sendRequest(app, 'PATCH', '/api/sponsors/SP26-OTHER', {
    city: 'Mumbai',
  });
  assert.equal(patchOtherSponsor.status, 403);

  const confirmOtherDeal = await sendRequest(
    app,
    'POST',
    '/api/opportunities/O26-OTHER/confirm',
    {
      signedAt: '2026-11-26T10:00:00+05:30',
      paymentTerms: '100_upfront',
      lines: [{ considerationType: 'cash', value: 80000 }],
      signedValueTotal: 80000,
    }
  );
  assert.equal(confirmOtherDeal.status, 403);
});

test('[MOCKED] Stage 3B Test 4: Moving deal to lost without dropReason fails with 422', async () => {
  const storeRef = { current: createInitialMockStore() };
  const actorRef = { current: 'SIM-LEAD' };
  const { app } = buildStage3BTestApp(actorRef, storeRef);

  const res = await sendRequest(
    app,
    'POST',
    '/api/opportunities/O26-005/stage',
    { stage: 'lost' }
  );
  assert.equal(res.status, 422);
  assert.match(String(res.json.message), /drop reason/i);

  const confirmViaStage = await sendRequest(
    app,
    'POST',
    '/api/opportunities/O26-005/stage',
    { stage: 'partner_confirmed' }
  );
  assert.equal(confirmViaStage.status, 422);
});

test('[MOCKED] Stage 3B Test 5: Writes while ED-2025 / historical_synthetic selected are refused with 403', async () => {
  const storeRef = { current: createInitialMockStore() };
  const actorRef = { current: 'SIM-LEAD' };
  const { app } = buildStage3BTestApp(actorRef, storeRef);

  const res1 = await sendRequest(app, 'POST', '/api/campaigns', {
    editionId: 'ED-2025',
    recordClass: 'historical_synthetic',
    name: 'Invalid 2025 Campaign',
    channelId: 'CH-1',
  });
  assert.equal(res1.status, 403);

  const res2 = await sendRequest(app, 'POST', '/api/sponsors', {
    editionId: 'ED-2025',
    displayName: 'Invalid 2025 Sponsor',
    lifecycleStatus: 'prospect',
  });
  assert.equal(res2.status, 403);
});

test('[MOCKED] Stage 3B Test 6: Exhaustive permission matrix & withActorTransaction actor binding', async () => {
  const domains: BusinessEntityDomain[] = [
    'sponsors_contacts_research',
    'outreach_interactions_meetings_qualifications',
    'opportunities_stage',
    'proposals',
    'contracts_lines',
    'payment_schedule_invoices',
    'receipts_allocations',
    'tasks',
    'targets_rules_scenarios_metrics',
    'forecast_versions',
    'escalations',
    'hours_staffing',
    'audit_ai_logs',
  ];
  const ops: PermissionOperation[] = ['create', 'read', 'update', 'approve'];

  for (const role of CANONICAL_ROLE_SET) {
    for (const domain of domains) {
      for (const op of ops) {
        const expected = PERMISSION_MATRIX[role][domain]?.[op];
        const actual = evaluatePermission([role], domain, op);
        assert.equal(
          actual.allowed,
          Boolean(expected),
          `Mismatch for ${role}.${domain}.${op}`
        );
        assert.equal(
          actual.scope,
          expected ?? 'none',
          `Scope mismatch for ${role}.${domain}.${op}`
        );
      }
    }
  }

  assert.equal(canConfirmOpportunity(['coordination_lead'], false), true);
  assert.equal(canConfirmOpportunity(['partnerships'], true), true);
  assert.equal(canConfirmOpportunity(['partnerships'], false), false);
  assert.equal(canConfirmOpportunity(['pipeline_ops'], true), false);
  assert.equal(canConfirmOpportunity(['finance_collections'], true), false);
  assert.equal(canConfirmOpportunity(['viewer'], true), false);
  assert.equal(canConfirmOpportunity(['admin'], true), false);

  // withActorTransaction binds local actor vars and rejects missing actor with 403
  const storeRef = { current: createInitialMockStore() };
  const mock = createStage3BMockPool(storeRef);

  await assert.rejects(
    () =>
      withActorTransaction(
        { memberId: '', authUserId: 'x' },
        async () => 'never',
        mock.pool
      ),
    (err: unknown) => err instanceof AppApiError && err.status === 403
  );

  const actor: VerifiedActor = {
    memberId: 'SIM-LEAD',
    authUserId: 'auth-SIM-LEAD',
  };
  await withActorTransaction(
    actor,
    async (client) => {
      const res = await client.query('SELECT 1');
      return res.rowCount;
    },
    mock.pool
  );

  const keys = storeRef.current.setConfigCalls.map((c) => `${c.key}=${c.value}`);
  assert.ok(keys.includes('app.actor_member_id=SIM-LEAD'));
  assert.ok(keys.includes('app.actor_auth_uid=auth-SIM-LEAD'));
});
