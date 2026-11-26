-- ============================================================================
-- Sponsorship Growth Platform — Stage 1B Roles, Grants, RLS & Finance RPCs
-- File: db/02_roles_grants.sql
-- Target: Supabase PostgreSQL (PostgreSQL 15+), executed AFTER db/01_schema.sql
--
-- SECURITY MODEL:
--   1. Dedicated restricted application login role: app_service
--   2. Zero DELETE privileges on any table or view for any app role.
--   3. Direct PostgREST / browser access (anon, authenticated, PUBLIC) revoked
--      on schemas public and metrics, with RLS enabled on all base tables.
--   4. Read-only reference tables & app_state are SELECT-only for app_service.
--   5. Append-only logs and history tables forbid UPDATE/DELETE.
--   6. Financial tables (payment_schedule_item, invoice, receipt,
--      receipt_allocation) have NO direct INSERT/UPDATE/DELETE grants to
--      app_service; all writes go exclusively through SECURITY DEFINER functions
--      that verify the caller holds canonical role 'finance_collections'.
--
-- r2 (26 Nov 2026, technical-lead review): fixes D1-D3, D8, D10-D12 and OD-15/OD-16 defaults.
--   7. Identity: the server binds the verified user once per transaction with
--      set_config('app.actor_member_id', ..., true) and set_config('app.actor_auth_uid', ..., true).
--      fn_current_actor() checks that pair against team_member.auth_user_id. No function
--      accepts an actor ID as a parameter.
--
-- PASSWORD: this file sets NO password. After running it, run separately in the
-- SQL Editor (do not save the query):  ALTER ROLE app_service WITH PASSWORD '<generated>';
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. CREATE RESTRICTED APPLICATION ROLE (app_service)
-- ============================================================================

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_service') THEN
        CREATE ROLE app_service
            WITH LOGIN
            NOSUPERUSER
            NOCREATEDB
            NOCREATEROLE
            NOINHERIT
            NOREPLICATION
            CONNECTION LIMIT 25;
    END IF;
END
$$;

-- ============================================================================
-- 2. LOCK DOWN PUBLIC / SUPABASE anon & authenticated ROLES
-- ============================================================================

REVOKE ALL ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON SCHEMA metrics FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA metrics FROM PUBLIC;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        REVOKE ALL ON SCHEMA public FROM anon;
        REVOKE ALL ON SCHEMA metrics FROM anon;
        REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
        REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
        REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon;
        REVOKE ALL ON ALL FUNCTIONS IN SCHEMA metrics FROM anon;
    END IF;

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        REVOKE ALL ON SCHEMA public FROM authenticated;
        REVOKE ALL ON SCHEMA metrics FROM authenticated;
        REVOKE ALL ON ALL TABLES IN SCHEMA public FROM authenticated;
        REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM authenticated;
        REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM authenticated;
        REVOKE ALL ON ALL FUNCTIONS IN SCHEMA metrics FROM authenticated;
    END IF;
END
$$;

-- r2/D8: objects the owner creates later (Stage 2 metric functions, new tables) must not
-- inherit Supabase's default grants to anon/authenticated/service_role, nor PUBLIC EXECUTE.
-- Schema-level revokes cannot remove the global PUBLIC EXECUTE default, hence the global line.
DO $$
DECLARE v_role TEXT;
BEGIN
    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role']
    LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_role) THEN
            EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %I', v_role);
            EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I', v_role);
            EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM %I', v_role);
            EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA metrics REVOKE ALL ON TABLES FROM %I', v_role);
            EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA metrics REVOKE ALL ON FUNCTIONS FROM %I', v_role);
        END IF;
    END LOOP;
END
$$;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- ============================================================================
-- 3. GRANT SCHEMA & TABLE PRIVILEGES TO app_service
-- ============================================================================

GRANT USAGE ON SCHEMA public TO app_service;
GRANT USAGE ON SCHEMA metrics TO app_service;

-- Clear any prior grants on public tables before applying least-privilege grants.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM app_service;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM app_service;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM app_service;

-- 3.1 Read-only Reference, Research & System State Tables (SELECT ONLY)
GRANT SELECT ON
    public.app_state,
    public.decision_record,
    public.source_register,
    public.benchmark,
    public.festival_edition,
    public.category,
    public.channel,
    public.bet,
    public.metric_definition,
    public.kpi_definition,
    public.scenario_reference,
    public.threshold_rule,
    public.experiment,
    public.model_assumption,
    public.target_version,
    public.knowledge_chunk,
    public.prospect_research,
    public.inventory_asset,
    public.price_list_entry,
    public.package,
    public.package_item,
    public.forecast_version,
    public.kpi_actual,
    public.role_assignment,
    public.team_member
TO app_service;

-- r2/D2: team_member identity columns (member_id, auth_user_id, record_class) and
-- role_assignment change only through the admin functions in section 5A.
GRANT UPDATE (full_name, email, fte_share, active_from, active_to, is_active, updated_at)
    ON public.team_member TO app_service;

-- 3.2 Derived Financial Views (SELECT ONLY)
GRANT SELECT ON
    public.balance_view,
    public.payment_schedule_item_status_view
