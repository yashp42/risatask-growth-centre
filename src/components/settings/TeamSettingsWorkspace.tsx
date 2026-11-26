import { useCallback, useEffect, useState } from 'react';
import { Check, Pencil, Play, RefreshCw, X } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useSeason } from '../../contexts/SeasonContext';
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

function formatCellValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export function TeamSettingsWorkspace() {
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
  }, [editionId, recordClass]);

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
        <div className="flex flex-wrap items-baseline justify-between gap-2">
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
          <span className="font-mono text-[12px] text-[#525E58]">
            {teamLoading ? 'Loading…' : `${teamRoster.length} members`}
          </span>
        </div>

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
                  <th className="px-4 py-2.5">Roles</th>
                  <th className="px-4 py-2.5">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E8E6E0] bg-white">
                {teamRoster.map((tm) => (
                  <tr key={tm.member_id} className="hover:bg-[#FAF9F6]">
                    <td className="px-4 py-2.5 font-medium text-[#202824]">
                      {tm.full_name}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-[12px] text-[#525E58]">
                      {tm.member_id}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-[12px] text-[#315F52]">
                      {tm.roles && tm.roles.length > 0 ? tm.roles.join(', ') : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-[12px] text-[#525E58]">
                      {tm.is_active ? 'Active' : 'Inactive'}
                    </td>
                  </tr>
                ))}
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
