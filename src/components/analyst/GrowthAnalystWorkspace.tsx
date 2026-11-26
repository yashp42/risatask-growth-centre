import { Lock, PanelRightOpen } from 'lucide-react';
import { useState } from 'react';
import type { UseGrowthAnalystSessionResult } from '../../hooks/useGrowthAnalystSession';
import type { AiActionRecord } from '../../types/analyst';
import type { NavSectionId } from '../../types/overview';
import { ActionConfirmationDialog } from './ActionConfirmationDialog';
import { DataContextHeader } from './DataContextHeader';
import { EvidencePanel } from './EvidencePanel';
import { GrowthAnalystChat } from './GrowthAnalystChat';
import { ProposedActionCard } from './ProposedActionCard';

interface GrowthAnalystWorkspaceProps {
  session: UseGrowthAnalystSessionResult;
  activeContextSection: NavSectionId;
  activeRecordContext?: {
    entityType: 'campaign' | 'sponsor' | 'opportunity' | 'task';
    entityId: string;
  } | null;
  initialDraft?: string | null;
  onOpenRecord?: (recordType: string, recordId: string) => void;
}

export function GrowthAnalystWorkspace({
  session,
  activeContextSection,
  activeRecordContext,
  initialDraft,
  onOpenRecord,
}: GrowthAnalystWorkspaceProps) {
  const [evidenceOpen, setEvidenceOpen] = useState(true);
  const [mobilePanel, setMobilePanel] = useState<'chat' | 'evidence' | 'actions'>(
    'chat'
  );
  const [pendingConfirmAction, setPendingConfirmAction] =
    useState<AiActionRecord | null>(null);

  const pendingCount = session.actions.filter(
    (a) => a.status === 'proposed'
  ).length;

  const handleConfirmSubmit = async (actionId: string) => {
    await session.confirmAction(actionId);
    setPendingConfirmAction(null);
  };

  return (
    <div className="space-y-6">
      <DataContextHeader
        filters={session.filters}
        onChangeRecordClass={session.setRecordClass}
        onChangeEdition={(edition_id) =>
          session.setFilters((prev) => ({ ...prev, edition_id }))
        }
        onChangeAsOf={(as_of) =>
          session.setFilters((prev) => ({ ...prev, as_of }))
        }
        dataVersion={session.dataVersion}
        quota={session.quota}
        conversationId={session.conversationId}
        onResetConversation={session.resetConversation}
        pendingActionCount={pendingCount}
        mobilePanel={mobilePanel}
        onChangeMobilePanel={setMobilePanel}
      />

      {session.permissionProfile.verifiedByServer &&
      !session.permissionProfile.canUseAnalyst ? (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-md border border-[#D9D7D0] bg-white p-5"
        >
          <Lock
            className="mt-0.5 h-4 w-4 shrink-0 text-[#9B3B32]"
            aria-hidden="true"
          />
          <div>
            <h2 className="text-[14px] font-semibold text-[#202824]">
              Growth Analyst access restricted (403)
            </h2>
            <p className="mt-1 text-[13px] text-[#525E58]">
              Your account does not carry a sponsorship operations or viewer
              role required for Growth Analyst queries.
            </p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* Main Conversation Area */}
          <section
            aria-label="Growth Analyst conversation"
            className={`${
              mobilePanel === 'chat' ? 'block' : 'hidden lg:block'
            } ${evidenceOpen ? 'lg:col-span-8' : 'lg:col-span-12'}`}
          >
            {!evidenceOpen ? (
              <div className="mb-3 hidden justify-end lg:flex">
                <button
                  type="button"
                  onClick={() => setEvidenceOpen(true)}
                  className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[#D9D7D0] bg-white px-3 text-[12px] font-medium text-[#202824] hover:bg-[#FAF9F6]"
                >
                  <PanelRightOpen className="h-3.5 w-3.5 text-[#525E58]" aria-hidden="true" />
                  <span>Show evidence &amp; actions</span>
                </button>
              </div>
            ) : null}

            <GrowthAnalystChat
              messages={session.messages}
              actions={session.actions}
              permissionProfile={session.permissionProfile}
              sending={session.sending}
              loadingConversation={session.loadingConversation}
              error={session.error}
              dataVersionChanged={session.dataVersionChanged}
              actionProcessingId={session.actionProcessingId}
              actionErrorById={session.actionErrorById}
              initialDraft={initialDraft}
              onSend={session.sendMessage}
              onDismissError={session.dismissError}
              onClearDataVersionChanged={session.clearDataVersionChanged}
              onRequestConfirmAction={setPendingConfirmAction}
              onCancelAction={(id) => void session.cancelAction(id)}
              onOpenRecord={onOpenRecord}
              onSubmitFeedback={session.submitFeedback}
            />
          </section>

          {/* Right Side Workspace: Evidence & Context + Action Workspace */}
          {evidenceOpen ? (
            <div className="space-y-4 lg:col-span-4">
              <div
                className={
                  mobilePanel === 'evidence' ? 'block' : 'hidden lg:block'
                }
              >
                <EvidencePanel
                  filters={session.filters}
                  dataVersion={session.dataVersion}
                  latestStructured={session.latestStructured}
                  activeContextSection={activeContextSection}
                  activeRecordContext={activeRecordContext}
                  permissionProfile={session.permissionProfile}
                  onCollapse={() => setEvidenceOpen(false)}
                  onOpenLinkedRecord={onOpenRecord}
                />
              </div>

              <section
                aria-label="Action workspace"
                className={`space-y-3 rounded-md border border-[#D9D7D0] bg-white p-4 ${
                  mobilePanel === 'actions' ? 'block' : 'hidden lg:block'
                }`}
              >
                <div className="flex items-center justify-between border-b border-[#E8E6E0] pb-2.5">
                  <h2 className="text-[14px] font-semibold text-[#202824]">
                    Action workspace
                  </h2>
                  <span className="font-mono text-[11px] text-[#788C83]">
                    {pendingCount} pending
                  </span>
                </div>

                {session.actions.length === 0 ? (
                  <p className="text-[12px] text-[#788C83]">
                    Proposed tasks, interactions, meetings, or sponsor contact
                    updates will appear here for explicit confirmation before
                    any write occurs.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {session.actions.map((act) => (
                      <ProposedActionCard
                        key={act.ai_action_id}
                        action={act}
                        permissionProfile={session.permissionProfile}
                        processing={
                          session.actionProcessingId === act.ai_action_id
                        }
                        errorMessage={
                          session.actionErrorById[act.ai_action_id] ?? null
                        }
                        onRequestConfirm={setPendingConfirmAction}
                        onCancel={(id) => void session.cancelAction(id)}
                        onOpenRecord={onOpenRecord}
                        compact
                      />
                    ))}
                  </div>
                )}
              </section>
            </div>
          ) : null}
        </div>
      )}

      <ActionConfirmationDialog
        action={pendingConfirmAction}
        processing={
          pendingConfirmAction
            ? session.actionProcessingId === pendingConfirmAction.ai_action_id
            : false
        }
        onConfirm={(id) => void handleConfirmSubmit(id)}
        onClose={() => setPendingConfirmAction(null)}
      />
    </div>
  );
}
