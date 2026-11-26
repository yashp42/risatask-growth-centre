import 'dotenv/config';
import { z } from 'zod';

export type AppEnvironmentName =
  | 'demo'
  | 'development'
  | 'staging'
  | 'production';

export interface OpenDecisionItem {
  id: string;
  topic: string;
  sourceRef: string;
  status: 'open';
  summary: string;
}

/**
 * Explicit unresolved-decision register preserved without silent reconciliation.
 */
export const UNRESOLVED_DECISIONS: ReadonlyArray<OpenDecisionItem> = [
  {
    id: 'OD-02',
    topic: '2025 historical_synthetic dataset placement in app DB vs analytical store',
    sourceRef: '04_integration_requirements.md §2 IN-01; 10_technical_architecture_handoff.md §2.1',
    status: 'open',
    summary:
      'Whether ED-2025 synthetic rows live in operational Supabase DB tables as read-only reference rows or exclusively in an analytical store.',
  },
  {
    id: 'OD-07',
    topic: 'External LLM provider data-retention & training terms',
    sourceRef: '04_integration_requirements.md §3 OUT-03; user Stage 1A brief',
    status: 'open',
    summary:
      'Project switched to OpenRouter free-tier models only (no paid fallback, no auto-routing to paid models); provider zero-retention confirmation pending before Stage 4 activation.',
  },
  {
    id: 'OD-24',
    topic: 'Standalone admin role assignment & account-provisioning governance',
    sourceRef: '02_architecture_requirements.md §4',
    status: 'open',
    summary:
      'Administrator role is separate from business roles; who holds it and whether coordination_lead shares account-creation authority remains open.',
  },
  {
    id: 'AMB-TEAM-AUTH-JOIN',
    topic: 'TEAM_MEMBER to Supabase Auth user linkage column',
    sourceRef: '01_conceptual_data_model.md §4A vs 10_technical_architecture_handoff.md §3',
    status: 'open',
    summary:
      'Conceptual model lists email on TEAM_MEMBER while handoff notes joining role_assignment to team_member by auth user id; schema provisioning will confirm column name.',
  },
  {
    id: 'AMB-TASK-PROVENANCE',
    topic: 'TASK record_class scope & completed_at attribute',
    sourceRef: '01_conceptual_data_model.md §4E',
    status: 'open',
    summary:
      'Header allows live and simulated while provenance text says Live only; completed_at is referenced by done-status rule but omitted from table columns.',
  },
  {
    id: 'AMB-SUPPORT-TYPE-2025',
    topic: '2025 OPPORTUNITY.support_type vs 2026 CONTRACT_LINE.consideration_type for M-03/M-04',
    sourceRef: '01_conceptual_data_model.md §4C/§4D & 05_metric_dictionary.csv',
    status: 'open',
    summary:
      '2025 parity lacks contract lines and uses opportunity support_type; 2026 splits cash vs in-kind at contract line level.',
  },
];

export interface ServerConfig {
  port: number;
  nodeEnv: string;
  appEnv: string;
  editionIdDefault: string;
  databaseUrl: string | null;
  supabaseUrl: string | null;
  supabasePublishableKey: string | null;
  openrouterApiKey: string | null;
  openrouterModel: string | null;
  openrouterModelFallback?: string | null;
  demoLoginEmail: string | null;
  demoLoginPassword: string | null;
  validationErrors: string[];
  validationWarnings: string[];
  readiness: {
    databaseConfigured: boolean;
    authConfigured: boolean;
    demoLoginEnabled: boolean;
    openrouterKeyConfigured: boolean;
    openrouterModelConfigured: boolean;
    openrouterFreeTierValid: boolean;
    openrouterFallbackValid?: boolean;
    paidFallbackAllowed: false;
    autoRoutingAllowed: false;
  };
}

export interface PublicAppConfig {
  supabase_url: string | null;
  supabase_publishable_key: string | null;
  app_env: string;
  edition_id_default: string;
  auth_configured: boolean;
  demo_login_enabled: boolean;
}

