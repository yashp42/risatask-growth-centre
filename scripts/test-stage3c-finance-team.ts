import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import express from 'express';
import type { Pool, PoolClient } from 'pg';
import type { AuthDependencies } from '../server/auth.ts';
import type { ServerConfig } from '../server/config.ts';
import { type DatabasePoolState } from '../server/db.ts';
import { apiErrorHandler } from '../server/errors.ts';
import type { CanonicalRole } from '../server/permissions.ts';
import { createFinanceAndTeamApiRouter } from '../server/routes/financeAndTeamApi.ts';
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

interface MockTeamMember {
  member_id: string;
  full_name: string;
  email: string | null;
  auth_user_id: string | null;
  is_active: boolean;
  record_class: string;
  is_deleted: boolean;
}

interface MockRoleAssignment {
  role_assignment_id: string;
  member_id: string;
  edition_id: string;
  role: CanonicalRole;
  is_current: boolean;
  valid_to: string | null;
  record_class: string;
  is_deleted: boolean;
}

interface MockFinanceStore {
  dataVersion: number;
  actorMemberId: string;
  actorAuthUid: string;
  importBatches: Map<string, Record<string, unknown>>;
  teamMembers: Map<string, MockTeamMember>;
  roleAssignments: MockRoleAssignment[];
  sponsors: Map<string, Record<string, unknown>>;
  opportunities: Map<string, Record<string, unknown>>;
  contracts: Map<string, Record<string, unknown>>;
  contractLines: Array<Record<string, unknown>>;
  scheduleItems: Map<string, Record<string, unknown>>;
  invoices: Map<string, Record<string, unknown>>;
  receipts: Map<string, Record<string, unknown>>;
  allocations: Array<Record<string, unknown>>;
  auditEvents: Array<Record<string, unknown>>;
  setConfigCalls: Array<{ key: string; value: string }>;
}

function cloneStore(s: MockFinanceStore): MockFinanceStore {
  return {
    dataVersion: s.dataVersion,
    actorMemberId: s.actorMemberId,
    actorAuthUid: s.actorAuthUid,
    importBatches: new Map(
      Array.from(s.importBatches.entries()).map(([k, v]) => [k, { ...v }])
    ),
    teamMembers: new Map(
      Array.from(s.teamMembers.entries()).map(([k, v]) => [k, { ...v }])
    ),
    roleAssignments: s.roleAssignments.map((r) => ({ ...r })),
    sponsors: new Map(
      Array.from(s.sponsors.entries()).map(([k, v]) => [k, { ...v }])
    ),
    opportunities: new Map(
      Array.from(s.opportunities.entries()).map(([k, v]) => [k, { ...v }])
    ),
    contracts: new Map(
      Array.from(s.contracts.entries()).map(([k, v]) => [k, { ...v }])
    ),
    contractLines: s.contractLines.map((r) => ({ ...r })),
    scheduleItems: new Map(
      Array.from(s.scheduleItems.entries()).map(([k, v]) => [k, { ...v }])
    ),
    invoices: new Map(
      Array.from(s.invoices.entries()).map(([k, v]) => [k, { ...v }])
    ),
    receipts: new Map(
      Array.from(s.receipts.entries()).map(([k, v]) => [k, { ...v }])
    ),
    allocations: s.allocations.map((r) => ({ ...r })),
    auditEvents: s.auditEvents.map((r) => ({ ...r })),
    setConfigCalls: s.setConfigCalls.map((r) => ({ ...r })),
  };
}

function createInitialFinanceStore(): MockFinanceStore {
  return {
    dataVersion: 42,
    actorMemberId: '',
    actorAuthUid: '',
    importBatches: new Map([
      [
        'IB-SIM-2026',
        {
          import_batch_id: 'IB-SIM-2026',
          batch_type: 'seed',
          record_class: 'simulated',
        },
      ],
    ]),
    teamMembers: new Map<string, MockTeamMember>([
      [
        'SIM-FIN',
        {
          member_id: 'SIM-FIN',
          full_name: 'Meera Iyer',
          email: 'fin@demo.local',
          auth_user_id: 'auth-SIM-FIN',
          is_active: true,
          record_class: 'simulated',
          is_deleted: false,
        },
      ],
      [
        'SIM-LEAD',
        {
          member_id: 'SIM-LEAD',
          full_name: 'Shantanu Nimbalkar',
          email: 'lead@demo.local',
          auth_user_id: 'auth-SIM-LEAD',
          is_active: true,
          record_class: 'simulated',
          is_deleted: false,
        },
      ],
      [
        'SIM-OPS',
        {
          member_id: 'SIM-OPS',
          full_name: 'Rohan Deshmukh',
          email: 'ops@demo.local',
          auth_user_id: 'auth-SIM-OPS',
          is_active: true,
          record_class: 'simulated',
          is_deleted: false,
        },
      ],
    ]),
    roleAssignments: [
      {
        role_assignment_id: 'RA-SIM-FIN',
        member_id: 'SIM-FIN',
        edition_id: 'ED-2026-DEMO',
        role: 'finance_collections',
        is_current: true,
        valid_to: null,
        record_class: 'simulated',
        is_deleted: false,
      },
      {
        role_assignment_id: 'RA-SIM-LEAD',
        member_id: 'SIM-LEAD',
        edition_id: 'ED-2026-DEMO',
        role: 'coordination_lead',
        is_current: true,
        valid_to: null,
        record_class: 'simulated',
        is_deleted: false,
      },
      {
        role_assignment_id: 'RA-SIM-OPS',
        member_id: 'SIM-OPS',
        edition_id: 'ED-2026-DEMO',
        role: 'pipeline_ops',
        is_current: true,
        valid_to: null,
        record_class: 'simulated',
        is_deleted: false,
      },
    ],
    sponsors: new Map([
      [
        'SP26-BRAMBLE',
        {
          sponsor_id: 'SP26-BRAMBLE',
          display_name: 'Bramble Active',
          lifecycle_status: 'active_partner',
          record_class: 'simulated',
          is_deleted: false,
        },
      ],
      [
        'SP26-ALPHA',
        {
          sponsor_id: 'SP26-ALPHA',
          display_name: 'Alpha Sponsor',
          lifecycle_status: 'active_partner',
          record_class: 'simulated',
          is_deleted: false,
        },
      ],
    ]),
    opportunities: new Map([
      [
        'O26-BRAMBLE',
        {
          opportunity_id: 'O26-BRAMBLE',
          sponsor_id: 'SP26-BRAMBLE',
          edition_id: 'ED-2026-DEMO',
          name: 'Bramble Co-Title',
          record_class: 'simulated',
          is_deleted: false,
        },
      ],
      [
        'O26-ALPHA',
        {
          opportunity_id: 'O26-ALPHA',
          sponsor_id: 'SP26-ALPHA',
          edition_id: 'ED-2026-DEMO',
          name: 'Alpha Associate',
          record_class: 'simulated',
          is_deleted: false,
        },
      ],
    ]),
    contracts: new Map([
      [
        'KC26-BRAMBLE',
        {
          contract_id: 'KC26-BRAMBLE',
          opportunity_id: 'O26-BRAMBLE',
          signed_at: '2026-10-20T10:00:00Z',
          signed_value_total: 200000,
          payment_terms: 'standard_50_50',
          signatory_contact_id: 'CT26-BRAMBLE-1',
          document_uri: null,
          status: 'active',
          valid_to: null,
          record_class: 'simulated',
          is_deleted: false,
        },
      ],
      [
        'KC26-ALPHA',
        {
          contract_id: 'KC26-ALPHA',
          opportunity_id: 'O26-ALPHA',
          signed_at: '2026-10-21T10:00:00Z',
          signed_value_total: 100000,
          payment_terms: '100_upfront',
          signatory_contact_id: 'CT26-ALPHA-1',
          document_uri: null,
          status: 'active',
          valid_to: null,
          record_class: 'simulated',
          is_deleted: false,
        },
      ],
    ]),
    contractLines: [
      {
        contract_line_id: 'KL26-BRAMBLE-1',
        contract_id: 'KC26-BRAMBLE',
        consideration_type: 'cash',
        value: 200000,
        is_deleted: false,
      },
      {
        contract_line_id: 'KL26-ALPHA-1',
        contract_id: 'KC26-ALPHA',
        consideration_type: 'cash',
        value: 100000,
        is_deleted: false,
      },
    ],
    scheduleItems: new Map([
      [
        'PS26-BRAMBLE-ADV',
        {
          schedule_item_id: 'PS26-BRAMBLE-ADV',
          contract_id: 'KC26-BRAMBLE',
          kind: 'advance',
          amount_due: 100000,
          due_date: '2026-12-01',
          record_class: 'simulated',
          is_deleted: false,
        },
      ],
    ]),
    invoices: new Map(),
    receipts: new Map(),
    allocations: [],
    auditEvents: [],
    setConfigCalls: [],
  };
}

