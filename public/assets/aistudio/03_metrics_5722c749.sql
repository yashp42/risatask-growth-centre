-- ============================================================================
-- Sponsorship Growth Platform — Stage 2 metric engine
-- File: db/03_metrics.sql   (run after 03a_schema_adjustments.sql, as the project owner)
--
-- One function per metric in 05_metric_dictionary.csv (M-01 .. M-30):
--   metrics.m_XX(p_record_class TEXT, p_edition_id TEXT, p_as_of DATE, p_filters JSONB)
--   RETURNS SETOF metrics.metric_result
-- plus the dispatcher metrics.get_metric(...) used by POST /api/metrics/query and the
-- AI tool get_metric, and metrics.parity_2025() for GET/POST /api/admin/parity.
--
-- Rules:
--  * The same SQL serves historical_synthetic (2025) and live/simulated editions; the 2025
--    parity test proves it against the dictionary's example values.
--  * "As of D" = everything stamped before the end of day D in Asia/Kolkata (D + 1 day, IST).
--  * A metric that the data cannot support returns computable = false and a reason, never 0.
--  * Filters (all optional): campaign_id, channel_group (warm | inbound | cold | renewal |
--    premium), bet_id, scenario_id (M-30). applied_filters echoes the keys a metric used.
--  * SECURITY INVOKER: functions run with app_service's own read rights.
-- ============================================================================
BEGIN;

-- ---------------------------------------------------------------------------
-- 0. Helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION metrics.eod(p_as_of DATE)
RETURNS TIMESTAMPTZ LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $$
    SELECT ((p_as_of + 1)::timestamp AT TIME ZONE 'Asia/Kolkata');
$$;

CREATE OR REPLACE FUNCTION metrics.ist_date(p_ts TIMESTAMPTZ)
RETURNS DATE LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $$
    SELECT (p_ts AT TIME ZONE 'Asia/Kolkata')::date;
$$;

-- Validates the edition/class pair and returns the edition's festival start.
CREATE OR REPLACE FUNCTION metrics.edition_start(p_record_class TEXT, p_edition_id TEXT)
RETURNS TIMESTAMPTZ LANGUAGE plpgsql STABLE SET search_path = pg_catalog, public AS $$
DECLARE v_class TEXT; v_start TIMESTAMPTZ;
BEGIN
    SELECT record_class, starts_at INTO v_class, v_start
      FROM public.festival_edition WHERE edition_id = p_edition_id AND NOT is_deleted;
    IF v_class IS NULL THEN
        RAISE EXCEPTION 'Unknown edition %', p_edition_id USING ERRCODE = '22023';
    END IF;
    IF v_class <> p_record_class THEN
        RAISE EXCEPTION 'Edition % holds % records, not %', p_edition_id, v_class, p_record_class USING ERRCODE = '22023';
    END IF;
    RETURN v_start;
END $$;

-- Does a campaign pass the filters? p_default_exclude_cold implements "warm + inbound unless stated".
CREATE OR REPLACE FUNCTION metrics.campaign_match(p_campaign_id TEXT, p_filters JSONB, p_default_exclude_cold BOOLEAN DEFAULT false)
RETURNS BOOLEAN LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $$
    SELECT CASE
        WHEN p_campaign_id IS NULL THEN NOT (COALESCE(p_filters, '{}'::jsonb) ?| ARRAY['campaign_id', 'channel_group', 'bet_id'])
                                    AND NOT p_default_exclude_cold
        ELSE COALESCE((
            SELECT (p_filters->>'campaign_id' IS NULL OR c.campaign_id = p_filters->>'campaign_id')
               AND (p_filters->>'channel_group' IS NULL OR ch.channel_group = p_filters->>'channel_group')
               AND (p_filters->>'bet_id' IS NULL OR c.bet_id = p_filters->>'bet_id')
               AND (NOT p_default_exclude_cold
                    OR COALESCE(p_filters, '{}'::jsonb) ?| ARRAY['campaign_id', 'channel_group']
                    OR ch.channel_group <> 'cold')
              FROM public.campaign c JOIN public.channel ch ON ch.channel_id = c.channel_id
             WHERE c.campaign_id = p_campaign_id), false)
    END;
$$;

CREATE OR REPLACE FUNCTION metrics.used_filters(p_filters JSONB, p_keys TEXT[])
RETURNS JSONB LANGUAGE sql IMMUTABLE AS $$
    SELECT COALESCE(jsonb_object_agg(k, p_filters->k), '{}'::jsonb)
      FROM unnest(p_keys) k WHERE p_filters ? k;
$$;

-- Builds one result row, stamping data_version and definition_version.
CREATE OR REPLACE FUNCTION metrics.mk(
    p_metric_id TEXT, p_value NUMERIC, p_numerator NUMERIC, p_denominator NUMERIC,
    p_computable BOOLEAN, p_reason TEXT, p_applied JSONB,
    p_record_class TEXT, p_edition_id TEXT, p_as_of DATE, p_series_key TEXT DEFAULT NULL)
RETURNS metrics.metric_result LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $$
    SELECT ROW(
        p_metric_id,
        CASE WHEN p_computable THEN p_value END,
        md.unit,
        CASE WHEN p_computable THEN p_numerator END,
        CASE WHEN p_computable THEN p_denominator END,
        p_computable,
        p_reason,
        COALESCE(p_applied, '{}'::jsonb),
        p_record_class, p_edition_id, p_as_of,
        (SELECT data_version FROM public.app_state WHERE id = 1),
        md.definition_version,
        p_series_key)::metrics.metric_result
      FROM (SELECT 1) one
      LEFT JOIN public.metric_definition md ON md.metric_id = p_metric_id AND md.valid_to IS NULL AND NOT md.is_deleted;
$$;

CREATE OR REPLACE FUNCTION metrics.ratio(n NUMERIC, d NUMERIC)
RETURNS NUMERIC LANGUAGE sql IMMUTABLE AS $$ SELECT CASE WHEN d IS NULL OR d = 0 THEN NULL ELSE n / d END $$;

-- ---------------------------------------------------------------------------
-- 1. Point-in-time building blocks (mirror the audited 2025 DuckDB views)
-- ---------------------------------------------------------------------------

-- Outreach attempts with their event flags as of p_eod (mirrors core.attempts).
CREATE OR REPLACE FUNCTION metrics.attempts(p_record_class TEXT, p_edition_id TEXT, p_eod TIMESTAMPTZ)
RETURNS TABLE (attempt_id TEXT, sponsor_id TEXT, campaign_id TEXT, root_event_type TEXT, started_at TIMESTAMPTZ,
               got_reply BOOLEAN, reply_outcome TEXT, meeting_held BOOLEAN)
LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $$
    SELECT a.attempt_id, a.sponsor_id, a.campaign_id, a.root_event_type, a.started_at,
           COALESCE(bool_or(i.event_type = 'replied'), false),
           max(CASE WHEN i.event_type = 'replied' THEN i.outcome END),
           COALESCE(bool_or(i.event_type = 'meeting_held'), false)
      FROM public.outreach_attempt a
      JOIN public.campaign c ON c.campaign_id = a.campaign_id AND c.edition_id = p_edition_id
      LEFT JOIN public.interaction i ON i.attempt_id = a.attempt_id AND i.occurred_at < p_eod AND NOT i.is_deleted
     WHERE a.record_class = p_record_class AND NOT a.is_deleted AND a.started_at < p_eod
     GROUP BY a.attempt_id, a.sponsor_id, a.campaign_id, a.root_event_type, a.started_at;
$$;

