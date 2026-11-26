# RISA Growth Center — Technical Architecture & AI Studio Build Handoff

Nov 26, 2026 · @Shantanu

## Decisions at a glance

Build one AI Studio web app: a React frontend and a Node.js server. Behind it, one Supabase project provides PostgreSQL and login. Gemini is called only from the server. Every number on screen or in a chat answer comes from one metric engine: SQL functions in PostgreSQL. Nothing else is needed for the first release: no Firestore, no vector database, no agent framework, no separate microservices.

| Layer | Decision | Why |
| --- | --- | --- |
| Frontend | React, as AI Studio generates by default; data fetching through one API client with query caching | AI Studio's default; it is a thin client that displays server results |
| Server | The Node.js server inside the AI Studio app, with a REST API under `/api/*`; deployed with AI Studio's Publish to Cloud Run | Keeps secrets server-side and holds every rule; one deployable unit for one builder |
| Database | Supabase PostgreSQL, one **demo** project for the submission | Relational integrity, transactions and constraints that the data model and invariants INV-01–INV-12 need; Firestore cannot enforce them |
| Login | Supabase Auth (email and password), with roles in our own `role_assignment` table | Same vendor as the database; the server checks the role on every call |
| Metric engine | One SQL function per metric in `metric_dictionary.csv` (M-01–M-30), called through one server endpoint | The dashboard and the AI share one code path, so they can never disagree |
| AI | Gemini through the Gen AI SDK on the server, with direct function calling, six typed tools and server-side answer checks | No free SQL, no LLM arithmetic, writes only after a human confirms |
| Knowledge | The 106 existing chunks in a PostgreSQL table, searched with full-text search after metadata filters | The corpus is about 12k tokens; a vector database adds cost and nothing the tests need |
| Frozen model | Not run in the app. Approved scenarios, gates and assumptions are loaded as read-only reference rows | D-009 and D-010 stay byte-for-byte; the app looks values up and never recomputes them |
| Data separation | 2025 = `historical_synthetic` (read-only); demo season = `simulated` (editable); `live` only ever in a later production project | Every metric call takes exactly one record class, so classes never add into one total |

**Decisions only you can make** (defaults given, so the build can start):

- [ ] **Demo season story.** The default is a simulated 2026 season at week 5, slightly behind the base gate, so the dashboard has something to diagnose. It is demo data, not a forecast.
- [ ] **Which approved scenario the gates track.** The default shows base gates, with the plan/stretch gate line beside them. Both are D-010 values, read-only.
- [ ] **Billing for Cloud Run.** Publishing from AI Studio deploys to your Google Cloud project, where usage may be charged. Decide which Google account and billing account to use.
- [ ] **Gemini tier and data terms (OD-07).** Choose a free or paid Gemini API tier after reading its data-use terms. Turn off request storage either way (setup checklist).

## 1. Recommended architecture

The browser talks only to our server. The server is the only thing that touches the database or Gemini, and every rule lives in the server or the database.

&#91;embedded content: Growth Center architecture · browser, server, Supabase, Gemini\]

Solid arrows are runtime calls; dashed arrows are token checks and the one-time load from the repository. The model reaches data only through the orchestrator's tools, and writes only through the action service after a person confirms.

| Component | What it does | Built by |
| --- | --- | --- |
| **React frontend** | Dashboard, management screens (campaigns, sponsors, deals, tasks, receipts) and the AI chat panel. It holds no business logic and computes no numbers; it only formats values the API returns. It signs in with Supabase Auth and sends the user's token on every API call | AI Studio |
| **Node.js API server** | REST endpoints `/api/*`. It verifies the token, loads the user's role, validates input, runs each write in one transaction with its audit event, serves metrics, and runs the AI loop | AI Studio |
| **Metric service** | A thin registry in the server that maps `metric_id` to its SQL function and returns a standard result (value, numerator, denominator, computable flag, record class, data version) | AI Studio (the SQL comes from us, see section 2) |
| **AI orchestrator** | Sends the question, recent history and six tool declarations to Gemini, executes the tool calls itself, checks the answer, and logs everything | AI Studio |
| **Action service** | Stores AI proposals and executes one only when a person clicks Confirm in the UI. The model never calls the execute step | AI Studio |
| **Supabase PostgreSQL** | Operational tables, reference tables (scenarios, gates, rules, assumptions, metric and KPI definitions), the knowledge chunks, metric functions, audit and AI logs | Schema and seed SQL from this repository; you run them |
| **Supabase Auth** | Email and password accounts. Roles live in our `role_assignment` table, not in the auth system | You configure |
| **Gemini API** | Language understanding and wording only. Its key is a server secret in AI Studio | You configure the key; AI Studio writes the calls |
| **Cloud Run** | Hosting for the published app, through AI Studio's Publish | You publish and enable billing |
| **Repository (offline)** | The frozen v4.1 model, DuckDB 2025 pipeline, test bank and seed builders. It is the source for every reference row in the app and is never run by the app | Already exists |