TO app_service;

-- 3.3 Finance-Restricted Tables (SELECT ONLY — writes exclusively via SECURITY DEFINER RPCs)
GRANT SELECT ON
    public.payment_schedule_item,
    public.invoice,
    public.receipt,
    public.receipt_allocation
TO app_service;

-- 3.4 Strictly Append-Only Operational & Audit/AI Log Tables (SELECT + INSERT ONLY; NO UPDATE, NO DELETE)
GRANT SELECT, INSERT ON
    public.import_batch,
    public.outreach_attempt,
    public.interaction,
    public.qualification_version,
    public.opportunity_stage_version,
    public.experiment_result,
    public.ai_message,
    public.ai_query_log,
    public.audit_event
TO app_service;

-- 3.5 Full-State Versioned & Controlled-Transition Tables
-- INSERT new versions + narrow UPDATE ONLY to close superseded version windows / action status (NO DELETE).
GRANT SELECT, INSERT ON
    public.ownership_assignment,
    public.referral,
    public.staffing_allocation,
    public.ai_action
TO app_service;

GRANT UPDATE (valid_to, superseded_by, is_deleted) ON
    public.ownership_assignment,
    public.referral,
    public.staffing_allocation
TO app_service;

GRANT UPDATE (status, confirmed_by, confirmed_at, executed_at) ON
    public.ai_action
TO app_service;

-- 3.6 Mutable Operational Tables (SELECT + INSERT + UPDATE; NO DELETE anywhere)
GRANT SELECT, INSERT, UPDATE ON
    public.sponsor,
    public.contact,
    public.network_partner,
    public.campaign,
    public.opportunity,
    public.meeting,
    public.proposal,
    public.contract,
    public.contract_line,
    public.asset_slot,
    public.exclusivity_grant,
    public.contract_deliverable,
    public.in_kind_contribution,
    public.expense,
    public.task,
    public.task_dependency,
    public.escalation,
    public.time_log,
    public.ai_conversation
TO app_service;

-- ============================================================================
-- 4. ROW-LEVEL SECURITY (DEFENSE IN DEPTH AGAINST DIRECT POSTGREST ACCESS)
-- ============================================================================
-- Enabling RLS with policies scoped strictly TO app_service ensures anon and
-- authenticated browser clients receive zero rows even if PostgREST grants change.

DO $$
DECLARE
    v_tbl TEXT;
    v_read_only TEXT[] := ARRAY[
        'app_state', 'decision_record', 'source_register', 'benchmark',
        'festival_edition', 'category', 'channel', 'bet',
        'metric_definition', 'kpi_definition', 'scenario_reference',
        'threshold_rule', 'experiment', 'model_assumption', 'target_version',
        'knowledge_chunk', 'prospect_research', 'inventory_asset',
        'price_list_entry', 'package', 'package_item',
        'payment_schedule_item', 'invoice', 'receipt', 'receipt_allocation',
        'forecast_version', 'kpi_actual', 'role_assignment'
    ];
    v_append_only TEXT[] := ARRAY[
        'import_batch', 'outreach_attempt', 'interaction',
        'qualification_version', 'opportunity_stage_version',
        'experiment_result', 'ai_message',
        'ai_query_log', 'audit_event'
    ];
    v_mutable_or_versioned TEXT[] := ARRAY[
        'team_member', 'sponsor', 'contact', 'network_partner', 'campaign',
        'referral', 'ownership_assignment', 'opportunity', 'meeting',
        'proposal', 'contract', 'contract_line', 'asset_slot',
        'exclusivity_grant', 'contract_deliverable', 'in_kind_contribution',
        'expense', 'task', 'task_dependency', 'escalation', 'time_log',
        'staffing_allocation', 'ai_conversation', 'ai_action'
    ];
BEGIN
    FOREACH v_tbl IN ARRAY v_read_only
    LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', v_tbl);
        EXECUTE format('DROP POLICY IF EXISTS p_app_service_select ON public.%I;', v_tbl);
        EXECUTE format(
            'CREATE POLICY p_app_service_select ON public.%I FOR SELECT TO app_service USING (true);',
            v_tbl
        );
    END LOOP;

    FOREACH v_tbl IN ARRAY v_append_only
    LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', v_tbl);
        EXECUTE format('DROP POLICY IF EXISTS p_app_service_select ON public.%I;', v_tbl);
        EXECUTE format('DROP POLICY IF EXISTS p_app_service_insert ON public.%I;', v_tbl);
        EXECUTE format(
            'CREATE POLICY p_app_service_select ON public.%I FOR SELECT TO app_service USING (true);',
            v_tbl
        );
        EXECUTE format(
            'CREATE POLICY p_app_service_insert ON public.%I FOR INSERT TO app_service WITH CHECK (true);',
            v_tbl
        );
    END LOOP;

    FOREACH v_tbl IN ARRAY v_mutable_or_versioned
    LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', v_tbl);
        EXECUTE format('DROP POLICY IF EXISTS p_app_service_select ON public.%I;', v_tbl);
        EXECUTE format('DROP POLICY IF EXISTS p_app_service_insert ON public.%I;', v_tbl);
        EXECUTE format('DROP POLICY IF EXISTS p_app_service_update ON public.%I;', v_tbl);
        EXECUTE format(
            'CREATE POLICY p_app_service_select ON public.%I FOR SELECT TO app_service USING (true);',
            v_tbl
        );
        EXECUTE format(
            'CREATE POLICY p_app_service_insert ON public.%I FOR INSERT TO app_service WITH CHECK (true);',
            v_tbl
        );
        EXECUTE format(
            'CREATE POLICY p_app_service_update ON public.%I FOR UPDATE TO app_service USING (true) WITH CHECK (true);',
            v_tbl
        );
    END LOOP;