-- Latest stage version per opportunity as of p_eod (mirrors core.opportunity_asof).
CREATE OR REPLACE FUNCTION metrics.opp_state(p_record_class TEXT, p_edition_id TEXT, p_eod TIMESTAMPTZ)
RETURNS TABLE (opportunity_id TEXT, sponsor_id TEXT, originating_campaign_id TEXT, support_type TEXT,
               is_renewal BOOLEAN, created_at TIMESTAMPTZ, stage TEXT, proposed_value NUMERIC,
               confirmed_value NUMERIC, stage_class TEXT)
LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $$
    SELECT DISTINCT ON (o.opportunity_id)
           o.opportunity_id, o.sponsor_id, o.originating_campaign_id, o.support_type, o.is_renewal, o.created_at,
           v.stage, v.proposed_value, v.confirmed_value,
           CASE WHEN v.stage IN ('prospecting', 'contacted', 'proposal_sent', 'negotiating') THEN 'open'
                WHEN v.stage = 'partner_confirmed' THEN 'won' ELSE 'closed_lost' END
      FROM public.opportunity o
      JOIN public.opportunity_stage_version v ON v.opportunity_id = o.opportunity_id
                                             AND v.valid_from < p_eod AND NOT v.is_deleted
     WHERE o.edition_id = p_edition_id AND o.record_class = p_record_class AND NOT o.is_deleted
     ORDER BY o.opportunity_id, v.valid_from DESC, v.history_id DESC;
$$;

-- First time each opportunity reached each stage, as of p_eod (mirrors core.opportunity_stage_reached).
CREATE OR REPLACE FUNCTION metrics.stage_reached(p_record_class TEXT, p_edition_id TEXT, p_eod TIMESTAMPTZ)
RETURNS TABLE (opportunity_id TEXT, sponsor_id TEXT, originating_campaign_id TEXT, stage TEXT, first_reached_at TIMESTAMPTZ)
LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $$
    SELECT o.opportunity_id, o.sponsor_id, o.originating_campaign_id, v.stage, min(v.valid_from)
      FROM public.opportunity o
      JOIN public.opportunity_stage_version v ON v.opportunity_id = o.opportunity_id
                                             AND v.valid_from < p_eod AND NOT v.is_deleted
     WHERE o.edition_id = p_edition_id AND o.record_class = p_record_class AND NOT o.is_deleted
     GROUP BY o.opportunity_id, o.sponsor_id, o.originating_campaign_id, v.stage;
$$;

-- Latest qualification per sponsor as of p_eod, with first-qualified time (mirrors core.qualification_asof
-- and val.first_qualified).
CREATE OR REPLACE FUNCTION metrics.qual_state(p_record_class TEXT, p_edition_id TEXT, p_eod TIMESTAMPTZ)
RETURNS TABLE (sponsor_id TEXT, status TEXT, source_campaign_id TEXT, first_qualified_at TIMESTAMPTZ)
LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $$
    WITH v AS (
        SELECT q.* FROM public.qualification_version q
         WHERE q.edition_id = p_edition_id AND q.record_class = p_record_class
           AND q.valid_from < p_eod AND NOT q.is_deleted
    ), latest AS (
        SELECT DISTINCT ON (sponsor_id) sponsor_id, status, source_campaign_id
          FROM v ORDER BY sponsor_id, valid_from DESC, history_id DESC
    )
    SELECT l.sponsor_id, l.status, l.source_campaign_id,
           (SELECT min(v2.valid_from) FROM v v2 WHERE v2.sponsor_id = l.sponsor_id AND v2.status = 'qualified')
      FROM latest l;
$$;

-- Qualified-brand handoff register as of p_eod (mirrors val.handoff_register).
CREATE OR REPLACE FUNCTION metrics.handoff(p_record_class TEXT, p_edition_id TEXT, p_eod TIMESTAMPTZ)
RETURNS TABLE (sponsor_id TEXT, source_campaign_id TEXT, first_qualified_at TIMESTAMPTZ, n_opps BIGINT,
               first_opp_created_at TIMESTAMPTZ, first_proposal_at TIMESTAMPTZ)
LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $$
    SELECT q.sponsor_id, q.source_campaign_id, q.first_qualified_at,
           count(DISTINCT s.opportunity_id),
           min(s.created_at),
           (SELECT min(r.first_reached_at) FROM metrics.stage_reached(p_record_class, p_edition_id, p_eod) r
             WHERE r.sponsor_id = q.sponsor_id AND r.stage = 'proposal_sent')
      FROM metrics.qual_state(p_record_class, p_edition_id, p_eod) q
      LEFT JOIN metrics.opp_state(p_record_class, p_edition_id, p_eod) s ON s.sponsor_id = q.sponsor_id
     WHERE q.status = 'qualified'
     GROUP BY q.sponsor_id, q.source_campaign_id, q.first_qualified_at;
$$;

-- Brand-level funnel per campaign, attempts started before the festival (mirrors eda.q4_campaign_funnel).
CREATE OR REPLACE FUNCTION metrics.campaign_funnel(p_record_class TEXT, p_edition_id TEXT, p_eod TIMESTAMPTZ, p_filters JSONB)
RETURNS TABLE (campaign_id TEXT, brands_touched BIGINT, brands_responded BIGINT, brands_met BIGINT)
LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $$
    SELECT a.campaign_id,
           count(DISTINCT a.sponsor_id),
           count(DISTINCT a.sponsor_id) FILTER (WHERE a.got_reply OR a.root_event_type <> 'outreach_sent'),
           count(DISTINCT a.sponsor_id) FILTER (WHERE a.meeting_held)
      FROM metrics.attempts(p_record_class, p_edition_id, p_eod) a
     WHERE a.started_at < metrics.edition_start(p_record_class, p_edition_id)
       AND metrics.campaign_match(a.campaign_id, p_filters)
     GROUP BY a.campaign_id;
$$;

-- Cash signed by consideration type for opportunities currently confirmed (live / simulated).
CREATE OR REPLACE FUNCTION metrics.signed_lines(p_record_class TEXT, p_edition_id TEXT, p_eod TIMESTAMPTZ, p_filters JSONB)
RETURNS TABLE (consideration_type TEXT, value NUMERIC)
LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $$
    SELECT cl.consideration_type, sum(cl.value)
      FROM metrics.opp_state(p_record_class, p_edition_id, p_eod) s
      JOIN public.contract c ON c.opportunity_id = s.opportunity_id AND c.status = 'active' AND c.valid_to IS NULL
                            AND NOT c.is_deleted AND c.signed_at < p_eod
      JOIN public.contract_line cl ON cl.contract_id = c.contract_id AND NOT cl.is_deleted
     WHERE s.stage = 'partner_confirmed' AND metrics.campaign_match(s.originating_campaign_id, p_filters)
     GROUP BY cl.consideration_type;
$$;

-- Cash collected: reconciled receipts allocated to this edition's contracts, received before the festival.
CREATE OR REPLACE FUNCTION metrics.collected(p_record_class TEXT, p_edition_id TEXT, p_eod TIMESTAMPTZ, p_filters JSONB)
RETURNS NUMERIC LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $$
    SELECT COALESCE(sum(ra.amount), 0)
      FROM public.receipt_allocation ra
      JOIN public.receipt r ON r.receipt_id = ra.receipt_id AND NOT r.is_deleted AND r.reconciled
      LEFT JOIN public.payment_schedule_item psi ON psi.schedule_item_id = ra.schedule_item_id
      LEFT JOIN public.invoice inv ON inv.invoice_id = ra.invoice_id
      JOIN public.contract c ON c.contract_id = COALESCE(psi.contract_id, inv.contract_id)
      JOIN public.opportunity o ON o.opportunity_id = c.opportunity_id
     WHERE NOT ra.is_deleted AND ra.record_class = p_record_class AND o.edition_id = p_edition_id
       AND r.received_at < LEAST(metrics.edition_start(p_record_class, p_edition_id), p_eod)
       AND r.reconciled_at < p_eod
       AND metrics.campaign_match(o.originating_campaign_id, p_filters);
