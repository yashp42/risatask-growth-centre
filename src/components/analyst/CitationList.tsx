import { ChevronRight, FileText } from 'lucide-react';
import { useState } from 'react';
import { formatRecordClassLabel } from '../../services/analystApi';
import type { AiCitation } from '../../types/analyst';
import { SlideOverDrawer } from '../ui/SlideOverDrawer';

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
  const [selectedCitation, setSelectedCitation] = useState<AiCitation | null>(
    null
  );

  if (citations.length === 0) return null;

  const selectedStatusLabel = selectedCitation
    ? getDecisionStatusLabel(selectedCitation)
    : null;

  return (
    <div className="space-y-2">
      <p className="text-[11px] font-medium text-[#788C83]">
        Sources ({citations.length})
      </p>

      {/* Interactive citation chips */}
      <div className="flex flex-wrap gap-1.5">
        {citations.map((citation, idx) => {
          const key = `${citation.type}:${citation.id}:${idx}`;
          const statusLabel = getDecisionStatusLabel(citation);
          const isCaution =
            citation.decision_status === 'proposed' ||
            citation.retrieval_rule === 'contradiction_and_history_only';

          return (
            <button
              key={key}
              type="button"
              onClick={() => setSelectedCitation(citation)}
              className={`inline-flex max-w-full items-center gap-1.5 rounded border bg-[#FAF9F6] text-left transition-colors hover:border-[#315F52] hover:bg-white ${
                compact ? 'px-2 py-1 text-[11px]' : 'px-2.5 py-1.5 text-[12px]'
              } ${isCaution ? 'border-[#C8847D]' : 'border-[#D9D7D0]'}`}
            >
              <FileText
                className="h-3 w-3 shrink-0 text-[#315F52]"
                aria-hidden="true"
              />
              <span className="font-mono text-[11px] font-medium text-[#315F52]">
                {citation.chunk_id || citation.id}
              </span>
              {citation.title || citation.section ? (
                <span className="truncate max-w-[180px] text-[#202824]">
                  {citation.title || citation.section}
                </span>
              ) : null}
              {statusLabel && isCaution ? (
                <span className="font-mono text-[10px] font-medium text-[#9B3B32]">
                  · {statusLabel}
                </span>
              ) : null}
              <ChevronRight
                className="h-3 w-3 shrink-0 text-[#788C83]"
                aria-hidden="true"
              />
            </button>
          );
        })}
      </div>

      {/* Citation source detail drawer */}
      <SlideOverDrawer
        open={Boolean(selectedCitation)}
        onClose={() => setSelectedCitation(null)}
        meta={
          selectedCitation
            ? `${selectedCitation.type.toUpperCase()} · ${
                selectedCitation.chunk_id || selectedCitation.id
              }`
            : undefined
        }
        title={
          selectedCitation?.title ||
          selectedCitation?.section ||
          selectedCitation?.chunk_id ||
          selectedCitation?.id ||
          'Citation detail'
        }
        subtitle={
          selectedCitation?.citation_location ||
          selectedCitation?.doc_id ||
          undefined
        }
      >
        {selectedCitation ? (
          <div className="space-y-4">
            {selectedStatusLabel ? (
              <div
                className={`rounded border px-3 py-2 text-[12px] ${
                  selectedCitation.decision_status === 'proposed' ||
                  selectedCitation.retrieval_rule ===
                    'contradiction_and_history_only'
                    ? 'border-[#C8847D] bg-[#FDF5F4] text-[#9B3B32]'
                    : 'border-[#D9D7D0] bg-[#FAF9F6] text-[#202824]'
                }`}
              >
                Status: <span className="font-medium">{selectedStatusLabel}</span>
              </div>
            ) : null}

            {selectedCitation.chunk_text ? (
              <div className="rounded-md border border-[#D9D7D0] bg-[#FAF9F6] p-4">
                <p className="mb-1.5 text-[11px] font-medium text-[#788C83]">
                  Source excerpt
                </p>
                <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-[#202824]">
                  {selectedCitation.chunk_text}
                </p>
              </div>
            ) : (
              <p className="text-[12px] text-[#525E58]">
                Verified source reference recorded for this answer.
              </p>
            )}

            <dl className="grid grid-cols-1 gap-2 rounded-md border border-[#E8E6E0] bg-white p-3.5 text-[12px] sm:grid-cols-2">
              <div>
                <dt className="text-[11px] text-[#788C83]">Citation ID</dt>
                <dd className="font-mono text-[#202824]">
                  {selectedCitation.chunk_id || selectedCitation.id}
                </dd>
              </div>
              {selectedCitation.doc_id ? (
                <div>
                  <dt className="text-[11px] text-[#788C83]">Document</dt>
                  <dd className="font-mono text-[#202824]">
                    {selectedCitation.doc_id}
                  </dd>
                </div>
              ) : null}
              {selectedCitation.decision_id ? (
                <div>
                  <dt className="text-[11px] text-[#788C83]">Decision</dt>
                  <dd className="font-mono text-[#202824]">
                    {selectedCitation.decision_id}
                  </dd>
                </div>
              ) : null}
              {selectedCitation.effective_date ? (
                <div>
                  <dt className="text-[11px] text-[#788C83]">Effective date</dt>
                  <dd className="font-mono text-[#202824]">
                    {selectedCitation.effective_date}
                  </dd>
                </div>
              ) : null}
              {selectedCitation.citation_location ? (
                <div className="sm:col-span-2">
                  <dt className="text-[11px] text-[#788C83]">Location</dt>
                  <dd className="font-mono text-[#202824]">
                    {selectedCitation.citation_location}
                  </dd>
                </div>
              ) : null}
              {selectedCitation.related_bet || selectedCitation.related_kpi ? (
                <div className="sm:col-span-2">
                  <dt className="text-[11px] text-[#788C83]">Scope</dt>
                  <dd className="font-mono text-[#202824]">
                    {[selectedCitation.related_bet, selectedCitation.related_kpi]
                      .filter(Boolean)
                      .join(' · ')}
                  </dd>
                </div>
              ) : null}
              {selectedCitation.record_class ? (
                <div>
                  <dt className="text-[11px] text-[#788C83]">Data class</dt>
                  <dd className="text-[#202824]">
                    {formatRecordClassLabel(selectedCitation.record_class)}
                  </dd>
                </div>
              ) : null}
              {selectedCitation.data_version !== undefined &&
              selectedCitation.data_version !== null ? (
                <div>
                  <dt className="text-[11px] text-[#788C83]">Data version</dt>
                  <dd className="font-mono text-[#202824]">
                    v{String(selectedCitation.data_version)}
                  </dd>
                </div>
              ) : null}
            </dl>
          </div>
        ) : null}
      </SlideOverDrawer>
    </div>
  );
}
