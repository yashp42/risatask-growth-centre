-- ============================================================================
-- Sponsorship Growth Platform — Stage 1B Database Schema Foundation
-- File: db/01_schema.sql
-- Target: Supabase PostgreSQL (PostgreSQL 15+)
--
-- IMPORTANT GOVERNANCE NOTICE:
--   1. Do NOT execute automatically against production without review.
--   2. Preserve canonical entity names, metric IDs, D-009/D-010 values,
--      record-class isolation, append-only history, and no-hard-delete rules.
--   3. Sections marked "-- [PENDING DECISION: <ID>]" depend on unresolved
--      product or technical decisions tracked in DATABASE_DECISION_REGISTER.md.
--   4. Revision r2 (26 Nov 2026, technical-lead review): fixes D4-D7 from STAGE_1B_REVIEW.md.
-- ============================================================================

BEGIN;

-- Dedicated schema for deterministic metric SQL functions (Stage 2: metrics.m_01..m_30).
CREATE SCHEMA IF NOT EXISTS metrics;

-- ============================================================================
-- 1. SYSTEM STATE & PROVENANCE ROOT
-- ============================================================================

-- Singleton data_version counter bumped on every operational write (Rule 5).
CREATE TABLE IF NOT EXISTS public.app_state (
    id              SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    data_version    BIGINT NOT NULL DEFAULT 1 CHECK (data_version >= 1),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by      TEXT
);

INSERT INTO public.app_state (id, data_version, updated_by)
VALUES (1, 1, 'schema_init')
ON CONFLICT (id) DO NOTHING;

-- Root provenance batch table (01_conceptual_data_model.md §4G).
-- Note: import_batch is the root of provenance; import_batch_id is its own PK.
CREATE TABLE IF NOT EXISTS public.import_batch (
    import_batch_id     TEXT PRIMARY KEY,
    batch_type          TEXT NOT NULL CHECK (batch_type IN (
                            'ui', 'file_import', 'model_run', 'research_load', 'simulation'
                        )),
    record_class        TEXT NOT NULL CHECK (record_class IN (
                            'historical_synthetic', 'external_research', 'model_assumption',
                            'model_output', 'operating_plan', 'live', 'simulated'
                        )),
    source_file         TEXT,
    source_sha256       TEXT,
    row_count           INTEGER CHECK (row_count IS NULL OR row_count >= 0),
    started_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    validation_status   TEXT CHECK (validation_status IN ('passed', 'failed')),
    -- Standard provenance block
    source_ref          TEXT,
    evidence_class      TEXT CHECK (evidence_class IN ('D', 'B', 'A', 'C', 'T', 'U')),
    data_version        TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by          TEXT NOT NULL,
    ai_action_id        TEXT,
    is_deleted          BOOLEAN NOT NULL DEFAULT false
);