$$;

CREATE OR REPLACE FUNCTION metrics.not_in_2025(p_metric_id TEXT, p_reason TEXT, p_record_class TEXT, p_edition_id TEXT, p_as_of DATE)
RETURNS SETOF metrics.metric_result LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $$
    SELECT metrics.mk(p_metric_id, NULL, NULL, NULL, false, p_reason, '{}'::jsonb, p_record_class, p_edition_id, p_as_of);
$$;

-- Model hours per logged task type, from AS-19 (Hours per task). The task-type mapping is a
-- proposed operational default (decision register, Stage 2): call/pitch = meeting, invoice = collection.
CREATE TABLE IF NOT EXISTS metrics.task_model_hours (
    task_type      TEXT PRIMARY KEY,
    model_hours    NUMERIC(5, 2),
    source         TEXT NOT NULL,
    mapping_status TEXT NOT NULL
);
INSERT INTO metrics.task_model_hours VALUES
    ('follow_up', 2.0, 'AS-19 follow-up 2 h', 'proposed default'),
    ('proposal', 2.5, 'AS-19 proposal 2.5 h', 'proposed default'),
    ('call', 3.5, 'AS-19 meeting 3.5 h', 'proposed default'),
    ('pitch', 3.5, 'AS-19 meeting 3.5 h', 'proposed default'),
    ('invoice', 2.0, 'AS-19 collection 2 h', 'proposed default'),
    ('admin', NULL, 'no model rate in AS-19', 'excluded')
ON CONFLICT (task_type) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. Metrics M-01 .. M-30
-- ---------------------------------------------------------------------------
-- Cash family (M-01, M-06, M-07): receipts exist only for live / simulated editions.

CREATE OR REPLACE FUNCTION metrics.m_01(p_record_class TEXT, p_edition_id TEXT, p_as_of DATE, p_filters JSONB DEFAULT '{}')
RETURNS SETOF metrics.metric_result LANGUAGE plpgsql STABLE SET search_path = pg_catalog, public AS $$
DECLARE e TIMESTAMPTZ := metrics.eod(p_as_of); v NUMERIC;
BEGIN
    PERFORM metrics.edition_start(p_record_class, p_edition_id);
    IF p_record_class = 'historical_synthetic' THEN
        RETURN QUERY SELECT * FROM metrics.not_in_2025('M-01', 'Not computable: the 2025 dataset has no payment, invoice or receipt records. Signed value (M-02) is not cash.', p_record_class, p_edition_id, p_as_of);
        RETURN;
    END IF;
    v := metrics.collected(p_record_class, p_edition_id, e, p_filters);
    RETURN NEXT metrics.mk('M-01', v, v, NULL, true, NULL, metrics.used_filters(p_filters, ARRAY['campaign_id', 'channel_group', 'bet_id']), p_record_class, p_edition_id, p_as_of);
END $$;

CREATE OR REPLACE FUNCTION metrics.m_06(p_record_class TEXT, p_edition_id TEXT, p_as_of DATE, p_filters JSONB DEFAULT '{}')
RETURNS SETOF metrics.metric_result LANGUAGE plpgsql STABLE SET search_path = pg_catalog, public AS $$
DECLARE e TIMESTAMPTZ := metrics.eod(p_as_of); n NUMERIC; d NUMERIC;
BEGIN
    PERFORM metrics.edition_start(p_record_class, p_edition_id);
    IF p_record_class = 'historical_synthetic' THEN
        RETURN QUERY SELECT * FROM metrics.not_in_2025('M-06', 'Not computable: the 2025 dataset has no payment, invoice or receipt records.', p_record_class, p_edition_id, p_as_of);
        RETURN;
    END IF;
    n := metrics.collected(p_record_class, p_edition_id, e, p_filters);
    SELECT COALESCE(sum(value), 0) INTO d FROM metrics.signed_lines(p_record_class, p_edition_id, e, p_filters) WHERE consideration_type = 'cash';
    RETURN NEXT metrics.mk('M-06', metrics.ratio(n, d), n, d, d > 0, CASE WHEN d = 0 THEN 'No signed cash yet (denominator is zero).' END,
                           metrics.used_filters(p_filters, ARRAY['campaign_id', 'channel_group', 'bet_id']), p_record_class, p_edition_id, p_as_of);
END $$;

CREATE OR REPLACE FUNCTION metrics.m_07(p_record_class TEXT, p_edition_id TEXT, p_as_of DATE, p_filters JSONB DEFAULT '{}')
RETURNS SETOF metrics.metric_result LANGUAGE plpgsql STABLE SET search_path = pg_catalog, public AS $$
DECLARE e TIMESTAMPTZ := metrics.eod(p_as_of); c NUMERIC; s NUMERIC;
BEGIN
    PERFORM metrics.edition_start(p_record_class, p_edition_id);
    IF p_record_class = 'historical_synthetic' THEN
        RETURN QUERY SELECT * FROM metrics.not_in_2025('M-07', 'Not computable: the 2025 dataset has no payment, invoice or receipt records.', p_record_class, p_edition_id, p_as_of);
        RETURN;
    END IF;
    c := metrics.collected(p_record_class, p_edition_id, e, p_filters);
    SELECT COALESCE(sum(value), 0) INTO s FROM metrics.signed_lines(p_record_class, p_edition_id, e, p_filters) WHERE consideration_type = 'cash';
    RETURN NEXT metrics.mk('M-07', s - c, s, c, true, NULL, metrics.used_filters(p_filters, ARRAY['campaign_id', 'channel_group', 'bet_id']), p_record_class, p_edition_id, p_as_of);
END $$;

-- Signed value family (M-02 .. M-05)
CREATE OR REPLACE FUNCTION metrics.signed_split(p_record_class TEXT, p_edition_id TEXT, p_as_of DATE, p_filters JSONB,
                                                OUT total NUMERIC, OUT cash NUMERIC, OUT in_kind NUMERIC)
LANGUAGE plpgsql STABLE SET search_path = pg_catalog, public AS $$
DECLARE e TIMESTAMPTZ := metrics.eod(p_as_of);
BEGIN
    PERFORM metrics.edition_start(p_record_class, p_edition_id);
    SELECT COALESCE(sum(confirmed_value), 0) INTO total
      FROM metrics.opp_state(p_record_class, p_edition_id, e) s
     WHERE s.stage = 'partner_confirmed' AND metrics.campaign_match(s.originating_campaign_id, p_filters);
    IF p_record_class = 'historical_synthetic' THEN
        -- 2025: split by the deal's support_type (AMB-SUPPORT-TYPE-2025)
        SELECT COALESCE(sum(confirmed_value) FILTER (WHERE support_type = 'cash'), 0),
               COALESCE(sum(confirmed_value) FILTER (WHERE support_type = 'in_kind'), 0)
          INTO cash, in_kind
          FROM metrics.opp_state(p_record_class, p_edition_id, e) s
         WHERE s.stage = 'partner_confirmed' AND metrics.campaign_match(s.originating_campaign_id, p_filters);
    ELSE
        -- live / simulated: split by contract line consideration type (INV-02)
        SELECT COALESCE(sum(value) FILTER (WHERE consideration_type = 'cash'), 0),
               COALESCE(sum(value) FILTER (WHERE consideration_type = 'in_kind'), 0)
          INTO cash, in_kind
          FROM metrics.signed_lines(p_record_class, p_edition_id, e, p_filters);
    END IF;
END $$;