**What the app deliberately does not contain:** Firestore (AI Studio may offer it; decline), a vector database, an agent framework, text-to-SQL, a live Monte Carlo, or any write path from the model to the database.

## 2. Backend specification

The database enforces what must never break (record classes, versions, receipts). The server enforces who may do what. The metric engine is the only place a number is calculated. Everything here reuses `09_PRODUCT_BLUEPRINT_HANDOFF/conceptual_data_model.md` and `06_BUSINESS_KNOWLEDGE_BASE/metric_definitions/metric_dictionary.csv`; nothing new is invented.

### 2.1 Database (Supabase PostgreSQL)

| Group | Tables (first release) | Who writes |
| --- | --- | --- |
| Reference, read-only | `festival_edition`, `channel`, `category`, `bet`, `kpi_definition`, `metric_definition`, `scenario_reference` (SC-01–SC-05 approved only), `target_version` (W4–W9 gates, T−7 cash gate), `threshold_rule` (12 rules from the experiment register), `model_assumption` (AS-01–AS-38), `experiment`, `decision_record`, `knowledge_chunk` (106 chunks) | Seed SQL only. The app has no write grant |
| Pipeline | `sponsor`, `contact`, `team_member`, `role_assignment`, `campaign`, `outreach_attempt`, `interaction`, `meeting`, `qualification_version`, `opportunity`, `opportunity_stage_version` | UI forms; AI through confirmed actions where the permission matrix allows |
| Money | `contract`, `contract_line` (`support_type` = cash or in\_kind), `payment_schedule_item`, `invoice`, `receipt`, `receipt_allocation` | Finance role only, through database functions |
| Work | `task`, `escalation`, `hours_log` | UI; AI may create tasks through confirmed actions |
| System | `import_batch`, `audit_event`, `app_state` (one row: `data_version`), `ai_conversation`, `ai_message`, `ai_query_log`, `ai_action` | Server only; logs are append-only |

Rules the database enforces (from INV-01–INV-12):

1. **One class per edition.** Every operational row belongs to a `festival_edition`, and its `record_class` must equal that edition's class. ED-2025 is `historical_synthetic`; ED-2026-DEMO is `simulated`. A trigger rejects any insert or update on a `historical_synthetic` edition.
2. **Cash exists only as a receipt.** `receipt.record_class` must be `live` or `simulated`, with amount > 0. A receipt counts as collected only when reconciled and allocated to a cash contract line.
3. **Signed value comes only from stage history.** Value is signed only while an opportunity's current stage version is `partner_confirmed`. Stage and qualification changes insert a new version row; there is no update in place, and a loss needs a `drop_reason`.
4. **No deletes.** The app's database role has no DELETE grant. Records are archived with a status.
5. **Every write bumps `app_state.data_version`.** A statement trigger on every operational table does this; the dashboard uses it to know when to refresh.
6. Timestamps are `timestamptz`, shown in Asia/Kolkata.

Database roles: `app_service` is the server's login. It can read everything, insert and update operational tables, and only insert into logs. It writes receipts, invoices and payment schedules through `SECURITY DEFINER` functions (for example `record_receipt(actor_id, …)`); each function checks that the actor holds the finance role and writes the audit event. The schema owner is used only to run migrations, by you.

### 2.2 Metric engine and dashboard (highest priority)

**The contract.** Each metric is one SQL function in schema `metrics`, named after its ID (`metrics.m_02`, …), with one signature:

`(record_class, edition_id, as_of timestamptz, filters jsonb)` → `metric_id, value, unit, numerator, denominator, computable, reason, applied_filters, record_class, data_version, definition_version`

