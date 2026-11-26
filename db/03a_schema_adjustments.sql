-- ============================================================================
-- Sponsorship Growth Platform — Stage 2 schema adjustments
-- File: db/03a_schema_adjustments.sql   (run FIRST in Stage 2, as the project owner)
--
-- Why: loading the approved reference files unchanged showed that four CHECK lists in
-- 01_schema.sql use vocabularies that differ from the source files. The source files are
-- authoritative (no silent rewriting), so the checks are widened to the source values.
-- Also adds the citation fields the AI analyst needs on knowledge_chunk, and the
-- metric result type used by 03_metrics.sql. Idempotent.
-- ============================================================================
BEGIN;

-- 1. kpi_definition.kpi_type: use the KPI dictionary's own types (05_STRATEGY/kpi_dictionary.csv).
ALTER TABLE public.kpi_definition DROP CONSTRAINT IF EXISTS kpi_definition_kpi_type_check;
ALTER TABLE public.kpi_definition ADD CONSTRAINT kpi_definition_kpi_type_check CHECK (kpi_type IS NULL OR kpi_type IN (
    'north star', 'gate', 'outcome', 'conversion', 'activity', 'activity guard', 'quality',
    'capacity', 'financial', 'funnel diagnostic'));

-- 2. metric_definition.value_nature: dictionary values carry a qualifier, e.g. 'actual (synthetic 2025)'.
ALTER TABLE public.metric_definition DROP CONSTRAINT IF EXISTS metric_definition_value_nature_check;
ALTER TABLE public.metric_definition ADD CONSTRAINT metric_definition_value_nature_check
    CHECK (value_nature ~ '^(actual|calculated|assumed|forecast)');

-- 3. model_assumption.evidence_class: the assumption register also uses 'D-forward' and 'config'.
ALTER TABLE public.model_assumption DROP CONSTRAINT IF EXISTS model_assumption_evidence_class_check;
ALTER TABLE public.model_assumption ADD CONSTRAINT model_assumption_evidence_class_check
    CHECK (evidence_class IS NULL OR evidence_class IN ('D', 'B', 'A', 'C', 'T', 'U', 'D-forward', 'config'));
ALTER TABLE public.model_assumption ADD COLUMN IF NOT EXISTS unit TEXT;
ALTER TABLE public.model_assumption ADD COLUMN IF NOT EXISTS status TEXT;
ALTER TABLE public.model_assumption ADD COLUMN IF NOT EXISTS rationale TEXT;
ALTER TABLE public.model_assumption ADD COLUMN IF NOT EXISTS validation_method TEXT;

-- 4. knowledge_chunk: keep the knowledge base's own status values and multi-class evidence tags,
--    and add the citation fields (title, section, source) the AI must show.
ALTER TABLE public.knowledge_chunk DROP CONSTRAINT IF EXISTS knowledge_chunk_decision_status_check;
ALTER TABLE public.knowledge_chunk ADD CONSTRAINT knowledge_chunk_decision_status_check CHECK (decision_status IN (
    'approved', 'reference', 'proposed', 'superseded', 'draft',
    'superseded_mapping', 'corrected', 'conflict_resolution'));
ALTER TABLE public.knowledge_chunk DROP CONSTRAINT IF EXISTS knowledge_chunk_evidence_class_check;
ALTER TABLE public.knowledge_chunk ADD CONSTRAINT knowledge_chunk_evidence_class_check
    CHECK (evidence_class IS NULL OR evidence_class ~ '^[DBACTU](,[DBACTU])*$');
ALTER TABLE public.knowledge_chunk ADD COLUMN IF NOT EXISTS document_title TEXT;
ALTER TABLE public.knowledge_chunk ADD COLUMN IF NOT EXISTS section TEXT;
ALTER TABLE public.knowledge_chunk ADD COLUMN IF NOT EXISTS source_id TEXT;
ALTER TABLE public.knowledge_chunk ADD COLUMN IF NOT EXISTS source_type TEXT;
ALTER TABLE public.knowledge_chunk ADD COLUMN IF NOT EXISTS effective_date DATE;

-- 5. scenario_reference: keep the catalogue's full status wording beside the short status.
ALTER TABLE public.scenario_reference ADD COLUMN IF NOT EXISTS status_label TEXT;
ALTER TABLE public.scenario_reference ADD COLUMN IF NOT EXISTS p50 NUMERIC(12, 2);

-- 6. threshold_rule: the experiment register words the 'change' band separately.
ALTER TABLE public.threshold_rule ADD COLUMN IF NOT EXISTS change_if TEXT;

-- 7. Metric result type returned by every metrics.m_XX function (03_metrics.sql).
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
                    WHERE n.nspname = 'metrics' AND t.typname = 'metric_result') THEN
        CREATE TYPE metrics.metric_result AS (
            metric_id          TEXT,
            value              NUMERIC,
            unit               TEXT,
            numerator          NUMERIC,
            denominator        NUMERIC,
            computable         BOOLEAN,
            reason             TEXT,
            applied_filters    JSONB,
            record_class       TEXT,
            edition_id         TEXT,
            as_of              DATE,
            data_version       BIGINT,
            definition_version TEXT,
            series_key         TEXT
        );
    END IF;
END
$$;
GRANT USAGE ON TYPE metrics.metric_result TO app_service;

COMMIT;