CREATE OR REPLACE FUNCTION metrics.m_02(p_record_class TEXT, p_edition_id TEXT, p_as_of DATE, p_filters JSONB DEFAULT '{}')
RETURNS SETOF metrics.metric_result LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $$
    SELECT metrics.mk('M-02', s.total, s.total, NULL, true, NULL, metrics.used_filters(p_filters, ARRAY['campaign_id', 'channel_group', 'bet_id']), p_record_class, p_edition_id, p_as_of)
      FROM metrics.signed_split(p_record_class, p_edition_id, p_as_of, p_filters) s;
$$;
CREATE OR REPLACE FUNCTION metrics.m_03(p_record_class TEXT, p_edition_id TEXT, p_as_of DATE, p_filters JSONB DEFAULT '{}')
RETURNS SETOF metrics.metric_result LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $$
    SELECT metrics.mk('M-03', s.cash, s.cash, NULL, true, NULL, metrics.used_filters(p_filters, ARRAY['campaign_id', 'channel_group', 'bet_id']), p_record_class, p_edition_id, p_as_of)
      FROM metrics.signed_split(p_record_class, p_edition_id, p_as_of, p_filters) s;
$$;
CREATE OR REPLACE FUNCTION metrics.m_04(p_record_class TEXT, p_edition_id TEXT, p_as_of DATE, p_filters JSONB DEFAULT '{}')
RETURNS SETOF metrics.metric_result LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $$
    SELECT metrics.mk('M-04', s.in_kind, s.in_kind, NULL, true, NULL, metrics.used_filters(p_filters, ARRAY['campaign_id', 'channel_group', 'bet_id']), p_record_class, p_edition_id, p_as_of)
      FROM metrics.signed_split(p_record_class, p_edition_id, p_as_of, p_filters) s;
$$;
CREATE OR REPLACE FUNCTION metrics.m_05(p_record_class TEXT, p_edition_id TEXT, p_as_of DATE, p_filters JSONB DEFAULT '{}')
RETURNS SETOF metrics.metric_result LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $$
    SELECT metrics.mk('M-05', metrics.ratio(s.cash, s.total), s.cash, s.total, s.total > 0,
                      CASE WHEN s.total = 0 THEN 'No signed value yet (denominator is zero).' END,
                      metrics.used_filters(p_filters, ARRAY['campaign_id', 'channel_group', 'bet_id']), p_record_class, p_edition_id, p_as_of)
      FROM metrics.signed_split(p_record_class, p_edition_id, p_as_of, p_filters) s;
$$;

-- M-08 cumulative signed value: deals in their CURRENT state that are confirmed and were first confirmed
-- before the end of the as-of day (confirmed-then-withdrawn deals drop out). Pre-season premium
-- campaigns are excluded by default (tracked by M-26).
CREATE OR REPLACE FUNCTION metrics.m_08(p_record_class TEXT, p_edition_id TEXT, p_as_of DATE, p_filters JSONB DEFAULT '{}')
RETURNS SETOF metrics.metric_result LANGUAGE plpgsql STABLE SET search_path = pg_catalog, public AS $$
DECLARE e TIMESTAMPTZ := metrics.eod(p_as_of); v NUMERIC;
BEGIN
    PERFORM metrics.edition_start(p_record_class, p_edition_id);
    SELECT COALESCE(sum(s.confirmed_value), 0) INTO v
      FROM metrics.opp_state(p_record_class, p_edition_id, 'infinity'::timestamptz) s
      JOIN metrics.stage_reached(p_record_class, p_edition_id, e) r
        ON r.opportunity_id = s.opportunity_id AND r.stage = 'partner_confirmed'
      LEFT JOIN public.campaign c ON c.campaign_id = s.originating_campaign_id
      LEFT JOIN public.channel ch ON ch.channel_id = c.channel_id
     WHERE s.stage = 'partner_confirmed'
       AND metrics.campaign_match(s.originating_campaign_id, p_filters)
       AND (p_filters ? 'channel_group' OR ch.channel_group IS DISTINCT FROM 'premium');
    RETURN NEXT metrics.mk('M-08', v, v, NULL, true, NULL, metrics.used_filters(p_filters, ARRAY['campaign_id', 'channel_group', 'bet_id']), p_record_class, p_edition_id, p_as_of);
END $$;

CREATE OR REPLACE FUNCTION metrics.m_09(p_record_class TEXT, p_edition_id TEXT, p_as_of DATE, p_filters JSONB DEFAULT '{}')
RETURNS SETOF metrics.metric_result LANGUAGE plpgsql STABLE SET search_path = pg_catalog, public AS $$
DECLARE v NUMERIC;
BEGIN
    PERFORM metrics.edition_start(p_record_class, p_edition_id);
    SELECT count(*) INTO v FROM metrics.opp_state(p_record_class, p_edition_id, metrics.eod(p_as_of)) s
     WHERE s.stage = 'partner_confirmed' AND metrics.campaign_match(s.originating_campaign_id, p_filters);
    RETURN NEXT metrics.mk('M-09', v, v, NULL, true, NULL, metrics.used_filters(p_filters, ARRAY['campaign_id', 'channel_group', 'bet_id']), p_record_class, p_edition_id, p_as_of);
END $$;

CREATE OR REPLACE FUNCTION metrics.m_10(p_record_class TEXT, p_edition_id TEXT, p_as_of DATE, p_filters JSONB DEFAULT '{}')
RETURNS SETOF metrics.metric_result LANGUAGE plpgsql STABLE SET search_path = pg_catalog, public AS $$
DECLARE v NUMERIC;
BEGIN
    PERFORM metrics.edition_start(p_record_class, p_edition_id);
    SELECT count(*) INTO v FROM metrics.qual_state(p_record_class, p_edition_id, metrics.eod(p_as_of)) q
     WHERE q.status = 'qualified' AND metrics.campaign_match(q.source_campaign_id, p_filters);
    RETURN NEXT metrics.mk('M-10', v, v, NULL, true, NULL, metrics.used_filters(p_filters, ARRAY['campaign_id', 'channel_group', 'bet_id']), p_record_class, p_edition_id, p_as_of);
END $$;

-- Funnel rates (brand level, summed over campaigns as in the 2025 analysis)
CREATE OR REPLACE FUNCTION metrics.m_11(p_record_class TEXT, p_edition_id TEXT, p_as_of DATE, p_filters JSONB DEFAULT '{}')
RETURNS SETOF metrics.metric_result LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $$
    SELECT metrics.mk('M-11', metrics.ratio(sum(f.brands_met), sum(f.brands_touched)), COALESCE(sum(f.brands_met), 0), COALESCE(sum(f.brands_touched), 0),
                      COALESCE(sum(f.brands_touched), 0) > 0, CASE WHEN COALESCE(sum(f.brands_touched), 0) = 0 THEN 'No brands touched yet.' END,
                      metrics.used_filters(p_filters, ARRAY['campaign_id', 'channel_group', 'bet_id']), p_record_class, p_edition_id, p_as_of)
      FROM metrics.campaign_funnel(p_record_class, p_edition_id, metrics.eod(p_as_of), p_filters) f;
$$;

CREATE OR REPLACE FUNCTION metrics.m_12(p_record_class TEXT, p_edition_id TEXT, p_as_of DATE, p_filters JSONB DEFAULT '{}')
RETURNS SETOF metrics.metric_result LANGUAGE plpgsql STABLE SET search_path = pg_catalog, public AS $$
DECLARE e TIMESTAMPTZ := metrics.eod(p_as_of); n NUMERIC; d NUMERIC;
BEGIN
    PERFORM metrics.edition_start(p_record_class, p_edition_id);
    SELECT count(*) INTO n FROM metrics.handoff(p_record_class, p_edition_id, e) h
     WHERE h.n_opps > 0 AND h.first_proposal_at IS NOT NULL AND metrics.campaign_match(h.source_campaign_id, p_filters);
    SELECT COALESCE(sum(brands_met), 0) INTO d FROM metrics.campaign_funnel(p_record_class, p_edition_id, e, p_filters);
    RETURN NEXT metrics.mk('M-12', metrics.ratio(n, d), n, d, d > 0, CASE WHEN d = 0 THEN 'No brands met yet.' END,
                           metrics.used_filters(p_filters, ARRAY['campaign_id', 'channel_group', 'bet_id']), p_record_class, p_edition_id, p_as_of);