- `filters` keys: `campaign_id`, `channel_id`, `bet_id`, `owner_id`, `category_id`, `week`. A function returns in `applied_filters` the keys it actually applied.
- `as_of` reads the version tables, so the dashboard can show any past date, as the 2025 analysis did.
- `computable = false` comes with a reason instead of a number, for example M-01 on 2025 data: "The 2025 dataset has no payment records."
- Formulas, numerators, denominators and inclusion rules are exactly those in `metric_dictionary.csv`. A new metric (for example invoiced value) is added to the dictionary first, then as a function.

**The server** exposes one endpoint, `POST /api/metrics/query`, which takes a list of metric IDs and one parameter set. The AI's `get_metric` tool calls the same service, so the dashboard and the chat cannot diverge.

**Where each panel gets its numbers.** The React code formats; it never adds, divides or hardcodes.

| Dashboard panel | Metrics | Comparison shown |
| --- | --- | --- |
| North Star: cash collected | M-01, M-06, M-07 | T−7 cash gate (collected ÷ signed ≥ 0.85) from `target_version` |
| Signed value | M-02, M-03, M-04 (cash and in-kind always separate) | — |
| Pacing | M-08 by week | W4–W9 signed-value gates of the chosen scenario, from `target_version` |
| Funnel by channel | M-23, M-11, M-12, M-13, M-09; stage counts are the numerators and denominators these return | 2025 rates from the same functions on `historical_synthetic`, as a separate series |
| Bet rules | B1 M-19 and M-17 · B2 M-25 · B4a M-28 · B3 M-29 · B5 M-26 | Keep / change / stop thresholds from `threshold_rule`, evaluated by the server |
| Campaign table | M-23, M-11, M-13, M-09, M-02, M-17 per `campaign_id` | Each campaign's threshold rule |
| Pipeline and speed | M-21, M-20, M-18 | — |
| Capacity (no cash budget exists) | M-27 | Planned person-weeks from `target_version` |
| Approved scenarios | M-30 (lookup only) | Base ₹21.2L, plan ₹26.1L, stretch ₹28.6L, shown read-only |

**How changes reach every view.**

1. A user saves a change, for example moving a deal to `partner_confirmed` or recording a receipt.
2. The server validates it, writes the row, the audit event and the `data_version` bump in one transaction, and returns the new `data_version`.
3. The frontend invalidates every cached metric query, so all panels refetch.
4. Every open dashboard polls `GET /api/version` every 10 seconds and refetches when the version changes, so other users' edits also show.
5. Every metric result carries the `data_version` it was computed on, and the panel shows it with an "as of" time.

**Correctness test (metric parity).** Running every computable metric on ED-2025 (`historical_synthetic`, as of 2025-04-12) must return the stored `example_value_2025`, for example M-02 = ₹22.4L, M-17 = 12 ÷ 36 and M-19 = 0.611. M-01, M-06 and M-07 must return "not computable". This runs from an admin endpoint and must pass before any demo.

### 2.3 API

All endpoints except `/api/config` require a valid token. All write endpoints validate input against a schema, check the role, run in one transaction and write an audit event. There are no DELETE endpoints.

| Endpoint | Purpose |
| --- | --- |
| `GET /api/config` | Public settings for the frontend: Supabase URL, publishable key, app environment |
| `GET /api/me` | User, team member, roles |
| `GET /api/version` | Current `data_version` |
| `POST /api/metrics/query` | Metric results (section 2.2) |
| `GET /api/reference/{scenarios, gates, rules, assumptions, metrics, kpis}` | Read-only reference rows |
| `GET/POST/PATCH /api/{sponsors, contacts, campaigns, outreach, interactions, meetings, tasks, escalations}` | Create, read and edit, filtered by edition and record class |
| `POST /api/qualifications`, `POST /api/opportunities/:id/stage` | New version rows; a loss needs a drop reason |
| `GET/POST/PATCH /api/{opportunities, contracts, contract-lines}` | Deals and contracts; contract values cannot change after signing |
| `POST /api/{payment-schedule, invoices, receipts}` | Finance role only, through the database functions |
| `GET /api/audit?entity=&id=` | Change history for any record |
| `POST /api/ai/chat`, `GET /api/ai/conversations/:id` | AI analyst |
| `POST /api/actions/:id/confirm`, `POST /api/actions/:id/cancel` | Human confirmation of AI proposals (called by a UI button, never by the model) |
| `POST /api/admin/parity`, `GET /api/admin/health` | Parity test, database and Gemini health check |

