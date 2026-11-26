import { ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { formatRecordClassLabel } from '../../services/analystApi';
import type { AiCitation } from '../../types/analyst';

interface CitationListProps {
  citations: AiCitation[];
  compact?: boolean;
}

function getDecisionStatusLabel(citation: AiCitation): string | null {
  if (citation.retrieval_rule === 'contradiction_and_history_only') {
    return 'Historical record';
  }
  if (citation.decision_status === 'proposed') {
    return 'Proposed, not approved';
  }
  if (citation.decision_status === 'approved') {
    return 'Approved';
  }
  if (citation.decision_status === 'reference') {
    return 'Reference';
  }
  return citation.decision_status ? String(citation.decision_status) : null;
}

export function CitationList({
  citations,
  compact = false,
}: CitationListProps) {
  const [expandedKeys, setExpandedKeys] = useState<Record<string, boolean>>({});

  if (citations.length === 0) return null;

  const toggleKey = (key: string) => {
    setExpandedKeys((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div className="space-y-1.5">
      <p className="text-[11px] font-medium text-[#788C83]">
        Sources ({citations.length})
      </p>
      <div className="divide-y divide-[#E8E6E0] rounded-md border border-[#E8E6E0] bg-[#FAF9F6]">
        {citations.map((citation, idx) => {
          const key = `${citation.type}:${citation.id}:${idx}`;
          const expanded = Boolean(expandedKeys[key]);
          const statusLabel = getDecisionStatusLabel(citation);

          return (
            <div key={key} className={compact ? 'px-3 py-2' : 'px-3.5 py-2.5'}>
              <button
                type="button"
                onClick={() => toggleKey(key)}
                aria-expanded={expanded}
                className="flex w-full items-start justify-between gap-2 text-left"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span className="font-mono text-[11px] font-medium text-[#315F52]">
                      {citation.chunk_id || citation.id}
                    </span>
                    <span className="truncate text-[12px] font-medium text-[#202824]">
                      {citation.title ||
                        citation.section ||
                        citation.source_id ||
                        citation.type}
                    </span>
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-[#788C83]">
                    {citation.decision_id ? (
                      <span className="font-mono">{citation.decision_id}</span>
                    ) : null}
                    {statusLabel ? (
                      <>
                        {citation.decision_id ? <span aria-hidden="true">·</span> : null}
                        <span
                          className={
                            citation.decision_status === 'proposed' ||
                            citation.retrieval_rule ===
                              'contradiction_and_history_only'
                              ? 'font-medium text-[#9B3B32]'
                              : ''
                          }
                        >
                          {statusLabel}
                        </span>
                      </>
                    ) : null}
                    {citation.record_class ? (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>{formatRecordClassLabel(citation.record_class)}</span>
                      </>
                    ) : null}
                  </div>
                </div>
                {expanded ? (
                  <ChevronDown
                    className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#788C83]"
                    aria-hidden="true"
                  />
                ) : (
                  <ChevronRight
                    className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#788C83]"
                    aria-hidden="true"
                  />
                )}
              </button>

              {expanded ? (
                <dl className="mt-2 grid grid-cols-1 gap-1 border-t border-[#E8E6E0] pt-2 text-[11px] text-[#525E58] sm:grid-cols-2">
                  {citation.citation_location ? (
                    <div className="sm:col-span-2">
                      <dt className="inline font-medium text-[#202824]">
                        Location:{' '}
                      </dt>
                      <dd className="inline font-mono">
                        {citation.citation_location}
                      </dd>
                    </div>
                  ) : null}
                  {citation.doc_id ? (
                    <div>
                      <dt className="inline font-medium text-[#202824]">
                        Document:{' '}
                      </dt>
                      <dd className="inline font-mono">{citation.doc_id}</dd>
                    </div>
                  ) : null}
                  {citation.effective_date ? (
                    <div>
                      <dt className="inline font-medium text-[#202824]">
                        Effective:{' '}
                      </dt>
                      <dd className="inline font-mono">
                        {citation.effective_date}
                      </dd>
                    </div>
                  ) : null}
                  {citation.related_bet || citation.related_kpi ? (
                    <div className="sm:col-span-2">
                      <dt className="inline font-medium text-[#202824]">
                        Scope:{' '}
                      </dt>
                      <dd className="inline font-mono">
                        {[citation.related_bet, citation.related_kpi]
                          .filter(Boolean)
                          .join(' · ')}
                      </dd>
                    </div>
                  ) : null}
                  {citation.data_version !== undefined &&
                  citation.data_version !== null ? (
                    <div>
                      <dt className="inline font-medium text-[#202824]">
                        Data version:{' '}
                      </dt>
                      <dd className="inline font-mono">
                        v{String(citation.data_version)}
                      </dd>
                    </div>
                  ) : null}
                </dl>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