END $$;

CREATE OR REPLACE FUNCTION metrics.m_13(p_record_class TEXT, p_edition_id TEXT, p_as_of DATE, p_filters JSONB DEFAULT '{}')
RETURNS SETOF metrics.metric_result LANGUAGE plpgsql STABLE SET search_path = pg_catalog, public AS $$
DECLARE e TIMESTAMPTZ := metrics.eod(p_as_of); n NUMERIC; d NUMERIC;
BEGIN
    PERFORM metrics.edition_start(p_record_class, p_edition_id);
    SELECT count(*), count(*) FILTER (WHERE s.stage = 'partner_confirmed') INTO d, n
      FROM metrics.stage_reached(p_record_class, p_edition_id, e) r
      JOIN metrics.opp_state(p_record_class, p_edition_id, e) s ON s.opportunity_id = r.opportunity_id
     WHERE r.stage = 'proposal_sent' AND metrics.campaign_match(r.originating_campaign_id, p_filters);
    RETURN NEXT metrics.mk('M-13', metrics.ratio(n, d), n, d, d > 0, CASE WHEN d = 0 THEN 'No proposals sent yet.' END,
                           metrics.used_filters(p_filters, ARRAY['campaign_id', 'channel_group', 'bet_id']), p_record_class, p_edition_id, p_as_of);
END $$;

-- M-14 brand win rate, first-touch attribution (mirrors eda.brand_first_touch / brand_outcome)
CREATE OR REPLACE FUNCTION metrics.m_14(p_record_class TEXT, p_edition_id TEXT, p_as_of DATE, p_filters JSONB DEFAULT '{}')
RETURNS SETOF metrics.metric_result LANGUAGE plpgsql STABLE SET search_path = pg_catalog, public AS $$
DECLARE e TIMESTAMPTZ := metrics.eod(p_as_of); n NUMERIC; d NUMERIC;
BEGIN
    PERFORM metrics.edition_start(p_record_class, p_edition_id);
    WITH ft AS (
        SELECT DISTINCT ON (a.sponsor_id) a.sponsor_id, a.campaign_id
          FROM metrics.attempts(p_record_class, p_edition_id, e) a
         ORDER BY a.sponsor_id, a.started_at, a.attempt_id
    ), won AS (
        SELECT DISTINCT s.sponsor_id FROM metrics.opp_state(p_record_class, p_edition_id, e) s WHERE s.stage = 'partner_confirmed'
    )
    SELECT count(*), count(w.sponsor_id) INTO d, n
      FROM ft LEFT JOIN won w ON w.sponsor_id = ft.sponsor_id
     WHERE metrics.campaign_match(ft.campaign_id, p_filters);
    RETURN NEXT metrics.mk('M-14', metrics.ratio(n, d), n, d, d > 0, CASE WHEN d = 0 THEN 'No brands touched yet.' END,
                           metrics.used_filters(p_filters, ARRAY['campaign_id', 'channel_group', 'bet_id']) || '{"attribution":"first_touch"}'::jsonb,
                           p_record_class, p_edition_id, p_as_of);
END $$;

CREATE OR REPLACE FUNCTION metrics.m_15(p_record_class TEXT, p_edition_id TEXT, p_as_of DATE, p_filters JSONB DEFAULT '{}')
RETURNS SETOF metrics.metric_result LANGUAGE plpgsql STABLE SET search_path = pg_catalog, public AS $$
DECLARE n NUMERIC; d NUMERIC;
BEGIN
    PERFORM metrics.edition_start(p_record_class, p_edition_id);
    SELECT COALESCE(sum(s.confirmed_value), 0), count(*) INTO n, d FROM metrics.opp_state(p_record_class, p_edition_id, metrics.eod(p_as_of)) s
     WHERE s.stage = 'partner_confirmed' AND metrics.campaign_match(s.originating_campaign_id, p_filters);
    RETURN NEXT metrics.mk('M-15', metrics.ratio(n, d), n, d, d > 0, CASE WHEN d = 0 THEN 'No confirmed deals yet.' END,
                           metrics.used_filters(p_filters, ARRAY['campaign_id', 'channel_group', 'bet_id']), p_record_class, p_edition_id, p_as_of);
END $$;

CREATE OR REPLACE FUNCTION metrics.m_16(p_record_class TEXT, p_edition_id TEXT, p_as_of DATE, p_filters JSONB DEFAULT '{}')
RETURNS SETOF metrics.metric_result LANGUAGE plpgsql STABLE SET search_path = pg_catalog, public AS $$
DECLARE v NUMERIC; d NUMERIC;
BEGIN
    PERFORM metrics.edition_start(p_record_class, p_edition_id);
    SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY s.confirmed_value), count(*) INTO v, d
      FROM metrics.opp_state(p_record_class, p_edition_id, metrics.eod(p_as_of)) s
     WHERE s.stage = 'partner_confirmed' AND metrics.campaign_match(s.originating_campaign_id, p_filters);
    RETURN NEXT metrics.mk('M-16', v, NULL, d, d > 0, CASE WHEN d = 0 THEN 'No confirmed deals yet.' END,
                           metrics.used_filters(p_filters, ARRAY['campaign_id', 'channel_group', 'bet_id']), p_record_class, p_edition_id, p_as_of);
END $$;

-- Handoff family (M-17 .. M-19): warm + inbound unless a channel_group or campaign is given.
CREATE OR REPLACE FUNCTION metrics.handoff_rate(p_metric_id TEXT, p_record_class TEXT, p_edition_id TEXT, p_as_of DATE, p_filters JSONB)
RETURNS SETOF metrics.metric_result LANGUAGE plpgsql STABLE SET search_path = pg_catalog, public AS $$
DECLARE n NUMERIC; d NUMERIC; applied JSONB;
BEGIN
    PERFORM metrics.edition_start(p_record_class, p_edition_id);
    SELECT count(*),
           count(*) FILTER (WHERE CASE p_metric_id
                WHEN 'M-17' THEN h.n_opps = 0
                WHEN 'M-18' THEN h.first_opp_created_at IS NOT NULL
                                 AND metrics.ist_date(h.first_opp_created_at) - metrics.ist_date(h.first_qualified_at) <= 5
                WHEN 'M-19' THEN h.first_proposal_at IS NOT NULL
                                 AND metrics.ist_date(h.first_proposal_at) - metrics.ist_date(h.first_qualified_at) <= 10
           END)
      INTO d, n
      FROM metrics.handoff(p_record_class, p_edition_id, metrics.eod(p_as_of)) h
     WHERE metrics.campaign_match(h.source_campaign_id, p_filters, true);
    applied := metrics.used_filters(p_filters, ARRAY['campaign_id', 'channel_group', 'bet_id']);
    IF NOT (COALESCE(p_filters, '{}'::jsonb) ?| ARRAY['campaign_id', 'channel_group']) THEN
        applied := applied || '{"channel_group":"warm+inbound (default)"}'::jsonb;
    END IF;
    RETURN NEXT metrics.mk(p_metric_id, metrics.ratio(n, d), n, d, d > 0, CASE WHEN d = 0 THEN 'No qualified brands yet.' END,
                           applied, p_record_class, p_edition_id, p_as_of);
END $$;

