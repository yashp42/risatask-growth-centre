import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AnalystApiError,
  cancelAiAction,
  confirmAiAction,
  fetchAnalystConversation,
  getAnalystPermissionProfile,
  getDefaultAnalystEditionForClass,
  sendAnalystChatMessage,
} from '../services/analystApi';
import { fetchAnalyticsDataVersion } from '../services/analyticsApi';
import {
  DEFAULT_UNVERIFIED_PERMISSIONS,
  fetchCurrentUserPermissions,
} from '../services/sponsorsApi';
import type {
  AiActionRecord,
  AiChatMessage,
  AiPermissionProfile,
  AiRecordClass,
  AiStructuredResponse,
} from '../types/analyst';
import type { NavSectionId } from '../types/overview';
import type { UserPermissionContext } from '../types/sponsors';

export interface GrowthAnalystSessionFilterState {
  record_class: AiRecordClass;
  edition_id: string;
  as_of: string;
  campaign_id?: string;
  channel_id?: string;
  bet_id?: string;
  owner_id?: string;
  category_id?: string;
}

export interface GrowthAnalystWorkspaceContextMeta {
  activeSection: NavSectionId;
  selectedCampaignId: string | null;
  selectedSponsorId: string | null;
  selectedOpportunityId: string | null;
  selectedTaskId: string | null;
}

export interface UseGrowthAnalystSessionResult {
  conversationId: string | null;
  messages: AiChatMessage[];
  actions: AiActionRecord[];
  latestStructured: AiStructuredResponse | null;
  filters: GrowthAnalystSessionFilterState;
  setFilters: React.Dispatch<
    React.SetStateAction<GrowthAnalystSessionFilterState>
  >;
  setRecordClass: (nextClass: AiRecordClass) => void;
  dataVersion: string | number | null;
  dataVersionChanged: boolean;
  sending: boolean;
  loadingConversation: boolean;
  error: AnalystApiError | null;
  actionProcessingId: string | null;
  actionErrorById: Record<string, string>;
  permissionProfile: AiPermissionProfile;
  sendMessage: (text: string) => Promise<void>;
  confirmAction: (actionId: string) => Promise<void>;
  cancelAction: (actionId: string) => Promise<void>;
  resetConversation: () => void;
  dismissError: () => void;
  clearDataVersionChanged: () => void;
}

function createInitialFilters(): GrowthAnalystSessionFilterState {
  return {
    record_class: 'simulated',
    edition_id: getDefaultAnalystEditionForClass('simulated'),
    as_of: new Date().toISOString().slice(0, 10),
  };
}

