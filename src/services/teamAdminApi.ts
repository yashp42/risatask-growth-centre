import { apiFetch } from './authSession';
import { OVERVIEW_API_ENDPOINTS } from './overviewApi';
import type { CanonicalRole } from '../types/sponsors';

export class TeamAdminApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status = 500, code = 'API_ERROR') {
    super(message);
    this.name = 'TeamAdminApiError';
    this.status = status;
    this.code = code;
  }
}

export const ALL_CANONICAL_ROLE_OPTIONS: ReadonlyArray<{
  value: CanonicalRole;
  label: string;
}> = [
  { value: 'coordination_lead', label: 'Coordination Lead' },
  { value: 'pipeline_ops', label: 'Pipeline Ops' },
  { value: 'partnerships', label: 'Partnerships' },
  { value: 'community', label: 'Community' },
  { value: 'network', label: 'Network' },
  { value: 'premium_sales', label: 'Premium Sales' },
  { value: 'finance_collections', label: 'Finance & Collections' },
  { value: 'viewer', label: 'Viewer (read-only)' },
  { value: 'admin', label: 'Admin (team/roles & logs only)' },
];

async function requestTeamAdminJson<T>(
  url: string,
  init?: RequestInit
): Promise<T> {
  const response = await apiFetch(url, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers ?? {}),
    },
  });

  const ct = response.headers.get('content-type') ?? '';
  const isJson = ct.includes('application/json');

  if (!response.ok) {
    let message = 'Unable to complete team administration request.';
    let code = `HTTP_${response.status}`;
    if (isJson) {
      try {
        const body = (await response.json()) as {
          message?: string;
          error?: string;
          code?: string;
        };
        if (body.message) message = body.message;
        else if (body.error) message = body.error;
        if (body.code) code = body.code;
      } catch {
        // Ignore parse failure
      }
    }
    throw new TeamAdminApiError(message, response.status, code);
  }

  if (!isJson) {
    throw new TeamAdminApiError(
      'Team administration service unavailable.',
      503,
      'SERVICE_UNAVAILABLE'
    );
  }

  return (await response.json()) as T;
}

export async function createTeamMember(payload: {
  full_name: string;
  email?: string | null;
  edition_id: string;
  record_class: string;
}): Promise<{ member_id: string; data_version: number }> {
  return requestTeamAdminJson<{ member_id: string; data_version: number }>(
    OVERVIEW_API_ENDPOINTS.teamMembers,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    }
  );
}

export async function linkMemberAuthUser(
  memberId: string,
  authUserId: string,
  editionId: string
): Promise<{ member_id: string; auth_linked: boolean; data_version: number }> {
  return requestTeamAdminJson<{
    member_id: string;
    auth_linked: boolean;
    data_version: number;
  }>(
    `${OVERVIEW_API_ENDPOINTS.teamMembers}/${encodeURIComponent(memberId)}/link`,
    {
      method: 'POST',
      body: JSON.stringify({
        auth_user_id: authUserId.trim(),
        edition_id: editionId,
      }),
    }
  );
}

export async function assignMemberRole(payload: {
  member_id: string;
  role: CanonicalRole;
  edition_id: string;
  record_class: string;
}): Promise<{ role_assignment_id: string; data_version: number }> {
  return requestTeamAdminJson<{
    role_assignment_id: string;
    data_version: number;
  }>(OVERVIEW_API_ENDPOINTS.teamRoles, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function endMemberRole(
  roleAssignmentId: string,
  editionId: string
): Promise<{ role_assignment_id: string; is_current: boolean; data_version: number }> {
  return requestTeamAdminJson<{
    role_assignment_id: string;
    is_current: boolean;
    data_version: number;
  }>(
    `${OVERVIEW_API_ENDPOINTS.teamRoles}/${encodeURIComponent(roleAssignmentId)}/end`,
    {
      method: 'POST',
      body: JSON.stringify({ edition_id: editionId }),
    }
  );
}