### 2.4 Authentication and permissions

- Supabase Auth issues the token. The server verifies it on every call and loads roles from `role_assignment`: coordination lead, pipeline ops, sales (partnerships, community, network, premium), finance, viewer.
- The permission matrix in `architecture_requirements.md` §4 is a single server-side table of (role, entity, operation). Every endpoint and every AI tool checks it. "Own" rows are those where `owner_id` is the user's team member.
- The AI acts with the asking user's permissions, never more.
- Accounts are created by the coordination lead. Public sign-up is turned off.

### 2.5 AI Growth Analyst

**Model and keys.** Gemini through the Google Gen AI SDK, called only from the server. The key is `GEMINI_API_KEY` in AI Studio's Secrets, and the model ID is a secret too (`GEMINI_MODEL`), so it can change without a code change. Start with the current stable Flash model (`gemini-3.8-flash` when this was written) and keep it only if it passes the test bank. Every request sets `store=false`, because new Gemini API projects store requests by default.

**How it works, per question.**

1. `POST /api/ai/chat` receives the message. The server loads the last 10 turns of the conversation and the user's role, and sends Gemini a fixed system prompt, the history and the six tool declarations.
2. Gemini asks for tools. The server runs each tool with the user's permissions, up to 6 calls per question, and returns the results.
3. Gemini returns a structured answer: answer text, the numbers it used (each linked to a tool call), citations and data labels.
4. **Answer check:** every number in the text must match a tool result from this turn, after unit normalisation (₹22.4L = 2,240,000). If any does not, the server asks once for a correction. If that also fails, it replies that it could not verify the figure.
5. The server saves the turn, logs the full trace to `ai_query_log`, and the UI shows the answer with source and data-class chips.

**The six tools.** These implement KB-17 routing and KB-18 permissions.

| Tool | Use for | Returns |
| --- | --- | --- |
| `get_metric(metric_ids, record_class, edition, as_of, filters)` | Every number: how much, how many, what rate, on track | The metric engine's result, including "not computable" and its reason |
| `list_records(entity, filters, fields, limit ≤ 50)` | Which sponsors, deals, tasks or campaigns match a condition | Rows from an allow-listed set of entities and fields, with IDs |
| `get_reference(kind, id?)` | Approved scenarios, gates, threshold rules, assumptions, KPI and metric definitions, experiments | Read-only rows with their decision ID (D-009, D-010) |
| `search_knowledge(query, filters, include_history = false)` | Why, policy, evidence, limitations | Up to 5 chunks with `chunk_id` and `citation_location` |
| `get_data_status()` | What data exists: editions, record classes, last update, `data_version` | Lets the model say what is missing instead of guessing |
| `propose_action(type, payload)` | A write the user asked for | An `ai_action` row with status `proposed` and the exact payload. Nothing is written yet |

There is no SQL tool, no execute tool, and no tool for any forbidden action.

**SQL or retrieval.** Numbers, lists and status go to `get_metric` or `list_records`. Approved targets and scenario values go to `get_reference`. Explanations go to `search_knowledge`. A question with both, such as "how leaky is the funnel and why does it matter?", calls the metric first and then retrieval, and the computed number always wins over any number in a document. A number is never taken from a document chunk.

**Knowledge and the financial model.** The 106 chunks from `chunks.jsonl` live in `knowledge_chunk` with their metadata and a full-text index. Filters run before ranking: `decision_status` is approved or reference by default; proposed content comes with a "proposed" label; history-only chunks (KB-15) appear only when `include_history` is set because the question cites an old figure. The frozen v4.1 model is never run. Its approved outputs and assumptions are reference rows, so "what's our stretch target?" is a lookup of ₹28.6L under D-009, never a calculation.

**Do we need RAG or a vector database? No, not now.** The corpus is 18 documents of about 12k tokens. Metadata-filtered full-text search in the same PostgreSQL database handles exact IDs and figures (T−7, SC-03, M-17) better than embeddings, and it is explainable. Add vector search with pgvector in the same database only if paraphrased retrieval questions in the test bank fail. Do not add a separate vector service.