export function useGrowthAnalystSession(
  contextMeta: GrowthAnalystWorkspaceContextMeta,
  onAfterActionExecuted?: () => void
): UseGrowthAnalystSessionResult {
  const [conversationId, setConversationId] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    const paramId = new URLSearchParams(window.location.search).get(
      'conversation_id'
    );
    return paramId ? paramId.trim() || null : null;
  });

  const [messages, setMessages] = useState<AiChatMessage[]>([]);
  const [actionsMap, setActionsMap] = useState<Record<string, AiActionRecord>>(
    {}
  );
  const [filters, setFilters] =
    useState<GrowthAnalystSessionFilterState>(createInitialFilters);
  const [dataVersion, setDataVersion] = useState<string | number | null>(null);
  const [dataVersionChanged, setDataVersionChanged] = useState(false);

  const [sending, setSending] = useState(false);
  const [loadingConversation, setLoadingConversation] = useState(false);
  const [error, setError] = useState<AnalystApiError | null>(null);
  const [actionProcessingId, setActionProcessingId] = useState<string | null>(
    null
  );
  const [actionErrorById, setActionErrorById] = useState<
    Record<string, string>
  >({});

  const [permissions, setPermissions] = useState<UserPermissionContext>(
    DEFAULT_UNVERIFIED_PERMISSIONS
  );
  const permissionProfile = useMemo(
    () => getAnalystPermissionProfile(permissions),
    [permissions]
  );

  const sendingRef = useRef(false);
  const lastObservedVersionRef = useRef<string | number | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetchCurrentUserPermissions(controller.signal).then((ctx) => {
      setPermissions(ctx);
    });
    return () => controller.abort();
  }, []);

  // Poll GET /api/version to detect underlying data updates between turns
  useEffect(() => {
    const controller = new AbortController();
    const checkVersion = async () => {
      try {
        const ver = await fetchAnalyticsDataVersion(controller.signal);
        if (ver !== null) {
          if (
            lastObservedVersionRef.current !== null &&
            String(lastObservedVersionRef.current) !== String(ver)
          ) {
            setDataVersionChanged(true);
          }
          lastObservedVersionRef.current = ver;
          setDataVersion(ver);
        }
      } catch {
        // Ignore version poll errors when backend is absent
      }
    };

    checkVersion();
    const timer = window.setInterval(checkVersion, 10000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, []);

  // Load existing conversation if a conversation ID was provided in URL
  useEffect(() => {
    if (!conversationId || messages.length > 0) return;
    const controller = new AbortController();
    setLoadingConversation(true);

    fetchAnalystConversation(conversationId, controller.signal)
      .then((conv) => {
        setMessages(conv.messages);
        if (conv.record_class) {
          setFilters((prev) => ({
            ...prev,
            record_class: conv.record_class ?? prev.record_class,
            edition_id:
              conv.edition_id ??
              getDefaultAnalystEditionForClass(
                conv.record_class ?? prev.record_class
              ),
          }));
        }
        if (conv.data_version !== undefined && conv.data_version !== null) {
          lastObservedVersionRef.current = conv.data_version;
          setDataVersion(conv.data_version);
        }
        const hydratedActions: Record<string, AiActionRecord> = {};
        for (const msg of conv.messages) {
          for (const act of msg.structured?.actions ?? []) {
            hydratedActions[act.ai_action_id] = act;
          }
        }
        if (Object.keys(hydratedActions).length > 0) {
          setActionsMap((prev) => ({ ...prev, ...hydratedActions }));
        }
        setLoadingConversation(false);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setLoadingConversation(false);
        setError(
          err instanceof AnalystApiError
            ? err
            : new AnalystApiError(
                'Unable to load previous conversation.',
                503,
                'SERVICE_UNAVAILABLE'
              )
        );
      });

    return () => controller.abort();
  }, [conversationId, messages.length]);

  // Build active filter scope using documented metric/chat filter keys only
  const effectiveRequestFilters = useMemo(() => {
    const out: Record<string, string | undefined> = {};
    if (filters.campaign_id && filters.campaign_id !== 'all') {
      out.campaign_id = filters.campaign_id;
    } else if (
      contextMeta.activeSection === 'campaigns' &&
      contextMeta.selectedCampaignId
    ) {
      out.campaign_id = contextMeta.selectedCampaignId;
    }
    if (filters.channel_id && filters.channel_id !== 'all') {
      out.channel_id = filters.channel_id;
    }
    if (filters.bet_id && filters.bet_id !== 'all') {
      out.bet_id = filters.bet_id;
    }
    if (filters.owner_id && filters.owner_id !== 'all') {
      out.owner_id = filters.owner_id;
    }
    if (filters.category_id && filters.category_id !== 'all') {
      out.category_id = filters.category_id;
    }
    return out;
  }, [
    filters,
    contextMeta.activeSection,
    contextMeta.selectedCampaignId,
  ]);

  const setRecordClass = useCallback((nextClass: AiRecordClass) => {
    setFilters((prev) => ({
      ...prev,
      record_class: nextClass,
      edition_id: getDefaultAnalystEditionForClass(nextClass),
      campaign_id: undefined,
      owner_id: undefined,
    }));
  }, []);

  const sendMessage = useCallback(
    async (rawText: string) => {
      const trimmed = rawText.trim();
      if (!trimmed || sendingRef.current) return;

      if (permissionProfile.verifiedByServer && !permissionProfile.canUseAnalyst) {
        setError(
          new AnalystApiError(
            'Your assigned role does not permit Growth Analyst access.',
            403,
            'FORBIDDEN'
          )
        );
        return;
      }

      sendingRef.current = true;
      setSending(true);
      setError(null);

      const optimisticUserMessage: AiChatMessage = {
        message_id: `local-user-${Date.now()}`,
        role: 'user',
        content: trimmed,
        created_at: new Date().toISOString(),
        context_snapshot: {
          record_class: filters.record_class,
          edition_id: filters.edition_id,
          as_of: filters.as_of,
        },
      };

      setMessages((prev) => [...prev, optimisticUserMessage]);

      try {
        const structured = await sendAnalystChatMessage({
          conversation_id: conversationId,
          message: trimmed,
          record_class: filters.record_class,
          edition_id: filters.edition_id,
          as_of: filters.as_of,
          filters: effectiveRequestFilters,
        });

        if (structured.conversation_id) {
          setConversationId(structured.conversation_id);
        }

        if (
          structured.data_version !== undefined &&
          structured.data_version !== null
        ) {
          lastObservedVersionRef.current = structured.data_version;
          setDataVersion(structured.data_version);
          setDataVersionChanged(false);
        }

        if (structured.actions && structured.actions.length > 0) {
          setActionsMap((prev) => {
            const next = { ...prev };
            for (const act of structured.actions ?? []) {
              next[act.ai_action_id] = act;
            }
            return next;
          });
        }

        const assistantMessage: AiChatMessage = {
          message_id:
            structured.query_id || `assistant-${Date.now()}`,
          role: 'assistant',
          content: structured.answer,
          created_at: new Date().toISOString(),
          structured,
          context_snapshot: {
            record_class: structured.record_class ?? filters.record_class,
            edition_id: structured.edition_id ?? filters.edition_id,
            as_of: structured.as_of ?? filters.as_of,
          },
        };

        setMessages((prev) => [...prev, assistantMessage]);
      } catch (err: unknown) {
        setError(
          err instanceof AnalystApiError
            ? err
            : new AnalystApiError(
                'Growth Analyst service is currently unavailable.',
                503,
                'SERVICE_UNAVAILABLE'
              )
        );
      } finally {
        sendingRef.current = false;
        setSending(false);
      }
    },
    [
      conversationId,
      effectiveRequestFilters,
      filters,
      permissionProfile.canUseAnalyst,
      permissionProfile.verifiedByServer,
    ]
  );

  const confirmAction = useCallback(
    async (actionId: string) => {
      const target = actionsMap[actionId];
      if (!target || actionProcessingId) return;

      setActionProcessingId(actionId);
      setActionErrorById((prev) => {
        const next = { ...prev };
        delete next[actionId];
        return next;
      });

      try {
        const res = await confirmAiAction(actionId, target.payload_hash);
        setActionsMap((prev) => ({
          ...prev,
          [actionId]: res.action,
        }));
        if (res.data_version !== undefined && res.data_version !== null) {
          lastObservedVersionRef.current = res.data_version;
          setDataVersion(res.data_version);
        } else {
          const latestVer = await fetchAnalyticsDataVersion().catch(() => null);
          if (latestVer !== null) {
            lastObservedVersionRef.current = latestVer;
            setDataVersion(latestVer);
          }
        }
        onAfterActionExecuted?.();
      } catch (err: unknown) {
        setActionErrorById((prev) => ({
          ...prev,
          [actionId]:
            err instanceof AnalystApiError
              ? err.message
              : 'Unable to confirm this action right now.',
        }));
      } finally {
        setActionProcessingId(null);
      }
    },
    [actionProcessingId, actionsMap, onAfterActionExecuted]
  );

  const cancelAction = useCallback(
    async (actionId: string) => {
      if (!actionsMap[actionId] || actionProcessingId) return;

      setActionProcessingId(actionId);
      setActionErrorById((prev) => {
        const next = { ...prev };
        delete next[actionId];
        return next;
      });

      try {
        const res = await cancelAiAction(actionId);
        setActionsMap((prev) => ({
          ...prev,
          [actionId]: res.action,
        }));
      } catch (err: unknown) {
        setActionErrorById((prev) => ({
          ...prev,
          [actionId]:
            err instanceof AnalystApiError
              ? err.message
              : 'Unable to cancel this action right now.',
        }));
      } finally {
        setActionProcessingId(null);
      }
    },
    [actionProcessingId, actionsMap]
  );

  const resetConversation = useCallback(() => {
    setConversationId(null);
    setMessages([]);
    setActionsMap({});
    setError(null);
    setActionErrorById({});
    setDataVersionChanged(false);
  }, []);

  const latestStructured = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant' && messages[i].structured) {
        return messages[i].structured ?? null;
      }
    }
    return null;
  }, [messages]);

  const actions = useMemo(() => Object.values(actionsMap), [actionsMap]);

  return {
    conversationId,
    messages,
    actions,
    latestStructured,
    filters,
    setFilters,
    setRecordClass,
    dataVersion,
    dataVersionChanged,
    sending,
    loadingConversation,
    error,
    actionProcessingId,
    actionErrorById,
    permissionProfile,
    sendMessage,
    confirmAction,
    cancelAction,
    resetConversation,
    dismissError: () => setError(null),
    clearDataVersionChanged: () => setDataVersionChanged(false),
  };
}
