import {
  assertValidFreeOpenRouterModel,
  DEFAULT_OPENROUTER_MODEL_FALLBACK,
  DEFAULT_OPENROUTER_MODEL_PRIMARY,
  isVerifiedFreeOpenRouterModel,
  type ServerConfig,
} from '../config.ts';

export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
export const OPENROUTER_CHAT_TIMEOUT_MS = 60_000;
export const OPENROUTER_REVERIFY_INTERVAL_MS = 6 * 60 * 60 * 1000;
export const OPENROUTER_QUOTA_RESET_NOTE = '05:30 IST';
export const QUOTA_EXHAUSTED_MESSAGE =
  "Today's free AI quota is used up; it resets at 05:30 IST.";

export interface OpenRouterToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface OpenRouterToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface OpenRouterChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: OpenRouterToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface OpenRouterModelCheck {
  model: string;
  exists: boolean;
  freePricing: boolean;
  toolsSupported: boolean;
  reasoningSupported: boolean;
  error?: string | null;
}

export interface OpenRouterQuotaSnapshot {
  limit: number | null;
  remaining: number | null;
  used: number | null;
  exhausted: boolean;
  checked_at: string | null;
  reset_note: string;
  source: 'openrouter_key_api' | 'unconfigured' | 'error';
  error?: string | null;
}

export interface OpenRouterHealthSnapshot {
  provider: 'openrouter';
  orchestration_implemented: true;
  api_key_configured: boolean;
  model_configured: boolean;
  primary_model: string | null;
  fallback_model: string | null;
  free_tier_verified: boolean;
  tools_supported: boolean;
  fallback_verified: boolean;
  paid_fallback_allowed: false;
  auto_routing_allowed: false;
  last_verified_at: string | null;
  verification_error: string | null;
  primary_check: OpenRouterModelCheck | null;
  fallback_check: OpenRouterModelCheck | null;
  quota: OpenRouterQuotaSnapshot;
}

export interface OpenRouterCompletionResult {
  model: string;
  usedFallback: boolean;
  message: {
    role: 'assistant';
    content: string | null;
    tool_calls?: OpenRouterToolCall[];
  };
  finishReason: string | null;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

export class OpenRouterError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryable: boolean;

  constructor(
    message: string,
    status = 502,
    code = 'OPENROUTER_ERROR',
    retryable = false
  ) {
    super(message);
    this.name = 'OpenRouterError';
    this.status = status;
    this.code = code;
    this.retryable = retryable;
  }
}

export interface OpenRouterClientOptions {
  fetchFn?: typeof fetch;
  referer?: string;
  title?: string;
  startBackgroundRefresh?: boolean;
}

export interface OpenRouterClient {
  readonly primaryModel: string | null;
  readonly fallbackModel: string | null;
  readonly configValid: boolean;
  readonly validationError: string | null;
  verifyModels(): Promise<{
    free_tier_verified: boolean;
    tools_supported: boolean;
    fallback_verified: boolean;
    primary_check: OpenRouterModelCheck | null;
    fallback_check: OpenRouterModelCheck | null;
    error: string | null;
  }>;
  fetchQuota(forceRefresh?: boolean): Promise<OpenRouterQuotaSnapshot>;
  decrementLocalQuotaEstimate(): void;
  getHealthSnapshot(refreshQuota?: boolean): Promise<OpenRouterHealthSnapshot>;
  createChatCompletion(params: {
    messages: OpenRouterChatMessage[];
    tools?: OpenRouterToolDefinition[];
    temperature?: number;
  }): Promise<OpenRouterCompletionResult>;
  stop(): void;
}

function toFiniteOrNull(val: unknown): number | null {
  if (val === null || val === undefined || val === '') return null;
  const num = Number(val);
  return Number.isFinite(num) ? num : null;
}