END
$$;

-- ============================================================================
-- 5. IDENTITY BINDING (r2/D1-D3)
-- ============================================================================
-- The server verifies the Supabase token and, inside each write transaction, runs:
--   SELECT set_config('app.actor_member_id', <member_id>, true),
--          set_config('app.actor_auth_uid', <auth user id>, true);
-- Both values come only from the verified token. fn_current_actor() checks that the pair
-- belongs to one active team member. Settings are transaction-local, so this is safe with
-- the transaction pooler.

CREATE OR REPLACE FUNCTION public.fn_current_actor()
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_member TEXT := NULLIF(current_setting('app.actor_member_id', true), '');
    v_uid    TEXT := NULLIF(current_setting('app.actor_auth_uid', true), '');
BEGIN
    IF v_member IS NULL OR v_uid IS NULL THEN
        RAISE EXCEPTION 'No authenticated actor is bound to this transaction.' USING ERRCODE = '42501';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM public.team_member tm
         WHERE tm.member_id = v_member
           AND tm.auth_user_id::text = v_uid
           AND tm.is_active = true
           AND tm.is_deleted = false
    ) THEN
        RAISE EXCEPTION 'Bound actor % does not match an active linked team member.', v_member USING ERRCODE = '42501';
    END IF;
    RETURN v_member;
END;
$$;

-- Internal helper: actor holds finance_collections in the edition.
CREATE OR REPLACE FUNCTION public.fn_assert_finance_role(
    p_actor_id TEXT,
    p_edition_id TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.role_assignment ra
         WHERE ra.member_id = p_actor_id
           AND ra.edition_id = p_edition_id
           AND ra.role = 'finance_collections'
           AND ra.is_current = true
           AND ra.valid_to IS NULL
           AND ra.is_deleted = false
    ) THEN
        RAISE EXCEPTION 'Forbidden: actor % does not hold finance_collections role in edition %.', p_actor_id, p_edition_id
            USING ERRCODE = '42501';
    END IF;
END;
$$;

-- Internal helper: bound actor is a coordination lead or admin (any edition).
CREATE OR REPLACE FUNCTION public.fn_assert_admin_actor()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_actor TEXT := public.fn_current_actor();
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.role_assignment ra
         WHERE ra.member_id = v_actor
           AND ra.role IN ('coordination_lead', 'admin')
           AND ra.is_current = true
           AND ra.valid_to IS NULL
           AND ra.is_deleted = false
    ) THEN
        RAISE EXCEPTION 'Only a coordination_lead or admin may change team members or roles.' USING ERRCODE = '42501';
    END IF;
    RETURN v_actor;
END;
$$;