function makePgError(code: string, message: string): Error & { code: string } {
  const err = new Error(message) as Error & { code: string };
  err.code = code;
  return err;
}

function computeM01(
  store: MockFinanceStore,
  recordClass: string,
  editionId: string
): number {
  let total = 0;
  for (const alloc of store.allocations) {
    if (alloc.is_deleted || alloc.record_class !== recordClass) continue;
    const receipt = store.receipts.get(String(alloc.receipt_id));
    if (!receipt || receipt.is_deleted || !receipt.reconciled) continue;

    let contractId: string | null = null;
    if (alloc.invoice_id) {
      const inv = store.invoices.get(String(alloc.invoice_id));
      if (inv && !inv.is_deleted) contractId = String(inv.contract_id);
    }
    if (!contractId && alloc.schedule_item_id) {
      const ps = store.scheduleItems.get(String(alloc.schedule_item_id));
      if (ps && !ps.is_deleted) contractId = String(ps.contract_id);
    }
    if (!contractId) continue;
    const contract = store.contracts.get(contractId);
    if (!contract || contract.is_deleted) continue;
    const opp = store.opportunities.get(String(contract.opportunity_id));
    if (!opp || opp.edition_id !== editionId) continue;

    total += Number(alloc.amount ?? 0);
  }
  return total;
}