-- ============================================================================
-- 2. GOVERNANCE, SOURCE & BENCHMARK REFERENCE TABLES (DOMAIN G)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.decision_record (
    decision_id         TEXT PRIMARY KEY,
    title               TEXT NOT NULL,
    status              TEXT NOT NULL CHECK (status IN ('approved', 'proposed', 'superseded')),
    approved_at         TIMESTAMPTZ,
    approved_by         TEXT,
    superseded_by_id    TEXT REFERENCES public.decision_record(decision_id),
    document_uri        TEXT,
    -- Standard provenance block
    record_class        TEXT NOT NULL CHECK (record_class = 'operating_plan'),
    import_batch_id     TEXT NOT NULL REFERENCES public.import_batch(import_batch_id),
    source_ref          TEXT,
    evidence_class      TEXT CHECK (evidence_class IN ('D', 'B', 'A', 'C', 'T', 'U')),
    data_version        TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by          TEXT NOT NULL,
    ai_action_id        TEXT,
    is_deleted          BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS public.source_register (
    source_id           TEXT PRIMARY KEY,
    url                 TEXT NOT NULL,
    publisher           TEXT,
    source_date         TEXT,
    accessed_at         DATE NOT NULL,
    archive_uri         TEXT,
    -- Standard provenance block
    record_class        TEXT NOT NULL CHECK (record_class = 'external_research'),
    import_batch_id     TEXT NOT NULL REFERENCES public.import_batch(import_batch_id),
    source_ref          TEXT,
    evidence_class      TEXT CHECK (evidence_class IN ('D', 'B', 'A', 'C', 'T', 'U')),
    data_version        TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by          TEXT NOT NULL,
    ai_action_id        TEXT,
    is_deleted          BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS public.benchmark (
    benchmark_id        TEXT PRIMARY KEY,
    source_id           TEXT NOT NULL REFERENCES public.source_register(source_id),
    festival            TEXT NOT NULL,
    city                TEXT,
    edition_year        INTEGER CHECK (edition_year IS NULL OR (edition_year >= 1990 AND edition_year <= 2100)),
    asset_type          TEXT CHECK (asset_type IS NULL OR asset_type IN (
                            'title', 'presenting', 'co_presenting', 'powered_by',
                            'activation', 'digital', 'headline_night', 'other'
                        )),
    price_low           NUMERIC(14, 2) CHECK (price_low IS NULL OR price_low >= 0),
    price_high          NUMERIC(14, 2) CHECK (price_high IS NULL OR price_high >= 0),
    value_kind          TEXT NOT NULL CHECK (value_kind IN ('ASK', 'ACTUAL', 'COST')),
    stated_footfall     TEXT,
    excluded_from_central BOOLEAN NOT NULL DEFAULT false,
    -- Standard provenance block
    record_class        TEXT NOT NULL CHECK (record_class = 'external_research'),
    import_batch_id     TEXT NOT NULL REFERENCES public.import_batch(import_batch_id),
    source_ref          TEXT,
    evidence_class      TEXT CHECK (evidence_class IN ('D', 'B', 'A', 'C', 'T', 'U')),
    data_version        TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by          TEXT NOT NULL,
    ai_action_id        TEXT,
    is_deleted          BOOLEAN NOT NULL DEFAULT false,
    CHECK (price_low IS NULL OR price_high IS NULL OR price_high >= price_low)
);

-- ============================================================================
-- 3. ORGANISATION & CHANNEL REFERENCE TABLES (DOMAINS A & B)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.festival_edition (
    edition_id          TEXT PRIMARY KEY,
    name                TEXT NOT NULL,
    city                TEXT,
    starts_at           TIMESTAMPTZ NOT NULL,
    ends_at             TIMESTAMPTZ NOT NULL,
    season_start        DATE,
    preseason_start     DATE,
    currency            TEXT NOT NULL DEFAULT 'INR',
    is_fictional        BOOLEAN NOT NULL DEFAULT false,
    is_current          BOOLEAN NOT NULL DEFAULT false,
    -- Standard provenance block
    record_class        TEXT NOT NULL CHECK (record_class IN (
                            'historical_synthetic', 'live', 'simulated'
                        )),
    import_batch_id     TEXT NOT NULL REFERENCES public.import_batch(import_batch_id),
    source_ref          TEXT,
    evidence_class      TEXT CHECK (evidence_class IN ('D', 'B', 'A', 'C', 'T', 'U')),
    data_version        TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by          TEXT NOT NULL,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    ai_action_id        TEXT,
    is_deleted          BOOLEAN NOT NULL DEFAULT false,
    CHECK (ends_at >= starts_at),
    CHECK (season_start IS NULL OR starts_at::date > season_start),
    CHECK (preseason_start IS NULL OR season_start IS NULL OR preseason_start <= season_start),
    -- 2025 fictional assignment edition can never be the current active edition.
    CHECK (NOT (is_fictional AND is_current))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_festival_edition_single_current
    ON public.festival_edition (is_current)
    WHERE is_current = true AND is_deleted = false;

CREATE TABLE IF NOT EXISTS public.category (
    category_id         TEXT PRIMARY KEY,
    name                TEXT NOT NULL,
    parent_category_id  TEXT REFERENCES public.category(category_id),
    tier                TEXT CHECK (tier IS NULL OR tier IN ('T1', 'T2', 'selective')),
    dataset_industry    TEXT,
    -- Standard provenance block
    record_class        TEXT NOT NULL CHECK (record_class = 'operating_plan'),
    import_batch_id     TEXT NOT NULL REFERENCES public.import_batch(import_batch_id),
    source_ref          TEXT,
    evidence_class      TEXT CHECK (evidence_class IN ('D', 'B', 'A', 'C', 'T', 'U')),
    data_version        TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by          TEXT NOT NULL,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    ai_action_id        TEXT,
    is_deleted          BOOLEAN NOT NULL DEFAULT false,
    CHECK (parent_category_id IS NULL OR parent_category_id <> category_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_category_name_global
    ON public.category (lower(btrim(name)))
    WHERE is_deleted = false;

CREATE UNIQUE INDEX IF NOT EXISTS uq_category_name_within_parent
    ON public.category (COALESCE(parent_category_id, ''), lower(btrim(name)))
    WHERE is_deleted = false;

CREATE TABLE IF NOT EXISTS public.channel (
    channel_id          TEXT PRIMARY KEY,
    name                TEXT NOT NULL UNIQUE,
    channel_group       TEXT NOT NULL CHECK (channel_group IN (
                            'warm', 'inbound', 'cold', 'renewal', 'premium'
                        )),
    is_active           BOOLEAN NOT NULL DEFAULT true,
    -- Standard provenance block
    record_class        TEXT NOT NULL CHECK (record_class = 'operating_plan'),
    import_batch_id     TEXT NOT NULL REFERENCES public.import_batch(import_batch_id),
    source_ref          TEXT,
    evidence_class      TEXT CHECK (evidence_class IN ('D', 'B', 'A', 'C', 'T', 'U')),
    data_version        TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by          TEXT NOT NULL,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    ai_action_id        TEXT,
    is_deleted          BOOLEAN NOT NULL DEFAULT false
);

-- [PENDING DECISION: AMB-TEAM-AUTH-JOIN]
-- Conceptual model defines email UNIQUE ("Login identity") without auth_user_id;
-- 10_technical_architecture_handoff.md §3 joins role_assignment to team_member by auth user id.
-- Both email (nullable for historical_synthetic T01/T02/T05 rows) and auth_user_id (UUID UNIQUE)
-- are included so Stage 1A/Stage 2 auth resolution works without fabrication.
CREATE TABLE IF NOT EXISTS public.team_member (
    member_id           TEXT PRIMARY KEY,
    full_name           TEXT NOT NULL,
    email               TEXT UNIQUE,
    auth_user_id        UUID UNIQUE,
    fte_share           NUMERIC(4, 2) CHECK (fte_share IS NULL OR (fte_share > 0 AND fte_share <= 1.00)),
    active_from         DATE,
    active_to           DATE,
    is_active           BOOLEAN NOT NULL DEFAULT true,
    -- Standard provenance block
    record_class        TEXT NOT NULL CHECK (record_class IN (
                            'historical_synthetic', 'live', 'simulated'
                        )),
    import_batch_id     TEXT NOT NULL REFERENCES public.import_batch(import_batch_id),
    source_ref          TEXT,
    evidence_class      TEXT CHECK (evidence_class IN ('D', 'B', 'A', 'C', 'T', 'U')),
    data_version        TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by          TEXT NOT NULL,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    ai_action_id        TEXT,
    is_deleted          BOOLEAN NOT NULL DEFAULT false,
    CHECK (active_to IS NULL OR active_from IS NULL OR active_to >= active_from),
    CHECK (record_class <> 'historical_synthetic' OR auth_user_id IS NULL)
);

-- ============================================================================
-- 4. STRATEGY, KPI & METRIC REFERENCE TABLES (DOMAIN F & G)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.bet (
    bet_id              TEXT PRIMARY KEY,
    name                TEXT NOT NULL,
    rank                INTEGER CHECK (rank IS NULL OR rank >= 1),
    decision_id         TEXT REFERENCES public.decision_record(decision_id),
    scenarios           TEXT,
    -- Standard provenance block
    record_class        TEXT NOT NULL CHECK (record_class = 'operating_plan'),
    import_batch_id     TEXT NOT NULL REFERENCES public.import_batch(import_batch_id),
    source_ref          TEXT,
    evidence_class      TEXT CHECK (evidence_class IN ('D', 'B', 'A', 'C', 'T', 'U')),
    data_version        TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by          TEXT NOT NULL,
    ai_action_id        TEXT,
    is_deleted          BOOLEAN NOT NULL DEFAULT false
);

-- [PENDING DECISION: AMB-METRIC-CSV-COLS]
-- Preserves all canonical 01_conceptual_data_model.md attributes PLUS metadata columns from
-- 05_metric_dictionary.csv (name, kpi_id, business_meaning, time_period, inclusion_exclusion,
-- source_table_2025, source_table_future, unit, computable_2025, example_calculation,
-- example_value_2025) and full-state version columns.
CREATE TABLE IF NOT EXISTS public.metric_definition (
    metric_id           TEXT PRIMARY KEY,
    name                TEXT,
    kpi_id              TEXT,
    business_meaning    TEXT,
    formula             TEXT NOT NULL,
    numerator           TEXT,
    denominator         TEXT,
    aggregation         TEXT,
    time_period         TEXT,
    inclusion_exclusion TEXT,
    source_table_2025   TEXT,
    source_table_future TEXT,
    value_nature        TEXT NOT NULL CHECK (value_nature IN (
                            'actual', 'calculated', 'assumed', 'forecast'
                        )),
    unit                TEXT,
    sql                 TEXT,
    sql_hash            TEXT,
    test_ref            TEXT,
    computable_2025     TEXT CHECK (computable_2025 IS NULL OR computable_2025 IN ('yes', 'no', 'lookup')),
    example_calculation TEXT,
    example_value_2025  NUMERIC(14, 4),
    definition_version  TEXT NOT NULL DEFAULT '1.0',
    -- Full-state versioning columns
    valid_from          TIMESTAMPTZ NOT NULL DEFAULT now(),
    valid_to            TIMESTAMPTZ,
    version_no          INTEGER NOT NULL DEFAULT 1 CHECK (version_no >= 1),
    superseded_by       TEXT REFERENCES public.metric_definition(metric_id),
    -- Standard provenance block
    record_class        TEXT NOT NULL CHECK (record_class = 'operating_plan'),
    import_batch_id     TEXT NOT NULL REFERENCES public.import_batch(import_batch_id),
    source_ref          TEXT,
    evidence_class      TEXT CHECK (evidence_class IN ('D', 'B', 'A', 'C', 'T', 'U')),
    data_version        TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by          TEXT NOT NULL,
    ai_action_id        TEXT,
    is_deleted          BOOLEAN NOT NULL DEFAULT false,
    CHECK (valid_to IS NULL OR valid_to >= valid_from)
);

CREATE TABLE IF NOT EXISTS public.kpi_definition (
    kpi_id              TEXT PRIMARY KEY,
    name                TEXT NOT NULL,
    bet_id              TEXT REFERENCES public.bet(bet_id),
    kpi_type            TEXT CHECK (kpi_type IS NULL OR kpi_type IN (
                            'north_star', 'gate', 'leading', 'lagging', 'guardrail',
                            'funnel', 'capacity', 'diagnostic', 'other'
                        )),
    definition          TEXT NOT NULL,
    grain               TEXT,
    frequency           TEXT,
    metric_id           TEXT REFERENCES public.metric_definition(metric_id),
    -- Full-state versioning columns
    valid_from          TIMESTAMPTZ NOT NULL DEFAULT now(),
    valid_to            TIMESTAMPTZ,
    version_no          INTEGER NOT NULL DEFAULT 1 CHECK (version_no >= 1),
    superseded_by       TEXT REFERENCES public.kpi_definition(kpi_id),
    -- Standard provenance block
    record_class        TEXT NOT NULL CHECK (record_class = 'operating_plan'),
    import_batch_id     TEXT NOT NULL REFERENCES public.import_batch(import_batch_id),
    source_ref          TEXT,
    evidence_class      TEXT CHECK (evidence_class IN ('D', 'B', 'A', 'C', 'T', 'U')),
    data_version        TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by          TEXT NOT NULL,
    ai_action_id        TEXT,
    is_deleted          BOOLEAN NOT NULL DEFAULT false,
    CHECK (valid_to IS NULL OR valid_to >= valid_from)
);

CREATE TABLE IF NOT EXISTS public.scenario_reference (
    scenario_id         TEXT PRIMARY KEY,
    name                TEXT NOT NULL,
    status              TEXT NOT NULL CHECK (status IN ('APPROVED', 'analysis', 'option')),
    expected_cash       NUMERIC(12, 2) NOT NULL CHECK (expected_cash >= 0),
    p10                 NUMERIC(12, 2),
    p90                 NUMERIC(12, 2),
    window_pw           NUMERIC(6, 2) CHECK (window_pw IS NULL OR window_pw >= 0),
    preseason_pw        NUMERIC(6, 2) CHECK (preseason_pw IS NULL OR preseason_pw >= 0),
    decision_id         TEXT REFERENCES public.decision_record(decision_id),
    output_checksum     TEXT NOT NULL,
    -- Standard provenance block
    record_class        TEXT NOT NULL CHECK (record_class = 'model_output'),
    import_batch_id     TEXT NOT NULL REFERENCES public.import_batch(import_batch_id),
    source_ref          TEXT,
    evidence_class      TEXT CHECK (evidence_class IN ('D', 'B', 'A', 'C', 'T', 'U')),
    data_version        TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by          TEXT NOT NULL,
    ai_action_id        TEXT,
    is_deleted          BOOLEAN NOT NULL DEFAULT false,
    CHECK (p10 IS NULL OR p90 IS NULL OR p90 >= p10)
);

CREATE TABLE IF NOT EXISTS public.threshold_rule (
    rule_id             TEXT PRIMARY KEY,
    kpi_id              TEXT NOT NULL REFERENCES public.kpi_definition(kpi_id),
    evaluate_at         TEXT NOT NULL,
    keep_if             TEXT,
    escalate_if         TEXT NOT NULL,
    response            TEXT NOT NULL,
    owner_role          TEXT CHECK (owner_role IS NULL OR owner_role IN (
                            'coordination_lead', 'pipeline_ops', 'finance_collections',
                            'partnerships', 'community', 'network', 'premium_sales',
                            'viewer', 'admin'
                        )),
    decision_id         TEXT REFERENCES public.decision_record(decision_id),
    rule_status         TEXT NOT NULL DEFAULT 'operational decision rule, not a statistical test',
    -- Full-state versioning columns
    valid_from          TIMESTAMPTZ NOT NULL DEFAULT now(),
    valid_to            TIMESTAMPTZ,
    version_no          INTEGER NOT NULL DEFAULT 1 CHECK (version_no >= 1),
    superseded_by       TEXT REFERENCES public.threshold_rule(rule_id),
    -- Standard provenance block
    record_class        TEXT NOT NULL CHECK (record_class = 'operating_plan'),
    import_batch_id     TEXT NOT NULL REFERENCES public.import_batch(import_batch_id),
    source_ref          TEXT,
    evidence_class      TEXT CHECK (evidence_class IN ('D', 'B', 'A', 'C', 'T', 'U')),
    data_version        TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by          TEXT NOT NULL,
    ai_action_id        TEXT,
    is_deleted          BOOLEAN NOT NULL DEFAULT false,
    CHECK (valid_to IS NULL OR valid_to >= valid_from)
);

CREATE TABLE IF NOT EXISTS public.experiment (
    experiment_id       TEXT PRIMARY KEY,
    bet_id              TEXT NOT NULL REFERENCES public.bet(bet_id),
    hypothesis          TEXT NOT NULL,
    population          TEXT,
    intervention        TEXT,
    sample_size         TEXT,
    time_limit          TEXT,
    primary_kpi_id      TEXT REFERENCES public.kpi_definition(kpi_id),
    rule_id             TEXT REFERENCES public.threshold_rule(rule_id),
    status              TEXT NOT NULL DEFAULT 'planned' CHECK (status IN (
                            'planned', 'running', 'decided'
                        )),
    -- Standard provenance block
    record_class        TEXT NOT NULL CHECK (record_class = 'operating_plan'),
    import_batch_id     TEXT NOT NULL REFERENCES public.import_batch(import_batch_id),
    source_ref          TEXT,
    evidence_class      TEXT CHECK (evidence_class IN ('D', 'B', 'A', 'C', 'T', 'U')),
    data_version        TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by          TEXT NOT NULL,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    ai_action_id        TEXT,
    is_deleted          BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS public.model_assumption (
    assumption_id       TEXT PRIMARY KEY,
    variable            TEXT NOT NULL,
    frozen_value        TEXT NOT NULL,
    uncertainty         TEXT,
    validation_kpi_id   TEXT REFERENCES public.kpi_definition(kpi_id),
    experiment_id       TEXT REFERENCES public.experiment(experiment_id),
    -- Standard provenance block
    record_class        TEXT NOT NULL CHECK (record_class = 'model_assumption'),
    import_batch_id     TEXT NOT NULL REFERENCES public.import_batch(import_batch_id),
    source_ref          TEXT,
    evidence_class      TEXT CHECK (evidence_class IN ('D', 'B', 'A', 'C', 'T', 'U')),
    data_version        TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by          TEXT NOT NULL,
    ai_action_id        TEXT,
    is_deleted          BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS public.target_version (
    target_id           TEXT PRIMARY KEY,
    edition_id          TEXT NOT NULL REFERENCES public.festival_edition(edition_id),
    kpi_id              TEXT NOT NULL REFERENCES public.kpi_definition(kpi_id),
    scenario_id         TEXT REFERENCES public.scenario_reference(scenario_id),
    period              TEXT,
    target_value        NUMERIC(14, 4) NOT NULL,
    decision_id         TEXT REFERENCES public.decision_record(decision_id),
    -- Full-state versioning columns
    valid_from          TIMESTAMPTZ NOT NULL DEFAULT now(),
    valid_to            TIMESTAMPTZ,
    version_no          INTEGER NOT NULL DEFAULT 1 CHECK (version_no >= 1),
    superseded_by       TEXT REFERENCES public.target_version(target_id),
    -- Standard provenance block
    record_class        TEXT NOT NULL CHECK (record_class IN (
                            'historical_synthetic', 'operating_plan'
                        )),
    import_batch_id     TEXT NOT NULL REFERENCES public.import_batch(import_batch_id),
    source_ref          TEXT,
    evidence_class      TEXT CHECK (evidence_class IN ('D', 'B', 'A', 'C', 'T', 'U')),
    data_version        TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by          TEXT NOT NULL,
    ai_action_id        TEXT,
    is_deleted          BOOLEAN NOT NULL DEFAULT false,
    CHECK (valid_to IS NULL OR valid_to >= valid_from)
);

-- [PENDING DECISION: OD-06]
-- First release uses PostgreSQL full-text search (tsv GIN index) without pgvector.
-- If paraphrased evaluation queries fail, embedding VECTOR(...) may be added behind OD-06 approval.
CREATE TABLE IF NOT EXISTS public.knowledge_chunk (
    chunk_id            TEXT PRIMARY KEY,
    doc_id              TEXT NOT NULL,
    version             TEXT NOT NULL,
    decision_status     TEXT NOT NULL CHECK (decision_status IN (
                            'approved', 'reference', 'proposed', 'superseded', 'draft'
                        )),
    retrieval_rule      TEXT NOT NULL DEFAULT 'default' CHECK (retrieval_rule IN (
                            'default', 'contradiction_and_history_only'
                        )),
    evidence_class      TEXT CHECK (evidence_class IN ('D', 'B', 'A', 'C', 'T', 'U')),
    related_bet         TEXT,
    related_kpi         TEXT,
    text                TEXT NOT NULL,
    citation_location   TEXT,
    tsv                 TSVECTOR GENERATED ALWAYS AS (
                            to_tsvector(
                                'english',
                                COALESCE(chunk_id, '') || ' ' ||
                                COALESCE(doc_id, '') || ' ' ||
                                COALESCE(related_bet, '') || ' ' ||
                                COALESCE(related_kpi, '') || ' ' ||
                                COALESCE(text, '')
                            )
                        ) STORED,
    -- Full-state versioning columns
    valid_from          TIMESTAMPTZ NOT NULL DEFAULT now(),
    valid_to            TIMESTAMPTZ,
    version_no          INTEGER NOT NULL DEFAULT 1 CHECK (version_no >= 1),
    superseded_by       TEXT REFERENCES public.knowledge_chunk(chunk_id),
    -- Standard provenance block
    record_class        TEXT NOT NULL CHECK (record_class IN (
                            'historical_synthetic', 'external_research', 'model_assumption',
                            'model_output', 'operating_plan'
                        )),
    import_batch_id     TEXT NOT NULL REFERENCES public.import_batch(import_batch_id),
    source_ref          TEXT,
    data_version        TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by          TEXT NOT NULL,
    ai_action_id        TEXT,
    is_deleted          BOOLEAN NOT NULL DEFAULT false,
    CHECK (valid_to IS NULL OR valid_to >= valid_from)
);

CREATE INDEX IF NOT EXISTS idx_knowledge_chunk_tsv
    ON public.knowledge_chunk USING GIN (tsv);

CREATE INDEX IF NOT EXISTS idx_knowledge_chunk_filters
    ON public.knowledge_chunk (decision_status, retrieval_rule, record_class)
    WHERE is_deleted = false AND valid_to IS NULL;

-- ============================================================================
-- 5. ORGANISATION & PIPELINE OPERATIONAL TABLES (DOMAINS A & B)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.sponsor (
    sponsor_id          TEXT PRIMARY KEY,
    display_name        TEXT NOT NULL,
    legal_name          TEXT,
    category_id         TEXT REFERENCES public.category(category_id),
    -- r2/D7: 2025 brands carry no lifecycle status; it is required for every other class.
    lifecycle_status    TEXT CHECK (lifecycle_status IS NULL OR lifecycle_status IN (
                            'research_target', 'prospect', 'active', 'past_sponsor', 'do_not_contact'
                        )),
    first_source        TEXT CHECK (first_source IS NULL OR first_source IN (
                            'research', 'referral', 'inbound', 'outreach', 'renewal'
                        )),
    gstin               TEXT,
    website             TEXT,
    city                TEXT,
    -- Standard provenance block
    record_class        TEXT NOT NULL CHECK (record_class IN (
                            'historical_synthetic', 'external_research', 'live', 'simulated'
                        )),
    import_batch_id     TEXT NOT NULL REFERENCES public.import_batch(import_batch_id),
    source_ref          TEXT,
    evidence_class      TEXT CHECK (evidence_class IN ('D', 'B', 'A', 'C', 'T', 'U')),
    data_version        TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by          TEXT NOT NULL,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    ai_action_id        TEXT,
    is_deleted          BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT sponsor_lifecycle_required_outside_history
        CHECK (record_class = 'historical_synthetic' OR lifecycle_status IS NOT NULL)
);

-- Normalised display_name unique within each record_class so 2025 historical_synthetic
-- brands never collide or silently merge with live/simulated sponsors.
CREATE UNIQUE INDEX IF NOT EXISTS uq_sponsor_display_name_per_class
    ON public.sponsor (record_class, lower(btrim(display_name)))
    WHERE is_deleted = false;

CREATE TABLE IF NOT EXISTS public.contact (
    contact_id          TEXT PRIMARY KEY,
    sponsor_id          TEXT NOT NULL REFERENCES public.sponsor(sponsor_id),
    full_name           TEXT NOT NULL,
    job_title           TEXT,
    decision_role       TEXT NOT NULL DEFAULT 'unknown' CHECK (decision_role IN (
                            'decision_maker', 'influencer', 'user', 'unknown'
                        )),
    email               TEXT,
    phone               TEXT,
    consent_basis       TEXT CHECK (consent_basis IS NULL OR consent_basis IN (
                            'legitimate_interest', 'inbound_consent', 'referral_intro',
                            'prior_sponsor', 'public_directory', 'unknown'
                        )),
    opted_out_at        TIMESTAMPTZ,
    -- Standard provenance block
    record_class        TEXT NOT NULL CHECK (record_class IN (
                            'historical_synthetic', 'live', 'simulated'
                        )),
    import_batch_id     TEXT NOT NULL REFERENCES public.import_batch(import_batch_id),
    source_ref          TEXT,
    evidence_class      TEXT CHECK (evidence_class IN ('D', 'B', 'A', 'C', 'T', 'U')),
    data_version        TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by          TEXT NOT NULL,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    ai_action_id        TEXT,
    is_deleted          BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS public.network_partner (
    partner_id          TEXT PRIMARY KEY,
    partner_type        TEXT NOT NULL CHECK (partner_type IN (
                            'creator', 'vc_fund', 'alumnus', 'past_sponsor', 'other'
                        )),
    name                TEXT NOT NULL,
    owner_member_id     TEXT REFERENCES public.team_member(member_id),
    recruited_at        DATE,
    status              TEXT NOT NULL DEFAULT 'invited' CHECK (status IN (
                            'invited', 'active', 'inactive'
                        )),
    -- Standard provenance block
    record_class        TEXT NOT NULL CHECK (record_class IN ('live', 'simulated')),
    import_batch_id     TEXT NOT NULL REFERENCES public.import_batch(import_batch_id),
    source_ref          TEXT,
    evidence_class      TEXT CHECK (evidence_class IN ('D', 'B', 'A', 'C', 'T', 'U')),
    data_version        TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by          TEXT NOT NULL,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    ai_action_id        TEXT,
    is_deleted          BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS public.campaign (
    campaign_id         TEXT PRIMARY KEY,
    edition_id          TEXT NOT NULL REFERENCES public.festival_edition(edition_id),
    name                TEXT NOT NULL,
    channel_id          TEXT NOT NULL REFERENCES public.channel(channel_id),
    bet_id              TEXT REFERENCES public.bet(bet_id),
    owner_member_id     TEXT REFERENCES public.team_member(member_id),
    planned_start       TIMESTAMPTZ,
    planned_end         TIMESTAMPTZ,
    objective           TEXT,
    status              TEXT NOT NULL DEFAULT 'planned' CHECK (status IN (
                            'planned', 'active', 'stopped', 'closed'
                        )),
    -- IMPORTANT: Campaign must NEVER contain planned_person_weeks or planned_hours (00_READ_FIRST.md).
    -- Standard provenance block
    record_class        TEXT NOT NULL CHECK (record_class IN (
                            'historical_synthetic', 'live', 'simulated'
                        )),
    import_batch_id     TEXT NOT NULL REFERENCES public.import_batch(import_batch_id),
    source_ref          TEXT,
    evidence_class      TEXT CHECK (evidence_class IN ('D', 'B', 'A', 'C', 'T', 'U')),
    data_version        TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by          TEXT NOT NULL,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    ai_action_id        TEXT,
    is_deleted          BOOLEAN NOT NULL DEFAULT false,
    CHECK (planned_end IS NULL OR planned_start IS NULL OR planned_end >= planned_start)
);

CREATE TABLE IF NOT EXISTS public.referral (
    referral_id         TEXT PRIMARY KEY,
    partner_id          TEXT NOT NULL REFERENCES public.network_partner(partner_id),
    sponsor_id          TEXT NOT NULL REFERENCES public.sponsor(sponsor_id),
    contact_id          TEXT REFERENCES public.contact(contact_id),
    campaign_id         TEXT REFERENCES public.campaign(campaign_id),
    commitment_status   TEXT NOT NULL CHECK (commitment_status IN (
                            'speculative', 'committed', 'met', 'declined', 'lapsed'
                        )),
    committed_at        TIMESTAMPTZ,
    ask_sent_at         TIMESTAMPTZ,
    -- Full-state versioning columns
    valid_from          TIMESTAMPTZ NOT NULL DEFAULT now(),
    valid_to            TIMESTAMPTZ,
    version_no          INTEGER NOT NULL DEFAULT 1 CHECK (version_no >= 1),
    superseded_by       TEXT REFERENCES public.referral(referral_id),
    -- Standard provenance block
    record_class        TEXT NOT NULL CHECK (record_class IN ('live', 'simulated')),
    import_batch_id     TEXT NOT NULL REFERENCES public.import_batch(import_batch_id),
    source_ref          TEXT,
    evidence_class      TEXT CHECK (evidence_class IN ('D', 'B', 'A', 'C', 'T', 'U')),
    data_version        TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by          TEXT NOT NULL,
    ai_action_id        TEXT,
    is_deleted          BOOLEAN NOT NULL DEFAULT false,
    CHECK (valid_to IS NULL OR valid_to >= valid_from),
    -- INV-04: Committed introduction requires a named contact_id.
    CHECK (commitment_status <> 'committed' OR contact_id IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS public.prospect_research (
    research_id         TEXT PRIMARY KEY,
    sponsor_id          TEXT NOT NULL REFERENCES public.sponsor(sponsor_id),
    edition_id          TEXT REFERENCES public.festival_edition(edition_id),
    attractiveness      INTEGER CHECK (attractiveness IS NULL OR (attractiveness >= 0 AND attractiveness <= 100)),
    accessibility       INTEGER CHECK (accessibility IS NULL OR (accessibility >= 0 AND accessibility <= 100)),
    route_class         TEXT CHECK (route_class IS NULL OR route_class IN (
                            'A', 'V1', 'V2', 'V3', 'U_local', 'U', 'U_out'
                        )),
    action              TEXT CHECK (action IS NULL OR action IN (
                            'Pursue now', 'Build a route', 'Opportunistic', 'Deprioritise'
                        )),
    value_track         TEXT CHECK (value_track IS NULL OR value_track IN ('cash', 'in_kind')),
    face_value_low      NUMERIC(14, 2) CHECK (face_value_low IS NULL OR face_value_low >= 0),
    face_value_high     NUMERIC(14, 2) CHECK (face_value_high IS NULL OR face_value_high >= 0),
    evidence_source_ids TEXT,
    assessed_at         DATE NOT NULL,
    -- Full-state versioning columns
    valid_from          TIMESTAMPTZ NOT NULL DEFAULT now(),
    valid_to            TIMESTAMPTZ,
    version_no          INTEGER NOT NULL DEFAULT 1 CHECK (version_no >= 1),
    superseded_by       TEXT REFERENCES public.prospect_research(research_id),
    -- Standard provenance block
    record_class        TEXT NOT NULL CHECK (record_class = 'external_research'),
    import_batch_id     TEXT NOT NULL REFERENCES public.import_batch(import_batch_id),
    source_ref          TEXT,
    evidence_class      TEXT CHECK (evidence_class IN ('D', 'B', 'A', 'C', 'T', 'U')),
    data_version        TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by          TEXT NOT NULL,
    ai_action_id        TEXT,
    is_deleted          BOOLEAN NOT NULL DEFAULT false,
    CHECK (valid_to IS NULL OR valid_to >= valid_from),
    CHECK (face_value_low IS NULL OR face_value_high IS NULL OR face_value_high >= face_value_low)
);

CREATE TABLE IF NOT EXISTS public.ownership_assignment (
    assignment_id       TEXT PRIMARY KEY,
    subject_type        TEXT NOT NULL CHECK (subject_type IN (
                            'sponsor', 'opportunity', 'network_partner'
                        )),
    subject_id          TEXT NOT NULL,
    member_id           TEXT NOT NULL REFERENCES public.team_member(member_id),
    role_in_relationship TEXT NOT NULL DEFAULT 'owner' CHECK (role_in_relationship IN (
                            'owner', 'support'
                        )),
    reason              TEXT,
    -- Full-state versioning columns
    valid_from          TIMESTAMPTZ NOT NULL DEFAULT now(),
    valid_to            TIMESTAMPTZ,
    version_no          INTEGER NOT NULL DEFAULT 1 CHECK (version_no >= 1),
    superseded_by       TEXT REFERENCES public.ownership_assignment(assignment_id),
    -- Standard provenance block
    record_class        TEXT NOT NULL CHECK (record_class IN (
                            'historical_synthetic', 'live', 'simulated'
                        )),
    import_batch_id     TEXT NOT NULL REFERENCES public.import_batch(import_batch_id),
    source_ref          TEXT,
    evidence_class      TEXT CHECK (evidence_class IN ('D', 'B', 'A', 'C', 'T', 'U')),
    data_version        TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by          TEXT NOT NULL,
    ai_action_id        TEXT,
    is_deleted          BOOLEAN NOT NULL DEFAULT false,
    CHECK (valid_to IS NULL OR valid_to >= valid_from)
);

-- At most one current primary owner per subject (sponsor / opportunity / network_partner).
CREATE UNIQUE INDEX IF NOT EXISTS uq_ownership_one_current_owner
    ON public.ownership_assignment (subject_type, subject_id, record_class)
    WHERE role_in_relationship = 'owner'
      AND valid_to IS NULL
      AND is_deleted = false;

CREATE TABLE IF NOT EXISTS public.outreach_attempt (
    attempt_id          TEXT PRIMARY KEY,
    campaign_id         TEXT NOT NULL REFERENCES public.campaign(campaign_id),
    sponsor_id          TEXT NOT NULL REFERENCES public.sponsor(sponsor_id),
    contact_id          TEXT REFERENCES public.contact(contact_id),
    referral_id         TEXT REFERENCES public.referral(referral_id),
    owner_member_id     TEXT REFERENCES public.team_member(member_id),
    started_at          TIMESTAMPTZ NOT NULL,
    root_event_type     TEXT NOT NULL CHECK (root_event_type IN (
                            'outreach_sent', 'introduction_received', 'web_inbound'
                        )),
    -- Standard provenance block
    record_class        TEXT NOT NULL CHECK (record_class IN (
                            'historical_synthetic', 'live', 'simulated'
                        )),
    import_batch_id     TEXT NOT NULL REFERENCES public.import_batch(import_batch_id),
    source_ref          TEXT,
    evidence_class      TEXT CHECK (evidence_class IN ('D', 'B', 'A', 'C', 'T', 'U')),
    data_version        TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by          TEXT NOT NULL,
    ai_action_id        TEXT,
    is_deleted          BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS public.interaction (
    interaction_id      TEXT PRIMARY KEY,
    attempt_id          TEXT NOT NULL REFERENCES public.outreach_attempt(attempt_id),
    origin_interaction_id TEXT REFERENCES public.interaction(interaction_id),
    -- r2/D6: the 2025 vocabulary (stg.ref_event_outcome) is authoritative and stored unchanged;
    -- the remaining values were already added for 2026 operations. Synonym 'opted_out' removed.
    event_type          TEXT NOT NULL CHECK (event_type IN (
                            'outreach_sent', 'delivered', 'replied', 'meeting_booked',
                            'meeting_held', 'opt_out', 'introduction_received', 'web_inbound',
                            'bounced', 'meeting_cancelled', 'follow_up_sent', 'note'
                        )),
    outcome             TEXT CHECK (outcome IS NULL OR outcome IN (
                            'sent', 'delivered', 'positive', 'neutral', 'not_interested',
                            'wrong_contact', 'scheduled', 'attended', 'do_not_contact',
                            'introduced', 'interest_submitted',
                            'no_response', 'bounced', 'cancelled', 'completed', 'other'
                        )),
    occurred_at         TIMESTAMPTZ NOT NULL,
    summary             TEXT,
    logged_by           TEXT REFERENCES public.team_member(member_id),
    -- Standard provenance block
    record_class        TEXT NOT NULL CHECK (record_class IN (
                            'historical_synthetic', 'live', 'simulated'
                        )),
    import_batch_id     TEXT NOT NULL REFERENCES public.import_batch(import_batch_id),
    source_ref          TEXT,
    evidence_class      TEXT CHECK (evidence_class IN ('D', 'B', 'A', 'C', 'T', 'U')),
    data_version        TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by          TEXT NOT NULL,
    ai_action_id        TEXT,
    is_deleted          BOOLEAN NOT NULL DEFAULT false
);

-- Duplicate event protection (01_conceptual_data_model.md §4B INTERACTION).
CREATE UNIQUE INDEX IF NOT EXISTS uq_interaction_attempt_event_time
    ON public.interaction (attempt_id, event_type, occurred_at)
    WHERE is_deleted = false;

-- [PENDING DECISION: AMB-SUPPORT-TYPE-2025]
-- OPPORTUNITY retains support_type (cash / in_kind / mixed) for 2025 metric parity (M-03/M-04)
-- while live/simulated 2026 signed values break down by CONTRACT_LINE.consideration_type.
CREATE TABLE IF NOT EXISTS public.opportunity (
    opportunity_id      TEXT PRIMARY KEY,
    sponsor_id          TEXT NOT NULL REFERENCES public.sponsor(sponsor_id),
    edition_id          TEXT NOT NULL REFERENCES public.festival_edition(edition_id),
    primary_contact_id  TEXT REFERENCES public.contact(contact_id),
    originating_campaign_id TEXT REFERENCES public.campaign(campaign_id),
    bet_id              TEXT REFERENCES public.bet(bet_id),
    support_type        TEXT NOT NULL CHECK (support_type IN ('cash', 'in_kind', 'mixed')),
    is_renewal          BOOLEAN NOT NULL DEFAULT false,
    renewal_route       TEXT CHECK (renewal_route IS NULL OR renewal_route IN (
                            'direct_past_owner', 'warm_intro', 'inbound', 'reassigned', 'other'
                        )),
    recovered_lead      BOOLEAN NOT NULL DEFAULT false,
    name                TEXT,
    -- Standard provenance block
    record_class        TEXT NOT NULL CHECK (record_class IN (
                            'historical_synthetic', 'live', 'simulated'
                        )),
    import_batch_id     TEXT NOT NULL REFERENCES public.import_batch(import_batch_id),
    source_ref          TEXT,
    evidence_class      TEXT CHECK (evidence_class IN ('D', 'B', 'A', 'C', 'T', 'U')),
    data_version        TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by          TEXT NOT NULL,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    ai_action_id        TEXT,
    is_deleted          BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS public.meeting (
    meeting_id          TEXT PRIMARY KEY,
    attempt_id          TEXT REFERENCES public.outreach_attempt(attempt_id),
    opportunity_id      TEXT REFERENCES public.opportunity(opportunity_id),
    sponsor_id          TEXT NOT NULL REFERENCES public.sponsor(sponsor_id),
    scheduled_at        TIMESTAMPTZ NOT NULL,
    status              TEXT NOT NULL CHECK (status IN (
                            'booked', 'held', 'no_show', 'cancelled'
                        )),
    purpose             TEXT CHECK (purpose IS NULL OR purpose IN (
                            'discovery', 'renewal_screen', 'title_pitch', 'negotiation'
                        )),
    attendee_member_ids TEXT[],
    outcome_note        TEXT,
    -- Standard provenance block
    record_class        TEXT NOT NULL CHECK (record_class IN (
                            'historical_synthetic', 'live', 'simulated'
                        )),
    import_batch_id     TEXT NOT NULL REFERENCES public.import_batch(import_batch_id),
    source_ref          TEXT,
    evidence_class      TEXT CHECK (evidence_class IN ('D', 'B', 'A', 'C', 'T', 'U')),
    data_version        TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by          TEXT NOT NULL,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    ai_action_id        TEXT,
    is_deleted          BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS public.qualification_version (
    history_id          TEXT PRIMARY KEY,
    sponsor_id          TEXT NOT NULL REFERENCES public.sponsor(sponsor_id),
    edition_id          TEXT NOT NULL REFERENCES public.festival_edition(edition_id),
    source_campaign_id  TEXT REFERENCES public.campaign(campaign_id),
    status              TEXT NOT NULL CHECK (status IN (
                            'unreviewed', 'engaged', 'qualified', 'unqualified', 'dormant'
                        )),
    reason              TEXT,
    checklist_passed    BOOLEAN,
    -- Full-state versioning columns
    valid_from          TIMESTAMPTZ NOT NULL DEFAULT now(),
    valid_to            TIMESTAMPTZ,
    version_no          INTEGER NOT NULL DEFAULT 1 CHECK (version_no >= 1),
    superseded_by       TEXT REFERENCES public.qualification_version(history_id),
    -- Standard provenance block
    record_class        TEXT NOT NULL CHECK (record_class IN (
                            'historical_synthetic', 'live', 'simulated'
                        )),
    import_batch_id     TEXT NOT NULL REFERENCES public.import_batch(import_batch_id),
    source_ref          TEXT,
    evidence_class      TEXT CHECK (evidence_class IN ('D', 'B', 'A', 'C', 'T', 'U')),
    data_version        TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by          TEXT NOT NULL,
    ai_action_id        TEXT,
    is_deleted          BOOLEAN NOT NULL DEFAULT false,
    CHECK (valid_to IS NULL OR valid_to >= valid_from)
);

CREATE TABLE IF NOT EXISTS public.opportunity_stage_version (
    history_id          TEXT PRIMARY KEY,
    opportunity_id      TEXT NOT NULL REFERENCES public.opportunity(opportunity_id),
    stage               TEXT NOT NULL CHECK (stage IN (
                            'prospecting', 'contacted', 'proposal_sent',
                            'negotiating', 'partner_confirmed', 'lost', 'withdrawn'
                        )),
    owner_member_id     TEXT REFERENCES public.team_member(member_id),
    proposed_value      NUMERIC(14, 2) CHECK (proposed_value IS NULL OR proposed_value >= 0),
    confirmed_value     NUMERIC(14, 2) CHECK (confirmed_value IS NULL OR confirmed_value >= 0),
    drop_reason         TEXT CHECK (drop_reason IS NULL OR drop_reason IN (
                            'budget_mismatch', 'timing_fit', 'category_conflict', 'terms_dispute',
                            'no_response', 'sla_breach_dropped', 'sponsor_declined',
                            'internal_withdrawn', 'other'
                        )),
    loss_reason         TEXT CHECK (loss_reason IS NULL OR loss_reason IN (
                            'terms_dispute', 'budget_mismatch', 'competitor_exclusivity',
                            'timing_fit', 'no_response', 'category_conflict', 'other'
                        )),
    -- Full-state versioning columns
    valid_from          TIMESTAMPTZ NOT NULL DEFAULT now(),
    valid_to            TIMESTAMPTZ,
    version_no          INTEGER NOT NULL DEFAULT 1 CHECK (version_no >= 1),
    superseded_by       TEXT REFERENCES public.opportunity_stage_version(history_id),
    -- Standard provenance block
    record_class        TEXT NOT NULL CHECK (record_class IN (
                            'historical_synthetic', 'live', 'simulated'
                        )),
    import_batch_id     TEXT NOT NULL REFERENCES public.import_batch(import_batch_id),
    source_ref          TEXT,
    evidence_class      TEXT CHECK (evidence_class IN ('D', 'B', 'A', 'C', 'T', 'U')),
    data_version        TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by          TEXT NOT NULL,
    ai_action_id        TEXT,
    is_deleted          BOOLEAN NOT NULL DEFAULT false,
    CHECK (valid_to IS NULL OR valid_to >= valid_from),
    -- Rule 3 / INV-06: Confirmed value only at partner_confirmed; lost/withdrawn require drop_reason
    -- (for live/simulated; 2025 historical_synthetic had no drop_reason column).
    CHECK (confirmed_value IS NULL OR confirmed_value = 0 OR stage = 'partner_confirmed'),
    CHECK (
        record_class = 'historical_synthetic'
        OR stage NOT IN ('lost', 'withdrawn')
        OR drop_reason IS NOT NULL
    )
);

-- ============================================================================
-- 6. SPONSORSHIP COMMERCIAL MANAGEMENT TABLES (DOMAIN C)
-- ============================================================================

-- [PENDING DECISION: OD-18]
-- Full conceptual Domain C inventory/slot/rate-card/exclusivity tables included so
-- contract_line, proposal, and B5 constraints enforce complete referential integrity.
CREATE TABLE IF NOT EXISTS public.inventory_asset (
    asset_id            TEXT PRIMARY KEY,
    edition_id          TEXT NOT NULL REFERENCES public.festival_edition(edition_id),
    asset_type          TEXT NOT NULL CHECK (asset_type IN (
                            'title', 'presenting', 'co_presenting', 'powered_by',
                            'activation', 'digital', 'headline_night', 'other'
                        )),
    slots_total         INTEGER NOT NULL CHECK (slots_total >= 1),
    is_premium          BOOLEAN NOT NULL DEFAULT false,
    sell_by_week        INTEGER,
    lead_time_weeks     TEXT,
    deliverables        TEXT,
    requires_booking    TEXT,
    -- Standard provenance block
    record_class        TEXT NOT NULL CHECK (record_class = 'operating_plan'),
    import_batch_id     TEXT NOT NULL REFERENCES public.import_batch(import_batch_id),
    source_ref          TEXT,
    evidence_class      TEXT CHECK (evidence_class IN ('D', 'B', 'A', 'C', 'T', 'U')),
    data_version        TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by          TEXT NOT NULL,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    ai_action_id        TEXT,
    is_deleted          BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS public.price_list_entry (
    price_id            TEXT PRIMARY KEY,
    asset_id            TEXT NOT NULL REFERENCES public.inventory_asset(asset_id),
    list_price          NUMERIC(14, 2) CHECK (list_price IS NULL OR list_price >= 0),
    floor_price         NUMERIC(14, 2) CHECK (floor_price IS NULL OR floor_price >= 0),
    realised_low        NUMERIC(14, 2) CHECK (realised_low IS NULL OR realised_low >= 0),
    realised_mode       NUMERIC(14, 2) CHECK (realised_mode IS NULL OR realised_mode >= 0),
    realised_high       NUMERIC(14, 2) CHECK (realised_high IS NULL OR realised_high >= 0),
    assumption_id       TEXT REFERENCES public.model_assumption(assumption_id),
    advance_share       NUMERIC(5, 4) CHECK (advance_share IS NULL OR (advance_share >= 0 AND advance_share <= 1)),
    -- Full-state versioning columns
    valid_from          TIMESTAMPTZ NOT NULL DEFAULT now(),
    valid_to            TIMESTAMPTZ,
    version_no          INTEGER NOT NULL DEFAULT 1 CHECK (version_no >= 1),
    superseded_by       TEXT REFERENCES public.price_list_entry(price_id),
    -- Standard provenance block
    record_class        TEXT NOT NULL CHECK (record_class = 'operating_plan'),
    import_batch_id     TEXT NOT NULL REFERENCES public.import_batch(import_batch_id),
    source_ref          TEXT,
    evidence_class      TEXT CHECK (evidence_class IN ('D', 'B', 'A', 'C', 'T', 'U')),
    data_version        TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by          TEXT NOT NULL,
    ai_action_id        TEXT,
    is_deleted          BOOLEAN NOT NULL DEFAULT false,
    CHECK (valid_to IS NULL OR valid_to >= valid_from)
);

CREATE TABLE IF NOT EXISTS public.package (
    package_id          TEXT PRIMARY KEY,
    edition_id          TEXT NOT NULL REFERENCES public.festival_edition(edition_id),
    name                TEXT NOT NULL,
    list_price          NUMERIC(14, 2) CHECK (list_price IS NULL OR list_price >= 0),
    is_active           BOOLEAN NOT NULL DEFAULT true,
    -- Standard provenance block
    record_class        TEXT NOT NULL CHECK (record_class = 'operating_plan'),
    import_batch_id     TEXT NOT NULL REFERENCES public.import_batch(import_batch_id),
    source_ref          TEXT,
    evidence_class      TEXT CHECK (evidence_class IN ('D', 'B', 'A', 'C', 'T', 'U')),
    data_version        TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by          TEXT NOT NULL,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    ai_action_id        TEXT,
    is_deleted          BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS public.package_item (
    package_item_id     TEXT PRIMARY KEY,
    package_id          TEXT NOT NULL REFERENCES public.package(package_id),
    asset_id            TEXT NOT NULL REFERENCES public.inventory_asset(asset_id),
    quantity            INTEGER NOT NULL CHECK (quantity >= 1),
    -- Standard provenance block
    record_class        TEXT NOT NULL CHECK (record_class = 'operating_plan'),
    import_batch_id     TEXT NOT NULL REFERENCES public.import_batch(import_batch_id),
    source_ref          TEXT,
    evidence_class      TEXT CHECK (evidence_class IN ('D', 'B', 'A', 'C', 'T', 'U')),
    data_version        TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by          TEXT NOT NULL,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    ai_action_id        TEXT,
    is_deleted          BOOLEAN NOT NULL DEFAULT false
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_package_item_package_asset
    ON public.package_item (package_id, asset_id)
    WHERE is_deleted = false;

CREATE TABLE IF NOT EXISTS public.proposal (
    proposal_id         TEXT PRIMARY KEY,
    opportunity_id      TEXT NOT NULL REFERENCES public.opportunity(opportunity_id),
    package_id          TEXT REFERENCES public.package(package_id),
    proposed_value      NUMERIC(14, 2) NOT NULL CHECK (proposed_value >= 0),
    exclusivity_requested TEXT DEFAULT 'none' CHECK (exclusivity_requested IS NULL OR exclusivity_requested IN (
                            'none', 'narrow', 'broad'
                        )),
    sent_at             TIMESTAMPTZ,
    valid_until         DATE,
    status              TEXT NOT NULL CHECK (status IN (
                            'draft', 'sent', 'superseded', 'accepted', 'declined'
                        )),
    document_uri        TEXT,
    -- Full-state versioning columns
    valid_from          TIMESTAMPTZ NOT NULL DEFAULT now(),
    valid_to            TIMESTAMPTZ,
    version_no          INTEGER NOT NULL DEFAULT 1 CHECK (version_no >= 1),
    superseded_by       TEXT REFERENCES public.proposal(proposal_id),
    -- Standard provenance block
    record_class        TEXT NOT NULL CHECK (record_class IN ('live', 'simulated')),
    import_batch_id     TEXT NOT NULL REFERENCES public.import_batch(import_batch_id),
    source_ref          TEXT,
    evidence_class      TEXT CHECK (evidence_class IN ('D', 'B', 'A', 'C', 'T', 'U')),
    data_version        TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by          TEXT NOT NULL,
    ai_action_id        TEXT,
    is_deleted          BOOLEAN NOT NULL DEFAULT false,
    CHECK (valid_to IS NULL OR valid_to >= valid_from),
    -- Human must send proposals (L4 drafts only from AI; sent requires sent_at).
    CHECK (status <> 'sent' OR sent_at IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS public.contract (
    contract_id         TEXT PRIMARY KEY,
    opportunity_id      TEXT NOT NULL REFERENCES public.opportunity(opportunity_id),
    signed_at           TIMESTAMPTZ NOT NULL,
    signed_value_total  NUMERIC(14, 2) NOT NULL CHECK (signed_value_total >= 0),
    payment_terms       TEXT CHECK (payment_terms IS NULL OR payment_terms IN (
                            'standard_50_50', '100_upfront', 'custom'
                        )),
    signatory_contact_id TEXT REFERENCES public.contact(contact_id),
    document_uri        TEXT,
    status              TEXT NOT NULL DEFAULT 'active' CHECK (status IN (
                            'active', 'amended', 'terminated'
                        )),
    -- Full-state versioning columns
    valid_from          TIMESTAMPTZ NOT NULL DEFAULT now(),
    valid_to            TIMESTAMPTZ,
    version_no          INTEGER NOT NULL DEFAULT 1 CHECK (version_no >= 1),
    superseded_by       TEXT REFERENCES public.contract(contract_id),
    -- Standard provenance block
    record_class        TEXT NOT NULL CHECK (record_class IN ('live', 'simulated')),
    import_batch_id     TEXT NOT NULL REFERENCES public.import_batch(import_batch_id),
    source_ref          TEXT,
    evidence_class      TEXT CHECK (evidence_class IN ('D', 'B', 'A', 'C', 'T', 'U')),
    data_version        TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by          TEXT NOT NULL,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    ai_action_id        TEXT,
    is_deleted          BOOLEAN NOT NULL DEFAULT false,
    CHECK (valid_to IS NULL OR valid_to >= valid_from)
);

-- Exactly one active non-superseded contract per opportunity.
CREATE UNIQUE INDEX IF NOT EXISTS uq_contract_active_per_opportunity
    ON public.contract (opportunity_id)
    WHERE status = 'active' AND valid_to IS NULL AND is_deleted = false;

CREATE TABLE IF NOT EXISTS public.contract_line (
    contract_line_id    TEXT PRIMARY KEY,
    contract_id         TEXT NOT NULL REFERENCES public.contract(contract_id),
    asset_id            TEXT REFERENCES public.inventory_asset(asset_id),
    consideration_type  TEXT NOT NULL CHECK (consideration_type IN ('cash', 'in_kind')),
    value               NUMERIC(14, 2) NOT NULL CHECK (value > 0),
    price_id            TEXT REFERENCES public.price_list_entry(price_id),
    -- Standard provenance block
    record_class        TEXT NOT NULL CHECK (record_class IN ('live', 'simulated')),
    import_batch_id     TEXT NOT NULL REFERENCES public.import_batch(import_batch_id),
    source_ref          TEXT,
    evidence_class      TEXT CHECK (evidence_class IN ('D', 'B', 'A', 'C', 'T', 'U')),
    data_version        TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by          TEXT NOT NULL,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    ai_action_id        TEXT,
    is_deleted          BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS public.asset_slot (
    slot_id             TEXT PRIMARY KEY,
    asset_id            TEXT NOT NULL REFERENCES public.inventory_asset(asset_id),
    slot_no             INTEGER NOT NULL CHECK (slot_no >= 1),
    status              TEXT NOT NULL DEFAULT 'available' CHECK (status IN (
                            'available', 'held', 'sold', 'withdrawn'
                        )),
    held_for_opportunity_id TEXT REFERENCES public.opportunity(opportunity_id),
    hold_expires_at     TIMESTAMPTZ,
    sold_contract_line_id TEXT REFERENCES public.contract_line(contract_line_id),
    -- Standard provenance block
    record_class        TEXT NOT NULL CHECK (record_class IN ('live', 'simulated')),
    import_batch_id     TEXT NOT NULL REFERENCES public.import_batch(import_batch_id),
    source_ref          TEXT,
    evidence_class      TEXT CHECK (evidence_class IN ('D', 'B', 'A', 'C', 'T', 'U')),
    data_version        TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by          TEXT NOT NULL,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    ai_action_id        TEXT,
    is_deleted          BOOLEAN NOT NULL DEFAULT false,
    CHECK (status <> 'sold' OR sold_contract_line_id IS NOT NULL),
    CHECK (status <> 'held' OR held_for_opportunity_id IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_asset_slot_number_per_class
    ON public.asset_slot (asset_id, slot_no, record_class)
    WHERE is_deleted = false;

-- INV-08: A contract line claims at most one sold slot per class/row.
CREATE UNIQUE INDEX IF NOT EXISTS uq_asset_slot_sold_contract_line
    ON public.asset_slot (sold_contract_line_id)
    WHERE sold_contract_line_id IS NOT NULL AND is_deleted = false;

CREATE TABLE IF NOT EXISTS public.exclusivity_grant (
    grant_id            TEXT PRIMARY KEY,
    contract_id         TEXT NOT NULL REFERENCES public.contract(contract_id),
    category_id         TEXT NOT NULL REFERENCES public.category(category_id),
    scope               TEXT NOT NULL CHECK (scope IN ('narrow', 'broad')),
    valid_from          DATE NOT NULL,
    valid_to            DATE NOT NULL,
    blocks_base_share   NUMERIC(5, 4) CHECK (blocks_base_share IS NULL OR (blocks_base_share >= 0 AND blocks_base_share <= 1)),
    -- Standard provenance block
    record_class        TEXT NOT NULL CHECK (record_class IN ('live', 'simulated')),
    import_batch_id     TEXT NOT NULL REFERENCES public.import_batch(import_batch_id),
    source_ref          TEXT,
    evidence_class      TEXT CHECK (evidence_class IN ('D', 'B', 'A', 'C', 'T', 'U')),
    data_version        TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by          TEXT NOT NULL,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    ai_action_id        TEXT,
    is_deleted          BOOLEAN NOT NULL DEFAULT false,
    CHECK (valid_to >= valid_from)
);

CREATE TABLE IF NOT EXISTS public.contract_deliverable (
    deliverable_id      TEXT PRIMARY KEY,
    contract_line_id    TEXT REFERENCES public.contract_line(contract_line_id),
    opportunity_id      TEXT REFERENCES public.opportunity(opportunity_id),
    description         TEXT NOT NULL,
    due_at              TIMESTAMPTZ,
    delivered_at        TIMESTAMPTZ,
    proof_metric        TEXT,
    attendee_campaign_ref TEXT,
    -- Standard provenance block
    record_class        TEXT NOT NULL CHECK (record_class IN (
                            'historical_synthetic', 'live', 'simulated'
                        )),
    import_batch_id     TEXT NOT NULL REFERENCES public.import_batch(import_batch_id),
    source_ref          TEXT,
    evidence_class      TEXT CHECK (evidence_class IN ('D', 'B', 'A', 'C', 'T', 'U')),
    data_version        TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by          TEXT NOT NULL,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    ai_action_id        TEXT,
    is_deleted          BOOLEAN NOT NULL DEFAULT false,
    CHECK (contract_line_id IS NOT NULL OR opportunity_id IS NOT NULL)
);

-- ============================================================================
-- 7. FINANCIAL MANAGEMENT TABLES (DOMAIN D)
-- ============================================================================

-- Written ONLY by finance_collections via SECURITY DEFINER functions in 02_roles_grants.sql.
-- Status is intentionally NOT stored as a mutable column; derived via payment_schedule_item_status_view.
CREATE TABLE IF NOT EXISTS public.payment_schedule_item (
    schedule_item_id    TEXT PRIMARY KEY,
    contract_id         TEXT NOT NULL REFERENCES public.contract(contract_id),
    kind                TEXT NOT NULL CHECK (kind IN ('advance', 'balance', 'other')),
    amount_due          NUMERIC(14, 2) NOT NULL CHECK (amount_due > 0),
    due_date            DATE NOT NULL,
    -- Standard provenance block
    record_class        TEXT NOT NULL CHECK (record_class IN ('live', 'simulated')),
    import_batch_id     TEXT NOT NULL REFERENCES public.import_batch(import_batch_id),
    source_ref          TEXT,
    evidence_class      TEXT CHECK (evidence_class IN ('D', 'B', 'A', 'C', 'T', 'U')),
    data_version        TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by          TEXT NOT NULL,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    ai_action_id        TEXT,
    is_deleted          BOOLEAN NOT NULL DEFAULT false
);

-- [PENDING DECISION: OD-15 / AMB-INVOICE-IMMUTABLE]
-- Conceptual model specifies immutable versioning alongside status enum (issued / cancelled / settled).
-- Sequential gap-free invoice_no policy and GST tax_amount rules await OD-15 resolution.
CREATE TABLE IF NOT EXISTS public.invoice (
    invoice_id          TEXT PRIMARY KEY,
    invoice_no          TEXT NOT NULL UNIQUE,
    contract_id         TEXT NOT NULL REFERENCES public.contract(contract_id),
    schedule_item_id    TEXT REFERENCES public.payment_schedule_item(schedule_item_id),
    issued_at           TIMESTAMPTZ NOT NULL,
    amount              NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
    tax_amount          NUMERIC(14, 2) DEFAULT 0 CHECK (tax_amount IS NULL OR tax_amount >= 0),
    status              TEXT NOT NULL DEFAULT 'issued' CHECK (status IN (
                            'issued', 'cancelled', 'settled'
                        )),
    document_uri        TEXT,
    -- Standard provenance block
    record_class        TEXT NOT NULL CHECK (record_class IN ('live', 'simulated')),
    import_batch_id     TEXT NOT NULL REFERENCES public.import_batch(import_batch_id),
    source_ref          TEXT,
    evidence_class      TEXT CHECK (evidence_class IN ('D', 'B', 'A', 'C', 'T', 'U')),
    data_version        TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by          TEXT NOT NULL,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    ai_action_id        TEXT,
    is_deleted          BOOLEAN NOT NULL DEFAULT false
);

-- [PENDING DECISION: OD-16 / AMB-RECEIPT-RECONCILE]
-- Core receipt fields (sponsor_id, received_at, amount, method, bank_reference) are immutable;
-- only reconciled (false -> true) may transition via finance_collections reconcile_receipt() RPC.
CREATE TABLE IF NOT EXISTS public.receipt (
    receipt_id          TEXT PRIMARY KEY,
    sponsor_id          TEXT NOT NULL REFERENCES public.sponsor(sponsor_id),
    received_at         TIMESTAMPTZ NOT NULL,
    amount              NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
    method              TEXT CHECK (method IS NULL OR method IN (
                            'bank_transfer', 'upi', 'cheque'
                        )),
    bank_reference      TEXT UNIQUE,
    reconciled          BOOLEAN NOT NULL DEFAULT false,
    reconciled_at       TIMESTAMPTZ,
    recorded_by         TEXT NOT NULL REFERENCES public.team_member(member_id),
    -- Standard provenance block
    record_class        TEXT NOT NULL CHECK (record_class IN ('live', 'simulated')),
    import_batch_id     TEXT NOT NULL REFERENCES public.import_batch(import_batch_id),
    source_ref          TEXT,
    evidence_class      TEXT CHECK (evidence_class IN ('D', 'B', 'A', 'C', 'T', 'U')),
    data_version        TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by          TEXT NOT NULL,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    ai_action_id        TEXT,
    is_deleted          BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS public.receipt_allocation (
    allocation_id       TEXT PRIMARY KEY,
    receipt_id          TEXT NOT NULL REFERENCES public.receipt(receipt_id),
    invoice_id          TEXT REFERENCES public.invoice(invoice_id),
    schedule_item_id    TEXT REFERENCES public.payment_schedule_item(schedule_item_id),
    amount              NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
    -- Standard provenance block
    record_class        TEXT NOT NULL CHECK (record_class IN ('live', 'simulated')),
    import_batch_id     TEXT NOT NULL REFERENCES public.import_batch(import_batch_id),
    source_ref          TEXT,
    evidence_class      TEXT CHECK (evidence_class IN ('D', 'B', 'A', 'C', 'T', 'U')),
    data_version        TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by          TEXT NOT NULL,
    ai_action_id        TEXT,
    is_deleted          BOOLEAN NOT NULL DEFAULT false,
    CHECK (invoice_id IS NOT NULL OR schedule_item_id IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS public.in_kind_contribution (
    in_kind_id          TEXT PRIMARY KEY,
    contract_line_id    TEXT NOT NULL REFERENCES public.contract_line(contract_line_id),
    description         TEXT NOT NULL,
    declared_value      NUMERIC(14, 2) NOT NULL CHECK (declared_value > 0),
    valuation_basis     TEXT,
    delivered_at        TIMESTAMPTZ,
    status              TEXT NOT NULL DEFAULT 'promised' CHECK (status IN (
                            'promised', 'delivered', 'partial', 'not_delivered'
                        )),
    -- Standard provenance block
    record_class        TEXT NOT NULL CHECK (record_class IN ('live', 'simulated')),
    import_batch_id     TEXT NOT NULL REFERENCES public.import_batch(import_batch_id),
    source_ref          TEXT,
    evidence_class      TEXT CHECK (evidence_class IN ('D', 'B', 'A', 'C', 'T', 'U')),
    data_version        TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by          TEXT NOT NULL,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    ai_action_id        TEXT,
    is_deleted          BOOLEAN NOT NULL DEFAULT false
);

-- [PENDING DECISION: OD-19] Cash spend cap policy is undecided.
CREATE TABLE IF NOT EXISTS public.expense (
    expense_id          TEXT PRIMARY KEY,
    edition_id          TEXT NOT NULL REFERENCES public.festival_edition(edition_id),
    bet_id              TEXT REFERENCES public.bet(bet_id),
    amount              NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
    incurred_at         DATE NOT NULL,
    approved_by         TEXT REFERENCES public.team_member(member_id),
    -- Standard provenance block
    record_class        TEXT NOT NULL CHECK (record_class IN ('live', 'simulated')),
    import_batch_id     TEXT NOT NULL REFERENCES public.import_batch(import_batch_id),
    source_ref          TEXT,
    evidence_class      TEXT CHECK (evidence_class IN ('D', 'B', 'A', 'C', 'T', 'U')),
    data_version        TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by          TEXT NOT NULL,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    ai_action_id        TEXT,
    is_deleted          BOOLEAN NOT NULL DEFAULT false
);

-- ============================================================================
-- 8. EXECUTION & OBSERVED ANALYTICS TABLES (DOMAINS E & F)
-- ============================================================================

-- [PENDING DECISION: AMB-TASK-PROVENANCE]
-- 01_conceptual_data_model.md §4E header lists Allowed record classes: live, simulated;
-- Provenance note states "Live only", and Constraints mandate `done requires completed_at`
-- even though completed_at was omitted from the attribute table. Both live/simulated and
-- completed_at are explicitly implemented here.
CREATE TABLE IF NOT EXISTS public.task (
    task_id             TEXT PRIMARY KEY,
    title               TEXT NOT NULL,
    task_type           TEXT NOT NULL CHECK (task_type IN (
                            'follow_up', 'proposal', 'invoice', 'call', 'pitch', 'admin'
                        )),
    owner_member_id     TEXT NOT NULL REFERENCES public.team_member(member_id),
    due_at              TIMESTAMPTZ NOT NULL,
    status              TEXT NOT NULL DEFAULT 'open' CHECK (status IN (
                            'open', 'in_progress', 'blocked', 'done', 'cancelled'
                        )),
    completed_at        TIMESTAMPTZ,
    linked_type         TEXT CHECK (linked_type IS NULL OR linked_type IN (
                            'sponsor', 'opportunity', 'invoice', 'campaign', 'referral'
                        )),
    linked_id           TEXT,
    bet_id              TEXT REFERENCES public.bet(bet_id),
    origin              TEXT NOT NULL DEFAULT 'manual' CHECK (origin IN (
                            'manual', 'rule', 'ai_confirmed'
                        )),
    -- Standard provenance block
    record_class        TEXT NOT NULL CHECK (record_class IN ('live', 'simulated')),
    import_batch_id     TEXT NOT NULL REFERENCES public.import_batch(import_batch_id),
    source_ref          TEXT,
    evidence_class      TEXT CHECK (evidence_class IN ('D', 'B', 'A', 'C', 'T', 'U')),
    data_version        TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by          TEXT NOT NULL,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    ai_action_id        TEXT,
    is_deleted          BOOLEAN NOT NULL DEFAULT false,
    CHECK ((linked_type IS NULL AND linked_id IS NULL) OR (linked_type IS NOT NULL AND linked_id IS NOT NULL)),
    CHECK (status <> 'done' OR completed_at IS NOT NULL),
    CHECK (origin <> 'ai_confirmed' OR ai_action_id IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS public.task_dependency (
    dependency_id       TEXT PRIMARY KEY,
    task_id             TEXT NOT NULL REFERENCES public.task(task_id),
    depends_on_task_id  TEXT NOT NULL REFERENCES public.task(task_id),
    -- Standard provenance block
    record_class        TEXT NOT NULL CHECK (record_class IN ('live', 'simulated')),
    import_batch_id     TEXT NOT NULL REFERENCES public.import_batch(import_batch_id),
    source_ref          TEXT,
    evidence_class      TEXT CHECK (evidence_class IN ('D', 'B', 'A', 'C', 'T', 'U')),
    data_version        TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by          TEXT NOT NULL,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    ai_action_id        TEXT,
    is_deleted          BOOLEAN NOT NULL DEFAULT false,
    CHECK (task_id <> depends_on_task_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_task_dependency_pair
    ON public.task_dependency (task_id, depends_on_task_id)
    WHERE is_deleted = false;

CREATE TABLE IF NOT EXISTS public.kpi_actual (
    kpi_actual_id       TEXT PRIMARY KEY,
    kpi_id              TEXT NOT NULL REFERENCES public.kpi_definition(kpi_id),
    metric_version      INTEGER NOT NULL CHECK (metric_version >= 1),
    as_of               TIMESTAMPTZ NOT NULL,
    value               NUMERIC(18, 6),
    numerator           NUMERIC(18, 6),
    denominator         NUMERIC(18, 6),
    scope               TEXT,
    computed_by         TEXT NOT NULL,
    -- Standard provenance block
    record_class        TEXT NOT NULL CHECK (record_class IN (
                            'historical_synthetic', 'live', 'simulated'
                        )),
    import_batch_id     TEXT NOT NULL REFERENCES public.import_batch(import_batch_id),
    source_ref          TEXT,
    evidence_class      TEXT CHECK (evidence_class IN ('D', 'B', 'A', 'C', 'T', 'U')),
    data_version        TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by          TEXT NOT NULL,
    ai_action_id        TEXT,
    is_deleted          BOOLEAN NOT NULL DEFAULT false
);

-- [PENDING DECISION: OD-22] Escalation owner role assignment is proposed pending confirmation.
CREATE TABLE IF NOT EXISTS public.escalation (
    escalation_id       TEXT PRIMARY KEY,
    rule_id             TEXT NOT NULL REFERENCES public.threshold_rule(rule_id),
    kpi_actual_id       TEXT REFERENCES public.kpi_actual(kpi_actual_id),
    raised_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    owner_member_id     TEXT REFERENCES public.team_member(member_id),
    status              TEXT NOT NULL DEFAULT 'open' CHECK (status IN (
                            'open', 'acknowledged', 'action_taken', 'closed'
                        )),
    action_taken        TEXT,
    closed_at           TIMESTAMPTZ,
    -- Standard provenance block
    record_class        TEXT NOT NULL CHECK (record_class IN ('live', 'simulated')),
    import_batch_id     TEXT NOT NULL REFERENCES public.import_batch(import_batch_id),
    source_ref          TEXT,
    evidence_class      TEXT CHECK (evidence_class IN ('D', 'B', 'A', 'C', 'T', 'U')),
    data_version        TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by          TEXT NOT NULL,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    ai_action_id        TEXT,
    is_deleted          BOOLEAN NOT NULL DEFAULT false,
    CHECK (status <> 'closed' OR (action_taken IS NOT NULL AND btrim(action_taken) <> '' AND closed_at IS NOT NULL))
);

-- [PENDING DECISION: AMB-TIME-LOG-NAME]
-- Canonical entity name in 01_conceptual_data_model.md is TIME_LOG (time_log);
-- 10_technical_architecture_handoff.md §2.1 refers informally to "hours_log".
CREATE TABLE IF NOT EXISTS public.time_log (
    time_log_id         TEXT PRIMARY KEY,
    member_id           TEXT NOT NULL REFERENCES public.team_member(member_id),
    task_id             TEXT REFERENCES public.task(task_id),
    bet_id              TEXT REFERENCES public.bet(bet_id),
    task_type           TEXT NOT NULL CHECK (task_type IN (
                            'follow_up', 'proposal', 'invoice', 'call', 'pitch', 'admin'
                        )),
    work_date           DATE NOT NULL,
    hours               NUMERIC(4, 2) NOT NULL CHECK (hours > 0 AND hours <= 16),
    -- Standard provenance block
    record_class        TEXT NOT NULL CHECK (record_class IN ('live', 'simulated')),
    import_batch_id     TEXT NOT NULL REFERENCES public.import_batch(import_batch_id),
    source_ref          TEXT,
    evidence_class      TEXT CHECK (evidence_class IN ('D', 'B', 'A', 'C', 'T', 'U')),
    data_version        TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by          TEXT NOT NULL,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    ai_action_id        TEXT,
    is_deleted          BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS public.staffing_allocation (
    allocation_id       TEXT PRIMARY KEY,
    member_id           TEXT NOT NULL REFERENCES public.team_member(member_id),
    bet_id              TEXT REFERENCES public.bet(bet_id),
    week_no             INTEGER NOT NULL CHECK (week_no >= -5 AND week_no <= 12),
    person_weeks        NUMERIC(5, 2) NOT NULL CHECK (person_weeks >= 0 AND person_weeks <= 2.00),
    -- Full-state versioning columns
    valid_from          TIMESTAMPTZ NOT NULL DEFAULT now(),
    valid_to            TIMESTAMPTZ,
    version_no          INTEGER NOT NULL DEFAULT 1 CHECK (version_no >= 1),
    superseded_by       TEXT REFERENCES public.staffing_allocation(allocation_id),
    -- Standard provenance block
    record_class        TEXT NOT NULL CHECK (record_class IN ('live', 'simulated')),
    import_batch_id     TEXT NOT NULL REFERENCES public.import_batch(import_batch_id),
    source_ref          TEXT,
    evidence_class      TEXT CHECK (evidence_class IN ('D', 'B', 'A', 'C', 'T', 'U')),
    data_version        TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by          TEXT NOT NULL,
    ai_action_id        TEXT,
    is_deleted          BOOLEAN NOT NULL DEFAULT false,
    CHECK (valid_to IS NULL OR valid_to >= valid_from)
);

CREATE TABLE IF NOT EXISTS public.experiment_result (
    result_id           TEXT PRIMARY KEY,
    experiment_id       TEXT NOT NULL REFERENCES public.experiment(experiment_id),
    kpi_actual_id       TEXT NOT NULL REFERENCES public.kpi_actual(kpi_actual_id),
    n                   INTEGER NOT NULL CHECK (n >= 0),
    decision            TEXT NOT NULL CHECK (decision IN (
                            'keep', 'change', 'stop', 'escalate'
                        )),
    decided_by          TEXT NOT NULL REFERENCES public.team_member(member_id),
    decided_at          TIMESTAMPTZ NOT NULL,
    note                TEXT,
    -- Standard provenance block
    record_class        TEXT NOT NULL CHECK (record_class IN ('live', 'simulated')),
    import_batch_id     TEXT NOT NULL REFERENCES public.import_batch(import_batch_id),
    source_ref          TEXT,
    evidence_class      TEXT CHECK (evidence_class IN ('D', 'B', 'A', 'C', 'T', 'U')),
    data_version        TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by          TEXT NOT NULL,
    ai_action_id        TEXT,
    is_deleted          BOOLEAN NOT NULL DEFAULT false
);

-- [PENDING DECISION: OD-12]
-- Re-forecast process and publication approval workflow are proposed pending Stage 8 sign-off.
CREATE TABLE IF NOT EXISTS public.forecast_version (
    forecast_id         TEXT PRIMARY KEY,
    edition_id          TEXT NOT NULL REFERENCES public.festival_edition(edition_id),
    baseline_scenario_id TEXT NOT NULL REFERENCES public.scenario_reference(scenario_id),
    model_version       TEXT NOT NULL,
    input_data_version  TEXT NOT NULL,
    run_at              TIMESTAMPTZ NOT NULL,
    expected_cash       NUMERIC(12, 2),
    p10                 NUMERIC(12, 2),
    p90                 NUMERIC(12, 2),
    status              TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
                            'draft', 'reviewed', 'published'
                        )),
    reviewed_by         TEXT REFERENCES public.team_member(member_id),
    -- Standard provenance block
    record_class        TEXT NOT NULL CHECK (record_class IN ('model_output', 'simulated')),
    import_batch_id     TEXT NOT NULL REFERENCES public.import_batch(import_batch_id),
    source_ref          TEXT,
    evidence_class      TEXT CHECK (evidence_class IN ('D', 'B', 'A', 'C', 'T', 'U')),
    data_version        TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by          TEXT NOT NULL,
    ai_action_id        TEXT,
    is_deleted          BOOLEAN NOT NULL DEFAULT false,
    CHECK (p10 IS NULL OR p90 IS NULL OR p90 >= p10),
    CHECK (status <> 'published' OR reviewed_by IS NOT NULL)
);

-- ============================================================================
-- 9. GOVERNANCE, ROLE DIRECTORY, AI CONVERSATION & AUDIT TABLES (DOMAIN G)
-- ============================================================================

-- [PENDING DECISION: OD-24] Standalone admin role holder & provisioning boundary unresolved.
CREATE TABLE IF NOT EXISTS public.role_assignment (
    role_assignment_id  TEXT PRIMARY KEY,
    member_id           TEXT NOT NULL REFERENCES public.team_member(member_id),
    edition_id          TEXT NOT NULL REFERENCES public.festival_edition(edition_id),
    role                TEXT NOT NULL CHECK (role IN (
                            'coordination_lead', 'pipeline_ops', 'finance_collections',
                            'partnerships', 'community', 'network', 'premium_sales',
                            'viewer', 'admin'
                        )),
    is_current          BOOLEAN NOT NULL DEFAULT true,
    -- Full-state versioning columns
    valid_from          TIMESTAMPTZ NOT NULL DEFAULT now(),
    valid_to            TIMESTAMPTZ,
    version_no          INTEGER NOT NULL DEFAULT 1 CHECK (version_no >= 1),
    superseded_by       TEXT REFERENCES public.role_assignment(role_assignment_id),
    -- Standard provenance block
    record_class        TEXT NOT NULL CHECK (record_class IN ('live', 'simulated')),
    import_batch_id     TEXT NOT NULL REFERENCES public.import_batch(import_batch_id),
    source_ref          TEXT,
    evidence_class      TEXT CHECK (evidence_class IN ('D', 'B', 'A', 'C', 'T', 'U')),
    data_version        TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by          TEXT NOT NULL,
    ai_action_id        TEXT,
    is_deleted          BOOLEAN NOT NULL DEFAULT false,
    CHECK (valid_to IS NULL OR valid_to >= valid_from),
    CHECK ((is_current = true AND valid_to IS NULL) OR (is_current = false))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_role_assignment_active_member_edition_role
    ON public.role_assignment (member_id, edition_id, role)
    WHERE is_current = true AND valid_to IS NULL AND is_deleted = false;

-- [PENDING DECISION: AMB-AI-TABLES]
-- Required by 10_technical_architecture_handoff.md §2.1 & §2.5 (GET /api/ai/conversations/:id,
-- loading last 10 turns from ai_message) although omitted from 01_conceptual_data_model.md §4G.
CREATE TABLE IF NOT EXISTS public.ai_conversation (
    conversation_id     TEXT PRIMARY KEY,
    member_id           TEXT NOT NULL REFERENCES public.team_member(member_id),
    edition_id          TEXT NOT NULL REFERENCES public.festival_edition(edition_id),
    title               TEXT,
    last_data_version   BIGINT,
    last_filters        JSONB,
    -- Standard provenance block
    record_class        TEXT NOT NULL CHECK (record_class IN ('live', 'simulated')),
    import_batch_id     TEXT NOT NULL REFERENCES public.import_batch(import_batch_id),
    source_ref          TEXT,
    evidence_class      TEXT CHECK (evidence_class IN ('D', 'B', 'A', 'C', 'T', 'U')),
    data_version        TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by          TEXT NOT NULL,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    ai_action_id        TEXT,
    is_deleted          BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS public.ai_message (
    message_id          TEXT PRIMARY KEY,
    conversation_id     TEXT NOT NULL REFERENCES public.ai_conversation(conversation_id),
    turn_index          INTEGER NOT NULL CHECK (turn_index >= 1),
    role                TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content             TEXT NOT NULL,
    tools_used          JSONB,
    filters_used        JSONB,
    citations           JSONB,
    data_labels         JSONB,
    data_version_at_turn BIGINT,
    -- Standard provenance block
    record_class        TEXT NOT NULL CHECK (record_class IN ('live', 'simulated')),
    import_batch_id     TEXT NOT NULL REFERENCES public.import_batch(import_batch_id),
    source_ref          TEXT,
    evidence_class      TEXT CHECK (evidence_class IN ('D', 'B', 'A', 'C', 'T', 'U')),
    data_version        TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by          TEXT NOT NULL,
    ai_action_id        TEXT,
    is_deleted          BOOLEAN NOT NULL DEFAULT false
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_message_turn
    ON public.ai_message (conversation_id, turn_index)
    WHERE is_deleted = false;

CREATE TABLE IF NOT EXISTS public.ai_query_log (
    query_id            TEXT PRIMARY KEY,
    conversation_id     TEXT REFERENCES public.ai_conversation(conversation_id),
    member_id           TEXT NOT NULL REFERENCES public.team_member(member_id),
    asked_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    question            TEXT NOT NULL,
    route               TEXT CHECK (route IS NULL OR route IN (
                            'sql', 'rag', 'hybrid', 'lookup', 'action', 'refuse'
                        )),
    tool_calls          JSONB,
    citations           JSONB,
    data_version        TEXT,
    answer              TEXT,
    answer_check_passed BOOLEAN,
    model_id            TEXT,
    latency_ms          INTEGER CHECK (latency_ms IS NULL OR latency_ms >= 0),
    feedback            TEXT CHECK (feedback IS NULL OR feedback IN ('up', 'down', 'flagged')),
    -- Standard provenance block
    record_class        TEXT NOT NULL CHECK (record_class IN ('live', 'simulated')),
    import_batch_id     TEXT NOT NULL REFERENCES public.import_batch(import_batch_id),
    source_ref          TEXT,
    evidence_class      TEXT CHECK (evidence_class IN ('D', 'B', 'A', 'C', 'T', 'U')),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by          TEXT NOT NULL,
    ai_action_id        TEXT,
    is_deleted          BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS public.ai_action (
    ai_action_id        TEXT PRIMARY KEY,
    query_id            TEXT REFERENCES public.ai_query_log(query_id),
    action_type         TEXT NOT NULL CHECK (action_type IN (
                            'create_task', 'log_interaction', 'log_meeting',
                            'upsert_sponsor_contact'
                        )),
    permission_level    TEXT NOT NULL CHECK (permission_level IN ('L4', 'L5')),
    payload             JSONB NOT NULL,
    payload_sha256      TEXT NOT NULL,
    status              TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN (
                            'proposed', 'confirmed', 'executed', 'rejected', 'expired'
                        )),
    confirmed_by        TEXT REFERENCES public.team_member(member_id),
    confirmed_at        TIMESTAMPTZ,
    executed_at         TIMESTAMPTZ,
    -- Standard provenance block
    record_class        TEXT NOT NULL CHECK (record_class IN ('live', 'simulated')),
    import_batch_id     TEXT NOT NULL REFERENCES public.import_batch(import_batch_id),
    source_ref          TEXT,
    evidence_class      TEXT CHECK (evidence_class IN ('D', 'B', 'A', 'C', 'T', 'U')),
    data_version        TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by          TEXT NOT NULL,
    is_deleted          BOOLEAN NOT NULL DEFAULT false,
    CHECK (status <> 'executed' OR (confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL AND executed_at IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS public.audit_event (
    audit_id            TEXT PRIMARY KEY,
    actor_id            TEXT NOT NULL REFERENCES public.team_member(member_id),
    ai_action_id        TEXT REFERENCES public.ai_action(ai_action_id),
    channel             TEXT NOT NULL DEFAULT 'ui' CHECK (channel IN (
                            'ui', 'ai_action', 'import', 'system'
                        )),
    entity              TEXT NOT NULL,
    entity_id           TEXT NOT NULL,
    operation           TEXT NOT NULL CHECK (operation IN (
                            'insert', 'update', 'soft_delete'
                        )),
    before_hash         TEXT,
    after               JSONB,
    data_version        BIGINT,
    at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Standard provenance block
    record_class        TEXT NOT NULL CHECK (record_class IN ('live', 'simulated')),
    import_batch_id     TEXT NOT NULL REFERENCES public.import_batch(import_batch_id),
    source_ref          TEXT,
    evidence_class      TEXT CHECK (evidence_class IN ('D', 'B', 'A', 'C', 'T', 'U')),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by          TEXT NOT NULL,
    is_deleted          BOOLEAN NOT NULL DEFAULT false,
    CHECK (channel <> 'ai_action' OR ai_action_id IS NOT NULL)
);

-- Complete deferred foreign keys from provenance ai_action_id -> public.ai_action(ai_action_id).
DO $$
DECLARE
    v_tbl TEXT;
    v_tables TEXT[] := ARRAY[
        'import_batch', 'decision_record', 'source_register', 'benchmark',
        'festival_edition', 'category', 'channel', 'team_member', 'bet',
        'metric_definition', 'kpi_definition', 'scenario_reference', 'threshold_rule',
        'experiment', 'model_assumption', 'target_version', 'knowledge_chunk',
        'sponsor', 'contact', 'network_partner', 'campaign', 'referral',
        'prospect_research', 'ownership_assignment', 'outreach_attempt',
        'interaction', 'opportunity', 'meeting', 'qualification_version',
        'opportunity_stage_version', 'inventory_asset', 'price_list_entry',
        'package', 'package_item', 'proposal', 'contract', 'contract_line',
        'asset_slot', 'exclusivity_grant', 'contract_deliverable',
        'payment_schedule_item', 'invoice', 'receipt', 'receipt_allocation',
        'in_kind_contribution', 'expense', 'task', 'task_dependency',
        'kpi_actual', 'escalation', 'time_log', 'staffing_allocation',
        'experiment_result', 'forecast_version', 'role_assignment',
        'ai_conversation', 'ai_message', 'ai_query_log'
    ];
BEGIN
    FOREACH v_tbl IN ARRAY v_tables
    LOOP
        IF NOT EXISTS (
            SELECT 1
              FROM pg_constraint c
              JOIN pg_class t ON t.oid = c.conrelid
              JOIN pg_namespace n ON n.oid = t.relnamespace
             WHERE n.nspname = 'public'
               AND t.relname = v_tbl
               AND c.conname = format('fk_%s_ai_action', v_tbl)
        ) THEN
            EXECUTE format(
                'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (ai_action_id) REFERENCES public.ai_action(ai_action_id)',
                v_tbl,
                format('fk_%s_ai_action', v_tbl)
            );
        END IF;
    END LOOP;
END
$$;

-- ============================================================================
-- 10. DERIVED FINANCIAL VIEWS (NEVER BASE TABLES)
-- ============================================================================

-- Derived balance_view (01_conceptual_data_model.md §4D BALANCE_VIEW).
-- Computed strictly from cash contract_lines, reconciled receipt allocations, and payment schedule items.
CREATE OR REPLACE VIEW public.balance_view
WITH (security_invoker = true) AS
SELECT
    c.contract_id,
    c.opportunity_id,
    c.record_class,
    COALESCE(cl_cash.cash_signed, 0::NUMERIC(14, 2)) AS cash_signed,
    COALESCE(rec_alloc.cash_received, 0::NUMERIC(14, 2)) AS cash_received,
    (COALESCE(cl_cash.cash_signed, 0::NUMERIC(14, 2)) - COALESCE(rec_alloc.cash_received, 0::NUMERIC(14, 2)))::NUMERIC(14, 2) AS outstanding,
    COALESCE(sched_overdue.overdue_amount, 0::NUMERIC(14, 2)) AS overdue_amount
FROM public.contract c
LEFT JOIN (
    SELECT
        cl.contract_id,
        SUM(cl.value)::NUMERIC(14, 2) AS cash_signed
    FROM public.contract_line cl
    WHERE cl.is_deleted = false
      AND cl.consideration_type = 'cash'
    GROUP BY cl.contract_id
) cl_cash ON cl_cash.contract_id = c.contract_id
LEFT JOIN (
    SELECT
        COALESCE(psi.contract_id, inv.contract_id) AS contract_id,
        SUM(ra.amount)::NUMERIC(14, 2) AS cash_received
    FROM public.receipt_allocation ra
    JOIN public.receipt r
      ON r.receipt_id = ra.receipt_id
     AND r.is_deleted = false
     AND r.reconciled = true
    LEFT JOIN public.payment_schedule_item psi
      ON psi.schedule_item_id = ra.schedule_item_id
     AND psi.is_deleted = false
    LEFT JOIN public.invoice inv
      ON inv.invoice_id = ra.invoice_id
     AND inv.is_deleted = false
    WHERE ra.is_deleted = false
    GROUP BY COALESCE(psi.contract_id, inv.contract_id)
) rec_alloc ON rec_alloc.contract_id = c.contract_id
LEFT JOIN (
    SELECT
        psi.contract_id,
        SUM(
            GREATEST(
                psi.amount_due - COALESCE(item_paid.allocated_amount, 0::NUMERIC(14, 2)),
                0::NUMERIC(14, 2)
            )
        )::NUMERIC(14, 2) AS overdue_amount
    FROM public.payment_schedule_item psi
    LEFT JOIN (
        SELECT
            ra.schedule_item_id,
            SUM(ra.amount)::NUMERIC(14, 2) AS allocated_amount
        FROM public.receipt_allocation ra
        JOIN public.receipt r
          ON r.receipt_id = ra.receipt_id
         AND r.is_deleted = false
         AND r.reconciled = true
        WHERE ra.is_deleted = false
          AND ra.schedule_item_id IS NOT NULL
        GROUP BY ra.schedule_item_id
    ) item_paid ON item_paid.schedule_item_id = psi.schedule_item_id
    WHERE psi.is_deleted = false
      AND psi.due_date < CURRENT_DATE
    GROUP BY psi.contract_id
) sched_overdue ON sched_overdue.contract_id = c.contract_id
WHERE c.is_deleted = false
  AND c.valid_to IS NULL
  AND c.status = 'active';

-- Derived payment_schedule_item status view (per 01_cdm §4D: "status derived from allocations, not typed").
CREATE OR REPLACE VIEW public.payment_schedule_item_status_view
WITH (security_invoker = true) AS
SELECT
    psi.schedule_item_id,
    psi.contract_id,
    psi.kind,
    psi.amount_due,
    psi.due_date,
    psi.record_class,
    COALESCE(alloc.allocated_amount, 0::NUMERIC(14, 2)) AS allocated_amount,
    GREATEST(psi.amount_due - COALESCE(alloc.allocated_amount, 0::NUMERIC(14, 2)), 0::NUMERIC(14, 2)) AS remaining_amount,
    CASE
        WHEN COALESCE(alloc.allocated_amount, 0) >= psi.amount_due THEN 'paid'
        WHEN psi.due_date < CURRENT_DATE THEN 'overdue'
        WHEN COALESCE(alloc.allocated_amount, 0) > 0 THEN 'partly_paid'
        ELSE 'due'
    END AS derived_status
FROM public.payment_schedule_item psi
LEFT JOIN (
    SELECT
        ra.schedule_item_id,
        SUM(ra.amount)::NUMERIC(14, 2) AS allocated_amount
    FROM public.receipt_allocation ra
    JOIN public.receipt r
      ON r.receipt_id = ra.receipt_id
     AND r.is_deleted = false
     AND r.reconciled = true
    WHERE ra.is_deleted = false
      AND ra.schedule_item_id IS NOT NULL
    GROUP BY ra.schedule_item_id
) alloc ON alloc.schedule_item_id = psi.schedule_item_id
WHERE psi.is_deleted = false;

-- ============================================================================
-- 11. INDEXES ON FOREIGN KEYS, RECORD CLASSES & AUDIT PATHS
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_sponsor_class_status ON public.sponsor (record_class, lifecycle_status) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_sponsor_category ON public.sponsor (category_id) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_contact_sponsor ON public.contact (sponsor_id, record_class) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_prospect_research_sponsor ON public.prospect_research (sponsor_id, edition_id) WHERE is_deleted = false AND valid_to IS NULL;
CREATE INDEX IF NOT EXISTS idx_network_partner_owner ON public.network_partner (owner_member_id, record_class) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_referral_partner_sponsor ON public.referral (partner_id, sponsor_id, commitment_status) WHERE is_deleted = false AND valid_to IS NULL;
CREATE INDEX IF NOT EXISTS idx_ownership_subject ON public.ownership_assignment (subject_type, subject_id, member_id) WHERE is_deleted = false AND valid_to IS NULL;

CREATE INDEX IF NOT EXISTS idx_campaign_edition_class ON public.campaign (edition_id, record_class, channel_id, bet_id) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_outreach_campaign_sponsor ON public.outreach_attempt (campaign_id, sponsor_id, started_at) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_interaction_attempt_time ON public.interaction (attempt_id, occurred_at, event_type) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_meeting_sponsor_opp ON public.meeting (sponsor_id, opportunity_id, scheduled_at) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_qual_version_sponsor_edition ON public.qualification_version (sponsor_id, edition_id, record_class, valid_from DESC) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_opportunity_edition_class ON public.opportunity (edition_id, record_class, sponsor_id, bet_id) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_opp_stage_version_lookup ON public.opportunity_stage_version (opportunity_id, record_class, valid_from DESC, valid_to) WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS idx_proposal_opp ON public.proposal (opportunity_id, status, sent_at) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_contract_opp ON public.contract (opportunity_id, status, signed_at) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_contract_line_contract ON public.contract_line (contract_id, consideration_type) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_asset_slot_asset_status ON public.asset_slot (asset_id, status) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_exclusivity_contract_cat ON public.exclusivity_grant (contract_id, category_id, valid_from, valid_to) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_deliverable_opp_line ON public.contract_deliverable (opportunity_id, contract_line_id) WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS idx_psi_contract_due ON public.payment_schedule_item (contract_id, due_date) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_invoice_contract ON public.invoice (contract_id, schedule_item_id, issued_at) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_receipt_sponsor_date ON public.receipt (sponsor_id, received_at, reconciled) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_receipt_alloc_links ON public.receipt_allocation (receipt_id, invoice_id, schedule_item_id) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_in_kind_line ON public.in_kind_contribution (contract_line_id) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_expense_edition_bet ON public.expense (edition_id, bet_id, incurred_at) WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS idx_task_owner_status_due ON public.task (owner_member_id, status, due_at) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_task_linked ON public.task (linked_type, linked_id) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_escalation_rule_status ON public.escalation (rule_id, status, raised_at DESC) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_time_log_member_date ON public.time_log (member_id, work_date, bet_id) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_staffing_member_week ON public.staffing_allocation (member_id, week_no) WHERE is_deleted = false AND valid_to IS NULL;
CREATE INDEX IF NOT EXISTS idx_kpi_actual_lookup ON public.kpi_actual (kpi_id, record_class, as_of DESC) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_forecast_edition ON public.forecast_version (edition_id, status, run_at DESC) WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS idx_role_assignment_member_edition ON public.role_assignment (member_id, edition_id, is_current) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_ai_message_conv_turn ON public.ai_message (conversation_id, turn_index DESC) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_ai_query_log_member_time ON public.ai_query_log (member_id, asked_at DESC) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_ai_action_status ON public.ai_action (status, created_at DESC) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_audit_event_entity_time ON public.audit_event (entity, entity_id, at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_event_actor_time ON public.audit_event (actor_id, at DESC);

-- ============================================================================
-- 12. TRIGGER FUNCTIONS & DATABASE INVARIANT ENFORCEMENT
-- ============================================================================

-- 12.1 Automatic updated_at + monotonic app_state.data_version bump (Rule 5).
CREATE OR REPLACE FUNCTION public.tg_bump_data_version()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
    UPDATE public.app_state
       SET data_version = data_version + 1,
           updated_at = now(),
           updated_by = current_user
     WHERE id = 1;
    RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.tg_touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

-- 12.2 Block ALL hard DELETE operations (Rule 4 / INV-12).
CREATE OR REPLACE FUNCTION public.tg_block_hard_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
    RAISE EXCEPTION 'Hard deletes are prohibited on public.% (use is_deleted or versioning).', TG_TABLE_NAME
        USING ERRCODE = '42501';
END;
$$;

-- 12.3 Block UPDATE/DELETE on strictly append-only or immutable tables.
CREATE OR REPLACE FUNCTION public.tg_enforce_append_only()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
    RAISE EXCEPTION 'Table public.% is append-only/immutable; % is not permitted.', TG_TABLE_NAME, TG_OP
        USING ERRCODE = '42501';
END;
$$;

-- 12.4 Protect historical_synthetic records from mutation & app inserts (Rule 1 / A5).
CREATE OR REPLACE FUNCTION public.tg_protect_historical_synthetic()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.record_class = 'historical_synthetic' THEN
            IF current_user = 'app_service'
               OR COALESCE(current_setting('app.allow_historical_seed', true), 'off') <> 'true' THEN
                RAISE EXCEPTION 'Cannot insert historical_synthetic rows into public.% via application role or unguarded session.', TG_TABLE_NAME
                    USING ERRCODE = '42501';
            END IF;
        END IF;
        RETURN NEW;
    ELSIF TG_OP = 'UPDATE' THEN
        IF OLD.record_class = 'historical_synthetic' OR NEW.record_class = 'historical_synthetic' THEN
            RAISE EXCEPTION 'historical_synthetic rows in public.% are strictly read-only.', TG_TABLE_NAME
                USING ERRCODE = '42501';
        END IF;
        RETURN NEW;
    ELSIF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Deletes are prohibited on public.% (historical_synthetic protection).', TG_TABLE_NAME
            USING ERRCODE = '42501';
    END IF;
    RETURN NULL;
END;
$$;

-- 12.5 Enforce one record_class per edition on edition-scoped operational tables (Rule 1).
CREATE OR REPLACE FUNCTION public.tg_check_edition_record_class()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_edition_class TEXT;
BEGIN
    SELECT fe.record_class
      INTO v_edition_class
      FROM public.festival_edition fe
     WHERE fe.edition_id = NEW.edition_id
       AND fe.is_deleted = false;

    IF v_edition_class IS NULL THEN
        RAISE EXCEPTION 'Referenced edition_id % does not exist or is soft-deleted.', NEW.edition_id
            USING ERRCODE = '23503';
    END IF;

    IF TG_TABLE_NAME IN ('campaign', 'qualification_version', 'opportunity', 'role_assignment', 'expense') THEN
        IF NEW.record_class <> v_edition_class THEN
            RAISE EXCEPTION 'Record class mismatch on public.%: row record_class (%) must equal festival_edition.record_class (%).',
                TG_TABLE_NAME, NEW.record_class, v_edition_class
                USING ERRCODE = '23514';
        END IF;
    ELSIF TG_TABLE_NAME = 'forecast_version' THEN
        IF v_edition_class = 'historical_synthetic' THEN
            RAISE EXCEPTION 'Cannot attach forecast_version to historical_synthetic edition %.', NEW.edition_id
                USING ERRCODE = '23514';
        END IF;
    ELSIF TG_TABLE_NAME = 'target_version' THEN
        IF v_edition_class = 'historical_synthetic' AND NEW.record_class <> 'historical_synthetic' THEN
            RAISE EXCEPTION 'Targets on historical_synthetic edition % must carry record_class historical_synthetic.', NEW.edition_id
                USING ERRCODE = '23514';
        ELSIF v_edition_class IN ('live', 'simulated') AND NEW.record_class <> 'operating_plan' THEN
            RAISE EXCEPTION 'Targets on active/simulated edition % must carry record_class operating_plan.', NEW.edition_id
                USING ERRCODE = '23514';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

-- 12.6 Propagate & validate parent-child record_class consistency across pipeline/money tables.
CREATE OR REPLACE FUNCTION public.tg_check_parent_record_class()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_parent_class TEXT;
BEGIN
    IF TG_TABLE_NAME = 'outreach_attempt' THEN
        SELECT record_class INTO v_parent_class FROM public.campaign WHERE campaign_id = NEW.campaign_id;
    ELSIF TG_TABLE_NAME = 'interaction' THEN
        SELECT record_class INTO v_parent_class FROM public.outreach_attempt WHERE attempt_id = NEW.attempt_id;
    ELSIF TG_TABLE_NAME = 'opportunity_stage_version' THEN
        SELECT record_class INTO v_parent_class FROM public.opportunity WHERE opportunity_id = NEW.opportunity_id;
    ELSIF TG_TABLE_NAME = 'proposal' THEN
        SELECT record_class INTO v_parent_class FROM public.opportunity WHERE opportunity_id = NEW.opportunity_id;
    ELSIF TG_TABLE_NAME = 'contract' THEN
        SELECT record_class INTO v_parent_class FROM public.opportunity WHERE opportunity_id = NEW.opportunity_id;
    ELSIF TG_TABLE_NAME = 'contract_line' THEN
        SELECT record_class INTO v_parent_class FROM public.contract WHERE contract_id = NEW.contract_id;
    ELSIF TG_TABLE_NAME = 'payment_schedule_item' THEN
        SELECT record_class INTO v_parent_class FROM public.contract WHERE contract_id = NEW.contract_id;
    ELSIF TG_TABLE_NAME = 'invoice' THEN
        SELECT record_class INTO v_parent_class FROM public.contract WHERE contract_id = NEW.contract_id;
    ELSIF TG_TABLE_NAME = 'receipt_allocation' THEN
        SELECT record_class INTO v_parent_class FROM public.receipt WHERE receipt_id = NEW.receipt_id;
    ELSIF TG_TABLE_NAME = 'in_kind_contribution' THEN
        SELECT record_class INTO v_parent_class FROM public.contract_line WHERE contract_line_id = NEW.contract_line_id;
    ELSIF TG_TABLE_NAME = 'exclusivity_grant' THEN
        SELECT record_class INTO v_parent_class FROM public.contract WHERE contract_id = NEW.contract_id;
    END IF;

    IF v_parent_class IS NOT NULL AND NEW.record_class <> v_parent_class THEN
        RAISE EXCEPTION 'Record class mismatch on public.%: child class (%) does not match parent class (%).',
            TG_TABLE_NAME, NEW.record_class, v_parent_class
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

-- 12.7 Opt-out guard on OUTREACH_ATTEMPT.
CREATE OR REPLACE FUNCTION public.tg_check_outreach_opt_out()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_opted_out TIMESTAMPTZ;
    v_sponsor_status TEXT;
BEGIN
    SELECT lifecycle_status INTO v_sponsor_status
      FROM public.sponsor
     WHERE sponsor_id = NEW.sponsor_id;

    IF v_sponsor_status = 'do_not_contact' AND NEW.record_class <> 'historical_synthetic' THEN
        RAISE EXCEPTION 'Outreach blocked: sponsor % is marked do_not_contact.', NEW.sponsor_id
            USING ERRCODE = '23514';
    END IF;

    IF NEW.contact_id IS NOT NULL THEN
        SELECT opted_out_at INTO v_opted_out
          FROM public.contact
         WHERE contact_id = NEW.contact_id;

        IF v_opted_out IS NOT NULL AND NEW.record_class <> 'historical_synthetic' THEN
            RAISE EXCEPTION 'Outreach blocked: contact % opted out at %.', NEW.contact_id, v_opted_out
                USING ERRCODE = '23514';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

-- 12.8 INV-03: OPPORTUNITY requires sponsor not to be research_target;
-- originating_campaign_id immutable on update.
CREATE OR REPLACE FUNCTION public.tg_check_opportunity_invariants()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_lifecycle TEXT;
BEGIN
    IF TG_OP = 'INSERT' THEN
        SELECT lifecycle_status INTO v_lifecycle
          FROM public.sponsor
         WHERE sponsor_id = NEW.sponsor_id;

        IF v_lifecycle = 'research_target' AND NEW.record_class <> 'historical_synthetic' THEN
            RAISE EXCEPTION 'INV-03 violation: sponsor % is research_target and cannot open an opportunity before an interaction with a named contact.', NEW.sponsor_id
                USING ERRCODE = '23514';
        END IF;
    ELSIF TG_OP = 'UPDATE' THEN
        IF OLD.originating_campaign_id IS DISTINCT FROM NEW.originating_campaign_id THEN
            RAISE EXCEPTION 'opportunity.originating_campaign_id is immutable after creation.'
                USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

-- 12.9 Rule 3: OPPORTUNITY_STAGE_VERSION confirmed_value > 0 in live/simulated requires active CONTRACT.
CREATE OR REPLACE FUNCTION public.tg_check_stage_version_contract()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_has_contract BOOLEAN;
BEGIN
    IF NEW.record_class IN ('live', 'simulated')
       AND NEW.stage = 'partner_confirmed'
       AND COALESCE(NEW.confirmed_value, 0) > 0 THEN
        SELECT EXISTS (
            SELECT 1
              FROM public.contract c
             WHERE c.opportunity_id = NEW.opportunity_id
               AND c.status = 'active'
               AND c.valid_to IS NULL
               AND c.is_deleted = false
        ) INTO v_has_contract;

        IF NOT v_has_contract THEN
            RAISE EXCEPTION 'Confirmed value > 0 on % opportunity % requires an active CONTRACT record.',
                NEW.record_class, NEW.opportunity_id
                USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

-- 12.10 INV-02 & Domain D guards: IN_KIND_CONTRIBUTION requires cash-excluded in_kind line;
-- RECEIPT immutability except finance reconciliation; RECEIPT_ALLOCATION caps.
CREATE OR REPLACE FUNCTION public.tg_check_in_kind_line_type()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_type TEXT;
BEGIN
    SELECT consideration_type INTO v_type
      FROM public.contract_line
     WHERE contract_line_id = NEW.contract_line_id
       AND is_deleted = false;

    IF v_type IS DISTINCT FROM 'in_kind' THEN
        RAISE EXCEPTION 'in_kind_contribution requires contract_line % to have consideration_type = in_kind (found %).',
            NEW.contract_line_id, COALESCE(v_type, 'NULL')
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.tg_protect_receipt_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Hard deletes on receipt are prohibited.' USING ERRCODE = '42501';
    END IF;

    IF OLD.sponsor_id IS DISTINCT FROM NEW.sponsor_id
       OR OLD.received_at IS DISTINCT FROM NEW.received_at
       OR OLD.amount IS DISTINCT FROM NEW.amount
       OR OLD.method IS DISTINCT FROM NEW.method
       OR OLD.bank_reference IS DISTINCT FROM NEW.bank_reference
       OR OLD.recorded_by IS DISTINCT FROM NEW.recorded_by
       OR OLD.record_class IS DISTINCT FROM NEW.record_class THEN
        RAISE EXCEPTION 'Receipt financial attributes are immutable once recorded.'
            USING ERRCODE = '42501';
    END IF;

    IF OLD.reconciled = true AND NEW.reconciled = false THEN
        RAISE EXCEPTION 'Reconciled receipt % cannot be unreconciled in place.', OLD.receipt_id
            USING ERRCODE = '23514';
    END IF;

    IF OLD.reconciled IS DISTINCT FROM NEW.reconciled
       AND COALESCE(current_setting('app.finance_fn_active', true), 'off') <> 'true' THEN
        RAISE EXCEPTION 'Receipt reconciliation must be executed via reconcile_receipt() by finance_collections.'
            USING ERRCODE = '42501';
    END IF;

    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.tg_protect_invoice_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Hard deletes on invoice are prohibited.' USING ERRCODE = '42501';
    END IF;

    IF OLD.invoice_no IS DISTINCT FROM NEW.invoice_no
       OR OLD.contract_id IS DISTINCT FROM NEW.contract_id
       OR OLD.schedule_item_id IS DISTINCT FROM NEW.schedule_item_id
       OR OLD.issued_at IS DISTINCT FROM NEW.issued_at
       OR OLD.amount IS DISTINCT FROM NEW.amount
       OR OLD.tax_amount IS DISTINCT FROM NEW.tax_amount
       OR OLD.record_class IS DISTINCT FROM NEW.record_class THEN
        RAISE EXCEPTION 'Issued invoice core attributes are immutable; cancel via credit note / status transition function.'
            USING ERRCODE = '42501';
    END IF;

    IF OLD.status IS DISTINCT FROM NEW.status
       AND COALESCE(current_setting('app.finance_fn_active', true), 'off') <> 'true' THEN
        RAISE EXCEPTION 'Invoice status updates must be executed via finance SECURITY DEFINER functions.'
            USING ERRCODE = '42501';
    END IF;

    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.tg_check_receipt_allocation_caps()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_receipt_amount NUMERIC(14, 2);
    v_receipt_allocated NUMERIC(14, 2);
    v_item_due NUMERIC(14, 2);
    v_item_allocated NUMERIC(14, 2);
    v_invoice_amount NUMERIC(14, 2);
    v_invoice_allocated NUMERIC(14, 2);
BEGIN
    SELECT amount INTO v_receipt_amount
      FROM public.receipt
     WHERE receipt_id = NEW.receipt_id AND is_deleted = false;

    SELECT COALESCE(SUM(amount), 0) INTO v_receipt_allocated
      FROM public.receipt_allocation
     WHERE receipt_id = NEW.receipt_id AND is_deleted = false;

    IF (v_receipt_allocated + NEW.amount) > v_receipt_amount THEN
        RAISE EXCEPTION 'Receipt allocation total (%) exceeds receipt % amount (%).',
            (v_receipt_allocated + NEW.amount), NEW.receipt_id, v_receipt_amount
            USING ERRCODE = '23514';
    END IF;

    IF NEW.schedule_item_id IS NOT NULL THEN
        SELECT amount_due INTO v_item_due
          FROM public.payment_schedule_item
         WHERE schedule_item_id = NEW.schedule_item_id AND is_deleted = false;

        SELECT COALESCE(SUM(amount), 0) INTO v_item_allocated
          FROM public.receipt_allocation
         WHERE schedule_item_id = NEW.schedule_item_id AND is_deleted = false;

        IF (v_item_allocated + NEW.amount) > v_item_due THEN
            RAISE EXCEPTION 'Schedule item allocation total (%) exceeds item % amount_due (%).',
                (v_item_allocated + NEW.amount), NEW.schedule_item_id, v_item_due
                USING ERRCODE = '23514';
        END IF;
    END IF;

    IF NEW.invoice_id IS NOT NULL THEN
        SELECT amount INTO v_invoice_amount
          FROM public.invoice
         WHERE invoice_id = NEW.invoice_id AND is_deleted = false AND status <> 'cancelled';

        IF v_invoice_amount IS NULL THEN
            RAISE EXCEPTION 'Cannot allocate receipt to missing or cancelled invoice %.', NEW.invoice_id
                USING ERRCODE = '23514';
        END IF;

        SELECT COALESCE(SUM(amount), 0) INTO v_invoice_allocated
          FROM public.receipt_allocation
         WHERE invoice_id = NEW.invoice_id AND is_deleted = false;

        IF (v_invoice_allocated + NEW.amount) > v_invoice_amount THEN
            RAISE EXCEPTION 'Invoice allocation total (%) exceeds invoice % amount (%).',
                (v_invoice_allocated + NEW.amount), NEW.invoice_id, v_invoice_amount
                USING ERRCODE = '23514';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

-- 12.11 INV-07: Exclusivity grant must attach to a title/presenting contract and not overlap
-- another active grant in the same category or ancestor/descendant lineage.
CREATE OR REPLACE FUNCTION public.tg_check_exclusivity_grant()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_has_premium_line BOOLEAN;
    v_conflict_id TEXT;
BEGIN
    SELECT EXISTS (
        SELECT 1
          FROM public.contract_line cl
          JOIN public.inventory_asset ia ON ia.asset_id = cl.asset_id
         WHERE cl.contract_id = NEW.contract_id
           AND cl.is_deleted = false
           AND ia.asset_type IN ('title', 'presenting')
    ) INTO v_has_premium_line;

    IF NOT v_has_premium_line THEN
        RAISE EXCEPTION 'INV-07 violation: exclusivity_grant requires contract % to include a title or presenting inventory line (no standalone exclusives).',
            NEW.contract_id
            USING ERRCODE = '23514';
    END IF;

    WITH RECURSIVE
    ancestors AS (
        SELECT category_id, parent_category_id FROM public.category WHERE category_id = NEW.category_id
        UNION ALL
        SELECT c.category_id, c.parent_category_id
          FROM public.category c
          JOIN ancestors a ON a.parent_category_id = c.category_id
    ),
    descendants AS (
        SELECT category_id FROM public.category WHERE category_id = NEW.category_id
        UNION ALL
        SELECT c.category_id
          FROM public.category c
          JOIN descendants d ON c.parent_category_id = d.category_id
    ),
    related_cats AS (
        SELECT category_id FROM ancestors
        UNION
        SELECT category_id FROM descendants
    )
    SELECT eg.grant_id INTO v_conflict_id
      FROM public.exclusivity_grant eg
      JOIN related_cats rc ON rc.category_id = eg.category_id
     WHERE eg.grant_id <> NEW.grant_id
       AND eg.is_deleted = false
       AND eg.record_class = NEW.record_class
       AND daterange(eg.valid_from, eg.valid_to, '[]') && daterange(NEW.valid_from, NEW.valid_to, '[]')
     LIMIT 1;

    IF v_conflict_id IS NOT NULL THEN
        RAISE EXCEPTION 'INV-07 violation: exclusivity_grant overlaps existing grant % on category lineage %.',
            v_conflict_id, NEW.category_id
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

-- 12.12 Polymorphic referential checks (01_cdm §8: TASK.linked_id & OWNERSHIP_ASSIGNMENT.subject_id).
CREATE OR REPLACE FUNCTION public.tg_validate_polymorphic_links()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_exists BOOLEAN := false;
BEGIN
    IF TG_TABLE_NAME = 'ownership_assignment' THEN
        IF NEW.subject_type = 'sponsor' THEN
            SELECT EXISTS (SELECT 1 FROM public.sponsor WHERE sponsor_id = NEW.subject_id AND is_deleted = false) INTO v_exists;
        ELSIF NEW.subject_type = 'opportunity' THEN
            SELECT EXISTS (SELECT 1 FROM public.opportunity WHERE opportunity_id = NEW.subject_id AND is_deleted = false) INTO v_exists;
        ELSIF NEW.subject_type = 'network_partner' THEN
            SELECT EXISTS (SELECT 1 FROM public.network_partner WHERE partner_id = NEW.subject_id AND is_deleted = false) INTO v_exists;
        END IF;

        IF NOT v_exists THEN
            RAISE EXCEPTION 'Polymorphic FK error on ownership_assignment: % (%) does not exist.',
                NEW.subject_type, NEW.subject_id
                USING ERRCODE = '23503';
        END IF;
    ELSIF TG_TABLE_NAME = 'task' AND NEW.linked_type IS NOT NULL THEN
        IF NEW.linked_type = 'sponsor' THEN
            SELECT EXISTS (SELECT 1 FROM public.sponsor WHERE sponsor_id = NEW.linked_id AND is_deleted = false) INTO v_exists;
        ELSIF NEW.linked_type = 'opportunity' THEN
            SELECT EXISTS (SELECT 1 FROM public.opportunity WHERE opportunity_id = NEW.linked_id AND is_deleted = false) INTO v_exists;
        ELSIF NEW.linked_type = 'invoice' THEN
            SELECT EXISTS (SELECT 1 FROM public.invoice WHERE invoice_id = NEW.linked_id AND is_deleted = false) INTO v_exists;
        ELSIF NEW.linked_type = 'campaign' THEN
            SELECT EXISTS (SELECT 1 FROM public.campaign WHERE campaign_id = NEW.linked_id AND is_deleted = false) INTO v_exists;
        ELSIF NEW.linked_type = 'referral' THEN
            SELECT EXISTS (SELECT 1 FROM public.referral WHERE referral_id = NEW.linked_id AND is_deleted = false) INTO v_exists;
        END IF;

        IF NOT v_exists THEN
            RAISE EXCEPTION 'Polymorphic FK error on task: % (%) does not exist.',
                NEW.linked_type, NEW.linked_id
                USING ERRCODE = '23503';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

-- 12.13 Task dependency cycle detection (no cycles).
CREATE OR REPLACE FUNCTION public.tg_check_task_dependency_cycle()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_cycle BOOLEAN;
BEGIN
    WITH RECURSIVE chain AS (
        SELECT NEW.depends_on_task_id AS node
        UNION
        SELECT td.depends_on_task_id
          FROM public.task_dependency td
          JOIN chain c ON c.node = td.task_id
         WHERE td.is_deleted = false
    )
    SELECT EXISTS (SELECT 1 FROM chain WHERE node = NEW.task_id) INTO v_cycle;

    IF v_cycle THEN
        RAISE EXCEPTION 'Cycle detected in task_dependency involving task % and dependency %.',
            NEW.task_id, NEW.depends_on_task_id
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

-- 12.14 r2/D4 (INV-01): a receipt may only be allocated to its own sponsor's contract,
-- invoice and schedule item must belong to the same contract, and record classes must match.
CREATE OR REPLACE FUNCTION public.tg_check_allocation_ownership()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_receipt_sponsor TEXT;
    v_receipt_class TEXT;
    v_item_contract TEXT;
    v_invoice_contract TEXT;
    v_contract_sponsor TEXT;
    v_contract_class TEXT;
BEGIN
    SELECT sponsor_id, record_class INTO v_receipt_sponsor, v_receipt_class
      FROM public.receipt WHERE receipt_id = NEW.receipt_id;
    IF NEW.schedule_item_id IS NOT NULL THEN
        SELECT contract_id INTO v_item_contract FROM public.payment_schedule_item WHERE schedule_item_id = NEW.schedule_item_id;
    END IF;
    IF NEW.invoice_id IS NOT NULL THEN
        SELECT contract_id INTO v_invoice_contract FROM public.invoice WHERE invoice_id = NEW.invoice_id;
    END IF;
    IF v_item_contract IS NOT NULL AND v_invoice_contract IS NOT NULL AND v_item_contract <> v_invoice_contract THEN
        RAISE EXCEPTION 'Invoice % and schedule item % belong to different contracts.', NEW.invoice_id, NEW.schedule_item_id
            USING ERRCODE = '23514';
    END IF;
    SELECT o.sponsor_id, c.record_class INTO v_contract_sponsor, v_contract_class
      FROM public.contract c
      JOIN public.opportunity o ON o.opportunity_id = c.opportunity_id
     WHERE c.contract_id = COALESCE(v_item_contract, v_invoice_contract);
    IF v_contract_sponsor IS DISTINCT FROM v_receipt_sponsor THEN
        RAISE EXCEPTION 'INV-01: receipt sponsor % differs from contract sponsor %.', v_receipt_sponsor, v_contract_sponsor
            USING ERRCODE = '23514';
    END IF;
    IF v_contract_class IS DISTINCT FROM v_receipt_class THEN
        RAISE EXCEPTION 'Receipt record_class % differs from contract record_class %.', v_receipt_class, v_contract_class
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

-- 12.15 r2/D5 (INV-02): signed_value_total = SUM(non-deleted contract lines), checked at commit.
CREATE OR REPLACE FUNCTION public.tg_check_contract_total()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_total NUMERIC(14, 2);
    v_sum NUMERIC(14, 2);
BEGIN
    SELECT signed_value_total INTO v_total
      FROM public.contract
     WHERE contract_id = NEW.contract_id AND is_deleted = false AND status = 'active' AND valid_to IS NULL;
    IF v_total IS NULL THEN
        RETURN NULL;
    END IF;
    SELECT COALESCE(SUM(value), 0) INTO v_sum
      FROM public.contract_line WHERE contract_id = NEW.contract_id AND is_deleted = false;
    IF v_sum <> v_total THEN
        RAISE EXCEPTION 'INV-02: contract % lines sum to % but signed_value_total is %.', NEW.contract_id, v_sum, v_total
            USING ERRCODE = '23514';
    END IF;
    RETURN NULL;
END;
$$;

-- 12.16 r2/D5: signed terms are immutable; amendments are new contract versions.
CREATE OR REPLACE FUNCTION public.tg_signed_terms_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
    -- Nested IFs: PL/pgSQL does not short-circuit record field references across tables.
    IF TG_TABLE_NAME = 'contract_line' THEN
        IF (OLD.value, OLD.consideration_type, OLD.contract_id) IS DISTINCT FROM (NEW.value, NEW.consideration_type, NEW.contract_id) THEN
            RAISE EXCEPTION 'Signed contract lines are immutable; amend by a new contract version.' USING ERRCODE = '42501';
        END IF;
    ELSIF TG_TABLE_NAME = 'contract' THEN
        IF (OLD.signed_value_total, OLD.opportunity_id, OLD.signed_at) IS DISTINCT FROM (NEW.signed_value_total, NEW.opportunity_id, NEW.signed_at) THEN
            RAISE EXCEPTION 'Signed contract terms are immutable; amend by a new contract version.' USING ERRCODE = '42501';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

-- ============================================================================
-- 13. ATTACH TRIGGERS ACROSS TABLES
-- ============================================================================

-- 13.1 Hard delete protection on EVERY table.
DO $$
DECLARE
    v_tbl TEXT;
    v_all_tables TEXT[] := ARRAY[
        'import_batch', 'decision_record', 'source_register', 'benchmark',
        'festival_edition', 'category', 'channel', 'team_member', 'bet',
        'metric_definition', 'kpi_definition', 'scenario_reference', 'threshold_rule',
        'experiment', 'model_assumption', 'target_version', 'knowledge_chunk',
        'sponsor', 'contact', 'network_partner', 'campaign', 'referral',
        'prospect_research', 'ownership_assignment', 'outreach_attempt',
        'interaction', 'opportunity', 'meeting', 'qualification_version',
        'opportunity_stage_version', 'inventory_asset', 'price_list_entry',
        'package', 'package_item', 'proposal', 'contract', 'contract_line',
        'asset_slot', 'exclusivity_grant', 'contract_deliverable',
        'payment_schedule_item', 'invoice', 'receipt', 'receipt_allocation',
        'in_kind_contribution', 'expense', 'task', 'task_dependency',
        'kpi_actual', 'escalation', 'time_log', 'staffing_allocation',
        'experiment_result', 'forecast_version', 'role_assignment',
        'ai_conversation', 'ai_message', 'ai_query_log', 'ai_action', 'audit_event'
    ];
BEGIN
    FOREACH v_tbl IN ARRAY v_all_tables
    LOOP
        EXECUTE format(
            'DROP TRIGGER IF EXISTS trg_no_delete ON public.%I;
             CREATE TRIGGER trg_no_delete BEFORE DELETE ON public.%I
             FOR EACH ROW EXECUTE FUNCTION public.tg_block_hard_delete();',
            v_tbl, v_tbl
        );
    END LOOP;
END
$$;

-- 13.2 Append-only / immutable trigger attachment.
DO $$
DECLARE
    v_tbl TEXT;
    v_append_only_tables TEXT[] := ARRAY[
        'import_batch', 'decision_record', 'source_register', 'benchmark',
        'bet', 'scenario_reference', 'model_assumption',
        'outreach_attempt', 'interaction', 'qualification_version',
        'opportunity_stage_version', 'receipt_allocation', 'kpi_actual',
        'experiment_result', 'forecast_version', 'ai_query_log', 'audit_event'
    ];
BEGIN
    FOREACH v_tbl IN ARRAY v_append_only_tables
    LOOP
        EXECUTE format(
            'DROP TRIGGER IF EXISTS trg_append_only ON public.%I;
             CREATE TRIGGER trg_append_only BEFORE UPDATE ON public.%I
             FOR EACH ROW EXECUTE FUNCTION public.tg_enforce_append_only();',
            v_tbl, v_tbl
        );
    END LOOP;
END
$$;

-- 13.3 historical_synthetic immutability protection across tables allowing that class.
DO $$
DECLARE
    v_tbl TEXT;
    v_hist_tables TEXT[] := ARRAY[
        'festival_edition', 'sponsor', 'contact', 'team_member',
        'ownership_assignment', 'campaign', 'outreach_attempt', 'interaction',
        'meeting', 'qualification_version', 'opportunity',
        'opportunity_stage_version', 'contract_deliverable', 'target_version',
        'kpi_actual', 'knowledge_chunk'
    ];
BEGIN
    FOREACH v_tbl IN ARRAY v_hist_tables
    LOOP
        EXECUTE format(
            'DROP TRIGGER IF EXISTS trg_protect_historical_synthetic ON public.%I;
             CREATE TRIGGER trg_protect_historical_synthetic BEFORE INSERT OR UPDATE ON public.%I
             FOR EACH ROW EXECUTE FUNCTION public.tg_protect_historical_synthetic();',
            v_tbl, v_tbl
        );
    END LOOP;
END
$$;

-- 13.4 Edition record_class consistency triggers.
DO $$
DECLARE
    v_tbl TEXT;
    v_edition_tables TEXT[] := ARRAY[
        'campaign', 'qualification_version', 'opportunity', 'target_version',
        'role_assignment', 'expense', 'forecast_version'
    ];
BEGIN
    FOREACH v_tbl IN ARRAY v_edition_tables
    LOOP
        EXECUTE format(
            'DROP TRIGGER IF EXISTS trg_edition_record_class ON public.%I;
             CREATE TRIGGER trg_edition_record_class BEFORE INSERT OR UPDATE ON public.%I
             FOR EACH ROW EXECUTE FUNCTION public.tg_check_edition_record_class();',
            v_tbl, v_tbl
        );
    END LOOP;
END
$$;

-- 13.5 Parent-child record_class consistency triggers.
DO $$
DECLARE
    v_tbl TEXT;
    v_child_tables TEXT[] := ARRAY[
        'outreach_attempt', 'interaction', 'opportunity_stage_version',
        'proposal', 'contract', 'contract_line', 'payment_schedule_item',
        'invoice', 'receipt_allocation', 'in_kind_contribution', 'exclusivity_grant'
    ];
BEGIN
    FOREACH v_tbl IN ARRAY v_child_tables
    LOOP
        EXECUTE format(
            'DROP TRIGGER IF EXISTS trg_parent_record_class ON public.%I;
             CREATE TRIGGER trg_parent_record_class BEFORE INSERT OR UPDATE ON public.%I
             FOR EACH ROW EXECUTE FUNCTION public.tg_check_parent_record_class();',
            v_tbl, v_tbl
        );
    END LOOP;
END
$$;

-- 13.6 updated_at maintenance on mutable tables.
DO $$
DECLARE
    v_tbl TEXT;
    v_mutable_tables TEXT[] := ARRAY[
        'festival_edition', 'category', 'channel', 'team_member', 'experiment',
        'sponsor', 'contact', 'network_partner', 'campaign', 'opportunity',
        'meeting', 'inventory_asset', 'package', 'package_item', 'contract',
        'contract_line', 'asset_slot', 'exclusivity_grant', 'contract_deliverable',
        'payment_schedule_item', 'invoice', 'receipt', 'in_kind_contribution',
        'expense', 'task', 'task_dependency', 'escalation', 'time_log', 'ai_conversation'
    ];
BEGIN
    FOREACH v_tbl IN ARRAY v_mutable_tables
    LOOP
        EXECUTE format(
            'DROP TRIGGER IF EXISTS trg_touch_updated_at ON public.%I;
             CREATE TRIGGER trg_touch_updated_at BEFORE UPDATE ON public.%I
             FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();',
            v_tbl, v_tbl
        );
    END LOOP;
END
$$;

-- 13.7 Monotonic app_state.data_version bump on all operational tables (Rule 5).
DO $$
DECLARE
    v_tbl TEXT;
    v_operational_tables TEXT[] := ARRAY[
        'sponsor', 'contact', 'network_partner', 'referral', 'ownership_assignment',
        'campaign', 'outreach_attempt', 'interaction', 'meeting',
        'qualification_version', 'opportunity', 'opportunity_stage_version',
        'asset_slot', 'proposal', 'contract', 'contract_line',
        'exclusivity_grant', 'contract_deliverable', 'payment_schedule_item',
        'invoice', 'receipt', 'receipt_allocation', 'in_kind_contribution',
        'expense', 'task', 'task_dependency', 'escalation', 'time_log',
        'staffing_allocation', 'kpi_actual', 'experiment_result',
        'forecast_version', 'role_assignment'
    ];
BEGIN
    FOREACH v_tbl IN ARRAY v_operational_tables
    LOOP
        EXECUTE format(
            'DROP TRIGGER IF EXISTS trg_bump_data_version ON public.%I;
             CREATE TRIGGER trg_bump_data_version AFTER INSERT OR UPDATE ON public.%I
             FOR EACH STATEMENT EXECUTE FUNCTION public.tg_bump_data_version();',
            v_tbl, v_tbl
        );
    END LOOP;
END
$$;

-- 13.8 Domain-specific business invariant triggers.
DROP TRIGGER IF EXISTS trg_outreach_opt_out ON public.outreach_attempt;
CREATE TRIGGER trg_outreach_opt_out
    BEFORE INSERT ON public.outreach_attempt
    FOR EACH ROW EXECUTE FUNCTION public.tg_check_outreach_opt_out();

DROP TRIGGER IF EXISTS trg_opportunity_invariants ON public.opportunity;
CREATE TRIGGER trg_opportunity_invariants
    BEFORE INSERT OR UPDATE ON public.opportunity
    FOR EACH ROW EXECUTE FUNCTION public.tg_check_opportunity_invariants();

DROP TRIGGER IF EXISTS trg_stage_version_contract ON public.opportunity_stage_version;
CREATE TRIGGER trg_stage_version_contract
    BEFORE INSERT ON public.opportunity_stage_version
    FOR EACH ROW EXECUTE FUNCTION public.tg_check_stage_version_contract();

DROP TRIGGER IF EXISTS trg_in_kind_line_type ON public.in_kind_contribution;
CREATE TRIGGER trg_in_kind_line_type
    BEFORE INSERT OR UPDATE ON public.in_kind_contribution
    FOR EACH ROW EXECUTE FUNCTION public.tg_check_in_kind_line_type();

DROP TRIGGER IF EXISTS trg_protect_receipt ON public.receipt;
CREATE TRIGGER trg_protect_receipt
    BEFORE UPDATE OR DELETE ON public.receipt
    FOR EACH ROW EXECUTE FUNCTION public.tg_protect_receipt_immutability();

DROP TRIGGER IF EXISTS trg_protect_invoice ON public.invoice;
CREATE TRIGGER trg_protect_invoice
    BEFORE UPDATE OR DELETE ON public.invoice
    FOR EACH ROW EXECUTE FUNCTION public.tg_protect_invoice_immutability();

DROP TRIGGER IF EXISTS trg_check_receipt_allocation_caps ON public.receipt_allocation;
CREATE TRIGGER trg_check_receipt_allocation_caps
    BEFORE INSERT ON public.receipt_allocation
    FOR EACH ROW EXECUTE FUNCTION public.tg_check_receipt_allocation_caps();

DROP TRIGGER IF EXISTS trg_allocation_ownership ON public.receipt_allocation;
CREATE TRIGGER trg_allocation_ownership
    BEFORE INSERT ON public.receipt_allocation
    FOR EACH ROW EXECUTE FUNCTION public.tg_check_allocation_ownership();

DROP TRIGGER IF EXISTS trg_contract_total ON public.contract;
CREATE CONSTRAINT TRIGGER trg_contract_total
    AFTER INSERT OR UPDATE ON public.contract
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION public.tg_check_contract_total();

DROP TRIGGER IF EXISTS trg_contract_line_total ON public.contract_line;
CREATE CONSTRAINT TRIGGER trg_contract_line_total
    AFTER INSERT OR UPDATE ON public.contract_line
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION public.tg_check_contract_total();

DROP TRIGGER IF EXISTS trg_signed_terms_contract ON public.contract;
CREATE TRIGGER trg_signed_terms_contract
    BEFORE UPDATE ON public.contract
    FOR EACH ROW EXECUTE FUNCTION public.tg_signed_terms_immutable();

DROP TRIGGER IF EXISTS trg_signed_terms_line ON public.contract_line;
CREATE TRIGGER trg_signed_terms_line
    BEFORE UPDATE ON public.contract_line
    FOR EACH ROW EXECUTE FUNCTION public.tg_signed_terms_immutable();

DROP TRIGGER IF EXISTS trg_check_exclusivity_grant ON public.exclusivity_grant;
CREATE TRIGGER trg_check_exclusivity_grant
    BEFORE INSERT OR UPDATE ON public.exclusivity_grant
    FOR EACH ROW EXECUTE FUNCTION public.tg_check_exclusivity_grant();

DROP TRIGGER IF EXISTS trg_validate_ownership_link ON public.ownership_assignment;
CREATE TRIGGER trg_validate_ownership_link
    BEFORE INSERT OR UPDATE ON public.ownership_assignment
    FOR EACH ROW EXECUTE FUNCTION public.tg_validate_polymorphic_links();

DROP TRIGGER IF EXISTS trg_validate_task_link ON public.task;
CREATE TRIGGER trg_validate_task_link
    BEFORE INSERT OR UPDATE ON public.task
    FOR EACH ROW EXECUTE FUNCTION public.tg_validate_polymorphic_links();

DROP TRIGGER IF EXISTS trg_check_task_dependency_cycle ON public.task_dependency;
CREATE TRIGGER trg_check_task_dependency_cycle
    BEFORE INSERT OR UPDATE ON public.task_dependency
    FOR EACH ROW EXECUTE FUNCTION public.tg_check_task_dependency_cycle();

COMMIT;