-- Internal helper: audit row written inside SECURITY DEFINER functions.
CREATE OR REPLACE FUNCTION public.fn_write_audit(
    p_actor_id TEXT, p_entity TEXT, p_entity_id TEXT, p_operation TEXT, p_after JSONB,
    p_record_class TEXT, p_import_batch_id TEXT, p_source_ref TEXT, p_evidence_class TEXT
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_version BIGINT;
BEGIN
    SELECT a.data_version INTO v_version FROM public.app_state a WHERE a.id = 1;
    INSERT INTO public.audit_event (
        audit_id, actor_id, channel, entity, entity_id, operation, after, data_version,
        record_class, import_batch_id, source_ref, evidence_class, created_by
    ) VALUES (
        'AUD-' || replace(gen_random_uuid()::text, '-', ''), p_actor_id, 'ui', p_entity, p_entity_id, p_operation,
        p_after, v_version, p_record_class, p_import_batch_id, p_source_ref, p_evidence_class, p_actor_id
    );
    RETURN v_version;
END;
$$;

-- r2/D3: audit rows written by the application must name the bound actor.
CREATE OR REPLACE FUNCTION public.tg_audit_actor_matches()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
    IF session_user = 'app_service' THEN
        IF NEW.channel NOT IN ('ui', 'ai_action') THEN
            RAISE EXCEPTION 'The application may only write ui or ai_action audit events.' USING ERRCODE = '42501';
        END IF;
        IF NEW.actor_id IS DISTINCT FROM public.fn_current_actor() THEN
            RAISE EXCEPTION 'Audit actor must equal the actor bound to this transaction.' USING ERRCODE = '42501';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_actor ON public.audit_event;
CREATE TRIGGER trg_audit_actor
    BEFORE INSERT ON public.audit_event
    FOR EACH ROW EXECUTE FUNCTION public.tg_audit_actor_matches();

-- ============================================================================
-- 5A. TEAM AND ROLE ADMINISTRATION (coordination_lead or admin only)
-- ============================================================================
-- Bootstrap: the first coordination_lead/admin is inserted by the schema owner in the
-- seed script and linked to the owner's Supabase auth user id there.

CREATE OR REPLACE FUNCTION public.create_team_member(
    p_member_id TEXT, p_full_name TEXT, p_email TEXT, p_edition_id TEXT, p_import_batch_id TEXT
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_actor TEXT := public.fn_assert_admin_actor();
    v_class TEXT;
BEGIN
    SELECT record_class INTO v_class FROM public.festival_edition WHERE edition_id = p_edition_id AND is_deleted = false;
    IF v_class IS NULL OR v_class NOT IN ('live', 'simulated') THEN
        RAISE EXCEPTION 'Team members are created in a live or simulated edition.' USING ERRCODE = '23514';
    END IF;
    INSERT INTO public.team_member (member_id, full_name, email, record_class, import_batch_id, source_ref, created_by)
    VALUES (p_member_id, p_full_name, p_email, v_class, p_import_batch_id, 'ui:team_admin', v_actor);
    RETURN public.fn_write_audit(v_actor, 'TEAM_MEMBER', p_member_id, 'insert',
        jsonb_build_object('member_id', p_member_id, 'full_name', p_full_name, 'email', p_email),
        v_class, p_import_batch_id, 'ui:team_admin', 'T');
END;
$$;

CREATE OR REPLACE FUNCTION public.link_auth_user(
    p_member_id TEXT, p_auth_user_id UUID, p_import_batch_id TEXT
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_actor TEXT := public.fn_assert_admin_actor();
    v_class TEXT;
BEGIN
    UPDATE public.team_member
       SET auth_user_id = p_auth_user_id
     WHERE member_id = p_member_id
       AND auth_user_id IS NULL
       AND is_deleted = false
    RETURNING record_class INTO v_class;
    IF v_class IS NULL THEN
        RAISE EXCEPTION 'Member % not found or already linked to a login.', p_member_id USING ERRCODE = '23514';
    END IF;
    RETURN public.fn_write_audit(v_actor, 'TEAM_MEMBER', p_member_id, 'update',
        jsonb_build_object('auth_user_id', p_auth_user_id), v_class, p_import_batch_id, 'ui:team_admin', 'T');
END;
$$;

CREATE OR REPLACE FUNCTION public.assign_role(
    p_role_assignment_id TEXT, p_member_id TEXT, p_edition_id TEXT, p_role TEXT, p_import_batch_id TEXT
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_actor TEXT := public.fn_assert_admin_actor();
    v_class TEXT;
BEGIN
    SELECT record_class INTO v_class FROM public.festival_edition WHERE edition_id = p_edition_id AND is_deleted = false;
    INSERT INTO public.role_assignment (role_assignment_id, member_id, edition_id, role, record_class, import_batch_id, source_ref, created_by)
    VALUES (p_role_assignment_id, p_member_id, p_edition_id, p_role, v_class, p_import_batch_id, 'ui:team_admin', v_actor);
    RETURN public.fn_write_audit(v_actor, 'ROLE_ASSIGNMENT', p_role_assignment_id, 'insert',
        jsonb_build_object('member_id', p_member_id, 'edition_id', p_edition_id, 'role', p_role),
        v_class, p_import_batch_id, 'ui:team_admin', 'T');
END;
$$;

CREATE OR REPLACE FUNCTION public.end_role(
    p_role_assignment_id TEXT, p_import_batch_id TEXT
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_actor TEXT := public.fn_assert_admin_actor();
    v_class TEXT;
BEGIN
    UPDATE public.role_assignment
       SET is_current = false, valid_to = now()
     WHERE role_assignment_id = p_role_assignment_id AND is_current = true AND is_deleted = false
    RETURNING record_class INTO v_class;
    IF v_class IS NULL THEN
        RAISE EXCEPTION 'Role assignment % not found or already ended.', p_role_assignment_id USING ERRCODE = '23514';
    END IF;
    RETURN public.fn_write_audit(v_actor, 'ROLE_ASSIGNMENT', p_role_assignment_id, 'update',
        jsonb_build_object('is_current', false), v_class, p_import_batch_id, 'ui:team_admin', 'T');
END;
$$;

-- ============================================================================
-- 5B. FINANCE FUNCTIONS (finance_collections only; actor from fn_current_actor)
-- ============================================================================

-- 5B.1 record_payment_schedule_item
CREATE OR REPLACE FUNCTION public.record_payment_schedule_item(
    p_schedule_item_id TEXT,
    p_contract_id TEXT,
    p_kind TEXT,
    p_amount_due NUMERIC(14, 2),
    p_due_date DATE,
    p_import_batch_id TEXT,
    p_source_ref TEXT DEFAULT 'ui:finance_payment_schedule',
    p_evidence_class TEXT DEFAULT 'T'
)
RETURNS TABLE (schedule_item_id TEXT, contract_id TEXT, record_class TEXT, data_version BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_actor TEXT := public.fn_current_actor();
    v_contract RECORD;
    v_cash_total NUMERIC(14, 2);
    v_scheduled_total NUMERIC(14, 2);
    v_version BIGINT;
BEGIN
    SELECT c.contract_id, c.record_class, c.status, o.edition_id INTO v_contract
      FROM public.contract c
      JOIN public.opportunity o ON o.opportunity_id = c.opportunity_id
     WHERE c.contract_id = p_contract_id AND c.is_deleted = false AND c.valid_to IS NULL
     FOR UPDATE OF c;
    IF v_contract IS NULL THEN
        RAISE EXCEPTION 'Active contract % not found.', p_contract_id USING ERRCODE = '23503';
    END IF;
    IF v_contract.status <> 'active' THEN
        RAISE EXCEPTION 'Contract % is % and cannot receive schedule items.', p_contract_id, v_contract.status USING ERRCODE = '23514';
    END IF;
    PERFORM public.fn_assert_finance_role(v_actor, v_contract.edition_id);
    IF p_amount_due IS NULL OR p_amount_due <= 0 THEN
        RAISE EXCEPTION 'amount_due must be greater than zero.' USING ERRCODE = '23514';
    END IF;
    SELECT COALESCE(SUM(cl.value), 0) INTO v_cash_total
      FROM public.contract_line cl
     WHERE cl.contract_id = p_contract_id AND cl.consideration_type = 'cash' AND cl.is_deleted = false;
    IF v_cash_total <= 0 THEN
        RAISE EXCEPTION 'Contract % has no cash lines; cannot schedule cash.', p_contract_id USING ERRCODE = '23514';
    END IF;
    SELECT COALESCE(SUM(psi.amount_due), 0) INTO v_scheduled_total
      FROM public.payment_schedule_item psi
     WHERE psi.contract_id = p_contract_id AND psi.is_deleted = false;
    IF v_scheduled_total + p_amount_due > v_cash_total THEN
        RAISE EXCEPTION 'Scheduled total (%) would exceed contract cash lines total (%).', v_scheduled_total + p_amount_due, v_cash_total
            USING ERRCODE = '23514';
    END IF;
    INSERT INTO public.payment_schedule_item (schedule_item_id, contract_id, kind, amount_due, due_date,
        record_class, import_batch_id, source_ref, evidence_class, created_by)
    VALUES (p_schedule_item_id, p_contract_id, p_kind, p_amount_due, p_due_date,
        v_contract.record_class, p_import_batch_id, p_source_ref, p_evidence_class, v_actor);
    v_version := public.fn_write_audit(v_actor, 'PAYMENT_SCHEDULE_ITEM', p_schedule_item_id, 'insert',
        jsonb_build_object('contract_id', p_contract_id, 'kind', p_kind, 'amount_due', p_amount_due, 'due_date', p_due_date),
        v_contract.record_class, p_import_batch_id, p_source_ref, p_evidence_class);
    RETURN QUERY SELECT p_schedule_item_id, p_contract_id, v_contract.record_class, v_version;
END;
$$;

-- 5B.2 record_invoice (OD-15 default: invoice_no entered by finance; tax entered, 0 if none)
CREATE OR REPLACE FUNCTION public.record_invoice(
    p_invoice_id TEXT,
    p_invoice_no TEXT,
    p_contract_id TEXT,
    p_schedule_item_id TEXT,
    p_issued_at TIMESTAMPTZ,
    p_amount NUMERIC(14, 2),
    p_tax_amount NUMERIC(14, 2),
    p_document_uri TEXT,
    p_import_batch_id TEXT,
    p_source_ref TEXT DEFAULT 'ui:finance_invoice',
    p_evidence_class TEXT DEFAULT 'T'
)
RETURNS TABLE (invoice_id TEXT, invoice_no TEXT, record_class TEXT, data_version BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_actor TEXT := public.fn_current_actor();
    v_contract RECORD;
    v_item_contract TEXT;
    v_version BIGINT;
BEGIN
    SELECT c.contract_id, c.record_class, c.status, o.edition_id INTO v_contract
      FROM public.contract c
      JOIN public.opportunity o ON o.opportunity_id = c.opportunity_id
     WHERE c.contract_id = p_contract_id AND c.is_deleted = false AND c.valid_to IS NULL
     FOR UPDATE OF c;
    IF v_contract IS NULL THEN
        RAISE EXCEPTION 'Active contract % not found.', p_contract_id USING ERRCODE = '23503';
    END IF;
    PERFORM public.fn_assert_finance_role(v_actor, v_contract.edition_id);
    IF p_schedule_item_id IS NOT NULL THEN
        SELECT psi.contract_id INTO v_item_contract
          FROM public.payment_schedule_item psi
         WHERE psi.schedule_item_id = p_schedule_item_id AND psi.is_deleted = false;
        IF v_item_contract IS DISTINCT FROM p_contract_id THEN
            RAISE EXCEPTION 'schedule_item_id % does not belong to contract %.', p_schedule_item_id, p_contract_id USING ERRCODE = '23514';
        END IF;
    END IF;
    IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION 'Invoice amount must be greater than zero.' USING ERRCODE = '23514';
    END IF;
    INSERT INTO public.invoice (invoice_id, invoice_no, contract_id, schedule_item_id, issued_at, amount, tax_amount,
        status, document_uri, record_class, import_batch_id, source_ref, evidence_class, created_by)
    VALUES (p_invoice_id, p_invoice_no, p_contract_id, p_schedule_item_id, p_issued_at, p_amount, COALESCE(p_tax_amount, 0),
        'issued', p_document_uri, v_contract.record_class, p_import_batch_id, p_source_ref, p_evidence_class, v_actor);
    v_version := public.fn_write_audit(v_actor, 'INVOICE', p_invoice_id, 'insert',
        jsonb_build_object('invoice_no', p_invoice_no, 'contract_id', p_contract_id, 'schedule_item_id', p_schedule_item_id,
                           'issued_at', p_issued_at, 'amount', p_amount, 'tax_amount', COALESCE(p_tax_amount, 0)),
        v_contract.record_class, p_import_batch_id, p_source_ref, p_evidence_class);
    RETURN QUERY SELECT p_invoice_id, p_invoice_no, v_contract.record_class, v_version;
END;
$$;

-- 5B.3 cancel_invoice (OD-15 default). 'settled' is derived from allocations, never set.
CREATE OR REPLACE FUNCTION public.cancel_invoice(
    p_edition_id TEXT,
    p_invoice_id TEXT,
    p_reason TEXT,
    p_import_batch_id TEXT,
    p_source_ref TEXT DEFAULT 'ui:finance_invoice_cancel',
    p_evidence_class TEXT DEFAULT 'T'
)
RETURNS TABLE (invoice_id TEXT, status TEXT, data_version BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_actor TEXT := public.fn_current_actor();
    v_inv RECORD;
    v_version BIGINT;
BEGIN
    PERFORM public.fn_assert_finance_role(v_actor, p_edition_id);
    IF p_reason IS NULL OR btrim(p_reason) = '' THEN
        RAISE EXCEPTION 'A cancellation reason is required.' USING ERRCODE = '23514';
    END IF;
    SELECT inv.invoice_id, inv.status, inv.record_class INTO v_inv
      FROM public.invoice inv
      JOIN public.contract c ON c.contract_id = inv.contract_id
      JOIN public.opportunity o ON o.opportunity_id = c.opportunity_id
     WHERE inv.invoice_id = p_invoice_id AND inv.is_deleted = false AND o.edition_id = p_edition_id
     FOR UPDATE OF inv;
    IF v_inv IS NULL THEN
        RAISE EXCEPTION 'Invoice % not found in edition %.', p_invoice_id, p_edition_id USING ERRCODE = '23503';
    END IF;
    IF v_inv.status <> 'issued' THEN
        RAISE EXCEPTION 'Invoice % is % and cannot be cancelled.', p_invoice_id, v_inv.status USING ERRCODE = '23514';
    END IF;
    IF EXISTS (SELECT 1 FROM public.receipt_allocation ra WHERE ra.invoice_id = p_invoice_id AND ra.is_deleted = false) THEN
        RAISE EXCEPTION 'Invoice % has allocated receipts and cannot be cancelled.', p_invoice_id USING ERRCODE = '23514';
    END IF;
    PERFORM set_config('app.finance_fn_active', 'true', true);
    UPDATE public.invoice inv SET status = 'cancelled' WHERE inv.invoice_id = p_invoice_id;
    PERFORM set_config('app.finance_fn_active', 'false', true);
    v_version := public.fn_write_audit(v_actor, 'INVOICE', p_invoice_id, 'update',
        jsonb_build_object('status', 'cancelled', 'reason', p_reason),
        v_inv.record_class, p_import_batch_id, p_source_ref, p_evidence_class);
    RETURN QUERY SELECT p_invoice_id, 'cancelled'::TEXT, v_version;
END;
$$;

-- 5B.4 record_receipt (OD-16 default: always recorded unreconciled; reconcile_receipt is the second step)
CREATE OR REPLACE FUNCTION public.record_receipt(
    p_edition_id TEXT,
    p_receipt_id TEXT,
    p_sponsor_id TEXT,
    p_received_at TIMESTAMPTZ,
    p_amount NUMERIC(14, 2),
    p_method TEXT,
    p_bank_reference TEXT,
    p_import_batch_id TEXT,
    p_source_ref TEXT DEFAULT 'ui:finance_receipt',
    p_evidence_class TEXT DEFAULT 'D'
)
RETURNS TABLE (receipt_id TEXT, sponsor_id TEXT, reconciled BOOLEAN, record_class TEXT, data_version BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_actor TEXT := public.fn_current_actor();
    v_edition_class TEXT;
    v_sponsor_class TEXT;
    v_version BIGINT;
BEGIN
    SELECT fe.record_class INTO v_edition_class
      FROM public.festival_edition fe WHERE fe.edition_id = p_edition_id AND fe.is_deleted = false;
    IF v_edition_class IS NULL OR v_edition_class NOT IN ('live', 'simulated') THEN
        RAISE EXCEPTION 'Receipts require a live or simulated festival_edition (got %).', COALESCE(v_edition_class, 'NULL')
            USING ERRCODE = '23514';
    END IF;
    PERFORM public.fn_assert_finance_role(v_actor, p_edition_id);
    SELECT s.record_class INTO v_sponsor_class FROM public.sponsor s WHERE s.sponsor_id = p_sponsor_id AND s.is_deleted = false;
    IF v_sponsor_class IS NULL THEN
        RAISE EXCEPTION 'Sponsor % not found.', p_sponsor_id USING ERRCODE = '23503';
    END IF;
    IF v_sponsor_class <> v_edition_class THEN
        RAISE EXCEPTION 'Sponsor % record_class (%) does not match edition record_class (%).', p_sponsor_id, v_sponsor_class, v_edition_class
            USING ERRCODE = '23514';
    END IF;
    IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION 'Receipt amount must be greater than zero.' USING ERRCODE = '23514';
    END IF;
    IF p_import_batch_id IS NULL OR btrim(p_import_batch_id) = '' THEN
        RAISE EXCEPTION 'import_batch_id is required for provenance on receipt.' USING ERRCODE = '23502';
    END IF;
    INSERT INTO public.receipt (receipt_id, sponsor_id, received_at, amount, method, bank_reference, reconciled,
        recorded_by, record_class, import_batch_id, source_ref, evidence_class, created_by)
    VALUES (p_receipt_id, p_sponsor_id, p_received_at, p_amount, p_method, p_bank_reference, false,
        v_actor, v_edition_class, p_import_batch_id, p_source_ref, p_evidence_class, v_actor);
    v_version := public.fn_write_audit(v_actor, 'RECEIPT', p_receipt_id, 'insert',
        jsonb_build_object('sponsor_id', p_sponsor_id, 'received_at', p_received_at, 'amount', p_amount,
                           'method', p_method, 'bank_reference', p_bank_reference, 'reconciled', false),
        v_edition_class, p_import_batch_id, p_source_ref, p_evidence_class);
    RETURN QUERY SELECT p_receipt_id, p_sponsor_id, false, v_edition_class, v_version;
END;
$$;

-- 5B.5 allocate_receipt (sponsor/contract/class ownership also enforced by trg_allocation_ownership)
CREATE OR REPLACE FUNCTION public.allocate_receipt(
    p_edition_id TEXT,
    p_allocation_id TEXT,
    p_receipt_id TEXT,
    p_invoice_id TEXT,
    p_schedule_item_id TEXT,
    p_amount NUMERIC(14, 2),
    p_import_batch_id TEXT,
    p_source_ref TEXT DEFAULT 'ui:finance_allocation',
    p_evidence_class TEXT DEFAULT 'D'
)
RETURNS TABLE (allocation_id TEXT, receipt_id TEXT, record_class TEXT, data_version BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_actor TEXT := public.fn_current_actor();
    v_edition_class TEXT;
    v_receipt RECORD;
    v_version BIGINT;
BEGIN
    PERFORM public.fn_assert_finance_role(v_actor, p_edition_id);
    SELECT fe.record_class INTO v_edition_class FROM public.festival_edition fe WHERE fe.edition_id = p_edition_id;
    SELECT r.receipt_id, r.record_class INTO v_receipt
      FROM public.receipt r WHERE r.receipt_id = p_receipt_id AND r.is_deleted = false
      FOR UPDATE OF r;
    IF v_receipt IS NULL THEN
        RAISE EXCEPTION 'Receipt % not found.', p_receipt_id USING ERRCODE = '23503';
    END IF;
    IF v_receipt.record_class IS DISTINCT FROM v_edition_class THEN
        RAISE EXCEPTION 'Receipt % is not in the record class of edition %.', p_receipt_id, p_edition_id USING ERRCODE = '23514';
    END IF;
    IF p_schedule_item_id IS NOT NULL THEN
        PERFORM 1 FROM public.payment_schedule_item psi
          JOIN public.contract c ON c.contract_id = psi.contract_id
          JOIN public.opportunity o ON o.opportunity_id = c.opportunity_id
         WHERE psi.schedule_item_id = p_schedule_item_id AND psi.is_deleted = false AND o.edition_id = p_edition_id
         FOR UPDATE OF psi;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'payment_schedule_item % not found in edition %.', p_schedule_item_id, p_edition_id USING ERRCODE = '23503';
        END IF;
    END IF;
    IF p_invoice_id IS NOT NULL THEN
        PERFORM 1 FROM public.invoice inv
          JOIN public.contract c ON c.contract_id = inv.contract_id
          JOIN public.opportunity o ON o.opportunity_id = c.opportunity_id
         WHERE inv.invoice_id = p_invoice_id AND inv.is_deleted = false AND o.edition_id = p_edition_id
         FOR UPDATE OF inv;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'invoice % not found in edition %.', p_invoice_id, p_edition_id USING ERRCODE = '23503';
        END IF;
    END IF;
    INSERT INTO public.receipt_allocation (allocation_id, receipt_id, invoice_id, schedule_item_id, amount,
        record_class, import_batch_id, source_ref, evidence_class, created_by)
    VALUES (p_allocation_id, p_receipt_id, p_invoice_id, p_schedule_item_id, p_amount,
        v_receipt.record_class, p_import_batch_id, p_source_ref, p_evidence_class, v_actor);
    v_version := public.fn_write_audit(v_actor, 'RECEIPT_ALLOCATION', p_allocation_id, 'insert',
        jsonb_build_object('receipt_id', p_receipt_id, 'invoice_id', p_invoice_id, 'schedule_item_id', p_schedule_item_id, 'amount', p_amount),
        v_receipt.record_class, p_import_batch_id, p_source_ref, p_evidence_class);
    RETURN QUERY SELECT p_allocation_id, p_receipt_id, v_receipt.record_class, v_version;
END;
$$;

-- 5B.6 reconcile_receipt (second step of OD-16; only reconciled receipts count as collected, INV-01)
CREATE OR REPLACE FUNCTION public.reconcile_receipt(
    p_edition_id TEXT,
    p_receipt_id TEXT,
    p_import_batch_id TEXT,
    p_source_ref TEXT DEFAULT 'ui:finance_reconcile',
    p_evidence_class TEXT DEFAULT 'D'
)
RETURNS TABLE (receipt_id TEXT, reconciled BOOLEAN, reconciled_at TIMESTAMPTZ, data_version BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_actor TEXT := public.fn_current_actor();
    v_edition_class TEXT;
    v_receipt RECORD;
    v_ts TIMESTAMPTZ := now();
    v_version BIGINT;
BEGIN
    PERFORM public.fn_assert_finance_role(v_actor, p_edition_id);
    SELECT fe.record_class INTO v_edition_class FROM public.festival_edition fe WHERE fe.edition_id = p_edition_id;
    SELECT r.receipt_id, r.reconciled, r.record_class INTO v_receipt
      FROM public.receipt r WHERE r.receipt_id = p_receipt_id AND r.is_deleted = false
      FOR UPDATE OF r;
    IF v_receipt IS NULL THEN
        RAISE EXCEPTION 'Receipt % not found.', p_receipt_id USING ERRCODE = '23503';
    END IF;
    IF v_receipt.record_class IS DISTINCT FROM v_edition_class THEN
        RAISE EXCEPTION 'Receipt % is not in the record class of edition %.', p_receipt_id, p_edition_id USING ERRCODE = '23514';
    END IF;
    IF v_receipt.reconciled THEN
        RAISE EXCEPTION 'Receipt % is already reconciled.', p_receipt_id USING ERRCODE = '23514';
    END IF;
    PERFORM set_config('app.finance_fn_active', 'true', true);
    UPDATE public.receipt r SET reconciled = true, reconciled_at = v_ts WHERE r.receipt_id = p_receipt_id;
    PERFORM set_config('app.finance_fn_active', 'false', true);
    v_version := public.fn_write_audit(v_actor, 'RECEIPT', p_receipt_id, 'update',
        jsonb_build_object('reconciled', true, 'reconciled_at', v_ts),
        v_receipt.record_class, p_import_batch_id, p_source_ref, p_evidence_class);
    RETURN QUERY SELECT p_receipt_id, true, v_ts, v_version;
END;
$$;

-- ============================================================================
-- 6. LOCK DOWN FUNCTION EXECUTE PRIVILEGES
-- ============================================================================

-- Old r1 signatures (with p_actor_id) must not survive a rerun on an existing database.
DROP FUNCTION IF EXISTS public.record_payment_schedule_item(TEXT, TEXT, TEXT, TEXT, NUMERIC, DATE, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.record_invoice(TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, NUMERIC, NUMERIC, TEXT, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.record_receipt(TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, NUMERIC, TEXT, TEXT, BOOLEAN, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.allocate_receipt(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.reconcile_receipt(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT);

-- Nothing in public is executable by PUBLIC, anon or authenticated.
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM authenticated;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
        REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM service_role;
    END IF;
END
$$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM app_service;

-- app_service may call only these entry points.
GRANT EXECUTE ON FUNCTION public.create_team_member(TEXT, TEXT, TEXT, TEXT, TEXT) TO app_service;
GRANT EXECUTE ON FUNCTION public.link_auth_user(TEXT, UUID, TEXT) TO app_service;
GRANT EXECUTE ON FUNCTION public.assign_role(TEXT, TEXT, TEXT, TEXT, TEXT) TO app_service;
GRANT EXECUTE ON FUNCTION public.end_role(TEXT, TEXT) TO app_service;
GRANT EXECUTE ON FUNCTION public.record_payment_schedule_item(TEXT, TEXT, TEXT, NUMERIC, DATE, TEXT, TEXT, TEXT) TO app_service;
GRANT EXECUTE ON FUNCTION public.record_invoice(TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, NUMERIC, NUMERIC, TEXT, TEXT, TEXT, TEXT) TO app_service;
GRANT EXECUTE ON FUNCTION public.cancel_invoice(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO app_service;
GRANT EXECUTE ON FUNCTION public.record_receipt(TEXT, TEXT, TEXT, TIMESTAMPTZ, NUMERIC, TEXT, TEXT, TEXT, TEXT, TEXT) TO app_service;
GRANT EXECUTE ON FUNCTION public.allocate_receipt(TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT, TEXT, TEXT) TO app_service;
GRANT EXECUTE ON FUNCTION public.reconcile_receipt(TEXT, TEXT, TEXT, TEXT, TEXT) TO app_service;

COMMIT;