CREATE OR REPLACE FUNCTION metrics.m_17(p_record_class TEXT, p_edition_id TEXT, p_as_of DATE, p_filters JSONB DEFAULT '{}')
RETURNS SETOF metrics.metric_result LANGUAGE sql STABLE AS $$ SELECT * FROM metrics.handoff_rate('M-17', p_record_class, p_edition_id, p_as_of, p_filters) $$;
CREATE OR REPLACE FUNCTION metrics.m_18(p_record_class TEXT, p_edition_id TEXT, p_as_of DATE, p_filters JSONB DEFAULT '{}')
RETURNS SETOF metrics.metric_result LANGUAGE sql STABLE AS $$ SELECT * FROM metrics.handoff_rate('M-18', p_record_class, p_edition_id, p_as_of, p_filters) $$;
CREATE OR REPLACE FUNCTION metrics.m_19(p_record_class TEXT, p_edition_id TEXT, p_as_of DATE, p_filters JSONB DEFAULT '{}')
RETURNS SETOF metrics.metric_result LANGUAGE sql STABLE AS $$ SELECT * FROM metrics.handoff_rate('M-19', p_record_class, p_edition_id, p_as_of, p_filters) $$;

-- M-20 days from creation to first confirmation, won deals in their current state
CREATE OR REPLACE FUNCTION metrics.m_20(p_record_class TEXT, p_edition_id TEXT, p_as_of DATE, p_filters JSONB DEFAULT '{}')
RETURNS SETOF metrics.metric_result LANGUAGE plpgsql STABLE SET search_path = pg_catalog, public AS $$
DECLARE e TIMESTAMPTZ := metrics.eod(p_as_of); n NUMERIC; d NUMERIC;
BEGIN
    PERFORM metrics.edition_start(p_record_class, p_edition_id);
    SELECT sum(metrics.ist_date(r.first_reached_at) - metrics.ist_date(s.created_at)), count(*) INTO n, d
      FROM metrics.opp_state(p_record_class, p_edition_id, e) s
      JOIN metrics.stage_reached(p_record_class, p_edition_id, e) r ON r.opportunity_id = s.opportunity_id AND r.stage = 'partner_confirmed'
     WHERE s.stage = 'partner_confirmed' AND metrics.campaign_match(s.originating_campaign_id, p_filters);
    RETURN NEXT metrics.mk('M-20', metrics.ratio(n, d), n, d, d > 0, CASE WHEN d = 0 THEN 'No confirmed deals yet.' END,
                           metrics.used_filters(p_filters, ARRAY['campaign_id', 'channel_group', 'bet_id']), p_record_class, p_edition_id, p_as_of);
END $$;

CREATE OR REPLACE FUNCTION metrics.m_21(p_record_class TEXT, p_edition_id TEXT, p_as_of DATE, p_filters JSONB DEFAULT '{}')
RETURNS SETOF metrics.metric_result LANGUAGE plpgsql STABLE SET search_path = pg_catalog, public AS $$
DECLARE v NUMERIC;
BEGIN
    PERFORM metrics.edition_start(p_record_class, p_edition_id);
    SELECT COALESCE(sum(s.proposed_value), 0) INTO v FROM metrics.opp_state(p_record_class, p_edition_id, metrics.eod(p_as_of)) s
     WHERE s.stage_class = 'open' AND metrics.campaign_match(s.originating_campaign_id, p_filters);
    RETURN NEXT metrics.mk('M-21', v, v, NULL, true, NULL, metrics.used_filters(p_filters, ARRAY['campaign_id', 'channel_group', 'bet_id']), p_record_class, p_edition_id, p_as_of);
END $$;

-- M-22 cold share of all attempts (incl. after the festival)
CREATE OR REPLACE FUNCTION metrics.m_22(p_record_class TEXT, p_edition_id TEXT, p_as_of DATE, p_filters JSONB DEFAULT '{}')
RETURNS SETOF metrics.metric_result LANGUAGE plpgsql STABLE SET search_path = pg_catalog, public AS $$
DECLARE n NUMERIC; d NUMERIC;
BEGIN
    PERFORM metrics.edition_start(p_record_class, p_edition_id);
    SELECT count(*) FILTER (WHERE ch.channel_group = 'cold'), count(*) INTO n, d
      FROM metrics.attempts(p_record_class, p_edition_id, metrics.eod(p_as_of)) a
      JOIN public.campaign c ON c.campaign_id = a.campaign_id
      JOIN public.channel ch ON ch.channel_id = c.channel_id
     WHERE (p_filters->>'bet_id' IS NULL OR c.bet_id = p_filters->>'bet_id');
    RETURN NEXT metrics.mk('M-22', metrics.ratio(n, d), n, d, d > 0, CASE WHEN d = 0 THEN 'No outreach attempts yet.' END,
                           metrics.used_filters(p_filters, ARRAY['bet_id']), p_record_class, p_edition_id, p_as_of);
END $$;

CREATE OR REPLACE FUNCTION metrics.m_23(p_record_class TEXT, p_edition_id TEXT, p_as_of DATE, p_filters JSONB DEFAULT '{}')
RETURNS SETOF metrics.metric_result LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $$
    SELECT metrics.mk('M-23', metrics.ratio(sum(f.brands_responded), sum(f.brands_touched)), COALESCE(sum(f.brands_responded), 0), COALESCE(sum(f.brands_touched), 0),
                      COALESCE(sum(f.brands_touched), 0) > 0, CASE WHEN COALESCE(sum(f.brands_touched), 0) = 0 THEN 'No brands touched yet.' END,
                      metrics.used_filters(p_filters, ARRAY['campaign_id', 'channel_group', 'bet_id']), p_record_class, p_edition_id, p_as_of)
      FROM metrics.campaign_funnel(p_record_class, p_edition_id, metrics.eod(p_as_of), p_filters) f;
$$;

-- M-24 confirmed partnerships (ever reached by D) vs the confirmed-partnerships goal in force at D
CREATE OR REPLACE FUNCTION metrics.m_24(p_record_class TEXT, p_edition_id TEXT, p_as_of DATE, p_filters JSONB DEFAULT '{}')
RETURNS SETOF metrics.metric_result LANGUAGE plpgsql STABLE SET search_path = pg_catalog, public AS $$
DECLARE e TIMESTAMPTZ := metrics.eod(p_as_of); n NUMERIC; d NUMERIC;
BEGIN
    PERFORM metrics.edition_start(p_record_class, p_edition_id);
    SELECT target_value INTO d FROM public.target_version
     WHERE edition_id = p_edition_id AND kpi_id = 'K-H-02' AND valid_from < e AND NOT is_deleted
     ORDER BY valid_from DESC LIMIT 1;
    IF d IS NULL THEN
        RETURN NEXT metrics.mk('M-24', NULL, NULL, NULL, false, 'No confirmed-partnerships goal is set for this edition (D-010 targets cash and signed value instead).',
                               '{}'::jsonb, p_record_class, p_edition_id, p_as_of);
        RETURN;
    END IF;
    SELECT count(*) INTO n FROM metrics.stage_reached(p_record_class, p_edition_id, e) r
     WHERE r.stage = 'partner_confirmed' AND metrics.campaign_match(r.originating_campaign_id, p_filters);
    RETURN NEXT metrics.mk('M-24', metrics.ratio(n, d), n, d, true, NULL, metrics.used_filters(p_filters, ARRAY['campaign_id', 'channel_group', 'bet_id']), p_record_class, p_edition_id, p_as_of);
END $$;

