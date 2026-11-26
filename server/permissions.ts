import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { AppApiError } from './errors.ts';

export type CanonicalRole =
  | 'coordination_lead'
  | 'pipeline_ops'
  | 'finance_collections'
  | 'partnerships'
  | 'community'
  | 'network'
  | 'premium_sales'
  | 'viewer'
  | 'admin';

export const CANONICAL_ROLE_SET: ReadonlySet<CanonicalRole> = new Set([
  'coordination_lead',
  'pipeline_ops',
  'finance_collections',
  'partnerships',
  'community',
  'network',
  'premium_sales',
  'viewer',
  'admin',
]);

export type BusinessEntityDomain =
  | 'sponsors_contacts_research'
  | 'outreach_interactions_meetings_qualifications'
  | 'opportunities_stage'
  | 'proposals'
  | 'contracts_lines'
  | 'payment_schedule_invoices'
  | 'receipts_allocations'
  | 'tasks'
  | 'targets_rules_scenarios_metrics'
  | 'forecast_versions'
  | 'escalations'
  | 'hours_staffing'
  | 'audit_ai_logs';

export type PermissionOperation = 'create' | 'read' | 'update' | 'approve';
export type PermissionScope = 'all' | 'own' | 'none';

interface RoleGrantRule {
  create?: PermissionScope;
  read?: PermissionScope;
  update?: PermissionScope;
  approve?: PermissionScope;
  condition?: string;
}

type RolePermissionMatrix = Record<
  CanonicalRole,
  Partial<Record<BusinessEntityDomain, RoleGrantRule>>
>;

const SALES_GRANT: Partial<Record<BusinessEntityDomain, RoleGrantRule>> = {
  sponsors_contacts_research: { create: 'own', read: 'own', update: 'own' },
  outreach_interactions_meetings_qualifications: {
    create: 'own',
    read: 'own',
    update: 'own',
  },
  opportunities_stage: { create: 'own', read: 'own', update: 'own', approve: 'own' },
  proposals: { create: 'own', read: 'own', update: 'own' },
  contracts_lines: {
    create: 'own',
    read: 'own',
    update: 'own',
    approve: 'own',
    condition: 'Update permitted only before signing.',
  },
  payment_schedule_invoices: { read: 'all' },
  receipts_allocations: {
    read: 'own',
    condition: 'Own deals, totals only; bank references redacted.',
  },
  tasks: { create: 'own', read: 'own', update: 'own' },
  targets_rules_scenarios_metrics: { read: 'all' },
  forecast_versions: { read: 'all' },
  escalations: { create: 'own', read: 'own', update: 'own' },
  hours_staffing: { create: 'own', read: 'own', update: 'own' },
};

/**
 * Central role & permission matrix implementing 02_architecture_requirements.md §4.
 * Unverified users or users with no assigned canonical roles resolve to 'none'.
 */
