import { ArrowUpRight, PanelRightClose } from 'lucide-react';
import { formatRecordClassLabel } from '../../services/analystApi';
import type { GrowthAnalystSessionFilterState } from '../../hooks/useGrowthAnalystSession';
import type {
  AiPermissionProfile,
  AiStructuredResponse,
} from '../../types/analyst';
import type { NavSectionId } from '../../types/overview';
import { CitationList } from './CitationList';
import { MetricEvidenceCard } from './MetricEvidenceCard';

interface EvidencePanelProps {
  filters: GrowthAnalystSessionFilterState;
  dataVersion: string | number | null;
  latestStructured: AiStructuredResponse | null;
  activeContextSection: NavSectionId;
  activeRecordContext?: {
    entityType: 'campaign' | 'sponsor' | 'opportunity' | 'task';
    entityId: string;
  } | null;
  permissionProfile: AiPermissionProfile;
  onCollapse?: () => void;
  onOpenLinkedRecord?: (entityType: string, entityId: string) => void;
}

export function EvidencePanel({
  filters,
  dataVersion,
  latestStructured,
  activeContextSection,
  activeRecordContext,
  permissionProfile,
  onCollapse,
  onOpenLinkedRecord,
}: EvidencePanelProps) {
  const activeFilterEntries = [
    filters.campaign_id && filters.campaign_id !== 'all'
      ? `Campaign: ${filters.campaign_id}`
      : null,
    filters.channel_id && filters.channel_id !== 'all'
      ? `Channel: ${filters.channel_id}`
      : null,
    filters.bet_id && filters.bet_id !== 'all'
      ? `Bet: ${filters.bet_id}`
      : null,
    filters.owner_id && filters.owner_id !== 'all'
      ? `Owner: ${filters.owner_id}`
      : null,
    filters.category_id && filters.category_id !== 'all'
      ? `Category: ${filters.category_id}`
      : null,
  ].filter(Boolean) as string[];

  return (
    <aside
      aria-label="Evidence and context"
      className="space-y-4 rounded-md border border-[#D9D7D0] bg-white p-4"
    >
      <div className="flex items-center justify-between border-b border-[#E8E6E0] pb-3">
        <h2 className="text-[14px] font-semibold text-[#202824]">
          Evidence &amp; context
        </h2>
        {onCollapse ? (
          <button
            type="button"
            onClick={onCollapse}
            aria-label="Collapse evidence panel"
            className="hidden h-7 w-7 items-center justify-center rounded text-[#525E58] hover:bg-[#FAF9F6] hover:text-[#202824] lg:inline-flex"
          >
            <PanelRightClose className="h-4 w-4" aria-hidden="true" />
          </button>
        ) : null}
      </div>

      {/* Active Data Scope */}
      <dl className="space-y-2 text-[12px]">
        <div className="flex items-baseline justify-between gap-2">
          <dt className="text-[#788C83]">Data class</dt>
          <dd className="text-right font-medium text-[#202824]">
            {formatRecordClassLabel(filters.record_class)}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-2">
          <dt className="text-[#788C83]">Edition</dt>
          <dd className="font-mono text-[#202824]">{filters.edition_id}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-2">
          <dt className="text-[#788C83]">As of</dt>
          <dd className="font-mono text-[#202824]">{filters.as_of}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-2">
          <dt className="text-[#788C83]">Data version</dt>
          <dd className="font-mono text-[#202824]">
            {dataVersion !== null && dataVersion !== undefined
              ? `v${String(dataVersion)}`
              : 'Unavailable'}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-2">
          <dt className="text-[#788C83]">Workspace context</dt>
          <dd className="font-mono text-[#525E58]">
            {activeRecordContext
              ? `${activeRecordContext.entityType} ${activeRecordContext.entityId}`
              : activeContextSection}
          </dd>
        </div>
      </dl>

      {activeFilterEntries.length > 0 ? (
        <div className="border-t border-[#E8E6E0] pt-3">
          <p className="text-[11px] font-medium text-[#788C83]">Active filters</p>
          <p className="mt-1 font-mono text-[11px] text-[#202824]">
            {activeFilterEntries.join(' · ')}
          </p>
        </div>
      ) : null}

      {/* Latest Answer Provenance & Tools */}
      {latestStructured ? (
        <>
          {latestStructured.data_labels.length > 0 ? (
            <div className="border-t border-[#E8E6E0] pt-3">
              <p className="text-[11px] font-medium text-[#788C83]">
                Source labels
              </p>
              <p className="mt-1 text-[12px] text-[#202824]">
                {latestStructured.data_labels.join(' · ')}
              </p>
            </div>
          ) : null}

          {latestStructured.metric_results &&
          latestStructured.metric_results.length > 0 ? (
            <div className="space-y-2.5 border-t border-[#E8E6E0] pt-3">
              <p className="text-[11px] font-medium text-[#788C83]">
                Metrics queried ({latestStructured.metric_results.length})
              </p>
              {latestStructured.metric_results.map((m, idx) => (
                <MetricEvidenceCard
                  key={`${m.metric_id}-panel-${idx}`}
                  metric={m}
                  compact
                />
              ))}
            </div>
          ) : null}

          {latestStructured.citations.length > 0 ? (
            <div className="border-t border-[#E8E6E0] pt-3">
              <CitationList citations={latestStructured.citations} compact />
            </div>
          ) : null}

          {latestStructured.linked_records &&
          latestStructured.linked_records.length > 0 &&
          !permissionProfile.isViewerRestricted ? (
            <div className="space-y-1.5 border-t border-[#E8E6E0] pt-3">
              <p className="text-[11px] font-medium text-[#788C83]">
                Linked records
              </p>
              <ul className="divide-y divide-[#E8E6E0] rounded border border-[#E8E6E0] bg-[#FAF9F6]">
                {latestStructured.linked_records.map((rec) => (
                  <li
                    key={`${rec.entity_type}:${rec.entity_id}`}
                    className="flex items-center justify-between gap-2 px-3 py-2 text-[12px]"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium text-[#202824]">
                        {rec.label}
                      </p>
                      <p className="truncate font-mono text-[10px] text-[#788C83]">
                        {rec.entity_type} · {rec.entity_id}
                      </p>
                    </div>
                    {onOpenLinkedRecord ? (
                      <button
                        type="button"
                        onClick={() =>
                          onOpenLinkedRecord(rec.entity_type, rec.entity_id)
                        }
                        aria-label={`Open ${rec.label}`}
                        className="shrink-0 text-[#315F52] hover:text-[#264B40]"
                      >
                        <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {latestStructured.tool_calls &&
          latestStructured.tool_calls.length > 0 ? (
            <div className="border-t border-[#E8E6E0] pt-3">
              <p className="text-[11px] font-medium text-[#788C83]">
                Tools invoked ({latestStructured.tool_calls.length}/6)
              </p>
              <ul className="mt-1.5 space-y-1 font-mono text-[11px] text-[#525E58]">
                {latestStructured.tool_calls.map((tc) => (
                  <li key={tc.tool_call_id} className="truncate">
                    {tc.tool_name}
                    {tc.summary ? ` — ${tc.summary}` : ''}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      ) : (
        <div className="border-t border-[#E8E6E0] pt-3 text-[12px] text-[#788C83]">
          Metrics, citations, and linked records from your active investigation
          will appear here.
        </div>
      )}
    </aside>
  );
}