function checkModelFromCatalog(
  modelId: string,
  catalog: ReadonlyArray<Record<string, unknown>>
): OpenRouterModelCheck {
  if (!isVerifiedFreeOpenRouterModel(modelId)) {
    return {
      model: modelId,
      exists: false,
      freePricing: false,
      toolsSupported: false,
      reasoningSupported: false,
      error: `Model "${modelId}" does not end with :free or is openrouter/auto.`,
    };
  }

  const entry = catalog.find((item) => String(item.id ?? '') === modelId);
  if (!entry) {
    return {
      model: modelId,
      exists: false,
      freePricing: false,
      toolsSupported: false,
      reasoningSupported: false,
      error: `Model "${modelId}" was not found in OpenRouter /models catalog.`,
    };
  }

  const pricing =
    entry.pricing && typeof entry.pricing === 'object'
      ? (entry.pricing as Record<string, unknown>)
      : {};
  const promptZero = String(pricing.prompt ?? '') === '0';
  const completionZero = String(pricing.completion ?? '') === '0';
  const freePricing = promptZero && completionZero;

  const supportedParams = Array.isArray(entry.supported_parameters)
    ? entry.supported_parameters.map((p) => String(p))
    : [];
  const toolsSupported = supportedParams.includes('tools');
  const reasoningSupported = supportedParams.includes('reasoning');

  return {
    model: modelId,
    exists: true,
    freePricing,
    toolsSupported,
    reasoningSupported,
    error: !freePricing
      ? `Model "${modelId}" has non-zero pricing.`
      : !toolsSupported
        ? `Model "${modelId}" does not support tools.`
        : null,
  };
}