export const PERMISSION_MATRIX: RolePermissionMatrix = {
  coordination_lead: {
    sponsors_contacts_research: { create: 'all', read: 'all', update: 'all' },
    outreach_interactions_meetings_qualifications: {
      create: 'all',
      read: 'all',
      update: 'all',
    },
    opportunities_stage: {
      create: 'all',
      read: 'all',
      update: 'all',
      approve: 'all',
    },
    proposals: { create: 'all', read: 'all', update: 'all', approve: 'all' },
    contracts_lines: {
      create: 'all',
      read: 'all',
      update: 'all',
      approve: 'all',
    },
    payment_schedule_invoices: { read: 'all' },
    receipts_allocations: { read: 'all' },
    tasks: { create: 'all', read: 'all', update: 'all', approve: 'all' },
    targets_rules_scenarios_metrics: {
      read: 'all',
      condition: 'Changes require an approved decision record.',
    },
    forecast_versions: {
      read: 'all',
      approve: 'all',
      condition: 'Publish approved offline forecast versions only.',
    },
    escalations: {
      create: 'all',
      read: 'all',
      update: 'all',
      approve: 'all',
    },
    hours_staffing: {
      create: 'all',
      read: 'all',
      update: 'all',
      approve: 'all',
    },
    audit_ai_logs: { read: 'all' },
  },
  pipeline_ops: {
    sponsors_contacts_research: { create: 'all', read: 'all', update: 'all' },
    outreach_interactions_meetings_qualifications: {
      create: 'all',
      read: 'all',
      update: 'all',
    },
    opportunities_stage: { create: 'all', read: 'all', update: 'all' },
    proposals: { create: 'all', read: 'all', update: 'all' },
    contracts_lines: { read: 'all' },
    payment_schedule_invoices: { read: 'all' },
    tasks: { create: 'all', read: 'all', update: 'all' },
    targets_rules_scenarios_metrics: { read: 'all' },
    forecast_versions: { read: 'all' },
    escalations: { create: 'all', read: 'all', update: 'all' },
    hours_staffing: { create: 'own', read: 'own', update: 'own' },
  },
  finance_collections: {
    sponsors_contacts_research: { read: 'all' },
    outreach_interactions_meetings_qualifications: { read: 'all' },
    opportunities_stage: { read: 'all' },
    proposals: { read: 'all' },
    contracts_lines: {
      read: 'all',
      update: 'all',
      condition: 'Payment terms updates only.',
    },
    payment_schedule_invoices: {
      create: 'all',
      read: 'all',
      update: 'all',
      approve: 'all',
    },
    receipts_allocations: {
      create: 'all',
      read: 'all',
      update: 'all',
      approve: 'all',
    },
    tasks: { create: 'own', read: 'own', update: 'own' },
    targets_rules_scenarios_metrics: { read: 'all' },
    forecast_versions: { read: 'all' },
    escalations: { create: 'own', read: 'own', update: 'own' },
    hours_staffing: { create: 'own', read: 'own', update: 'own' },
  },
  partnerships: SALES_GRANT,
  community: SALES_GRANT,
  network: SALES_GRANT,
  premium_sales: SALES_GRANT,
  viewer: {
    sponsors_contacts_research: { read: 'all' },
    outreach_interactions_meetings_qualifications: { read: 'all' },
    opportunities_stage: { read: 'all' },
    proposals: { read: 'all' },
    contracts_lines: { read: 'all' },
    tasks: { read: 'all' },
    targets_rules_scenarios_metrics: { read: 'all' },
    forecast_versions: { read: 'all' },
    escalations: { read: 'all' },
  },
  // Standalone admin role is kept separate from business roles (OD-24):
  // team/role administration + read access to audit and AI logs.
  admin: {
    audit_ai_logs: { read: 'all' },
  },
};

export interface PermissionDecision {
  allowed: boolean;
  scope: PermissionScope;
  entity: BusinessEntityDomain;
  operation: PermissionOperation;
  conditions: string[];
}

export function isCanonicalRole(value: string): value is CanonicalRole {
  return CANONICAL_ROLE_SET.has(value as CanonicalRole);
}

export const SALES_ROLE_SET: ReadonlySet<CanonicalRole> = new Set([
  'partnerships',
  'community',
  'network',
  'premium_sales',
]);

export function canConfirmOpportunity(
  roles: ReadonlyArray<CanonicalRole>,
  isOwner: boolean
): boolean {
  if (!roles || roles.length === 0) return false;
  if (roles.includes('coordination_lead')) return true;
  if (isOwner && roles.some((r) => SALES_ROLE_SET.has(r))) return true;
  return false;
}

export function evaluatePermission(
  roles: ReadonlyArray<CanonicalRole>,
  entity: BusinessEntityDomain,
  operation: PermissionOperation
): PermissionDecision {
  if (!roles || roles.length === 0) {
    return {
      allowed: false,
      scope: 'none',
      entity,
      operation,
      conditions: [],
    };
  }

  let bestScope: PermissionScope = 'none';
  const conditions: string[] = [];

  for (const role of roles) {
    const grant = PERMISSION_MATRIX[role]?.[entity];
    if (!grant) continue;
    const opScope = grant[operation] ?? 'none';
    if (opScope === 'all') {
      bestScope = 'all';
    } else if (opScope === 'own' && bestScope === 'none') {
      bestScope = 'own';
    }
    if (opScope !== 'none' && grant.condition) {
      conditions.push(grant.condition);
    }
  }

  return {
    allowed: bestScope !== 'none',
    scope: bestScope,
    entity,
    operation,
    conditions,
  };
}

/**
 * Reusable Express middleware enforcing the canonical §4 permission matrix
 * once a user's verified canonical roles have been loaded onto the request.
 */
export function requirePermission(
  entity: BusinessEntityDomain,
  operation: PermissionOperation
): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const verifiedRoles = req.resolvedMember?.roles;
    if (!req.authUser || !verifiedRoles) {
      next(
        new AppApiError(
          403,
          'ROLE_NOT_RESOLVED',
          'Verified canonical role assignment is required for this operation.'
        )
      );
      return;
    }

    const decision = evaluatePermission(verifiedRoles, entity, operation);
    if (!decision.allowed) {
      next(
        new AppApiError(
          403,
          'FORBIDDEN',
          `Your assigned role does not permit ${operation} on ${entity}.`
        )
      );
      return;
    }

    req.permissionDecision = decision;
    next();
  };
}
