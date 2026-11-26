# Sponsorship Growth Platform: database validation report (Stage 1B, r2)

**Executed by:** technical lead (Claude), 26 Nov 2026 · **Engine:** PostgreSQL 16.15 · **Setup:** non-superuser schema owner, and Supabase's `anon`, `authenticated` and `service_role` roles with Supabase's default grants. Browser access is tested through an `authenticator` login that switches role, as Supabase's REST API does.

| File | sha256 |
|---|---|
| `01_schema.sql` (r2) | `2c588adb826d9431dc91dfc5f41d21211307a59dcc59f5fd53e435fd22bfe153` |
| `02_roles_grants.sql` (r2) | `5c995d5c379b5f69081a8aa5da9c225585545f6ddc8c319c50b6b073b78494c9` |

## Execution

| Check | Result |
|---|---|
| 01 then 02 on an empty database | Success: 61 tables, 2 views, 190 triggers |
| 01 then 02 a second time (rerun) | Success, no changes |
| Functions `app_service` can execute | Exactly 10 (see README) |
| Test suite (`tests/final_tests.py`) | **50 of 50 pass**; every blocked case fails with the intended error (`tests/final_results.json`) |
| Original r1 files, same style of tests | 8 of 26 failed (defects D1–D5, D8); see the review |

## Test summary

| Group | Tests | What is proved |
|---|---|---|
| Identity (I1–I6) | 6 | Only a correctly bound finance user can write cash. A finance ID paired with another login, a missing binding, the old actor-ID functions and a viewer are all refused |
| Roles and logins (R1–R8) | 8 | Roles and login links change only through the lead or admin functions. Ordinary profile edits still work |
| Audit (U1–U3) | 3 | The app cannot write audit rows for another user or on the import channel |
| Cash (C1–C10) | 10 | No cross-sponsor allocation. Unreconciled cash does not count, and reconciled cash does (₹0 → ₹50,000 in `balance_view`). No double reconcile. Schedule caps hold. An unpaid invoice can be cancelled and a paid one cannot. No direct writes |
| Contracts (K1–K7) | 7 | Lines must equal the signed total. Signed terms are immutable, other fields are editable. A confirmed value needs a contract. A loss needs a drop reason |
| 2025 data (H1–H5) | 5 | All 11 event/outcome pairs from the 2025 data load unchanged. A 2025 brand without a lifecycle status loads. The app cannot insert 2025 rows, even by setting the seed flag |
| General (G1–G11) | 11 | No deletes. `data_version` cannot be reset. History cannot be rewritten. No app-written forecasts or KPI values. Internal helpers are private. Browser roles have no table or function access. Objects created later receive no browser or PUBLIC grants |

## Business invariants

| Invariant | Status |
|---|---|
| INV-01 cash collected = reconciled receipts on cash lines | Enforced in the database (finance functions, allocation ownership, reconciliation). The "before festival start" filter belongs to metric M-01 (Stage 2) |
| INV-02 signed = sum of lines; cash and in-kind separate | Enforced (deferred check at commit; immutable signed terms) |
| INV-03 research target needs an interaction first | Partly: the opportunity trigger blocks research targets; promotion rules live in the app |
| INV-04 committed introduction needs a named contact | Partly: a contact is required; "agreed meeting" is an app rule |
| INV-05 SLA clock (5 / 10 days) | Metric (M-18, M-19), not a constraint |
| INV-06 drop reason on lost or withdrawn | Enforced for live and simulated rows |
| INV-07 exclusivity only in title or presenting contracts; no overlaps | Enforced (trigger) |
| INV-08 a slot is sold once | Enforced (unique index); hold expiry is an app job |
| INV-09 versioned and not retroactive | Partly: versions are stored; "not retroactive" is an app rule (reference tables are seed-only in release 1) |
| INV-10 approved scenarios immutable; forecasts by job only | Enforced (append-only; the app cannot insert forecasts) |
| INV-11 KPI values computed, never typed | Enforced (the app cannot insert `kpi_actual`) |
| INV-12 no hard deletes; AI writes only through confirmed actions | Deletes enforced. AI action types are constrained; confirmation is a server rule (Stage 4) |

## Not yet verified (requires Supabase)

1. Execution on Supabase's own PostgreSQL version and `postgres` role.
2. Pooler login as `app_service.<project-ref>`.
3. The four live queries in the README run sheet.
4. The app's health check against the real database.
5. That the Data API exposes no `public` objects to the publishable key.