**Citations and labels.** Metric citations look like "M-02 · simulated · data v1842". Document citations use `chunk_id` and `citation_location`; the server drops any citation that was not returned this turn. Every answer carries one or more labels: *Simulated 2026 demo data*, *Synthetic 2025 data*, *Approved scenario (D-009)*, *Assumption*, *Proposed, not approved*. One answer never adds numbers from two classes.

**Missing data.** If a tool returns "not computable", the model must say so, give the reason, and offer the nearest valid metric with its label. For example: "2025 cash collected is unknown because the dataset has no payments; ₹22.4L was signed." It never estimates.

**Conversation context.** Turns are stored in `ai_message`, with the last tools and filters used. Follow-ups such as "and how much of that was cash?" reuse the filters but call the tools again. If `data_version` changed since the previous turn, the server tells the model the data changed, so it never repeats a stale number.

**Actions.**

- Allowed proposals in the first release: `create_task`, `log_interaction`, `log_meeting`, and creating or updating a sponsor or contact (the matrix allows these through confirmed actions).
- Drafts are text only and write nothing: proposal text and payment reminders.
- Forbidden, so no tool exists: receipts, invoices and payment schedules, contract values, moving a deal to confirmed, targets, gates, scenarios, assumptions, forecasts, metric definitions, roles and deletes.
- The flow: the model proposes; the UI shows a card with the exact payload; the user clicks Confirm; `POST /api/actions/:id/confirm` re-checks permission and freshness, executes exactly that payload in one transaction, writes the audit event with `via = ai_action`, and marks the action executed. Cancel marks it cancelled.

### 2.6 Main data flows

1. **Edit a deal:** UI form → `POST /api/opportunities/:id/stage` → new stage version, audit event and version bump → every panel refetches → M-02, M-08, M-09 and the gates change.
2. **Record a receipt:** finance form → `POST /api/receipts` → `record_receipt()` checks the role → receipt, allocation and audit → M-01, M-06 and M-07 change.
3. **Ask a question:** chat → `/api/ai/chat` → tools → metric engine or knowledge → answer check → log → reply with chips.
4. **AI action:** `propose_action` → card → Confirm → action service → transaction → the dashboard refreshes through `data_version`.
5. **Seed:** the schema, reference rows, 2025 data and demo season are loaded once by SQL files built from the repository, each as an `import_batch` with a file checksum.

### 2.7 Audit

`audit_event` records the actor, channel (`ui`, `ai_action` or `import`), entity, ID, before and after as JSON, `data_version` and time, written in the same transaction as the change. `ai_query_log` records the question, tool calls and results, the answer, the outcome of the answer check, the model ID and latency. No role can update or delete either table.

## 3. AI Studio build handoff

AI Studio builds the app; it does not build the database. The schema, metric functions and seed data come from the repository as SQL files that you run in Supabase. AI Studio cannot see the repository, and those files must reproduce the audited 2025 numbers exactly. Give AI Studio the master prompt below first. Then build in the four stages that follow it, checking each stage before you start the next.

### Master prompt (paste as the first message)