function createStage3CMockPool(storeRef: { current: MockFinanceStore }) {
  function assertCurrentActor(target: MockFinanceStore): string {
    if (!target.actorMemberId || !target.actorAuthUid) {
      throw makePgError('42501', 'No authenticated actor is bound to this transaction.');
    }
    const m = target.teamMembers.get(target.actorMemberId);
    if (
      !m ||
      m.is_deleted ||
      !m.is_active ||
      m.auth_user_id !== target.actorAuthUid
    ) {
      throw makePgError(
        '42501',
        `Bound actor ${target.actorMemberId} does not match an active linked team member.`
      );
    }
    return m.member_id;
  }

  function assertFinanceRole(
    target: MockFinanceStore,
    actorId: string,
    editionId: string
  ): void {
    const ok = target.roleAssignments.some(
      (ra) =>
        ra.member_id === actorId &&
        ra.edition_id === editionId &&
        ra.role === 'finance_collections' &&
        ra.is_current &&
        ra.valid_to === null &&
        !ra.is_deleted
    );
    if (!ok) {
      throw makePgError(
        '42501',
        `Forbidden: actor ${actorId} does not hold finance_collections role in edition ${editionId}.`
      );
    }
  }

  function assertAdminActor(target: MockFinanceStore): string {
    const actor = assertCurrentActor(target);
    const ok = target.roleAssignments.some(
      (ra) =>
        ra.member_id === actor &&
        (ra.role === 'coordination_lead' || ra.role === 'admin') &&
        ra.is_current &&
        ra.valid_to === null &&
        !ra.is_deleted
    );
    if (!ok) {
      throw makePgError(
        '42501',
        'Only a coordination_lead or admin may change team members or roles.'
      );
    }
    return actor;
  }

  function getEditionMeta(editionId: string) {
    if (editionId === 'ED-2025') {
      return {
        edition_id: 'ED-2025',
        name: 'CampusFest 2025',
        record_class: 'historical_synthetic',
        starts_at: '2025-04-12',
        season_start: '2025-01-15',
        preseason_start: '2025-01-01',
        is_current: false,
      };
    }
    if (editionId === 'ED-2026-DEMO') {
      return {
        edition_id: 'ED-2026-DEMO',
        name: 'Demo season 2026-27',
        record_class: 'simulated',
        starts_at: '2027-01-09',
        season_start: '2026-10-26',
        preseason_start: '2026-09-28',
        is_current: true,
      };
    }
    if (editionId === 'ED-2026-LIVE') {
      return {
        edition_id: 'ED-2026-LIVE',
        name: 'Live season 2026-27',
        record_class: 'live',
        starts_at: '2027-01-09',
        season_start: '2026-10-26',
        preseason_start: '2026-09-28',
        is_current: true,
      };
    }
    return null;
  }

  function writeAudit(
    target: MockFinanceStore,
    actorId: string,
    entity: string,
    entityId: string,
    operation: string,
    after: Record<string, unknown>,
    recordClass: string,
    importBatchId: string,
    sourceRef: string,
    evidenceClass: string
  ): number {
    target.dataVersion += 1;
    target.auditEvents.push({
      audit_id: `AUD-${target.auditEvents.length + 1}`,
      actor_id: actorId,
      channel: 'ui',
      entity,
      entity_id: entityId,
      operation,
      after,
      data_version: target.dataVersion,
      record_class: recordClass,
      import_batch_id: importBatchId,
      source_ref: sourceRef,
      evidence_class: evidenceClass,
      created_by: actorId,
    });
    return target.dataVersion;
  }

  function runOnTarget(target: MockFinanceStore, sql: string, params?: unknown[]) {
    const norm = sql.replace(/\s+/g, ' ').trim();

    if (norm.startsWith('SELECT set_config')) {
      const mId = String(params?.[0] ?? '');
      const uId = String(params?.[1] ?? '');
      target.actorMemberId = mId;
      target.actorAuthUid = uId;
      target.setConfigCalls.push(
        { key: 'app.actor_member_id', value: mId },
        { key: 'app.actor_auth_uid', value: uId }
      );
      return { rows: [{ set_config: mId }], rowCount: 1 };
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
          { table_name: 'role_assignment', column_name: 'role_assignment_id' },
          { table_name: 'role_assignment', column_name: 'member_id' },
          { table_name: 'role_assignment', column_name: 'edition_id' },
          { table_name: 'role_assignment', column_name: 'role' },
          { table_name: 'role_assignment', column_name: 'is_current' },
          { table_name: 'role_assignment', column_name: 'valid_to' },
          { table_name: 'role_assignment', column_name: 'is_deleted' },
        ],
        rowCount: 13,
      };
    }

    if (norm.includes('FROM public.team_member') && norm.includes('WHERE auth_user_id = $1')) {
      const authUid = String(params?.[0] ?? '');
      const match = Array.from(target.teamMembers.values()).find(
        (m) => m.auth_user_id === authUid && !m.is_deleted
      );
      if (!match) return { rows: [], rowCount: 0 };
      return {
        rows: [
          {
            member_id: match.member_id,
            full_name: match.full_name,
            email: match.email,
            record_class: match.record_class,
            import_batch_id: 'IB-SIM-2026',
          },
        ],
        rowCount: 1,
      };
    }

    if (norm.includes('FROM public.team_member') && norm.includes('WHERE member_id = $1')) {
      const memberId = String(params?.[0] ?? '');
      const m = target.teamMembers.get(memberId);
      if (!m || m.is_deleted) return { rows: [], rowCount: 0 };
      return { rows: [{ ...m }], rowCount: 1 };
    }

    if (norm.includes('FROM public.role_assignment') && norm.includes('WHERE role_assignment_id = $1')) {
      const raId = String(params?.[0] ?? '');
      const ra = target.roleAssignments.find(
        (r) => r.role_assignment_id === raId && !r.is_deleted
      );
      return { rows: ra ? [{ ...ra }] : [], rowCount: ra ? 1 : 0 };
    }

    if (norm.includes('FROM public.role_assignment') && norm.includes('SELECT role')) {
      const memberId = String(params?.[0] ?? '');
      const roles = target.roleAssignments.filter(
        (r) =>
          r.member_id === memberId &&
          r.is_current &&
          r.valid_to === null &&
          !r.is_deleted
      );
      return {
        rows: roles.map((r) => ({ role: r.role })),
        rowCount: roles.length,
      };
    }

    if (norm.includes('FROM public.festival_edition') && norm.includes('WHERE edition_id = $1')) {
      const edId = String(params?.[0] ?? 'ED-2026-DEMO');
      const meta = getEditionMeta(edId);
      return { rows: meta ? [meta] : [], rowCount: meta ? 1 : 0 };
    }

    if (norm.includes('FROM public.festival_edition') && norm.includes('WHERE record_class = $1')) {
      const rc = String(params?.[0] ?? 'simulated');
      const edId = rc === 'live' ? 'ED-2026-LIVE' : rc === 'historical_synthetic' ? 'ED-2025' : 'ED-2026-DEMO';
      const meta = getEditionMeta(edId);
      return { rows: meta ? [meta] : [], rowCount: meta ? 1 : 0 };
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

    if (norm.includes('FROM public.app_state')) {
      return { rows: [{ data_version: target.dataVersion }], rowCount: 1 };
    }

    if (norm.includes('FROM public.contract c JOIN public.opportunity o')) {
      const contractId = String(params?.[0] ?? '');
      const c = target.contracts.get(contractId);
      if (!c || c.is_deleted || c.valid_to !== null) return { rows: [], rowCount: 0 };
      const o = target.opportunities.get(String(c.opportunity_id));
      if (!o) return { rows: [], rowCount: 0 };
      return {
        rows: [
          {
            contract_id: c.contract_id,
            edition_id: o.edition_id,
            record_class: c.record_class,
          },
        ],
        rowCount: 1,
      };
    }

    if (norm.includes('FROM public.invoice inv JOIN public.contract c')) {
      const invoiceId = String(params?.[0] ?? '');
      const inv = target.invoices.get(invoiceId);
      if (!inv || inv.is_deleted) return { rows: [], rowCount: 0 };
      const c = target.contracts.get(String(inv.contract_id));
      const o = c ? target.opportunities.get(String(c.opportunity_id)) : null;
      return {
        rows: [
          {
            edition_id: o?.edition_id ?? 'ED-2026-DEMO',
            record_class: inv.record_class,
          },
        ],
        rowCount: 1,
      };
    }

    if (norm.includes('FROM public.receipt') && norm.includes('WHERE receipt_id = $1')) {
      const rcId = String(params?.[0] ?? '');
      const r = target.receipts.get(rcId);
      return {
        rows: r && !r.is_deleted ? [{ record_class: r.record_class }] : [],
        rowCount: r && !r.is_deleted ? 1 : 0,
      };
    }

    // Direct finance helper fn_assert_finance_role test
    if (norm.includes('public.fn_assert_finance_role(')) {
      const actorId = String(params?.[0] ?? '');
      const editionId = String(params?.[1] ?? '');
      assertFinanceRole(target, actorId, editionId);
      return { rows: [{ fn_assert_finance_role: null }], rowCount: 1 };
    }

    // RPC: public.record_payment_schedule_item
    if (norm.includes('FROM public.record_payment_schedule_item(')) {
      const actor = assertCurrentActor(target);
      const [
        scheduleItemId,
        contractId,
        kind,
        amountDue,
        dueDate,
        importBatchId,
        sourceRef,
        evidenceClass,
      ] = (params ?? []) as [
        string,
        string,
        string,
        number,
        string,
        string,
        string,
        string,
      ];
      const contract = target.contracts.get(contractId);
      if (!contract || contract.is_deleted || contract.valid_to !== null) {
        throw makePgError('23503', `Active contract ${contractId} not found.`);
      }
      if (contract.status !== 'active') {
        throw makePgError('23514', `Contract ${contractId} is not active.`);
      }
      const opp = target.opportunities.get(String(contract.opportunity_id));
      const editionId = String(opp?.edition_id ?? 'ED-2026-DEMO');
      assertFinanceRole(target, actor, editionId);

      const cashTotal = target.contractLines
        .filter(
          (l) =>
            l.contract_id === contractId &&
            l.consideration_type === 'cash' &&
            !l.is_deleted
        )
        .reduce((sum, l) => sum + Number(l.value ?? 0), 0);
      const scheduledTotal = Array.from(target.scheduleItems.values())
        .filter((ps) => ps.contract_id === contractId && !ps.is_deleted)
        .reduce((sum, ps) => sum + Number(ps.amount_due ?? 0), 0);

      if (scheduledTotal + Number(amountDue) > cashTotal) {
        throw makePgError(
          '23514',
          `Scheduled total (${scheduledTotal + Number(amountDue)}) would exceed contract cash lines total (${cashTotal}).`
        );
      }

      target.scheduleItems.set(scheduleItemId, {
        schedule_item_id: scheduleItemId,
        contract_id: contractId,
        kind,
        amount_due: Number(amountDue),
        due_date: dueDate,
        record_class: contract.record_class,
        import_batch_id: importBatchId,
        source_ref: sourceRef,
        evidence_class: evidenceClass,
        created_by: actor,
        is_deleted: false,
      });

      const ver = writeAudit(
        target,
        actor,
        'PAYMENT_SCHEDULE_ITEM',
        scheduleItemId,
        'insert',
        { contract_id: contractId, kind, amount_due: amountDue, due_date: dueDate },
        String(contract.record_class),
        importBatchId,
        sourceRef,
        evidenceClass
      );
      return {
        rows: [
          {
            schedule_item_id: scheduleItemId,
            contract_id: contractId,
            record_class: contract.record_class,
            data_version: ver,
          },
        ],
        rowCount: 1,
      };
    }

    // RPC: public.record_invoice
    if (norm.includes('FROM public.record_invoice(')) {
      const actor = assertCurrentActor(target);
      const [
        invoiceId,
        invoiceNo,
        contractId,
        scheduleItemId,
        issuedAt,
        amount,
        taxAmount,
        documentUri,
        importBatchId,
        sourceRef,
        evidenceClass,
      ] = (params ?? []) as [
        string,
        string,
        string,
        string | null,
        string,
        number,
        number,
        string | null,
        string,
        string,
        string,
      ];
      const contract = target.contracts.get(contractId);
      if (!contract || contract.is_deleted || contract.valid_to !== null) {
        throw makePgError('23503', `Active contract ${contractId} not found.`);
      }
      const opp = target.opportunities.get(String(contract.opportunity_id));
      const editionId = String(opp?.edition_id ?? 'ED-2026-DEMO');
      assertFinanceRole(target, actor, editionId);

      if (scheduleItemId) {
        const ps = target.scheduleItems.get(scheduleItemId);
        if (!ps || ps.is_deleted || ps.contract_id !== contractId) {
          throw makePgError(
            '23514',
            `schedule_item_id ${scheduleItemId} does not belong to contract ${contractId}.`
          );
        }
      }

      target.invoices.set(invoiceId, {
        invoice_id: invoiceId,
        invoice_no: invoiceNo,
        contract_id: contractId,
        schedule_item_id: scheduleItemId,
        issued_at: issuedAt,
        amount: Number(amount),
        tax_amount: Number(taxAmount ?? 0),
        status: 'issued',
        document_uri: documentUri,
        record_class: contract.record_class,
        import_batch_id: importBatchId,
        source_ref: sourceRef,
        evidence_class: evidenceClass,
        created_by: actor,
        is_deleted: false,
      });

      const ver = writeAudit(
        target,
        actor,
        'INVOICE',
        invoiceId,
        'insert',
        {
          invoice_no: invoiceNo,
          contract_id: contractId,
          schedule_item_id: scheduleItemId,
          issued_at: issuedAt,
          amount,
          tax_amount: taxAmount ?? 0,
        },
        String(contract.record_class),
        importBatchId,
        sourceRef,
        evidenceClass
      );
      return {
        rows: [
          {
            invoice_id: invoiceId,
            invoice_no: invoiceNo,
            record_class: contract.record_class,
            data_version: ver,
          },
        ],
        rowCount: 1,
      };
    }

    // RPC: public.cancel_invoice
    if (norm.includes('FROM public.cancel_invoice(')) {
      const actor = assertCurrentActor(target);
      const [
        editionId,
        invoiceId,
        reason,
        importBatchId,
        sourceRef,
        evidenceClass,
      ] = (params ?? []) as [string, string, string, string, string, string];
      assertFinanceRole(target, actor, editionId);
      if (!reason || !reason.trim()) {
        throw makePgError('23514', 'A cancellation reason is required.');
      }
      const inv = target.invoices.get(invoiceId);
      const contract = inv ? target.contracts.get(String(inv.contract_id)) : null;
      const opp = contract
        ? target.opportunities.get(String(contract.opportunity_id))
        : null;
      if (!inv || inv.is_deleted || opp?.edition_id !== editionId) {
        throw makePgError('23503', `Invoice ${invoiceId} not found in edition ${editionId}.`);
      }
      if (inv.status !== 'issued') {
        throw makePgError('23514', `Invoice ${invoiceId} is ${inv.status} and cannot be cancelled.`);
      }
      const hasAlloc = target.allocations.some(
        (a) => a.invoice_id === invoiceId && !a.is_deleted
      );
      if (hasAlloc) {
        throw makePgError(
          '23514',
          `Invoice ${invoiceId} has allocated receipts and cannot be cancelled.`
        );
      }
      inv.status = 'cancelled';
      const ver = writeAudit(
        target,
        actor,
        'INVOICE',
        invoiceId,
        'update',
        { status: 'cancelled', reason },
        String(inv.record_class),
        importBatchId,
        sourceRef,
        evidenceClass
      );
      return {
        rows: [{ invoice_id: invoiceId, status: 'cancelled', data_version: ver }],
        rowCount: 1,
      };
    }

    // RPC: public.record_receipt
    if (norm.includes('FROM public.record_receipt(')) {
      const actor = assertCurrentActor(target);
      const [
        editionId,
        receiptId,
        sponsorId,
        receivedAt,
        amount,
        method,
        bankReference,
        importBatchId,
        sourceRef,
        evidenceClass,
      ] = (params ?? []) as [
        string,
        string,
        string,
        string,
        number,
        string,
        string,
        string,
        string,
        string,
      ];
      const edMeta = getEditionMeta(editionId);
      if (
        !edMeta ||
        (edMeta.record_class !== 'live' && edMeta.record_class !== 'simulated')
      ) {
        throw makePgError('23514', 'Receipts require a live or simulated festival_edition.');
      }
      assertFinanceRole(target, actor, editionId);

      const sponsor = target.sponsors.get(sponsorId);
      if (!sponsor || sponsor.is_deleted) {
        throw makePgError('23503', `Sponsor ${sponsorId} not found.`);
      }
      if (sponsor.record_class !== edMeta.record_class) {
        throw makePgError('23514', 'Sponsor record_class does not match edition record_class.');
      }

      target.receipts.set(receiptId, {
        receipt_id: receiptId,
        sponsor_id: sponsorId,
        received_at: receivedAt,
        amount: Number(amount),
        method,
        bank_reference: bankReference,
        reconciled: false,
        reconciled_at: null,
        recorded_by: actor,
        record_class: edMeta.record_class,
        import_batch_id: importBatchId,
        source_ref: sourceRef,
        evidence_class: evidenceClass,
        created_by: actor,
        is_deleted: false,
      });

      const ver = writeAudit(
        target,
        actor,
        'RECEIPT',
        receiptId,
        'insert',
        {
          sponsor_id: sponsorId,
          received_at: receivedAt,
          amount,
          method,
          bank_reference: bankReference,
          reconciled: false,
        },
        edMeta.record_class,
        importBatchId,
        sourceRef,
        evidenceClass
      );
      return {
        rows: [
          {
            receipt_id: receiptId,
            sponsor_id: sponsorId,
            reconciled: false,
            record_class: edMeta.record_class,
            data_version: ver,
          },
        ],
        rowCount: 1,
      };
    }

    // RPC: public.allocate_receipt (includes INV-01 sponsor/contract ownership enforcement)
    if (norm.includes('FROM public.allocate_receipt(')) {
      const actor = assertCurrentActor(target);
      const [
        editionId,
        allocationId,
        receiptId,
        invoiceId,
        scheduleItemId,
        amount,
        importBatchId,
        sourceRef,
        evidenceClass,
      ] = (params ?? []) as [
        string,
        string,
        string,
        string | null,
        string | null,
        number,
        string,
        string,
        string,
      ];
      assertFinanceRole(target, actor, editionId);
      const edMeta = getEditionMeta(editionId);
      const receipt = target.receipts.get(receiptId);
      if (!receipt || receipt.is_deleted) {
        throw makePgError('23503', `Receipt ${receiptId} not found.`);
      }
      if (receipt.record_class !== edMeta?.record_class) {
        throw makePgError('23514', `Receipt ${receiptId} is not in edition record class.`);
      }

      if (scheduleItemId) {
        const ps = target.scheduleItems.get(scheduleItemId);
        const contract = ps ? target.contracts.get(String(ps.contract_id)) : null;
        const opp = contract
          ? target.opportunities.get(String(contract.opportunity_id))
          : null;
        if (!ps || ps.is_deleted || !opp || opp.edition_id !== editionId) {
          throw makePgError(
            '23503',
            `payment_schedule_item ${scheduleItemId} not found in edition ${editionId}.`
          );
        }
        if (opp.sponsor_id !== receipt.sponsor_id) {
          throw makePgError(
            'P0001',
            `INV-01 violation: receipt ${receiptId} belongs to sponsor ${receipt.sponsor_id}, not schedule item sponsor ${opp.sponsor_id}.`
          );
        }
      }

      if (invoiceId) {
        const inv = target.invoices.get(invoiceId);
        const contract = inv ? target.contracts.get(String(inv.contract_id)) : null;
        const opp = contract
          ? target.opportunities.get(String(contract.opportunity_id))
          : null;
        if (!inv || inv.is_deleted || !opp || opp.edition_id !== editionId) {
          throw makePgError(
            '23503',
            `invoice ${invoiceId} not found in edition ${editionId}.`
          );
        }
        if (inv.status === 'cancelled') {
          throw makePgError(
            '23514',
            `INV-01 violation: invoice ${invoiceId} is cancelled and cannot receive allocations.`
          );
        }
        if (opp.sponsor_id !== receipt.sponsor_id) {
          throw makePgError(
            'P0001',
            `INV-01 violation: receipt ${receiptId} belongs to sponsor ${receipt.sponsor_id}, not invoice sponsor ${opp.sponsor_id}.`
          );
        }
      }

      target.allocations.push({
        allocation_id: allocationId,
        receipt_id: receiptId,
        invoice_id: invoiceId,
        schedule_item_id: scheduleItemId,
        amount: Number(amount),
        record_class: receipt.record_class,
        import_batch_id: importBatchId,
        source_ref: sourceRef,
        evidence_class: evidenceClass,
        created_by: actor,
        is_deleted: false,
      });

      const ver = writeAudit(
        target,
        actor,
        'RECEIPT_ALLOCATION',
        allocationId,
        'insert',
        {
          receipt_id: receiptId,
          invoice_id: invoiceId,
          schedule_item_id: scheduleItemId,
          amount,
        },
        String(receipt.record_class),
        importBatchId,
        sourceRef,
        evidenceClass
      );
      return {
        rows: [
          {
            allocation_id: allocationId,
            receipt_id: receiptId,
            record_class: receipt.record_class,
            data_version: ver,
          },
        ],
        rowCount: 1,
      };
    }

    // RPC: public.reconcile_receipt
    if (norm.includes('FROM public.reconcile_receipt(')) {
      const actor = assertCurrentActor(target);
      const [editionId, receiptId, importBatchId, sourceRef, evidenceClass] =
        (params ?? []) as [string, string, string, string, string];
      assertFinanceRole(target, actor, editionId);
      const edMeta = getEditionMeta(editionId);
      const receipt = target.receipts.get(receiptId);
      if (!receipt || receipt.is_deleted) {
        throw makePgError('23503', `Receipt ${receiptId} not found.`);
      }
      if (receipt.record_class !== edMeta?.record_class) {
        throw makePgError('23514', `Receipt ${receiptId} is not in edition record class.`);
      }
      if (receipt.reconciled) {
        throw makePgError('23514', `Receipt ${receiptId} is already reconciled.`);
      }
      const ts = '2026-11-26T12:00:00Z';
      receipt.reconciled = true;
      receipt.reconciled_at = ts;

      const ver = writeAudit(
        target,
        actor,
        'RECEIPT',
        receiptId,
        'update',
        { reconciled: true, reconciled_at: ts },
        String(receipt.record_class),
        importBatchId,
        sourceRef,
        evidenceClass
      );
      return {
        rows: [
          {
            receipt_id: receiptId,
            reconciled: true,
            reconciled_at: ts,
            data_version: ver,
          },
        ],
        rowCount: 1,
      };
    }

    // PATCH /api/contracts/:id (direct UPDATE payment_terms)
    if (norm.startsWith('UPDATE public.contract SET payment_terms = $1')) {
      const paymentTerms = String(params?.[0] ?? '');
      const contractId = String(params?.[1] ?? '');
      const contract = target.contracts.get(contractId);
      if (!contract || contract.is_deleted || contract.valid_to !== null) {
        return { rows: [], rowCount: 0 };
      }
      contract.payment_terms = paymentTerms;
      return { rows: [{ ...contract }], rowCount: 1 };
    }

    // Direct audit insert (for PATCH /api/contracts/:id)
    if (norm.startsWith('INSERT INTO public.audit_event')) {
      const [
        auditId,
        actorId,
        channel,
        entity,
        entityId,
        operation,
        afterJson,
        dataVersion,
        recordClass,
        importBatchId,
        sourceRef,
        evidenceClass,
      ] = (params ?? []) as [
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        number,
        string,
        string,
        string,
        string,
      ];
      target.dataVersion += 1;
      target.auditEvents.push({
        audit_id: auditId,
        actor_id: actorId,
        channel,
        entity,
        entity_id: entityId,
        operation,
        after: JSON.parse(afterJson),
        data_version: dataVersion,
        record_class: recordClass,
        import_batch_id: importBatchId,
        source_ref: sourceRef,
        evidence_class: evidenceClass,
      });
      return { rows: [], rowCount: 1 };
    }

    // RPC: public.create_team_member
    if (norm.includes('public.create_team_member(')) {
      const actor = assertAdminActor(target);
      const [memberId, fullName, email, editionId, importBatchId] =
        (params ?? []) as [string, string, string | null, string, string];
      const edMeta = getEditionMeta(editionId);
      if (
        !edMeta ||
        (edMeta.record_class !== 'live' && edMeta.record_class !== 'simulated')
      ) {
        throw makePgError('23514', 'Team members are created in a live or simulated edition.');
      }
      target.teamMembers.set(memberId, {
        member_id: memberId,
        full_name: fullName,
        email,
        auth_user_id: null,
        is_active: true,
        record_class: edMeta.record_class,
        is_deleted: false,
      });
      const ver = writeAudit(
        target,
        actor,
        'TEAM_MEMBER',
        memberId,
        'insert',
        { member_id: memberId, full_name: fullName, email },
        edMeta.record_class,
        importBatchId,
        'ui:team_admin',
        'T'
      );
      return { rows: [{ data_version: ver }], rowCount: 1 };
    }

    // RPC: public.link_auth_user
    if (norm.includes('public.link_auth_user(')) {
      const actor = assertAdminActor(target);
      const [memberId, authUserId, importBatchId] = (params ?? []) as [
        string,
        string,
        string,
      ];
      const member = target.teamMembers.get(memberId);
      if (!member || member.is_deleted || member.auth_user_id !== null) {
        throw makePgError(
          '23514',
          `Member ${memberId} not found or already linked to a login.`
        );
      }
      member.auth_user_id = authUserId;
      const ver = writeAudit(
        target,
        actor,
        'TEAM_MEMBER',
        memberId,
        'update',
        { auth_user_id: authUserId },
        member.record_class,
        importBatchId,
        'ui:team_admin',
        'T'
      );
      return { rows: [{ data_version: ver }], rowCount: 1 };
    }

    // RPC: public.assign_role
    if (norm.includes('public.assign_role(')) {
      const actor = assertAdminActor(target);
      const [roleAssignmentId, memberId, editionId, role, importBatchId] =
        (params ?? []) as [string, string, string, CanonicalRole, string];
      const edMeta = getEditionMeta(editionId);
      if (!edMeta) {
        throw makePgError('23503', `Edition ${editionId} not found.`);
      }
      target.roleAssignments.push({
        role_assignment_id: roleAssignmentId,
        member_id: memberId,
        edition_id: editionId,
        role,
        is_current: true,
        valid_to: null,
        record_class: edMeta.record_class,
        is_deleted: false,
      });
      const ver = writeAudit(
        target,
        actor,
        'ROLE_ASSIGNMENT',
        roleAssignmentId,
        'insert',
        { member_id: memberId, edition_id: editionId, role },
        edMeta.record_class,
        importBatchId,
        'ui:team_admin',
        'T'
      );
      return { rows: [{ data_version: ver }], rowCount: 1 };
    }

    // RPC: public.end_role
    if (norm.includes('public.end_role(')) {
      const actor = assertAdminActor(target);
      const [roleAssignmentId, importBatchId] = (params ?? []) as [string, string];
      const ra = target.roleAssignments.find(
        (r) =>
          r.role_assignment_id === roleAssignmentId &&
          r.is_current &&
          !r.is_deleted
      );
      if (!ra) {
        throw makePgError(
          '23514',
          `Role assignment ${roleAssignmentId} not found or already ended.`
        );
      }
      ra.is_current = false;
      ra.valid_to = '2026-11-26T12:00:00Z';
      const ver = writeAudit(
        target,
        actor,
        'ROLE_ASSIGNMENT',
        roleAssignmentId,
        'update',
        { is_current: false },
        ra.record_class,
        importBatchId,
        'ui:team_admin',
        'T'
      );
      return { rows: [{ data_version: ver }], rowCount: 1 };
    }

    // metrics.get_metric('M-01', ...)
    if (norm.includes('FROM metrics.get_metric(')) {
      const metricId = String(params?.[0] ?? 'M-01');
      const recordClass = String(params?.[1] ?? 'simulated');
      const editionId = String(params?.[2] ?? 'ED-2026-DEMO');
      const val =
        metricId === 'M-01'
          ? computeM01(target, recordClass, editionId)
          : 0;
      return {
        rows: [
          {
            metric_id: metricId,
            value: val,
            numerator: val,
            denominator: 1,
            computable: true,
            reason: null,
            applied_filters: {},
            record_class: recordClass,
            edition_id: editionId,
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

  return {
    pool: {
      async query(sql: string, params?: unknown[]) {
        return runOnTarget(storeRef.current, sql, params);
      },
      async connect(): Promise<PoolClient> {
        let txStore: MockFinanceStore | null = null;
        return {
          async query(sql: string, params?: unknown[]) {
            const norm = sql.replace(/\s+/g, ' ').trim();
            if (norm === 'BEGIN') {
              txStore = cloneStore(storeRef.current);
              return { rows: [], rowCount: 0 };
            }
            if (norm === 'COMMIT') {
              if (txStore) {
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

function buildStage3CTestApp(
  memberHeaderRef: { current: string },
  storeRef: { current: MockFinanceStore }
) {
  const config = createTestConfig();
  const mock = createStage3CMockPool(storeRef);
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
  app.use('/api', createFinanceAndTeamApiRouter(config, dbState, authDeps));
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

test('[MOCKED] Stage 3C Test 1: Two-step receipt -> allocate -> M-01 unchanged -> reconcile -> M-01 increases + audit', async () => {
  const storeRef = { current: createInitialFinanceStore() };
  const actorRef = { current: 'SIM-FIN' };
  const { app } = buildStage3CTestApp(actorRef, storeRef);

  const m01Baseline = await sendRequest(app, 'POST', '/api/metrics/query', {
    metric_ids: ['M-01'],
    edition_id: 'ED-2026-DEMO',
    record_class: 'simulated',
  });
  assert.equal(m01Baseline.status, 200);
  const startM01 = Number(
    ((m01Baseline.json.metrics as Array<Record<string, unknown>>)[0]?.value) ?? 0
  );
  assert.equal(startM01, 0);

  // Guard: immediate reconciled=true is refused
  const immediateAttempt = await sendRequest(app, 'POST', '/api/collections/receipts', {
    sponsorId: 'SP26-BRAMBLE',
    receivedAt: '2026-11-26T10:00:00+05:30',
    amount: 50000,
    method: 'bank_transfer',
    bankReference: 'UTR-99001',
    reconciled: true,
  });
  assert.equal(immediateAttempt.status, 422);

  // Step 1: Record receipt unreconciled
  const receiptRes = await sendRequest(app, 'POST', '/api/collections/receipts', {
    sponsorId: 'SP26-BRAMBLE',
    receivedAt: '2026-11-26T10:00:00+05:30',
    amount: 50000,
    method: 'bank_transfer',
    bankReference: 'UTR-99001',
    reconciled: false,
  });
  assert.equal(receiptRes.status, 201);
  const receiptId = String(receiptRes.json.id);
  assert.ok(receiptId.startsWith('RC-'));
  assert.equal(receiptRes.json.reconciled, false);
  assert.ok(Number(receiptRes.json.dataVersion) > 42);

  const m01AfterReceipt = await sendRequest(app, 'POST', '/api/metrics/query', {
    metric_ids: ['M-01'],
    edition_id: 'ED-2026-DEMO',
    record_class: 'simulated',
  });
  assert.equal(
    Number(((m01AfterReceipt.json.metrics as Array<Record<string, unknown>>)[0]?.value) ?? 0),
    0
  );

  // Allocate to Bramble's schedule item
  const allocRes = await sendRequest(app, 'POST', '/api/collections/allocations', {
    receiptId,
    scheduleItemId: 'PS26-BRAMBLE-ADV',
    amount: 50000,
  });
  assert.equal(allocRes.status, 201);
  assert.ok(String(allocRes.json.id).startsWith('AL-'));

  // M-01 MUST still be 0 before reconcile
  const m01AfterAlloc = await sendRequest(app, 'POST', '/api/metrics/query', {
    metric_ids: ['M-01'],
    edition_id: 'ED-2026-DEMO',
    record_class: 'simulated',
  });
  assert.equal(
    Number(((m01AfterAlloc.json.metrics as Array<Record<string, unknown>>)[0]?.value) ?? 0),
    0
  );

  // Step 2: Reconcile receipt -> M-01 increases by 50,000
  const recRes = await sendRequest(
    app,
    'POST',
    `/api/collections/receipts/${receiptId}/reconcile`,
    {}
  );
  assert.equal(recRes.status, 200);
  assert.equal(recRes.json.reconciled, true);

  const m01AfterReconcile = await sendRequest(app, 'POST', '/api/metrics/query', {
    metric_ids: ['M-01'],
    edition_id: 'ED-2026-DEMO',
    record_class: 'simulated',
  });
  assert.equal(
    Number(((m01AfterReconcile.json.metrics as Array<Record<string, unknown>>)[0]?.value) ?? 0),
    50000
  );

  assert.equal(storeRef.current.auditEvents.length, 3);
  assert.ok(
    storeRef.current.auditEvents.every((a) => a.actor_id === 'SIM-FIN' && a.channel === 'ui')
  );
  assert.ok(storeRef.current.importBatches.has('IB-UI-ED-2026-DEMO'));
});

test('[MOCKED] Stage 3C Test 2: SIM-LEAD is rejected (403) on finance routes and DB fn_assert_finance_role', async () => {
  const storeRef = { current: createInitialFinanceStore() };
  const actorRef = { current: 'SIM-LEAD' };
  const { app, dbState } = buildStage3CTestApp(actorRef, storeRef);

  const postReceipt = await sendRequest(app, 'POST', '/api/collections/receipts', {
    sponsorId: 'SP26-BRAMBLE',
    receivedAt: '2026-11-26T10:00:00+05:30',
    amount: 25000,
    method: 'upi',
    bankReference: 'UPI-1122',
    reconciled: false,
  });
  assert.equal(postReceipt.status, 403);

  const postSchedule = await sendRequest(app, 'POST', '/api/collections/schedule', {
    contractId: 'KC26-BRAMBLE',
    kind: 'balance',
    amountDue: 100000,
    dueDate: '2026-12-20',
  });
  assert.equal(postSchedule.status, 403);

  const patchContract = await sendRequest(app, 'PATCH', '/api/contracts/KC26-BRAMBLE', {
    paymentTerms: 'custom',
  });
  assert.equal(patchContract.status, 403);

  // Even calling the database role check directly refuses SIM-LEAD with SQLSTATE 42501
  await assert.rejects(
    () =>
      dbState.pool!.query(`SELECT public.fn_assert_finance_role($1, $2)`, [
        'SIM-LEAD',
        'ED-2026-DEMO',
      ]),
    (err: unknown) =>
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err as { code?: string }).code === '42501'
  );
});

test('[MOCKED] Stage 3C Test 3: Allocating Alpha receipt against Bramble schedule fails 422 INV-01 & rolls back', async () => {
  const storeRef = { current: createInitialFinanceStore() };
  const actorRef = { current: 'SIM-FIN' };
  const { app } = buildStage3CTestApp(actorRef, storeRef);

  const alphaReceipt = await sendRequest(app, 'POST', '/api/collections/receipts', {
    sponsorId: 'SP26-ALPHA',
    receivedAt: '2026-11-26T10:00:00+05:30',
    amount: 40000,
    method: 'bank_transfer',
    bankReference: 'UTR-ALPHA-1',
    reconciled: false,
  });
  assert.equal(alphaReceipt.status, 201);
  const alphaReceiptId = String(alphaReceipt.json.id);

  const beforeAllocCount = storeRef.current.allocations.length;
  const beforeAuditCount = storeRef.current.auditEvents.length;

  const crossAlloc = await sendRequest(app, 'POST', '/api/collections/allocations', {
    receiptId: alphaReceiptId,
    scheduleItemId: 'PS26-BRAMBLE-ADV',
    amount: 40000,
  });
  assert.equal(crossAlloc.status, 422);
  assert.match(String(crossAlloc.json.message), /INV-01/i);
  assert.equal(storeRef.current.allocations.length, beforeAllocCount);
  assert.equal(storeRef.current.auditEvents.length, beforeAuditCount);
});

test('[MOCKED] Stage 3C Test 4: Invoice cancellation refuses allocated invoice (422), cancels unallocated issued invoice, and PATCH /contracts/:id allows payment_terms only', async () => {
  const storeRef = { current: createInitialFinanceStore() };
  const actorRef = { current: 'SIM-FIN' };
  const { app } = buildStage3CTestApp(actorRef, storeRef);

  // Invoice 1 (will be allocated -> cancel rejected 422)
  const inv1 = await sendRequest(app, 'POST', '/api/collections/invoices', {
    contractId: 'KC26-BRAMBLE',
    scheduleItemId: 'PS26-BRAMBLE-ADV',
    invoiceNo: 'INV-2026-001',
    issuedAt: '2026-11-26T09:00:00+05:30',
    amount: 100000,
    taxAmount: 18000,
  });
  assert.equal(inv1.status, 201);
  const inv1Id = String(inv1.json.id);
  assert.ok(inv1Id.startsWith('IV-'));

  const rc = await sendRequest(app, 'POST', '/api/collections/receipts', {
    sponsorId: 'SP26-BRAMBLE',
    receivedAt: '2026-11-26T11:00:00+05:30',
    amount: 60000,
    method: 'cheque',
    bankReference: 'CHQ-771',
    reconciled: false,
  });
  assert.equal(rc.status, 201);

  const alloc = await sendRequest(app, 'POST', '/api/collections/allocations', {
    receiptId: String(rc.json.id),
    invoiceId: inv1Id,
    amount: 60000,
  });
  assert.equal(alloc.status, 201);

  const cancelBlocked = await sendRequest(
    app,
    'POST',
    `/api/collections/invoices/${inv1Id}/cancel`,
    { reason: 'Duplicate issue' }
  );
  assert.equal(cancelBlocked.status, 422);
  assert.match(String(cancelBlocked.json.message), /allocated receipts/i);

  // Invoice 2 (unallocated -> cancel succeeds, second cancel rejected 422)
  const inv2 = await sendRequest(app, 'POST', '/api/collections/invoices', {
    contractId: 'KC26-BRAMBLE',
    invoiceNo: 'INV-2026-002',
    issuedAt: '2026-11-26T09:15:00+05:30',
    amount: 50000,
    taxAmount: 0,
  });
  assert.equal(inv2.status, 201);
  const inv2Id = String(inv2.json.id);

  const cancelOk = await sendRequest(
    app,
    'POST',
    `/api/collections/invoices/${inv2Id}/cancel`,
    { reason: 'Issued in error' }
  );
  assert.equal(cancelOk.status, 200);
  assert.equal(cancelOk.json.status, 'cancelled');

  const cancelTwice = await sendRequest(
    app,
    'POST',
    `/api/collections/invoices/${inv2Id}/cancel`,
    { reason: 'Retry' }
  );
  assert.equal(cancelTwice.status, 422);

  // PATCH /api/contracts/:id accepts payment_terms, refuses immutable fields
  const patchOk = await sendRequest(app, 'PATCH', '/api/contracts/KC26-BRAMBLE', {
    paymentTerms: 'custom',
  });
  assert.equal(patchOk.status, 200);
  assert.equal(patchOk.json.payment_terms, 'custom');

  const patchImmutable = await sendRequest(app, 'PATCH', '/api/contracts/KC26-BRAMBLE', {
    paymentTerms: '100_upfront',
    signedValueTotal: 999999,
  });
  assert.equal(patchImmutable.status, 422);
});

test('[MOCKED] Stage 3C Test 5: Team/role admin routes enforce coordination_lead/admin RBAC & historical edition guard', async () => {
  const storeRef = { current: createInitialFinanceStore() };
  const actorRef = { current: 'SIM-LEAD' };
  const { app } = buildStage3CTestApp(actorRef, storeRef);

  // SIM-LEAD creates a member, links auth UUID, assigns role, ends role
  const created = await sendRequest(app, 'POST', '/api/team/members', {
    fullName: 'Ananya Verma',
    email: 'ananya@demo.local',
    editionId: 'ED-2026-DEMO',
  });
  assert.equal(created.status, 201);
  const newMemberId = String(created.json.id);
  assert.ok(newMemberId.startsWith('TM-'));
  assert.equal(created.json.auth_linked, false);

  const linked = await sendRequest(app, 'POST', `/api/team/members/${newMemberId}/link`, {
    authUserId: '11111111-2222-4333-8444-555555555555',
    editionId: 'ED-2026-DEMO',
  });
  assert.equal(linked.status, 200);
  assert.equal(linked.json.auth_linked, true);

  const assigned = await sendRequest(app, 'POST', '/api/team/roles', {
    memberId: newMemberId,
    role: 'partnerships',
    editionId: 'ED-2026-DEMO',
  });
  assert.equal(assigned.status, 201);
  const roleAssignmentId = String(assigned.json.id);
  assert.ok(roleAssignmentId.startsWith('RA-'));

  const ended = await sendRequest(app, 'POST', `/api/team/roles/${roleAssignmentId}/end`, {
    editionId: 'ED-2026-DEMO',
  });
  assert.equal(ended.status, 200);
  assert.equal(ended.json.is_current, false);

  // Historical edition writes are refused with 403
  const historicalTeamWrite = await sendRequest(app, 'POST', '/api/team/members', {
    fullName: 'Historical User',
    editionId: 'ED-2025',
  });
  assert.equal(historicalTeamWrite.status, 403);

  // SIM-OPS (non-admin) is refused with 403 on all team/role routes
  actorRef.current = 'SIM-OPS';
  const opsCreateMember = await sendRequest(app, 'POST', '/api/team/members', {
    fullName: 'Unauthorized Member',
    editionId: 'ED-2026-DEMO',
  });
  assert.equal(opsCreateMember.status, 403);

  const opsAssignRole = await sendRequest(app, 'POST', '/api/team/roles', {
    memberId: 'SIM-OPS',
    role: 'admin',
    editionId: 'ED-2026-DEMO',
  });
  assert.equal(opsAssignRole.status, 403);

  const opsEndRole = await sendRequest(app, 'POST', '/api/team/roles/RA-SIM-FIN/end', {
    editionId: 'ED-2026-DEMO',
  });
  assert.equal(opsEndRole.status, 403);
});