const PLACEHOLDER_PATTERN = /^(MY_|REPLACE_WITH_|YOUR_|CHANGEME)/i;

function normalizeEnvValue(raw: string | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed || PLACEHOLDER_PATTERN.test(trimmed)) {
    return null;
  }
  return trimmed;
}

function isServiceRoleKey(key: string): boolean {
  if (/^sb_secret_/i.test(key)) return true;
  const parts = key.split('.');
  if (parts.length === 3) {
    try {
      const payloadJson = Buffer.from(parts[1], 'base64url').toString('utf8');
      const parsed = JSON.parse(payloadJson) as { role?: unknown };
      if (parsed.role === 'service_role') {
        return true;
      }
    } catch {
      // Non-JWT opaque key or malformed payload; handled elsewhere.
    }
  }
  return false;
}

function isValidPostgresUrl(raw: string): boolean {
  try {
    const parsed = new URL(raw);
    return (
      (parsed.protocol === 'postgres:' || parsed.protocol === 'postgresql:') &&
      Boolean(parsed.hostname)
    );
  } catch {
    return false;
  }
}

function isValidSupabaseUrl(raw: string): boolean {
  try {
    const parsed = new URL(raw);
    if (parsed.protocol === 'https:') {
      return Boolean(parsed.hostname);
    }
    if (
      parsed.protocol === 'http:' &&
      (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1')
    ) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export const DEFAULT_OPENROUTER_MODEL_PRIMARY =
  'nvidia/nemotron-3-ultra-550b-a55b:free';
export const DEFAULT_OPENROUTER_MODEL_FALLBACK =
  'inclusionai/ling-3.2-flash:free';

/**
 * Enforces the strict free-models-only cost constraint on OpenRouter models:
 * - Never `openrouter/auto` (automatic routing can select paid models)
 * - Explicit `<provider>/<model>:free` slug only
 */
export function isVerifiedFreeOpenRouterModel(model: string): boolean {
  const normalized = model.trim().toLowerCase();
  if (!normalized || normalized === 'openrouter/auto') {
    return false;
  }
  return normalized.endsWith(':free') && normalized.includes('/');
}

export function assertValidFreeOpenRouterModel(
  model: string,
  label = 'OPENROUTER_MODEL'
): string {
  const trimmed = model.trim();
  if (!isVerifiedFreeOpenRouterModel(trimmed)) {
    throw new Error(
      `${label} "${trimmed}" violates the free-models-only policy (must be an explicit <provider>/<model>:free slug and must not be openrouter/auto).`
    );
  }
  return trimmed;
}

const portSchema = z.coerce.number().int().min(1).max(65535).default(3000);

export function loadServerConfig(
  env: NodeJS.ProcessEnv = process.env
): ServerConfig {
  const validationErrors: string[] = [];
  const validationWarnings: string[] = [];

  const parsedPort = portSchema.safeParse(env.PORT ?? 3000);
  const port = parsedPort.success ? parsedPort.data : 3000;
  if (!parsedPort.success) {
    validationErrors.push('PORT must be a valid integer between 1 and 65535.');
  }

  const nodeEnv = normalizeEnvValue(env.NODE_ENV) ?? 'development';
  const appEnv = normalizeEnvValue(env.APP_ENV) ?? 'demo';
  const editionIdDefault =
    normalizeEnvValue(env.EDITION_ID_DEFAULT) ?? 'ED-2026-DEMO';

  let databaseUrl = normalizeEnvValue(env.DATABASE_URL);
  if (!databaseUrl) {
    validationWarnings.push(
      'DATABASE_URL is not configured; PostgreSQL persistence and role resolution are unavailable.'
    );
  } else if (!isValidPostgresUrl(databaseUrl)) {
    validationErrors.push(
      'DATABASE_URL is invalid; expected a postgresql:// or postgres:// connection URI.'
    );
    databaseUrl = null;
  }

  let supabaseUrl = normalizeEnvValue(env.SUPABASE_URL);
  if (!supabaseUrl) {
    validationWarnings.push(
      'SUPABASE_URL is not configured; Supabase token verification is unavailable.'
    );
  } else if (!isValidSupabaseUrl(supabaseUrl)) {
    validationErrors.push(
      'SUPABASE_URL is invalid; expected an https:// URL (or http://localhost for local development).'
    );
    supabaseUrl = null;
  }

  let supabasePublishableKey =
    normalizeEnvValue(env.SUPABASE_PUBLISHABLE_KEY) ??
    normalizeEnvValue(env.SUPABASE_ANON_KEY);
  if (!supabasePublishableKey) {
    validationWarnings.push(
      'SUPABASE_PUBLISHABLE_KEY is not configured; Supabase Auth client configuration is incomplete.'
    );
  } else if (isServiceRoleKey(supabasePublishableKey)) {
    validationErrors.push(
      'SUPABASE_PUBLISHABLE_KEY must not contain a Supabase service_role or sb_secret_ credential.'
    );
    supabasePublishableKey = null;
  }

  const demoLoginEmail = normalizeEnvValue(env.DEMO_LOGIN_EMAIL);
  const demoLoginPassword = normalizeEnvValue(env.DEMO_LOGIN_PASSWORD);
  const demoLoginEnabled = Boolean(demoLoginEmail && demoLoginPassword);

  const openrouterApiKey = normalizeEnvValue(env.OPENROUTER_API_KEY);
  if (!openrouterApiKey) {
    validationWarnings.push(
      'OPENROUTER_API_KEY is not configured (required later in Stage 4 AI Growth Analyst).'
    );
  }

  const rawPrimaryModel = normalizeEnvValue(env.OPENROUTER_MODEL);
  let openrouterModel: string | null =
    rawPrimaryModel ?? DEFAULT_OPENROUTER_MODEL_PRIMARY;
  let openrouterFreeTierValid = false;
  if (!isVerifiedFreeOpenRouterModel(openrouterModel)) {
    validationErrors.push(
      'OPENROUTER_MODEL violates free-models-only policy (must end in `:free` and must not be `openrouter/auto`).'
    );
    openrouterModel = null;
  } else {
    openrouterFreeTierValid = true;
  }

  const rawFallbackModel = normalizeEnvValue(env.OPENROUTER_MODEL_FALLBACK);
  let openrouterModelFallback: string | null =
    rawFallbackModel ?? DEFAULT_OPENROUTER_MODEL_FALLBACK;
  let openrouterFallbackValid = false;
  if (!isVerifiedFreeOpenRouterModel(openrouterModelFallback)) {
    validationErrors.push(
      'OPENROUTER_MODEL_FALLBACK violates free-models-only policy (must end in `:free` and must not be `openrouter/auto`).'
    );
    openrouterModelFallback = null;
  } else {
    openrouterFallbackValid = true;
  }

  return {
    port,
    nodeEnv,
    appEnv,
    editionIdDefault,
    databaseUrl,
    supabaseUrl,
    supabasePublishableKey,
    openrouterApiKey,
    openrouterModel,
    openrouterModelFallback,
    demoLoginEmail,
    demoLoginPassword,
    validationErrors,
    validationWarnings,
    readiness: {
      databaseConfigured: Boolean(databaseUrl),
      authConfigured: Boolean(supabaseUrl && supabasePublishableKey),
      demoLoginEnabled,
      openrouterKeyConfigured: Boolean(openrouterApiKey),
      openrouterModelConfigured: Boolean(openrouterModel),
      openrouterFreeTierValid,
      openrouterFallbackValid,
      paidFallbackAllowed: false,
      autoRoutingAllowed: false,
    },
  };
}

export function getPublicConfig(config: ServerConfig): PublicAppConfig {
  return {
    supabase_url: config.supabaseUrl,
    supabase_publishable_key: config.supabasePublishableKey,
    app_env: config.appEnv,
    edition_id_default: config.editionIdDefault,
    auth_configured: config.readiness.authConfigured,
    demo_login_enabled: Boolean(
      config.demoLoginEmail && config.demoLoginPassword
    ),
  };
}