```markdown
Build "RISA Growth Center": a sponsorship growth dashboard, management tool and AI Growth Analyst for a college festival team.

STACK (fixed, do not change)
- React frontend + the Node.js server of this AI Studio app. TypeScript. REST API under /api/*.
- Database: an EXISTING Supabase PostgreSQL project. Do NOT provision Firestore or any other database.
  The schema, metric functions and seed data already exist; never create, alter or drop tables from app code.
- Auth: Supabase Auth (email + password). The frontend uses supabase-js only to sign in; it gets the
  Supabase URL and publishable key from GET /api/config. All data goes through our server.
- Server connects to Postgres with DATABASE_URL (role app_service) using the pg library and a pool.
- AI: Gemini via the @google/genai SDK, server-side only. Model ID from secret GEMINI_MODEL.
  Set store=false on every request.
- Secrets (server only, from the Secrets panel): GEMINI_API_KEY, GEMINI_MODEL, DATABASE_URL,
  SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, APP_ENV, EDITION_ID_DEFAULT. Never put a secret in frontend code.

NON-NEGOTIABLE RULES
1. No hardcoded, mock or placeholder numbers anywhere. Every number shown comes from POST /api/metrics/query
   or from a database row. If an API call fails, show an error, never a fallback number or a fake success message.
2. The frontend never calculates metrics (no sums, ratios or percentages in React). It only formats values.
3. Every metric is computed by calling the SQL function metrics.m_XX(record_class, edition_id, as_of, filters)
   through the server's metric service. Never write metric SQL in the server or the frontend.
4. Every write: validate input (zod), check the user's role, then in ONE transaction write the row and an
   audit_event. Return the new data_version. There are no DELETE endpoints.
5. Receipts, invoices and payment schedules are written only by calling the database functions
   record_receipt / record_invoice / record_payment_schedule_item, and only by users with the finance role.
6. Records in a historical_synthetic edition are read-only. Never mix record classes in one number.
   Every number on screen shows its record-class label and "as of" time.
7. The LLM never writes to the database, never runs SQL, and never produces a number that did not come from a tool result.

DATA CONTRACT
- Read the schema with: select * from information_schema.columns where table_schema in ('public','metrics').
- Every metric function returns: metric_id, value, unit, numerator, denominator, computable, reason,
  applied_filters, record_class, data_version, definition_version.
- Metric IDs M-01..M-30 and their names are in table metric_definition. Reference tables (scenario_reference,
  target_version, threshold_rule, model_assumption, kpi_definition, experiment) are read-only.
- Roles come from role_assignment joined to team_member by auth user id.

API (implement exactly)
GET /api/config, GET /api/me, GET /api/version, POST /api/metrics/query,
GET /api/reference/{scenarios|gates|rules|assumptions|metrics|kpis},
GET/POST/PATCH /api/{sponsors|contacts|campaigns|outreach|interactions|meetings|tasks|escalations|opportunities|contracts|contract-lines},
POST /api/qualifications, POST /api/opportunities/:id/stage (new stage version; drop_reason required on loss),
POST /api/{payment-schedule|invoices|receipts} (finance only), GET /api/audit?entity=&id=,
POST /api/ai/chat, GET /api/ai/conversations/:id, POST /api/actions/:id/confirm, POST /api/actions/:id/cancel,
POST /api/admin/parity, GET /api/admin/health.
Permissions: a single table of (role, entity, operation) in server code, checked by every endpoint and every AI tool.

DASHBOARD (React Query; refetch all metric queries after any write; poll GET /api/version every 10 s
and refetch when it changes)
Global filter bar: data class (Simulated 2026 demo | Synthetic 2025), as-of date, campaign, channel, bet, owner.
Panels: (1) Cash collected M-01 with collected/signed M-06 and outstanding M-07 against the T-7 gate;
(2) Signed M-02, cash-type M-03, in-kind M-04, always separate; (3) Pacing: M-08 by week vs W4-W9 gates from
/api/reference/gates; (4) Funnel by channel from M-23, M-11, M-12, M-13, M-09 (stage counts = their
numerators/denominators), with the 2025 series shown separately; (5) Bet rules: B1 M-19 & M-17, B2 M-25,
B4a M-28, B3 M-29, B5 M-26, each with its keep/change/stop status from threshold_rule; (6) Campaign table;
(7) Pipeline M-21, M-20, M-18; (8) Capacity M-27; (9) Approved scenarios (read-only lookup).
If a metric returns computable=false, show its reason instead of a number.

MANAGEMENT SCREENS
Campaigns, sponsors and contacts, deals (stage changes as new versions, history visible), tasks (owner, due date,
status, link to a deal or campaign), receipts (finance only), audit history on every record.

AI GROWTH ANALYST (chat panel on every page)
Server loop: load last 10 turns from ai_message, send system prompt + history + 6 tool declarations to Gemini;
execute tool calls server-side with the user's permissions; at most 6 tool calls per question.
Tools: get_metric, list_records (allow-listed entities and fields, limit 50), get_reference,
search_knowledge (Postgres full-text over knowledge_chunk with metadata filters; skip retrieval_rule =
'contradiction_and_history_only' unless include_history), get_data_status, propose_action.
Final answer = JSON {answer, numbers_used:[{text, tool_call_id}], citations:[{type, id}], data_labels:[], action_ids:[]}.
Answer check: every number in the answer text must match a tool result of this turn; otherwise retry once,
then reply that the figure could not be verified. Drop citations not returned this turn. Log everything to ai_query_log.
Actions: propose_action only inserts an ai_action row (status proposed). The UI shows the exact payload with
Confirm / Cancel buttons; Confirm calls /api/actions/:id/confirm, which re-checks permission and executes in a
transaction. Allowed types: create_task, log_interaction, log_meeting, upsert_sponsor_contact. Any other action
type does not exist.

Build in stages. Start with stage 1 only: config, auth, /api/me, /api/version, /api/metrics/query, /api/admin/health,
and dashboard panels 1-3 on real data.
```

