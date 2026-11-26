import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  AlertCircle,
  Check,
  Link2,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  ShieldPlus,
  X,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useSeason } from '../../contexts/SeasonContext';
import {
  isHistoricalReadOnlyEdition,
  READ_ONLY_2025_MESSAGE,
} from '../../lib/dateIst';
import {
  fetchAdminHealth,
  runAdminParityCheck,
  updateCurrentMemberName,
  type AdminHealthResponse,
  type ParityCheckResponse,
} from '../../services/authSession';
import {
  fetchTeamRoster,
  type TeamDirectoryMember,
} from '../../services/tasksApi';
import {
  ALL_CANONICAL_ROLE_OPTIONS,
  assignMemberRole,
  createTeamMember,
  endMemberRole,
  linkMemberAuthUser,
  TeamAdminApiError,
} from '../../services/teamAdminApi';
import type { CanonicalRole } from '../../types/sponsors';

function formatCellValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export function TeamSettingsWorkspace() {
  const queryClient = useQueryClient();
  const { member, refreshIdentity } = useAuth();
  const { editionId, recordClass, asOf } = useSeason();
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [savingName, setSavingName] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [health, setHealth] = useState<AdminHealthResponse | null>(null);
  const [healthHttpStatus, setHealthHttpStatus] = useState<number | null>(null);
  const [healthLoading, setHealthLoading] = useState<boolean>(true);
  const [healthError, setHealthError] = useState<string | null>(null);

  const [parity, setParity] = useState<ParityCheckResponse | null>(null);
  const [parityLoading, setParityLoading] = useState<boolean>(false);
  const [parityError, setParityError] = useState<string | null>(null);

  const [teamRoster, setTeamRoster] = useState<TeamDirectoryMember[]>([]);
  const [teamLoading, setTeamLoading] = useState<boolean>(true);
  const [teamError, setTeamError] = useState<string | null>(null);
  const [teamNonce, setTeamNonce] = useState(0);

  // Team & role administration state (coordination_lead or admin only)
  const [adminError, setAdminError] = useState<string | null>(null);
  const [adminSuccess, setAdminSuccess] = useState<string | null>(null);
  const [showAddMember, setShowAddMember] = useState(false);
  const [newMemberName, setNewMemberName] = useState('');
  const [newMemberEmail, setNewMemberEmail] = useState('');
  const [creatingMember, setCreatingMember] = useState(false);

  const [showAssignRole, setShowAssignRole] = useState(false);
  const [assignTargetMemberId, setAssignTargetMemberId] = useState('');
  const [assignRoleChoice, setAssignRoleChoice] =
    useState<CanonicalRole>('partnerships');
  const [assigningRole, setAssigningRole] = useState(false);

  const [linkingMemberId, setLinkingMemberId] = useState<string | null>(null);
  const [linkAuthUuid, setLinkAuthUuid] = useState('');
  const [linkingAuth, setLinkingAuth] = useState(false);
  const [endingRoleId, setEndingRoleId] = useState<string | null>(null);

  const canManageTeam = Boolean(
    member?.roles.includes('coordination_lead') ||
      member?.roles.includes('admin')
  );
  const isHistorical = isHistoricalReadOnlyEdition(editionId, recordClass);

  const loadHealth = useCallback(async () => {
    setHealthLoading(true);
    setHealthError(null);
    try {
      const res = await fetchAdminHealth();
      setHealthHttpStatus(res.httpStatus);
      setHealth(res.payload);
    } catch (err) {
      setHealthError(
        err instanceof Error ? err.message : 'Unable to load system health.'
      );
    } finally {
      setHealthLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadHealth();
  }, [loadHealth]);

  useEffect(() => {
    const controller = new AbortController();
    setTeamLoading(true);
    setTeamError(null);
    fetchTeamRoster(editionId, recordClass, controller.signal)
      .then((rows) => {
        setTeamRoster(rows);
        setAssignTargetMemberId((prev) =>
          prev && rows.some((r) => r.member_id === prev)
            ? prev
            : rows[0]?.member_id ?? ''
        );
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setTeamRoster([]);
        setTeamError(
          err instanceof Error
            ? err.message
            : 'Unable to load team roster from /api/team.'
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setTeamLoading(false);
        }
      });
    return () => controller.abort();
  }, [editionId, recordClass, teamNonce]);

  const refreshTeamAfterAdminChange = useCallback(async () => {
    setTeamNonce((n) => n + 1);
    await refreshIdentity();
    void queryClient.invalidateQueries();
  }, [queryClient, refreshIdentity]);

  const handleCreateMember = async (e: FormEvent) => {
    e.preventDefault();
    if (!canManageTeam || isHistorical) return;
    setAdminError(null);
    setAdminSuccess(null);
    if (!newMemberName.trim()) {
      setAdminError('Full name is required.');
      return;
    }
    setCreatingMember(true);
    try {
      const created = await createTeamMember({
        full_name: newMemberName.trim(),
        email: newMemberEmail.trim() || null,
        edition_id: editionId,
        record_class: recordClass,
      });
      setNewMemberName('');
      setNewMemberEmail('');
      setShowAddMember(false);
      setAdminSuccess(
        `Created team member ${created.member_id} (Unlinked until an Auth User ID is linked).`
      );
      await refreshTeamAfterAdminChange();
    } catch (err: unknown) {
      setAdminError(
        err instanceof TeamAdminApiError
          ? err.message
          : 'Unable to create team member.'
      );
    } finally {
      setCreatingMember(false);
    }
  };

  const handleAssignRole = async (e: FormEvent) => {
    e.preventDefault();
    if (!canManageTeam || isHistorical) return;
    setAdminError(null);
    setAdminSuccess(null);
    if (!assignTargetMemberId) {
      setAdminError('Select a team member.');
      return;
    }
    setAssigningRole(true);
    try {
      const assigned = await assignMemberRole({
        member_id: assignTargetMemberId,
        role: assignRoleChoice,
        edition_id: editionId,
        record_class: recordClass,
      });
      setShowAssignRole(false);
      setAdminSuccess(
        `Assigned role "${assignRoleChoice}" (${assigned.role_assignment_id}).`
      );
      await refreshTeamAfterAdminChange();
    } catch (err: unknown) {
      setAdminError(
        err instanceof TeamAdminApiError
          ? err.message
          : 'Unable to assign role.'
      );
    } finally {
      setAssigningRole(false);
    }
  };

  const handleLinkAuthUser = async (e: FormEvent) => {
    e.preventDefault();
    if (!canManageTeam || isHistorical || !linkingMemberId) return;
    setAdminError(null);
    setAdminSuccess(null);
    if (!linkAuthUuid.trim()) {
      setAdminError('Supabase Auth User UUID is required.');
      return;
    }
    setLinkingAuth(true);
    try {
      await linkMemberAuthUser(linkingMemberId, linkAuthUuid, editionId);
      setAdminSuccess(`Linked login UUID to member ${linkingMemberId}.`);
      setLinkingMemberId(null);
      setLinkAuthUuid('');
      await refreshTeamAfterAdminChange();
    } catch (err: unknown) {
      setAdminError(
        err instanceof TeamAdminApiError
          ? err.message
          : 'Unable to link auth user ID.'
      );
    } finally {
      setLinkingAuth(false);
    }
  };

  const handleEndRole = async (roleAssignmentId: string) => {
    if (!canManageTeam || isHistorical) return;
    setAdminError(null);
    setAdminSuccess(null);
    setEndingRoleId(roleAssignmentId);
    try {
      await endMemberRole(roleAssignmentId, editionId);
      setAdminSuccess(`Ended role assignment ${roleAssignmentId}.`);
      await refreshTeamAfterAdminChange();
    } catch (err: unknown) {
      setAdminError(
        err instanceof TeamAdminApiError
          ? err.message
          : 'Unable to end role assignment.'
      );
    } finally {
      setEndingRoleId(null);
    }
  };

  const handleRunParity = async () => {
    setParityLoading(true);
    setParityError(null);
    try {
      const result = await runAdminParityCheck();
      setParity(result);
    } catch (err) {
      setParityError(
        err instanceof Error ? err.message : 'Parity check failed.'
      );
    } finally {
      setParityLoading(false);
    }
  };

  const handleStartEditName = () => {
    setNameDraft(member?.full_name ?? '');
    setNameError(null);
    setEditingName(true);
  };

  const handleCancelEditName = () => {
    setEditingName(false);
    setNameError(null);
  };

  const handleSaveName = async () => {
    const trimmed = nameDraft.trim();
    if (!trimmed) {
      setNameError('Name cannot be empty.');
      return;
    }
    setSavingName(true);
    setNameError(null);
    try {
      await updateCurrentMemberName(trimmed);
      await refreshIdentity();
      setEditingName(false);
    } catch (err) {
      setNameError(
        err instanceof Error ? err.message : 'Unable to save team member name.'
      );
    } finally {
      setSavingName(false);
    }
  };

  const metricsCount =
    health?.metrics?.count ?? health?.database?.metrics_function_count;
  const metricsExpected = health?.metrics?.expected ?? 30;
  const dbConnected = Boolean(health?.database?.connected);
  const metricsHealthy = Boolean(health?.metrics?.healthy);

  const parityColumns =
    parity && parity.rows.length > 0 ? Object.keys(parity.rows[0]) : [];

  return (
    <div className="space-y-6 pb-8">
      <div className="border-b border-[#D9D7D0] pb-5">
        <p className="font-mono text-[11px] text-[#788C83]">Workspace</p>
        <h1 className="mt-1 text-[28px] font-semibold tracking-[-0.025em] text-[#202824]">
          Team &amp; Settings
        </h1>
        <p className="mt-1 text-[13px] text-[#525E58]">
          Verified team identity, live backend system health, and 2025 metric
          parity verification.
        </p>
      </div>

      {/* Signed-in identity from GET /api/me */}
      <section
        aria-labelledby="signed-in-identity-heading"
        className="rounded-md border border-[#D9D7D0] bg-white p-6"
      >
        <h2
          id="signed-in-identity-heading"
          className="text-[16px] font-semibold text-[#202824]"
        >
          Signed-in team member
        </h2>
        {member ? (
          <dl className="mt-4 grid grid-cols-1 gap-4 border-t border-[#E8E6E0] pt-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <dt className="text-[12px] text-[#788C83]">Name</dt>
              {editingName ? (
                <dd className="mt-1 space-y-1.5">
                  <div className="flex items-center gap-1.5">
                    <input
                      type="text"
                      value={nameDraft}
                      onChange={(e) => setNameDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          void handleSaveName();
                        } else if (e.key === 'Escape') {
                          handleCancelEditName();
                        }
                      }}
                      disabled={savingName}
                      aria-label="Team member name"
                      maxLength={120}
                      className="h-8 w-full min-w-[140px] rounded border border-[#D9D7D0] bg-white px-2.5 text-[13px] text-[#202824] focus:border-[#315F52] focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => void handleSaveName()}
                      disabled={savingName}
                      title="Save name"
                      aria-label="Save name"
                      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded border border-[#315F52] bg-[#315F52] text-white hover:bg-[#264B40] disabled:opacity-50"
                    >
                      <Check className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      onClick={handleCancelEditName}
                      disabled={savingName}
                      title="Cancel"
                      aria-label="Cancel editing name"
                      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded border border-[#D9D7D0] bg-white text-[#525E58] hover:bg-[#FAF9F6] disabled:opacity-50"
                    >
                      <X className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </div>
                  {nameError ? (
                    <p className="text-[11px] text-[#991B1B]">{nameError}</p>
                  ) : null}
                </dd>
              ) : (
                <dd className="mt-1 flex items-center gap-2 text-[14px] font-medium text-[#202824]">
                  <span>{member.full_name ?? '—'}</span>
                  <button
                    type="button"
                    onClick={handleStartEditName}
                    title="Edit name"
                    aria-label="Edit name"
                    className="inline-flex h-6 w-6 items-center justify-center rounded text-[#788C83] transition-colors hover:bg-[#F3F1EB] hover:text-[#202824]"
                  >
                    <Pencil className="h-3 w-3" aria-hidden="true" />
                  </button>
                </dd>
              )}
            </div>
            <div>
              <dt className="text-[12px] text-[#788C83]">Member ID</dt>
              <dd className="mt-1 font-mono text-[13px] text-[#202824]">
                {member.member_id}
              </dd>
            </div>
            <div>
              <dt className="text-[12px] text-[#788C83]">Roles</dt>
              <dd className="mt-1 font-mono text-[13px] text-[#202824]">
                {member.roles.length > 0 ? member.roles.join(', ') : '—'}
              </dd>
            </div>
            <div>
              <dt className="text-[12px] text-[#788C83]">Edition</dt>
              <dd className="mt-1 font-mono text-[13px] text-[#202824]">
                {member.edition_id ?? '—'}
              </dd>
            </div>
          </dl>
        ) : (
          <p className="mt-3 text-[13px] text-[#525E58]">
            No verified member profile loaded.
          </p>
        )}
      </section>

      {/* Edition team roster from GET /api/team */}
      <section
        aria-labelledby="team-roster-heading"
        className="rounded-md border border-[#D9D7D0] bg-white p-6"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2
              id="team-roster-heading"
              className="text-[16px] font-semibold text-[#202824]"
            >
              Edition team directory
            </h2>
            <p className="mt-1 font-mono text-[11px] text-[#788C83]">
              {recordClass} · {editionId} · As of {asOf}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="mr-1 font-mono text-[12px] text-[#525E58]">
              {teamLoading ? 'Loading…' : `${teamRoster.length} members`}
            </span>
            {canManageTeam ? (
              <>
                <button
                  type="button"
                  disabled={isHistorical}
                  title={isHistorical ? READ_ONLY_2025_MESSAGE : undefined}
                  onClick={() => {
                    setShowAddMember((v) => !v);
                    setShowAssignRole(false);
                    setAdminError(null);
                  }}
                  className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[#D9D7D0] bg-white px-3 text-[12px] font-medium text-[#202824] hover:bg-[#FAF9F6] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Plus className="h-3.5 w-3.5 text-[#315F52]" />
                  Add member
                </button>
                <button
                  type="button"
                  disabled={isHistorical || teamRoster.length === 0}
                  title={isHistorical ? READ_ONLY_2025_MESSAGE : undefined}
                  onClick={() => {
                    setShowAssignRole((v) => !v);
                    setShowAddMember(false);
                    setAdminError(null);
                  }}
                  className="inline-flex h-8 items-center gap-1.5 rounded-md bg-[#315F52] px-3 text-[12px] font-medium text-white hover:bg-[#274D42] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <ShieldPlus className="h-3.5 w-3.5" />
                  Assign role
                </button>
              </>
            ) : null}
          </div>
        </div>

        {adminError ? (
          <div
            role="alert"
            className="mt-4 flex items-start gap-2 rounded-md border border-[#9B3B32]/30 bg-[#9B3B32]/5 px-4 py-3 text-[13px] text-[#9B3B32]"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{adminError}</span>
          </div>
        ) : null}

        {adminSuccess ? (
          <div className="mt-4 rounded-md border border-[#315F52]/30 bg-[#315F52]/5 px-4 py-2.5 text-[12px] text-[#315F52]">
            {adminSuccess}
          </div>
        ) : null}

        {canManageTeam && showAddMember ? (
          <form
            onSubmit={handleCreateMember}
            className="mt-4 rounded-md border border-[#D9D7D0] bg-[#FAF9F6] p-4"
          >
            <h3 className="text-[13px] font-semibold text-[#202824]">
              New team member ({editionId})
            </h3>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <input
                type="text"
                value={newMemberName}
                onChange={(e) => setNewMemberName(e.target.value)}
                placeholder="Full name (required)"
                className="h-9 rounded-md border border-[#D9D7D0] bg-white px-3 text-[13px] text-[#202824] focus:border-[#315F52] focus:outline-none"
                required
              />
              <input
                type="email"
                value={newMemberEmail}
                onChange={(e) => setNewMemberEmail(e.target.value)}
                placeholder="Email (optional)"
                className="h-9 rounded-md border border-[#D9D7D0] bg-white px-3 text-[13px] text-[#202824] focus:border-[#315F52] focus:outline-none"
              />
            </div>
            <div className="mt-3 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowAddMember(false)}
                className="h-8 rounded-md border border-[#D9D7D0] bg-white px-3 text-[12px] font-medium text-[#202824] hover:bg-[#FAF9F6]"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={creatingMember}
                className="h-8 rounded-md bg-[#315F52] px-3 text-[12px] font-medium text-white hover:bg-[#274D42] disabled:opacity-50"
              >
                {creatingMember ? 'Creating...' : 'Create member'}
              </button>
            </div>
          </form>
        ) : null}

        {canManageTeam && showAssignRole ? (
          <form
            onSubmit={handleAssignRole}
            className="mt-4 rounded-md border border-[#D9D7D0] bg-[#FAF9F6] p-4"
          >
            <h3 className="text-[13px] font-semibold text-[#202824]">
              Assign role in {editionId}
            </h3>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <select
                value={assignTargetMemberId}
                onChange={(e) => setAssignTargetMemberId(e.target.value)}
                aria-label="Member"
                className="h-9 rounded-md border border-[#D9D7D0] bg-white px-3 text-[13px] text-[#202824] focus:border-[#315F52] focus:outline-none"
              >
                {teamRoster.map((tm) => (
                  <option key={tm.member_id} value={tm.member_id}>
                    {tm.full_name} ({tm.member_id})
                  </option>
                ))}
              </select>
              <select
                value={assignRoleChoice}
                onChange={(e) =>
                  setAssignRoleChoice(e.target.value as CanonicalRole)
                }
                aria-label="Role"
                className="h-9 rounded-md border border-[#D9D7D0] bg-white px-3 text-[13px] text-[#202824] focus:border-[#315F52] focus:outline-none"
              >
                {ALL_CANONICAL_ROLE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="mt-3 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowAssignRole(false)}
                className="h-8 rounded-md border border-[#D9D7D0] bg-white px-3 text-[12px] font-medium text-[#202824] hover:bg-[#FAF9F6]"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={assigningRole}
                className="h-8 rounded-md bg-[#315F52] px-3 text-[12px] font-medium text-white hover:bg-[#274D42] disabled:opacity-50"
              >
                {assigningRole ? 'Assigning...' : 'Save role assignment'}
              </button>
            </div>
          </form>
        ) : null}

        {canManageTeam && linkingMemberId ? (
          <form
            onSubmit={handleLinkAuthUser}
            className="mt-4 rounded-md border border-[#D9D7D0] bg-[#FAF9F6] p-4"
          >
            <h3 className="text-[13px] font-semibold text-[#202824]">
              Link Supabase Auth User ID for {linkingMemberId}
            </h3>
            <p className="mt-1 text-[12px] text-[#525E58]">
              Once linked, this member can authenticate via Supabase and claim
              their assigned roles. Linking is one-time per member.
            </p>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
              <input
                type="text"
                value={linkAuthUuid}
                onChange={(e) => setLinkAuthUuid(e.target.value)}
                placeholder="Supabase auth_user_id UUID (e.g. 550e8400-e29b-41d4-a716-446655440000)"
                className="h-9 flex-1 rounded-md border border-[#D9D7D0] bg-white px-3 font-mono text-[12px] text-[#202824] focus:border-[#315F52] focus:outline-none"
                required
              />
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setLinkingMemberId(null);
                    setLinkAuthUuid('');
                  }}
                  className="h-9 rounded-md border border-[#D9D7D0] bg-white px-3 text-[12px] font-medium text-[#202824] hover:bg-[#FAF9F6]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={linkingAuth}
                  className="h-9 rounded-md bg-[#315F52] px-3 text-[12px] font-medium text-white hover:bg-[#274D42] disabled:opacity-50"
                >
                  {linkingAuth ? 'Linking...' : 'Link login'}
                </button>
              </div>
            </div>
          </form>
        ) : null}

        {teamError ? (
          <div
            role="alert"
            className="mt-4 rounded-md border border-[#DC2626]/30 bg-[#DC2626]/5 px-4 py-3 text-[13px] text-[#991B1B]"
          >
            {teamError}
          </div>
        ) : teamLoading ? (
          <div className="mt-4 space-y-2 border-t border-[#E8E6E0] pt-4">
            <div className="h-8 animate-pulse rounded bg-[#FAF9F6]" />
            <div className="h-8 animate-pulse rounded bg-[#FAF9F6]" />
          </div>
        ) : teamRoster.length === 0 ? (
          <p className="mt-4 border-t border-[#E8E6E0] pt-4 text-[13px] text-[#525E58]">
            No team role assignments found for {editionId}.
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto rounded border border-[#E8E6E0]">
            <table className="min-w-full divide-y divide-[#E8E6E0] text-left text-[13px]">
              <thead className="bg-[#FAF9F6] text-[12px] font-medium text-[#525E58]">
                <tr>
                  <th className="px-4 py-2.5">Member</th>
                  <th className="px-4 py-2.5">Member ID</th>
                  <th className="px-4 py-2.5">Login</th>
                  <th className="px-4 py-2.5">Roles ({editionId})</th>
                  <th className="px-4 py-2.5">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E8E6E0] bg-white">
                {teamRoster.map((tm) => {
                  const assignments = tm.role_assignments ?? [];
                  const isUnlinked = tm.auth_linked === false;
                  return (
                    <tr key={tm.member_id} className="hover:bg-[#FAF9F6]">
                      <td className="px-4 py-2.5">
                        <div className="font-medium text-[#202824]">
                          {tm.full_name}
                        </div>
                        {tm.email ? (
                          <div className="text-[11px] text-[#788C83]">
                            {tm.email}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-[12px] text-[#525E58]">
                        {tm.member_id}
                      </td>
                      <td className="px-4 py-2.5 text-[12px]">
                        {isUnlinked ? (
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-[#9B6B2E]">
                              Unlinked
                            </span>
                            {canManageTeam ? (
                              <button
                                type="button"
                                disabled={isHistorical}
                                title={
                                  isHistorical
                                    ? READ_ONLY_2025_MESSAGE
                                    : undefined
                                }
                                onClick={() => {
                                  setLinkingMemberId(tm.member_id);
                                  setLinkAuthUuid('');
                                  setAdminError(null);
                                }}
                                className="inline-flex items-center gap-1 text-[11px] font-medium text-[#315F52] hover:underline disabled:opacity-50"
                              >
                                <Link2 className="h-3 w-3" />
                                Link Auth ID
                              </button>
                            ) : null}
                          </div>
                        ) : (
                          <span className="text-[#315F52]">Linked</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-[12px] text-[#315F52]">
                        {assignments.length > 0 ? (
                          <div className="flex flex-wrap items-center gap-2">
                            {assignments.map((a) => (
                              <span
                                key={a.role_assignment_id}
                                className="inline-flex items-center gap-1.5 rounded border border-[#D9D7D0] bg-[#FAF9F6] px-2 py-0.5 text-[11px] text-[#202824]"
                              >
                                <span>{a.role}</span>
                                {canManageTeam ? (
                                  <button
                                    type="button"
                                    disabled={
                                      isHistorical ||
                                      endingRoleId === a.role_assignment_id
                                    }
                                    title={`End ${a.role}`}
                                    aria-label={`End ${a.role} for ${tm.full_name}`}
                                    onClick={() =>
                                      void handleEndRole(a.role_assignment_id)
                                    }
                                    className="text-[#9B3B32] hover:text-[#7F1D1D] disabled:opacity-40"
                                  >
                                    ×
                                  </button>
                                ) : null}
                              </span>
                            ))}
                          </div>
                        ) : tm.roles && tm.roles.length > 0 ? (
                          tm.roles.join(', ')
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-[12px] text-[#525E58]">
                        {tm.is_active === false ? 'Inactive' : 'Active'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* System check panel */}
      <section
        aria-labelledby="system-check-heading"
        className="rounded-md border border-[#D9D7D0] bg-white p-6"
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2
              id="system-check-heading"
              className="text-[16px] font-semibold text-[#202824]"
            >
              System check
            </h2>
            <p className="mt-1 text-[13px] text-[#525E58]">
              Live diagnostics from{' '}
              <code className="font-mono text-[12px] text-[#202824]">
                GET /api/admin/health
              </code>{' '}
              and{' '}
              <code className="font-mono text-[12px] text-[#202824]">
                POST /api/admin/parity
              </code>
              .
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={() => void loadHealth()}
              disabled={healthLoading}
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-[#D9D7D0] bg-white px-3.5 text-[13px] font-medium text-[#202824] transition-colors duration-150 hover:bg-[#FAF9F6] disabled:opacity-60 whitespace-nowrap shrink-0"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 text-[#525E58] ${healthLoading ? 'animate-spin' : ''}`}
                aria-hidden="true"
              />
              <span>Refresh health</span>
            </button>

            <button
              type="button"
              onClick={() => void handleRunParity()}
              disabled={parityLoading}
              className="inline-flex h-9 items-center gap-1.5 rounded-md bg-[#315F52] px-4 text-[13px] font-medium text-white transition-colors duration-150 hover:bg-[#264B40] disabled:opacity-60 whitespace-nowrap shrink-0"
            >
              <Play className="h-3.5 w-3.5" aria-hidden="true" />
              <span>
                {parityLoading ? 'Running parity...' : 'Run parity check'}
              </span>
            </button>
          </div>
        </div>

        {healthError ? (
          <div
            role="alert"
            className="mt-4 rounded-md border border-[#DC2626]/30 bg-[#DC2626]/5 px-4 py-3 text-[13px] text-[#991B1B]"
          >
            {healthError}
          </div>
        ) : null}

        {healthLoading && !health ? (
          <div className="mt-5 grid grid-cols-1 gap-4 border-t border-[#E8E6E0] pt-5 sm:grid-cols-3">
            <div className="h-16 animate-pulse rounded bg-[#FAF9F6]" />
            <div className="h-16 animate-pulse rounded bg-[#FAF9F6]" />
            <div className="h-16 animate-pulse rounded bg-[#FAF9F6]" />
          </div>
        ) : health ? (
          <div className="mt-5 space-y-5 border-t border-[#E8E6E0] pt-5">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded border border-[#E8E6E0] bg-[#FAF9F6] p-4">
                <p className="text-[12px] text-[#788C83]">Database</p>
                <p
                  className={`mt-1 text-[16px] font-semibold ${
                    dbConnected ? 'text-[#16A34A]' : 'text-[#DC2626]'
                  }`}
                >
                  {dbConnected ? 'Connected' : 'Disconnected'}
                </p>
                <p className="mt-1 font-mono text-[11px] text-[#525E58]">
                  status: {health.database.status}
                  {healthHttpStatus ? ` · HTTP ${healthHttpStatus}` : ''}
                </p>
              </div>

              <div className="rounded border border-[#E8E6E0] bg-[#FAF9F6] p-4">
                <p className="text-[12px] text-[#788C83]">Metrics functions</p>
                <p
                  className={`mt-1 font-mono text-[18px] font-semibold tabular-nums ${
                    metricsHealthy ? 'text-[#16A34A]' : 'text-[#D97706]'
                  }`}
                >
                  {metricsCount !== undefined ? `${metricsCount}` : '—'} /{' '}
                  {metricsExpected}
                </p>
                <p className="mt-1 font-mono text-[11px] text-[#525E58]">
                  status: {health.metrics?.status ?? 'unknown'}
                </p>
              </div>

              <div className="rounded border border-[#E8E6E0] bg-[#FAF9F6] p-4">
                <p className="text-[12px] text-[#788C83]">Canonical schema</p>
                <p className="mt-1 text-[16px] font-semibold text-[#202824]">
                  {health.database.schema_ready ? 'Ready' : 'Not ready'}
                </p>
                <p className="mt-1 font-mono text-[11px] text-[#525E58]">
                  missing tables: {health.database.missing_tables.length}
                </p>
              </div>

              <div className="rounded border border-[#E8E6E0] bg-[#FAF9F6] p-4">
                <p className="text-[12px] text-[#788C83]">2025 parity check</p>
                <p className="mt-1 font-mono text-[18px] font-semibold tabular-nums text-[#202824]">
                  {parity ? `${parity.passed} / ${parity.total}` : 'Not run'}
                </p>
                <p className="mt-1 font-mono text-[11px] text-[#525E58]">
                  {parity
                    ? parity.passed === parity.total
                      ? 'all checks passed'
                      : 'discrepancy detected'
                    : 'click Run parity check'}
                </p>
              </div>
            </div>

            {!dbConnected && (health.database.error_detail || health.database.reason) ? (
              <div className="rounded border border-[#D97706]/30 bg-[#D97706]/5 px-4 py-3 text-[13px] text-[#92400E]">
                <p>
                  <span className="font-mono text-[12px] font-medium">
                    {health.database.error_detail?.code ??
                      health.database.error_code ??
                      'DB_ERROR'}
                    :
                  </span>{' '}
                  {health.database.error_detail?.message ??
                    health.database.reason}
                </p>
                {health.database.error_detail?.hint ? (
                  <p className="mt-1 text-[12px]">
                    Hint: {health.database.error_detail.hint}
                  </p>
                ) : null}
                {health.database.tls ? (
                  <p className="mt-1 font-mono text-[11px]">
                    TLS: {health.database.tls}
                  </p>
                ) : null}
              </div>
            ) : null}

            {parityError ? (
              <div
                role="alert"
                className="rounded border border-[#DC2626]/30 bg-[#DC2626]/5 px-4 py-3 text-[13px] text-[#991B1B]"
              >
                {parityError}
              </div>
            ) : null}

            {parity ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-[14px] font-semibold text-[#202824]">
                    Parity result ({parity.passed} / {parity.total})
                  </h3>
                  <span className="font-mono text-[12px] tabular-nums text-[#525E58]">
                    {parity.rows.length} rows returned
                  </span>
                </div>

                <div className="overflow-x-auto rounded border border-[#E8E6E0]">
                  <table className="min-w-full divide-y divide-[#E8E6E0] text-left text-[12px]">
                    <thead className="bg-[#FAF9F6] text-[#525E58]">
                      <tr>
                        {parityColumns.map((col) => (
                          <th
                            key={col}
                            className="px-3 py-2 font-mono font-medium whitespace-nowrap"
                          >
                            {col}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E8E6E0] bg-white">
                      {parity.rows.map((row, idx) => (
                        <tr key={idx} className="hover:bg-[#FAF9F6]">
                          {parityColumns.map((col) => (
                            <td
                              key={col}
                              className="px-3 py-2 font-mono tabular-nums text-[#202824] whitespace-nowrap"
                            >
                              {formatCellValue(row[col])}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </section>
    </div>
  );
}