-- M-25 advance paid within 7 days of signing (cash contracts)
CREATE OR REPLACE FUNCTION metrics.m_25(p_record_class TEXT, p_edition_id TEXT, p_as_of DATE, p_filters JSONB DEFAULT '{}')
RETURNS SETOF metrics.metric_result LANGUAGE plpgsql STABLE SET search_path = pg_catalog, public AS $$
DECLARE e TIMESTAMPTZ := metrics.eod(p_as_of); n NUMERIC; d NUMERIC;
BEGIN
    PERFORM metrics.edition_start(p_record_class, p_edition_id);
    IF p_record_class = 'historical_synthetic' THEN
        RETURN QUERY SELECT * FROM metrics.not_in_2025('M-25', 'Not computable: the 2025 dataset has no payment, invoice or receipt records.', p_record_class, p_edition_id, p_as_of);
        RETURN;
    END IF;
    WITH k AS (
        SELECT c.contract_id, c.signed_at
          FROM public.contract c JOIN public.opportunity o ON o.opportunity_id = c.opportunity_id
         WHERE o.edition_id = p_edition_id AND c.record_class = p_record_class AND c.status = 'active' AND c.valid_to IS NULL
           AND NOT c.is_deleted AND c.signed_at < e AND metrics.campaign_match(o.originating_campaign_id, p_filters)
           AND EXISTS (SELECT 1 FROM public.contract_line cl WHERE cl.contract_id = c.contract_id AND cl.consideration_type = 'cash' AND NOT cl.is_deleted)
    )
    SELECT count(*),
           count(*) FILTER (WHERE EXISTS (
               SELECT 1 FROM public.receipt_allocation ra
                 JOIN public.receipt r ON r.receipt_id = ra.receipt_id AND r.reconciled AND r.reconciled_at < e
                 JOIN public.payment_schedule_item psi ON psi.schedule_item_id = ra.schedule_item_id
                WHERE psi.contract_id = k.contract_id AND psi.kind = 'advance' AND NOT ra.is_deleted
                  AND r.received_at <= k.signed_at + interval '7 days'))
      INTO d, n FROM k;
    RETURN NEXT metrics.mk('M-25', metrics.ratio(n, d), n, d, d > 0, CASE WHEN d = 0 THEN 'No signed cash contracts yet.' END,
                           metrics.used_filters(p_filters, ARRAY['campaign_id', 'channel_group', 'bet_id']), p_record_class, p_edition_id, p_as_of);
END $$;

-- M-26 premium value signed before W1 (season_start)
CREATE OR REPLACE FUNCTION metrics.m_26(p_record_class TEXT, p_edition_id TEXT, p_as_of DATE, p_filters JSONB DEFAULT '{}')
RETURNS SETOF metrics.metric_result LANGUAGE plpgsql STABLE SET search_path = pg_catalog, public AS $$
DECLARE e TIMESTAMPTZ := metrics.eod(p_as_of); v NUMERIC; w1 DATE;
BEGIN
    PERFORM metrics.edition_start(p_record_class, p_edition_id);
    IF p_record_class = 'historical_synthetic' THEN
        RETURN QUERY SELECT * FROM metrics.not_in_2025('M-26', 'Not computable: the 2025 dataset has no inventory or asset sales.', p_record_class, p_edition_id, p_as_of);
        RETURN;
    END IF;
    SELECT season_start INTO w1 FROM public.festival_edition WHERE edition_id = p_edition_id;
    SELECT COALESCE(sum(cl.value), 0) INTO v
      FROM public.contract c
      JOIN public.opportunity o ON o.opportunity_id = c.opportunity_id
      JOIN public.contract_line cl ON cl.contract_id = c.contract_id AND NOT cl.is_deleted
      JOIN public.inventory_asset ia ON ia.asset_id = cl.asset_id AND ia.is_premium
     WHERE o.edition_id = p_edition_id AND c.record_class = p_record_class AND c.status = 'active' AND c.valid_to IS NULL
       AND NOT c.is_deleted AND c.signed_at < LEAST(e, (w1::timestamp AT TIME ZONE 'Asia/Kolkata'));
    RETURN NEXT metrics.mk('M-26', v, v, NULL, w1 IS NOT NULL, CASE WHEN w1 IS NULL THEN 'Edition has no season start (W1) date.' END,
                           '{}'::jsonb, p_record_class, p_edition_id, p_as_of);
END $$;

-- M-27 logged hours on completed tasks ÷ model hours for those tasks (AS-19; mapping is a proposed default)
CREATE OR REPLACE FUNCTION metrics.m_27(p_record_class TEXT, p_edition_id TEXT, p_as_of DATE, p_filters JSONB DEFAULT '{}')
RETURNS SETOF metrics.metric_result LANGUAGE plpgsql STABLE SET search_path = pg_catalog, public AS $$
DECLARE e TIMESTAMPTZ := metrics.eod(p_as_of); n NUMERIC; d NUMERIC;
BEGIN
    PERFORM metrics.edition_start(p_record_class, p_edition_id);
    IF p_record_class = 'historical_synthetic' THEN
        RETURN QUERY SELECT * FROM metrics.not_in_2025('M-27', 'Not computable: the 2025 dataset has no hours or staffing data.', p_record_class, p_edition_id, p_as_of);
        RETURN;
    END IF;
    WITH done AS (
        SELECT t.task_id, mh.model_hours
          FROM public.task t
          JOIN public.team_member tm ON tm.member_id = t.owner_member_id
          JOIN public.role_assignment ra ON ra.member_id = tm.member_id AND ra.edition_id = p_edition_id AND ra.is_current
          JOIN metrics.task_model_hours mh ON mh.task_type = t.task_type AND mh.model_hours IS NOT NULL
         WHERE t.record_class = p_record_class AND t.status = 'done' AND t.completed_at < e AND NOT t.is_deleted
           AND (p_filters->>'bet_id' IS NULL OR t.bet_id = p_filters->>'bet_id')
         GROUP BY t.task_id, mh.model_hours
    )
    SELECT (SELECT COALESCE(sum(tl.hours), 0) FROM public.time_log tl JOIN done ON done.task_id = tl.task_id WHERE NOT tl.is_deleted AND tl.work_date < p_as_of + 1),
           COALESCE(sum(model_hours), 0)
      INTO n, d FROM done;
    RETURN NEXT metrics.mk('M-27', metrics.ratio(n, d), n, d, d > 0, CASE WHEN d = 0 THEN 'No completed tasks with logged hours yet.' END,
                           metrics.used_filters(p_filters, ARRAY['bet_id']), p_record_class, p_edition_id, p_as_of);
END $$;

-- M-28 interested past sponsors: past sponsors with a renewal opportunity opened by D (K-B4a-02)
CREATE OR REPLACE FUNCTION metrics.m_28(p_record_class TEXT, p_edition_id TEXT, p_as_of DATE, p_filters JSONB DEFAULT '{}')
RETURNS SETOF metrics.metric_result LANGUAGE plpgsql STABLE SET search_path = pg_catalog, public AS $$
DECLARE v NUMERIC;
BEGIN
    PERFORM metrics.edition_start(p_record_class, p_edition_id);
    IF p_record_class = 'historical_synthetic' THEN
        RETURN QUERY SELECT * FROM metrics.not_in_2025('M-28', 'Not computable: renewals are a 2026 activity; the 2025 dataset has none.', p_record_class, p_edition_id, p_as_of);
        RETURN;
    END IF;
    SELECT count(DISTINCT s.sponsor_id) INTO v FROM metrics.opp_state(p_record_class, p_edition_id, metrics.eod(p_as_of)) s WHERE s.is_renewal;
    RETURN NEXT metrics.mk('M-28', v, v, NULL, true, NULL, '{}'::jsonb, p_record_class, p_edition_id, p_as_of);
END $$;