export function createOpenRouterClient(
  config: ServerConfig,
  options: OpenRouterClientOptions = {}
): OpenRouterClient {
  const fetchFn = options.fetchFn ?? fetch;
  const referer =
    options.referer ?? process.env.APP_URL?.trim() ?? 'http://localhost:3000';
  const title = options.title ?? 'Sponsorship Growth Platform';

  const rawPrimary =
    config.openrouterModel ??
    (config.readiness.openrouterFreeTierValid
      ? DEFAULT_OPENROUTER_MODEL_PRIMARY
      : null);
  const rawFallback =
    config.openrouterModelFallback ??
    (config.readiness.openrouterFallbackValid !== false
      ? DEFAULT_OPENROUTER_MODEL_FALLBACK
      : null);

  let primaryModel: string | null = null;
  let fallbackModel: string | null = null;
  let configValid = true;
  let validationError: string | null = null;

  try {
    if (!config.readiness.openrouterFreeTierValid || !rawPrimary) {
      throw new Error(
        config.validationErrors.find((e) => e.includes('OPENROUTER_MODEL')) ??
          'Primary OPENROUTER_MODEL is missing or violates the :free policy.'
      );
    }
    primaryModel = assertValidFreeOpenRouterModel(
      rawPrimary,
      'OPENROUTER_MODEL'
    );

    if (config.readiness.openrouterFallbackValid === false || !rawFallback) {
      throw new Error(
        config.validationErrors.find((e) =>
          e.includes('OPENROUTER_MODEL_FALLBACK')
        ) ??
          'Fallback OPENROUTER_MODEL_FALLBACK violates the :free policy.'
      );
    }
    fallbackModel = assertValidFreeOpenRouterModel(
      rawFallback,
      'OPENROUTER_MODEL_FALLBACK'
    );
  } catch (err) {
    configValid = false;
    validationError = err instanceof Error ? err.message : 'Invalid model config.';
  }

  let primaryCheck: OpenRouterModelCheck | null = null;
  let fallbackCheck: OpenRouterModelCheck | null = null;
  let freeTierVerified = false;
  let toolsSupported = false;
  let fallbackVerified = false;
  let lastVerifiedAt: string | null = null;
  let verificationError: string | null = validationError;
  let verifyInFlight: Promise<void> | null = null;

  let cachedQuota: OpenRouterQuotaSnapshot = {
    limit: null,
    remaining: null,
    used: null,
    exhausted: false,
    checked_at: null,
    reset_note: OPENROUTER_REVERIFY_INTERVAL_MS
      ? OPENROUTER_QUOTA_RESET_NOTE
      : '05:30 IST',
    source: config.openrouterApiKey ? 'error' : 'unconfigured',
  };
  let quotaLastFetchedMs = 0;

  async function verifyModels(): Promise<{
    free_tier_verified: boolean;
    tools_supported: boolean;
    fallback_verified: boolean;
    primary_check: OpenRouterModelCheck | null;
    fallback_check: OpenRouterModelCheck | null;
    error: string | null;
  }> {
    if (!configValid || !primaryModel || !fallbackModel) {
      freeTierVerified = false;
      toolsSupported = false;
      fallbackVerified = false;
      verificationError =
        validationError ?? 'Invalid or missing :free OpenRouter model ID.';
      return {
        free_tier_verified: false,
        tools_supported: false,
        fallback_verified: false,
        primary_check: primaryCheck,
        fallback_check: fallbackCheck,
        error: verificationError,
      };
    }

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15_000);
      const res = await fetchFn(`${OPENROUTER_BASE_URL}/models`, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          ...(config.openrouterApiKey
            ? { Authorization: `Bearer ${config.openrouterApiKey}` }
            : {}),
        },
        signal: controller.signal,
      }).finally(() => clearTimeout(timer));

      if (!res.ok) {
        throw new Error(`OpenRouter /models returned HTTP ${res.status}`);
      }

      const payload = (await res.json()) as {
        data?: Array<Record<string, unknown>>;
      };
      const catalog = Array.isArray(payload.data) ? payload.data : [];

      primaryCheck = checkModelFromCatalog(primaryModel, catalog);
      fallbackCheck = checkModelFromCatalog(fallbackModel, catalog);

      freeTierVerified =
        primaryCheck.exists &&
        primaryCheck.freePricing &&
        fallbackCheck.exists &&
        fallbackCheck.freePricing;
      toolsSupported =
        primaryCheck.toolsSupported && fallbackCheck.toolsSupported;
      fallbackVerified =
        fallbackCheck.exists &&
        fallbackCheck.freePricing &&
        fallbackCheck.toolsSupported;
      lastVerifiedAt = new Date().toISOString();
      verificationError =
        [primaryCheck.error, fallbackCheck.error].filter(Boolean).join('; ') ||
        null;
    } catch (err) {
      freeTierVerified = false;
      toolsSupported = false;
      fallbackVerified = false;
      verificationError =
        err instanceof Error ? err.message : 'Unable to verify OpenRouter models.';
    }

    return {
      free_tier_verified: freeTierVerified,
      tools_supported: toolsSupported,
      fallback_verified: fallbackVerified,
      primary_check: primaryCheck,
      fallback_check: fallbackCheck,
      error: verificationError,
    };
  }

  async function fetchQuota(
    forceRefresh = false
  ): Promise<OpenRouterQuotaSnapshot> {
    if (!config.openrouterApiKey) {
      cachedQuota = {
        limit: null,
        remaining: null,
        used: null,
        exhausted: false,
        checked_at: null,
        reset_note: OPENROUTER_QUOTA_RESET_NOTE,
        source: 'unconfigured',
      };
      return cachedQuota;
    }

    const now = Date.now();
    if (!forceRefresh && quotaLastFetchedMs > 0 && now - quotaLastFetchedMs < 20_000) {
      return cachedQuota;
    }

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10_000);
      const res = await fetchFn(`${OPENROUTER_BASE_URL}/key`, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${config.openrouterApiKey}`,
        },
        signal: controller.signal,
      }).finally(() => clearTimeout(timer));

      if (!res.ok) {
        throw new Error(`OpenRouter /key returned HTTP ${res.status}`);
      }

      const body = (await res.json()) as {
        data?: Record<string, unknown>;
      } & Record<string, unknown>;
      const data =
        body.data && typeof body.data === 'object' ? body.data : body;

      const limit =
        toFiniteOrNull(data.limit) ??
        toFiniteOrNull(data.free_limit) ??
        (data.is_free_tier === true ? 50 : null);
      const remainingRaw =
        toFiniteOrNull(data.limit_remaining) ??
        toFiniteOrNull(data.remaining);
      const usedRaw =
        toFiniteOrNull(data.usage_daily) ??
        toFiniteOrNull(data.usage) ??
        toFiniteOrNull(data.used);

      const used =
        usedRaw ??
        (limit !== null && remainingRaw !== null
          ? Math.max(0, limit - remainingRaw)
          : null);
      const remaining =
        remainingRaw ??
        (limit !== null && used !== null ? Math.max(0, limit - used) : null);

      cachedQuota = {
        limit,
        remaining,
        used,
        exhausted: remaining !== null && remaining <= 0,
        checked_at: new Date().toISOString(),
        reset_note: OPENROUTER_QUOTA_RESET_NOTE,
        source: 'openrouter_key_api',
        error: null,
      };
      quotaLastFetchedMs = now;
    } catch (err) {
      cachedQuota = {
        ...cachedQuota,
        checked_at: new Date().toISOString(),
        source: 'error',
        error:
          err instanceof Error
            ? err.message
            : 'Failed to retrieve OpenRouter key quota.',
      };
    }

    return cachedQuota;
  }

  function decrementLocalQuotaEstimate(): void {
    if (cachedQuota.remaining !== null && cachedQuota.remaining > 0) {
      const nextRemaining = Math.max(0, cachedQuota.remaining - 1);
      cachedQuota = {
        ...cachedQuota,
        remaining: nextRemaining,
        used:
          cachedQuota.used !== null
            ? cachedQuota.used + 1
            : cachedQuota.limit !== null
              ? Math.max(0, cachedQuota.limit - nextRemaining)
              : null,
        exhausted: nextRemaining <= 0,
      };
    }
  }

  async function callSingleModel(
    model: string,
    messages: OpenRouterChatMessage[],
    tools: OpenRouterToolDefinition[] | undefined,
    temperature: number,
    reasoningSupported: boolean
  ): Promise<OpenRouterCompletionResult> {
    if (!config.openrouterApiKey) {
      throw new OpenRouterError(
        'OPENROUTER_API_KEY is not configured on the server.',
        503,
        'OPENROUTER_UNCONFIGURED',
        false
      );
    }

    // Strict cost guard: never auto-route, never use non-:free slugs
    assertValidFreeOpenRouterModel(model, 'model');

    const payload: Record<string, unknown> = {
      model,
      messages,
      temperature,
    };

    if (tools && tools.length > 0) {
      payload.tools = tools;
      payload.tool_choice = 'auto';
      payload.parallel_tool_calls = true;
    }

    if (reasoningSupported) {
      payload.reasoning = { effort: 'low' };
    }

    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      OPENROUTER_CHAT_TIMEOUT_MS
    );

    let res: Response;
    try {
      res = await fetchFn(`${OPENROUTER_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${config.openrouterApiKey}`,
          'HTTP-Referer': referer,
          'X-Title': title,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch (err) {
      const isAbort = err instanceof Error && err.name === 'AbortError';
      throw new OpenRouterError(
        isAbort
          ? 'Growth Analyst timed out waiting for the model response (60s).'
          : err instanceof Error
            ? err.message
            : 'Network error calling OpenRouter.',
        504,
        isAbort ? 'OPENROUTER_TIMEOUT' : 'OPENROUTER_NETWORK_ERROR',
        !isAbort
      );
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      const retryable = res.status === 429 || res.status >= 500;
      throw new OpenRouterError(
        `OpenRouter returned HTTP ${res.status}${errText ? `: ${errText.slice(0, 220)}` : ''}`,
        res.status,
        res.status === 429 ? 'OPENROUTER_RATE_LIMIT' : 'OPENROUTER_UPSTREAM_ERROR',
        retryable
      );
    }

    const json = (await res.json()) as {
      model?: string;
      choices?: Array<{
        finish_reason?: string | null;
        message?: {
          role?: string;
          content?: string | null;
          tool_calls?: OpenRouterToolCall[];
        };
      }>;
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
      };
    };

    const choice = json.choices?.[0];
    const msg = choice?.message;
    if (!msg) {
      throw new OpenRouterError(
        'OpenRouter returned an empty response with no message.',
        502,
        'OPENROUTER_EMPTY_RESPONSE',
        true
      );
    }

    decrementLocalQuotaEstimate();

    return {
      model: json.model ?? model,
      usedFallback: false,
      message: {
        role: 'assistant',
        content: typeof msg.content === 'string' ? msg.content : null,
        tool_calls: Array.isArray(msg.tool_calls) ? msg.tool_calls : undefined,
      },
      finishReason: choice?.finish_reason ?? null,
      usage: json.usage,
    };
  }

  async function createChatCompletion(params: {
    messages: OpenRouterChatMessage[];
    tools?: OpenRouterToolDefinition[];
    temperature?: number;
  }): Promise<OpenRouterCompletionResult> {
    if (!configValid || !primaryModel || !fallbackModel) {
      throw new OpenRouterError(
        validationError ?? 'OpenRouter model policy validation failed.',
        503,
        'INVALID_MODEL_POLICY',
        false
      );
    }

    if (verifyInFlight) {
      await verifyInFlight.catch(() => undefined);
    }

    const quota = await fetchQuota(false);
    if (quota.exhausted) {
      throw new OpenRouterError(
        QUOTA_EXHAUSTED_MESSAGE,
        429,
        'AI_QUOTA_EXHAUSTED',
        false
      );
    }

    const temperature = params.temperature ?? 0.1;
    const primaryReasoning = primaryCheck?.reasoningSupported ?? true;
    const fallbackReasoning = fallbackCheck?.reasoningSupported ?? true;

    try {
      return await callSingleModel(
        primaryModel,
        params.messages,
        params.tools,
        temperature,
        primaryReasoning
      );
    } catch (err) {
      const shouldFallback =
        err instanceof OpenRouterError &&
        (err.status === 429 || err.status >= 500) &&
        err.status !== 504 &&
        Boolean(fallbackModel) &&
        fallbackModel !== primaryModel;

      if (!shouldFallback) {
        throw err;
      }

      // Single fallback attempt only after 429 or 5xx from primary
      const fallbackResult = await callSingleModel(
        fallbackModel,
        params.messages,
        params.tools,
        temperature,
        fallbackReasoning
      );
      return {
        ...fallbackResult,
        usedFallback: true,
      };
    }
  }

  async function getHealthSnapshot(
    refreshQuota = false
  ): Promise<OpenRouterHealthSnapshot> {
    const quota = await fetchQuota(refreshQuota);
    return {
      provider: 'openrouter',
      orchestration_implemented: true,
      api_key_configured: Boolean(config.openrouterApiKey),
      model_configured: Boolean(primaryModel),
      primary_model: primaryModel,
      fallback_model: fallbackModel,
      free_tier_verified:
        configValid &&
        config.readiness.openrouterFreeTierValid &&
        (lastVerifiedAt !== null ? freeTierVerified : true),
      tools_supported: lastVerifiedAt !== null ? toolsSupported : true,
      fallback_verified:
        configValid &&
        config.readiness.openrouterFallbackValid !== false &&
        (lastVerifiedAt !== null ? fallbackVerified : true),
      paid_fallback_allowed: false,
      auto_routing_allowed: false,
      last_verified_at: lastVerifiedAt,
      verification_error: verificationError,
      primary_check: primaryCheck,
      fallback_check: fallbackCheck,
      quota,
    };
  }

  let intervalHandle: ReturnType<typeof setInterval> | null = null;
  if (options.startBackgroundRefresh !== false) {
    verifyInFlight = verifyModels().then(() => undefined);
    void fetchQuota(true);
    intervalHandle = setInterval(() => {
      void verifyModels();
    }, OPENROUTER_REVERIFY_INTERVAL_MS);
    if (typeof intervalHandle.unref === 'function') {
      intervalHandle.unref();
    }
  }

  return {
    primaryModel,
    fallbackModel,
    configValid,
    validationError,
    verifyModels,
    fetchQuota,
    decrementLocalQuotaEstimate,
    getHealthSnapshot,
    createChatCompletion,
    stop() {
      if (intervalHandle) {
        clearInterval(intervalHandle);
        intervalHandle = null;
      }
    },
  };
}