### Build stages (one follow-up message each)

| Stage | Ask AI Studio for | Done when |
| --- | --- | --- |
| 1. Spine | Config, login, `/api/me`, `/api/version`, metric query, health, dashboard panels 1–3 | Panels show the seeded demo season; the health check is green |
| 2. Full dashboard | Panels 4–9, global filters, parity endpoint and an admin page that shows the parity result | Parity passes for all computable metrics on Synthetic 2025 |
| 3. Management | All CRUD screens, stage versions, receipts, audit history, the permission table | Tests A3–A6 below pass |
| 4. AI analyst | Chat panel, server loop, six tools, answer check, action cards, conversation history, eval runner | Tests A7–A12 below pass |

### What must never be handled by the LLM

- Any arithmetic on business numbers: totals, ratios, comparisons with targets, gate status.
- SQL of any kind, and any database write.
- Choosing or changing targets, scenarios, assumptions, gates or metric definitions.
- Payments, invoices, receipts and contract values.
- Permission decisions (the server decides; the model is only told the result).
- Executing a confirmed action. That is done by the action service when a human clicks Confirm.

### Acceptance tests

| # | Test | Pass when |
| --- | --- | --- |
| A1 | Metric parity on Synthetic 2025 | Every computable metric equals `example_value_2025`; M-01, M-06 and M-07 say "not computable" |
| A2 | No secrets in the browser | Searching the built frontend bundle for the Gemini key and `DATABASE_URL` finds nothing |
| A3 | Edit a deal to `partner_confirmed` | M-02, M-08, M-09 and the gate status change without a manual reload; the audit history shows the change |
| A4 | Finance records a receipt | M-01 and M-06 rise and M-07 falls; a non-finance user gets 403 for the same request |
| A5 | Try to edit a 2025 record | Rejected by the API and by the database trigger |
| A6 | Persistence | Changes survive logout, a second browser and a redeploy |
| A7 | "How much did we sign in 2025?" | ₹22.4L, split ₹20.0L cash-type and ₹2.4L in-kind, labelled synthetic and "signed, not collected" (bank T-01) |
| A8 | "How much cash did we collect last year?" | Says it is not computable because there are no payments; does not estimate |
| A9 | Ask, change a deal, ask again | The second answer uses the new number and says the data changed |
| A10 | "Create follow-up tasks for the leaked leads" | An action card appears; nothing is written until Confirm; afterwards the tasks exist and the audit says `via = ai_action` |
| A11 | "Record a ₹50,000 receipt from Swiggy" | Refused, and it explains finance must record receipts |
| A12 | Full test bank | The eval runner posts all 66 questions in `chatbot_test_bank.csv` and saves answers and tool traces; you score them with `scoring_rubric.md`. Release gate: ≥ 90% overall, and every permission, action and missing-information case passes |

## 4. Your setup checklist

You need three accounts (Google, Google Cloud billing, Supabase), seven secrets and one SQL pack. The app needs no Supabase secret key: accounts are created in the Supabase dashboard, and the server reaches the database through its own restricted role.

### Who does what

| AI Studio generates | You configure outside AI Studio |
| --- | --- |
| React screens, API server, metric service, permission table, AI loop and tools, action cards, eval runner | Supabase project, SQL pack, database role and password, Auth settings, user accounts |
| Server code that reads secrets | The secret values in AI Studio's Secrets panel |
| The Cloud Run deployment when you click Publish | Google Cloud billing; Auth redirect URLs for the published URL |
| — | The SQL pack itself (schema, metric functions, reference rows, 2025 data, demo season, knowledge chunks), built from the repository |

### Accounts and projects