-- M-29 committed introductions from VC funds and alumni (B3, K-B3-02): current referral version committed or met, as of D
CREATE OR REPLACE FUNCTION metrics.m_29(p_record_class TEXT, p_edition_id TEXT, p_as_of DATE, p_filters JSONB DEFAULT '{}')
RETURNS SETOF metrics.metric_result LANGUAGE plpgsql STABLE SET search_path = pg_catalog, public AS $$
DECLARE e TIMESTAMPTZ := metrics.eod(p_as_of); v NUMERIC;
BEGIN
    PERFORM metrics.edition_start(p_record_class, p_edition_id);
    IF p_record_class = 'historical_synthetic' THEN
        RETURN QUERY SELECT * FROM metrics.not_in_2025('M-29', 'Not computable: the 2025 dataset records no committed introductions.', p_record_class, p_edition_id, p_as_of);
        RETURN;
    END IF;
    SELECT count(*) INTO v
      FROM public.referral rf
      JOIN public.campaign c ON c.campaign_id = rf.campaign_id AND c.edition_id = p_edition_id
      JOIN public.network_partner np ON np.partner_id = rf.partner_id AND np.partner_type IN ('vc_fund', 'alumnus')
     WHERE rf.record_class = p_record_class AND NOT rf.is_deleted
       AND rf.valid_from < e AND (rf.valid_to IS NULL OR rf.valid_to >= e)
       AND rf.commitment_status IN ('committed', 'met')
       AND metrics.campaign_match(rf.campaign_id, p_filters);
    RETURN NEXT metrics.mk('M-29', v, v, NULL, true, NULL, metrics.used_filters(p_filters, ARRAY['campaign_id', 'channel_group', 'bet_id']), p_record_class, p_edition_id, p_as_of);
END $$;

-- M-30 approved scenario expected cash (lookup, never recomputed). One row per scenario.
CREATE OR REPLACE FUNCTION metrics.m_30(p_record_class TEXT, p_edition_id TEXT, p_as_of DATE, p_filters JSONB DEFAULT '{}')
RETURNS SETOF metrics.metric_result LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $$
    SELECT metrics.mk('M-30', sr.expected_cash, NULL, NULL, true, sr.name || ' · ' || sr.status_label, metrics.used_filters(p_filters, ARRAY['scenario_id']),
                      'model_output', p_edition_id, p_as_of, sr.scenario_id)
      FROM public.scenario_reference sr
     WHERE sr.scenario_id IN ('SC-01', 'SC-02', 'SC-03') AND NOT sr.is_deleted
       AND (p_filters->>'scenario_id' IS NULL OR sr.scenario_id = p_filters->>'scenario_id')
     ORDER BY sr.scenario_id;
$$;

-- ---------------------------------------------------------------------------
-- 3. Dispatcher (single entry point for the API and the AI tool)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION metrics.get_metric(p_metric_id TEXT, p_record_class TEXT, p_edition_id TEXT, p_as_of DATE, p_filters JSONB DEFAULT '{}')
RETURNS SETOF metrics.metric_result LANGUAGE plpgsql STABLE SET search_path = pg_catalog, public AS $$
BEGIN
    IF p_metric_id !~ '^M-(0[1-9]|[12][0-9]|30)$' THEN
        RAISE EXCEPTION 'Unknown metric %', p_metric_id USING ERRCODE = '22023';
    END IF;
    IF p_filters IS NOT NULL AND EXISTS (SELECT 1 FROM jsonb_object_keys(p_filters) k
                                          WHERE k NOT IN ('campaign_id', 'channel_group', 'bet_id', 'scenario_id')) THEN
        RAISE EXCEPTION 'Unsupported filter key. Allowed: campaign_id, channel_group, bet_id, scenario_id' USING ERRCODE = '22023';
    END IF;
    RETURN QUERY EXECUTE format('SELECT * FROM metrics.%I($1, $2, $3, $4)', 'm_' || substr(p_metric_id, 3))
        USING p_record_class, p_edition_id, p_as_of, COALESCE(p_filters, '{}'::jsonb);
END $$;

-- ---------------------------------------------------------------------------
-- 4. 2025 parity test (acceptance test A1). Expected values = metric_dictionary example_value_2025.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION metrics.parity_2025()
RETURNS TABLE (metric_id TEXT, filters JSONB, as_of DATE, expected NUMERIC, actual NUMERIC, decimals INT,
               computable BOOLEAN, passed BOOLEAN, note TEXT)
LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $$
    WITH cases(metric_id, filters, as_of, decimals) AS (VALUES
        ('M-02', '{}'::jsonb, DATE '2025-04-20', 0), ('M-03', '{}', DATE '2025-04-20', 0), ('M-04', '{}', DATE '2025-04-20', 0),
        ('M-05', '{}', DATE '2025-04-20', 4), ('M-08', '{}', DATE '2025-03-15', 0), ('M-09', '{}', DATE '2025-04-20', 0),
        ('M-10', '{}', DATE '2025-04-20', 0), ('M-11', '{"campaign_id":"SC05"}', DATE '2025-04-20', 3),
        ('M-12', '{"campaign_id":"SC05"}', DATE '2025-04-20', 3), ('M-13', '{"channel_group":"cold"}', DATE '2025-04-20', 3),
        ('M-14', '{"channel_group":"warm"}', DATE '2025-04-20', 3), ('M-15', '{}', DATE '2025-04-20', 0),
        ('M-16', '{}', DATE '2025-04-20', 0), ('M-17', '{}', DATE '2025-04-20', 3), ('M-18', '{}', DATE '2025-04-20', 3),
        ('M-19', '{}', DATE '2025-04-20', 3), ('M-20', '{}', DATE '2025-04-20', 1), ('M-21', '{}', DATE '2025-04-20', 0),
        ('M-22', '{}', DATE '2025-04-20', 3), ('M-23', '{"campaign_id":"SC03"}', DATE '2025-04-20', 3),
        ('M-24', '{}', DATE '2025-03-15', 3),
        ('M-01', '{}', DATE '2025-04-20', NULL), ('M-06', '{}', DATE '2025-04-20', NULL), ('M-07', '{}', DATE '2025-04-20', NULL),
        ('M-25', '{}', DATE '2025-04-20', NULL), ('M-26', '{}', DATE '2025-04-20', NULL), ('M-27', '{}', DATE '2025-04-20', NULL),
        ('M-28', '{}', DATE '2025-04-20', NULL), ('M-29', '{}', DATE '2025-04-20', NULL)
    ), res AS (
        SELECT c.*, md.example_value_2025 AS expected, r.value AS actual, r.computable
          FROM cases c
          JOIN public.metric_definition md ON md.metric_id = c.metric_id
          CROSS JOIN LATERAL metrics.get_metric(c.metric_id, 'historical_synthetic', 'ED-2025', c.as_of, c.filters) r
    )
    SELECT metric_id, filters, as_of, expected, actual, decimals, computable,
           CASE WHEN decimals IS NULL THEN computable = false
                ELSE computable AND round(actual, decimals) = round(expected, decimals) END,
           CASE WHEN decimals IS NULL THEN 'must be not computable on 2025 data' ELSE 'rounded to ' || decimals || ' dp' END
      FROM res
    UNION ALL
    SELECT 'M-30', jsonb_build_object('scenario_id', r.series_key), NULL, x.expected, r.value, 2, r.computable,
           r.value = x.expected, 'approved scenario lookup (D-009)'
      FROM metrics.get_metric('M-30', 'historical_synthetic', 'ED-2025', DATE '2025-04-20', '{}') r
      JOIN (VALUES ('SC-01', 21.23), ('SC-02', 26.10), ('SC-03', 28.64)) x(scenario_id, expected) ON x.scenario_id = r.series_key
     ORDER BY 1;
$$;

-- ---------------------------------------------------------------------------
-- 5. Privileges: app_service may execute metric functions and read the hours mapping.
-- ---------------------------------------------------------------------------
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA metrics FROM PUBLIC;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA metrics TO app_service;
GRANT SELECT ON metrics.task_model_hours TO app_service;

COMMIT;
