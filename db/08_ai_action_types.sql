-- 08_ai_action_types.sql  (Stage 4, product-owner decision 26 Nov 2026)
-- Widens the operational writes the Growth Analyst may PROPOSE. Every proposal still needs an explicit
-- human confirmation and is executed by the server through the same permission-checked write path as the UI.
-- Deliberately NOT representable (human-only, in the app's own forms): payment schedules, invoices, receipts,
-- allocations, reconciliation, contract edits, targets, scenarios, thresholds/rules, roles/team, deletes.
-- Idempotent: safe to run twice.
BEGIN;
ALTER TABLE public.ai_action DROP CONSTRAINT IF EXISTS ai_action_action_type_check;
ALTER TABLE public.ai_action ADD CONSTRAINT ai_action_action_type_check CHECK (action_type IN (
    -- original four
    'create_task', 'log_interaction', 'log_meeting', 'upsert_sponsor_contact',
    -- sponsors and contacts
    'create_sponsor', 'update_sponsor', 'change_owner', 'create_contact', 'update_contact',
    -- campaigns and outreach
    'create_campaign', 'update_campaign', 'log_outreach',
    -- pipeline
    'record_qualification', 'create_opportunity', 'update_opportunity', 'change_stage', 'confirm_deal',
    -- execution
    'update_task', 'log_time', 'create_network_partner', 'record_referral'
));
COMMIT;
-- Check: SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'ai_action_action_type_check';
