# Sponsorship Growth Platform: database foundation (Stage 1B, revision r2)

**Status:** reviewed and executed by the technical lead on PostgreSQL 16 with a Supabase-like role setup. 50 of 50 security and integrity tests pass (`DATABASE_VALIDATION_REPORT.md`). Not yet run in Supabase.

| File | Purpose | Order |
|---|---|---|
| `db/01_schema.sql` | 61 tables, 2 derived views, provenance and version columns, record-class isolation, the historical lock, no hard deletes, append-only history, and business invariants | 1st |
| `db/02_roles_grants.sql` | Restricted `app_service` role, browser roles locked out (current and future objects), RLS, identity binding, team/role admin functions, and finance functions | 2nd |
| `db/DATABASE_DECISION_REGISTER.md` | Open decisions and their rulings | Reference |
| `db/DATABASE_VALIDATION_REPORT.md` | Execution evidence | Reference |

## Run sheet in Supabase (`risa-growth-demo`)

1. **SQL Editor → New query →** paste all of `01_schema.sql` → **Run**. Expect "Success" (notices like "trigger … does not exist, skipping" are normal).
2. **New query →** paste all of `02_roles_grants.sql` → **Run**.
3. **New query** (do not save it): `ALTER ROLE app_service WITH PASSWORD '<32+ random characters>';` → **Run**. Keep the password only in a password manager.
4. **Settings → Data API:** remove `public` from the exposed schemas (or turn the Data API off). The app never uses it, so this closes the browser path entirely.
5. **Connect → Connection string → Transaction pooler.** Change the user to `app_service.<project-ref>` and insert the password from step 3. Save the result as the server secret `DATABASE_URL` in AI Studio.
6. **Live checks** (paste the results back to the technical lead):

```sql
select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE';   -- expect 61
select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and has_function_privilege('app_service', p.oid, 'EXECUTE') order by 1;          -- expect exactly 10 names
select grantee, count(*) from information_schema.role_table_grants
 where table_schema='public' and grantee in ('anon','authenticated') group by 1;                            -- expect no rows
select rolname, rolsuper, rolbypassrls from pg_roles where rolname='app_service';                           -- expect false, false
```

Then open `GET /api/admin/health` in the app. Expect the database check to be healthy.

**Not part of this stage:** the 2025 data, the demo season, the reference rows (scenarios, gates, metric definitions) and the first coordination-lead account. The Stage 2 seed files load them, as the schema owner.

## Rules the database enforces

- **One record class per edition.** Operational rows inherit their edition's class. 2025 rows (`historical_synthetic`) can be inserted only by the owner's seed and are never updatable.
- **No hard deletes**, and append-only history (stage versions, qualifications, interactions, outreach, allocations, audit and AI logs).
- **Cash exists only as a receipt.** Receipts, invoices, schedules and allocations are written only through finance functions. A receipt is recorded unreconciled; only `reconcile_receipt` makes it count (OD-16, INV-01). A receipt can only be allocated to its own sponsor's contract.
- **Signed value = sum of contract lines** (INV-02), checked at commit. Create a contract and its lines in **one transaction**. Signed terms are immutable; an amendment is a new contract version.
- **2025 vocabulary is stored unchanged** (interaction events and outcomes).
- **Browser roles have no access** to tables or functions, now or for objects created later.

## Identity contract (server ⇄ database)

The database connection is shared (`app_service`), so the server tells the database who the user is, once per write transaction:

```sql
BEGIN;
SELECT set_config('app.actor_member_id', $1, true),   -- member_id resolved from the verified Supabase token
       set_config('app.actor_auth_uid',  $2, true);   -- the token's user id
-- ... writes and finance function calls ...
COMMIT;
```

- Both values come **only** from the verified token (`server/auth.ts`), never from a request body, query string or custom header. `server/db.ts` exposes this as `withActorTransaction(actor, fn)`, and every write uses it.
- `fn_current_actor()` checks that the pair belongs to one active, linked team member. Finance functions take **no** actor parameter.
- Audit rows written by the app must name that same actor.
- Team members, login links and roles change only through `create_team_member`, `link_auth_user`, `assign_role` and `end_role`, which require a coordination lead or admin.
- **Remaining risk:** a bug in this one helper, or a compromised server, could still act as another user. Cryptographic binding (finance calls through Supabase's API with the user's own token) is the upgrade before any real-money use.

## Functions the app may call (exactly these)

| Function | Who | Purpose |
|---|---|---|
| `create_team_member`, `link_auth_user`, `assign_role`, `end_role` | coordination lead, admin | Team and access administration |
| `record_payment_schedule_item` | finance | Schedule cash due on a contract (capped at the contract's cash lines) |
| `record_invoice`, `cancel_invoice` | finance | Invoice entered by finance; cancel only if unpaid (OD-15). "Settled" is derived, never set |
| `record_receipt`, `allocate_receipt`, `reconcile_receipt` | finance | Two-step cash: record, allocate, reconcile |

All return the new `data_version`.

## Pooler compatibility

All settings are transaction-local (`set_config(..., true)`), with no session state. This is safe with the transaction pooler (port 6543).
