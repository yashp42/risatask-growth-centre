# Sponsorship Growth Platform: Stage 2 (metrics and data)

**Status:** generated from the analysis repository and verified end to end on PostgreSQL 16 with a Supabase-like role setup: **30 of 30 checks pass** (`tests/VERIFY_STAGE2.log`). This includes the 2025 parity test (32 of 32) and the Stage 1B security suite rerun (50 of 50). Not yet run in Supabase.

## Run sheet (Supabase SQL Editor, as the owner, in this order)

| # | File | What it does | Time |
|---|---|---|---|
| 1 | `03a_schema_adjustments.sql` | Widens four checks to the source files' own vocabulary, adds citation columns to `knowledge_chunk`, and creates the metric result type. Safe to rerun | seconds |
| 2 | `03_metrics.sql` | The metric engine: `metrics.m_01` … `m_30`, the dispatcher `metrics.get_metric(...)`, and the parity test `metrics.parity_2025()`. Safe to rerun | seconds |
| 3 | `04_reference_seed.sql` | Decisions, bets, channels, categories, 30 metric definitions, 45 KPIs, 5 approved scenarios, 12 decision rules, 9 experiments, 38 assumptions | seconds |
| 4 | `05_seed_2025.sql` | The 2025 dataset (180 brands, 270 contacts, 370 attempts, 950 interactions, 433 qualification versions, 58 deals, 228 stage versions, targets, activations), read-only | ~10 s |
| 5 | `06_seed_demo_2026.sql` | The **simulated** 2026-27 demo season at week 5 (record class `simulated`) | seconds |
| 6 | `07_knowledge.sql` | The 106 knowledge chunks with full-text search | seconds |

Each seed file loads once. Running it again stops with "already loaded" and changes nothing. If the SQL Editor rejects a file as too large (file 4 is the biggest, about 0.7 MB), stop and report it; it will be split.

**Check after all six files** (paste into a new query):

```sql
select count(*) filter (where passed) || ' / ' || count(*) as parity from metrics.parity_2025();      -- expect 32 / 32
select metric_id, value from metrics.get_metric('M-08', 'simulated', 'ED-2026-DEMO', '2026-11-22', '{}')
union all select metric_id, value from metrics.get_metric('M-01', 'simulated', 'ED-2026-DEMO', '2026-11-25', '{}');  -- 470000, 222500
```

## How the app uses it

- **Every dashboard number and every AI number** comes from one call:
  `select * from metrics.get_metric(metric_id, record_class, edition_id, as_of_date, filters_json)`.
- **The result row** has: value, unit, numerator, denominator, `computable`, `reason`, `applied_filters`, record class, edition, as-of date, `data_version`, `definition_version`, and `series_key` (scenario ID for M-30).
- **Filters:** `campaign_id`, `channel_group` (`warm`, `inbound`, `cold`, `renewal`, `premium`), `bet_id`, and `scenario_id` (M-30 only). Any other key is rejected.
- **Editions:** `ED-2025` with record class `historical_synthetic`, or `ED-2026-DEMO` with `simulated`. A mismatched pair is rejected, so classes never mix in one number.
- **As-of date:** everything stamped before the end of that day in IST.
- **Not computable:** returns `computable = false` with a reason instead of a number. Examples: cash collected in 2025 ("no payment records"), or M-24 when an edition has no partnership goal.
- **Parity:** `metrics.parity_2025()` is acceptance test A1. The admin parity endpoint should simply return its rows.

## Demo season (simulated, as of 25 Nov 2026 = week 5)

W1 starts 26 Oct 2026; the festival opens 9 Jan 2027; the T−7 gate is 2 Jan 2027. These are demo dates, not plans. Numbers below are as of 25 Nov 2026 unless a week is named.

| Panel | Value | What it shows |
|---|---|---|
| Signed, end of W4 (M-08) | ₹4.70L | Below the base gate (₹5.1L), above 0.8 × base. The D-010 rule says: trigger the B3/B4 contingencies |
| Signed now (M-02) | ₹7.80L (cash ₹7.55L, in-kind ₹0.25L) | Includes the ₹1.6L pre-season presenting deal (M-26) |
| Cash collected (M-01) | ₹2.225L; one ₹0.30L advance received but not yet reconciled | Only reconciled cash counts |
| Advance within 7 days (M-25) | 3 of 7 | B2 is tested on the first 10 signings |
| Qualified → proposal ≤ 10 days (M-19) | 0.60 | Below 63%, so the B1 escalate band |
| Interested past sponsors (M-28) | 7 | B4a "change" band (4–7) |
| Committed introductions (M-29) | 9 | B3 "work all" band (6–11) |
| Hours vs model (M-27) | 1.27 | Just under the 1.3 alert |

The demo also has 51 sponsors, 19 deals, 7 contracts with 50/50 schedules, invoices issued on signing day, 14 tasks (some overdue), 7 time logs, one open escalation, and the title slot held for a pitch. Brand and person names are invented; renewal sponsors reuse the fictional 2025 names.

## Rules and choices made in this stage (see decision register §5)

1. **03a widens four checks** to the source files' own values: KPI types, metric value nature, assumption evidence classes, and knowledge-chunk status and evidence tags. Nothing in the source files was rewritten.
2. **Two historical goal KPIs** (`K-H-01`, `K-H-02`) hold the 2025 plan's goals from `stg.targets`, because M-24 needs a denominator. They are reference rows, not new strategy KPIs.
3. **M-08 excludes premium campaigns by default.** The dictionary says the gates count in-window channels only, and pre-season premium value is tracked by M-26.
4. **M-17 to M-19 default to warm and inbound**, as the dictionary says, unless a channel or campaign filter is given.
5. **Proposed operational definitions** (reversible, flagged for the product owner):
   - M-27 maps task types to the AS-19 hours: call and pitch = meeting, invoice = collection, admin excluded.
   - M-28 counts "interested" as a past sponsor with a renewal opportunity opened.
   - M-29 counts introductions from VC funds and alumni only (B3); creator referrals are B4b.
6. **Live data belongs in a separate production project.** This project holds 2025 (read-only) and the simulated demo; demo rows cannot be deleted by design.
