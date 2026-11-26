import { ArrowUpRight, ChevronDown, ChevronRight } from 'lucide-react';
import { useMemo, useState } from 'react';
import { ATTENTION_CATEGORY_OPTIONS } from '../../services/overviewApi';
import type {
  ApiErrorInfo,
  AttentionCategory,
  DataLoadStatus,
  NeedsAttentionItem,
} from '../../types/overview';
import { DataStateWrapper } from '../ui/DataStateWrapper';
import { SectionHeader } from '../ui/SectionHeader';

interface NeedsAttentionQueueSectionProps {
  items: NeedsAttentionItem[];
  status: DataLoadStatus;
  error: ApiErrorInfo | null;
  onRetry: () => void;
  onInspectItem?: (item: NeedsAttentionItem | null) => void;
}

export function NeedsAttentionQueueSection({
  items,
  status,
  error,
  onRetry,
  onInspectItem,
}: NeedsAttentionQueueSectionProps) {
  const [selectedCategory, setSelectedCategory] =
    useState<AttentionCategory>('all');
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});

  const filteredItems = useMemo(() => {
    if (selectedCategory === 'all') return items;
    return items.filter((item) => item.category === selectedCategory);
  }, [items, selectedCategory]);

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const skeleton = (
    <div className="rounded-md border border-[#D9D7D0] bg-white divide-y divide-[#E8E6E0]">
      {[0, 1, 2].map((idx) => (
        <div key={idx} className="px-5 py-4">
          <div className="h-4 w-56 rounded bg-[#E8E6E0]" />
          <div className="mt-2 h-3 w-80 rounded bg-[#F3F1EB]" />
        </div>
      ))}
    </div>
  );

  return (
    <section
      id="section-attention"
      aria-label="Needs attention queue"
      className="space-y-4"
    >
      <SectionHeader
        title="Needs attention"
        meta={items.length > 0 ? `${filteredItems.length} items` : undefined}
      />

      {/* Category filter bar */}
      <div
        role="tablist"
        aria-label="Filter attention queue by category"
        className="flex flex-wrap items-center gap-1.5"
      >
        {ATTENTION_CATEGORY_OPTIONS.map((cat) => {
          const isActive = selectedCategory === cat.id;
          return (
            <button
              key={cat.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setSelectedCategory(cat.id)}
              className={`rounded-md border px-3 py-1.5 text-[12px] font-medium transition-colors duration-150 whitespace-nowrap ${
                isActive
                  ? 'border-[#315F52] bg-[#315F52] text-white'
                  : 'border-[#D9D7D0] bg-white text-[#525E58] hover:border-[#788C83] hover:text-[#202824]'
              }`}
            >
              {cat.label}
            </button>
          );
        })}
      </div>

      <DataStateWrapper
        status={status}
        error={error}
        onRetry={onRetry}
        loadingSkeleton={skeleton}
      >
        <div className="overflow-hidden rounded-md border border-[#D9D7D0] bg-white">
          {filteredItems.length > 0 ? (
            <ul className="divide-y divide-[#E8E6E0]">
              {filteredItems.map((item) => {
                const isExpanded = Boolean(expandedIds[item.id]);
                return (
                  <li key={item.id} className="bg-white">
                    <button
                      type="button"
                      aria-expanded={isExpanded}
                      onClick={() => toggleExpand(item.id)}
                      className="flex w-full items-start justify-between gap-4 px-5 py-4 text-left transition-colors duration-150 hover:bg-[#FAF9F6]"
                    >
                      <div className="flex min-w-0 items-start gap-3">
                        {isExpanded ? (
                          <ChevronDown
                            className="mt-0.5 h-4 w-4 shrink-0 text-[#315F52]"
                            aria-hidden="true"
                          />
                        ) : (
                          <ChevronRight
                            className="mt-0.5 h-4 w-4 shrink-0 text-[#788C83]"
                            aria-hidden="true"
                          />
                        )}
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12px] text-[#788C83]">
                            <span className="font-medium text-[#315F52]">
                              {item.categoryLabel}
                            </span>
                            <span aria-hidden="true">·</span>
                            <span>{item.responsibleOwner}</span>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono text-[11px] tabular-nums">
                              {item.timestampLabel}
                            </span>
                          </div>
                          <p className="mt-1 text-[14px] font-semibold text-[#202824]">
                            {item.title}
                          </p>
                          <p className="mt-0.5 text-[13px] text-[#525E58]">
                            {item.whatHappened}
                          </p>
                        </div>
                      </div>
                      <span className="shrink-0 font-mono text-[11px] text-[#788C83]">
                        {isExpanded ? 'Hide' : 'Details'}
                      </span>
                    </button>

                    {isExpanded ? (
                      <div className="border-t border-[#E8E6E0] bg-[#FAF9F6] px-5 py-4 pl-12">
                        <dl className="grid grid-cols-1 gap-4 md:grid-cols-2">
                          <div>
                            <dt className="text-[11px] font-medium text-[#788C83]">
                              Why it matters
                            </dt>
                            <dd className="mt-1 text-[13px] text-[#202824]">
                              {item.whyItMatters}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-[11px] font-medium text-[#788C83]">
                              Evidence
                            </dt>
                            <dd className="mt-1 text-[13px] text-[#202824]">
                              {item.relevantEvidence}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-[11px] font-medium text-[#788C83]">
                              Next step
                            </dt>
                            <dd className="mt-1 text-[13px] font-medium text-[#315F52]">
                              {item.recommendedNextStep}
                            </dd>
                          </div>
                          <div className="flex items-end justify-start md:justify-end">
                            <button
                              type="button"
                              onClick={() => onInspectItem?.(item)}
                              className="inline-flex items-center gap-1.5 rounded-md border border-[#D9D7D0] bg-white px-3 py-1.5 text-[12px] font-medium text-[#202824] hover:bg-[#F3F1EB]"
                            >
                              Open record
                              <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                            </button>
                          </div>
                        </dl>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="px-5 py-8 text-center">
              <p className="text-[13px] font-medium text-[#202824]">
                {selectedCategory === 'all'
                  ? 'No items need attention'
                  : `No ${
                      ATTENTION_CATEGORY_OPTIONS.find(
                        (c) => c.id === selectedCategory
                      )?.label.toLowerCase() ?? 'items'
                    }`}
              </p>
              {selectedCategory !== 'all' ? (
                <button
                  type="button"
                  onClick={() => setSelectedCategory('all')}
                  className="mt-2.5 text-[12px] font-medium text-[#315F52] hover:underline"
                >
                  Show all categories
                </button>
              ) : null}
            </div>
          )}
        </div>
      </DataStateWrapper>
    </section>
  );
}