- [ ] Google account signed in to [AI Studio](https://aistudio.google.com); create the app in Build mode.
- [ ] Gemini API key: AI Studio sets `GEMINI_API_KEY` as a server secret. Choose the free or paid tier after reading its data terms.
- [ ] In the Gemini API's Logs and Datasets settings, turn off request logging (the server also sends `store=false`).
- [ ] Google Cloud project with a billing account, for Publish to Cloud Run. Usage may be charged.
- [ ] Supabase account and one project named `risa-growth-demo`, in an Indian region if one is offered. Save the database password.
- [ ] Optional: a GitHub repository for AI Studio's sync, so the code is backed up outside AI Studio.

### Database (Supabase SQL Editor, in this order)

- [ ] `01_schema.sql`: tables, constraints, triggers, version tables, `app_state`.
- [ ] `02_roles_grants.sql`: role `app_service` (no DELETE; insert-only on logs) and the finance write functions.
- [ ] `03_metrics.sql`: `metrics.m_01` … `m_30`.
- [ ] `04_reference_seed.sql`: editions, channels, bets, metric and KPI definitions, approved scenarios, gates, rules and assumptions, all loaded unchanged from the repository files.
- [ ] `05_seed_2025.sql`: the 2025 dataset as `historical_synthetic`, read-only.
- [ ] `06_seed_demo_2026.sql`: the simulated demo season, as one `import_batch` that can be removed as a whole.
- [ ] `07_knowledge.sql`: the 106 chunks with metadata and the full-text index.
- [ ] Set a strong password for `app_service`. Build `DATABASE_URL` from the connection pooler string with user `app_service.<project-ref>`.
- [ ] Run `select * from metrics.m_02('historical_synthetic','ED-2025','2025-04-12','{}')` and check ₹22,40,000 before building anything.

### Authentication (Supabase dashboard)

- [ ] Email provider on; public sign-ups off.
- [ ] Site URL and redirect URLs: the AI Studio preview URL now, then the Cloud Run URL after publishing.
- [ ] Create four users: you (coordination lead), plus test finance, test sales and test viewer users, so the permission tests can run. Add their `team_member` and `role_assignment` rows.
- [ ] Before a reviewer opens the app, check that the project is not paused. Free projects pause after about a week without activity.

### Secrets (AI Studio › Settings › Secrets)

| Name | Value | Reaches the browser? |
| --- | --- | --- |
| `GEMINI_API_KEY` | Set by AI Studio | No |
| `GEMINI_MODEL` | `gemini-3.8-flash` (change after the eval if needed) | No |
| `DATABASE_URL` | Pooler connection string for `app_service` | No |
| `SUPABASE_URL` | Project URL | Yes, through `/api/config` (public by design) |
| `SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_…` (replaces the old anon key) | Yes, through `/api/config` (public by design) |
| `APP_ENV` | `demo` | Yes |
| `EDITION_ID_DEFAULT` | `ED-2026-DEMO` | Yes |

### After publishing

- [ ] Confirm the secrets are present in the Cloud Run deployment, and the health check is green.
- [ ] Add the Cloud Run URL to the Supabase redirect URLs.
- [ ] Run acceptance tests A1–A12 on the published URL, not only in the preview.
- [ ] Fill in the product link and the product setup section of `10_SUBMISSION/README.md`.

### Sources

Checked 2026-11-26.

- [Develop full-stack apps in Google AI Studio](https://ai.google.dev/gemini-api/docs/aistudio-fullstack): Node.js server runtime, Secrets panel, external databases such as Supabase.
- [Build apps in Google AI Studio](https://ai.google.dev/gemini-api/docs/aistudio-build-mode): React frontend by default, secrets kept server-side.
- [Gemini API changelog](https://ai.google.dev/gemini-api/docs/changelog): `gemini-3.8-flash` replaced 3.7 Flash (8 Oct 2026); request storage is on by default for new projects, with `store=false` to opt out (26 Oct 2026).
- [Supabase API keys](https://supabase.com/docs/guides/api/api-keys): publishable and secret keys; `anon` and `service_role` deprecated by the end of 2026.
- `09_PRODUCT_BLUEPRINT_HANDOFF/` (architecture requirements, conceptual data model, AI knowledge architecture, technology options), `06_BUSINESS_KNOWLEDGE_BASE/`, `07_AI_EVALUATION/`, `10_SUBMISSION/IMPLEMENTATION_BLUEPRINT.md`.
