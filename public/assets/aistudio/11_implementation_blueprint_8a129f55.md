# Implementation blueprint: building the Growth Center

Stage 9 · 2026-11-26 · an ordered build plan for Part 2 of the assignment (dashboard, campaign and task management, embedded AI analyst). It turns the Stage 3 handoff (`../09_PRODUCT_BLUEPRINT_HANDOFF/`) into steps, separates what is essential from what can wait, and says how to know each step is done. Technology choices are suggestions pending the open decisions; nothing here changes D-009 or D-010.

## What the assignment will test, and what that means for the build

| Assessment (weight) | What a reviewer will do | What the build must guarantee |
|---|---|---|
| Dashboard and management (20%) | Change campaign data and check the analytics | Every chart reads from the metric layer; edits save and recompute immediately |
| AI analyst (20%) | Ask unfamiliar questions, change data, ask for calculations, ask things the data cannot answer, ask follow-ups | Numbers come from tools, never from the model's text; "cannot answer" is a valid tool result; actions need confirmation |
| Ownership and communication (5%) | Read the README | The product setup section of `README.md` §11 is filled in |

## Step 0: decisions to make first (yours)

Defaults are given so the build can start; change any you disagree with. Full options: `../09_PRODUCT_BLUEPRINT_HANDOFF/open_technical_decisions.md`.

| Decision | Suggested default |
|---|---|
| First-release scope (OD-18) | The essential steps below; premium inventory, forecasting job and integrations later |
| Database and hosting (OD-01, OD-03) | Managed PostgreSQL with built-in authentication (for example Supabase, which the assignment lists); a separate demo project for simulated data |
| AI model and orchestration (OD-07, OD-08) | Any model with reliable tool calling (for example Gemini through Google AI Studio, which the assignment lists); direct tool calling, no agent framework |
| "Overdue proposal" (OD-20) | Proposal sent and no stage change for more than 5 days |
| "Recovered lead" (OD-21) | A qualified lead that passed day 7 without a deal record and later got a proposal |
| Escalation owner (OD-22) | The coordination lead for every rule in the first release |
| Simulated season data | Allowed by the assignment: generate a 2026 in-progress season, labelled `simulated`, kept apart from the 2025 `historical_synthetic` data |

## Essential path (do in this order)

### 1. Database and seed data
- Create the first-release tables from `../09_PRODUCT_BLUEPRINT_HANDOFF/conceptual_data_model.md`: sponsor, contact, category, channel, campaign, outreach attempt, interaction, meeting, qualification version, opportunity, opportunity stage version, contract, contract line, payment schedule item, invoice, receipt, receipt allocation, task, team member, target version, threshold rule, KPI and metric definition, AI action, audit event. Every table gets `record_class`.
- Enforce the invariants that protect the numbers: receipts only `live` or `simulated`; signed value only at `partner_confirmed`; stage and qualification as append-only versions; no hard deletes.
- Load the 2025 dataset as `historical_synthetic` (read-only) and a simulated 2026 season as `simulated`.
- **Done when** the 2025 rows reproduce 180 brands, 24 confirmed partnerships, ₹22.4L signed (₹20.0L cash-type), and the 12-of-36 handoff leak.

### 2. Metric layer
- One SQL view or function per metric in `../06_BUSINESS_KNOWLEDGE_BASE/metric_definitions/metric_dictionary.csv` (start with M-01 to M-24), each taking an as-of date and a record class.
- **Done when** every metric run on the 2025 rows equals its stored `example_value_2025` (the parity test), and M-01, M-06, M-07 return "not computable" on 2025 data and real values on the simulated season.

### 3. Dashboard (measure and diagnose)
- Funnel by channel and bet (leads → conversations → proposals → deals → signed → collected), with denominators.
- Targets vs actuals: the W4–W9 signed-value gates and the T−7 cash gate for the chosen scenario, with the approved base / plan / stretch shown read-only beside them.
- Campaign table: each campaign's rates against its 2025 benchmark and its threshold rule, flagged keep / change / stop.
- Cash view: signed, invoiced, collected, outstanding and in-kind kept in separate columns.
- Capacity view ("budget"): planned vs logged person-weeks, since no cash budget exists.
- **Done when** editing one deal's stage or adding one receipt changes every dependent number without a reload trick.

### 4. Management tool (execute)
- Create and edit campaigns, sponsors, contacts, deals (each stage change a new version, drop reason required on loss), tasks (owner, due date, status, dependency, link to a deal or campaign), and receipts (finance role only).
- Rules: SLA clock on every qualified lead (alert at day 7), overdue-proposal list, threshold evaluation that raises an escalation.
- **Done when** changes persist across sessions and appear in the dashboard and the audit log.

### 5. AI analyst
- Tools: `get_metric(metric_id, filters, as_of)`, `get_scenario(id)`, `get_register(kind, id)`, `search_knowledge(query, filters)` over `../06_BUSINESS_KNOWLEDGE_BASE/chunks.jsonl` (skip superseded chunks), `propose_action(type, payload)` and `execute_action(id)` after the user confirms. Routing and permission rules: KB-17 and KB-18.
- Server-side checks: the AI acts with the user's role; every number in an answer must appear in a tool result of that turn; forbidden actions (payments, targets, scenarios, forecasts, deletes) do not exist as tools.
- Keep the conversation history so follow-ups resolve ("and how much of that was cash?").
- **Done when** the 66-case test bank (`../07_AI_EVALUATION/`) passes the release gate: at least 90% overall, and every permission, action and missing-information case passes. Regenerate expected values with `build_test_bank.py` against the database the assistant reads.

### 6. One complete demo workflow (required by the assignment)
1. Ask: "Which campaign is leaking the most qualified leads?" → the analyst runs the handoff-leak metric by campaign and cites it.
2. Follow-up: "Why does that matter for the target?" → explains B1 using the knowledge base, labelling assumptions.
3. "Create follow-up tasks for the leaked leads" → it shows the draft tasks; you confirm; they appear in the task list and the dashboard's overdue count changes.
4. "How much cash did we collect last year?" → it says the data has no payment records, so it cannot be known, and gives signed value instead, labelled.
5. Change a deal in the tool, ask again → the answer changes.

### 7. Test, deploy, document
- Re-run the parity test and the 66 cases on the deployed version; test a data change and a page reload for persistence.
- Fill in the product setup section and the live link in `README.md`.

## Enhancements (after the essential path)

| Enhancement | Why it is not essential |
|---|---|
| Premium inventory module (slots, holds, exclusivity) | Only matters if B5 runs (stretch only) |
| In-season re-forecast job using the frozen model | Process not yet approved (OD-12); approved scenarios suffice for gates |
| Hours log and staffing plan screens | Valuable from W1, but a spreadsheet import works first |
| Email, calendar or bank-statement integrations | Manual entry covers every workflow (`integration_requirements.md`) |
| Vector or hybrid retrieval | The knowledge base is small; add only if paraphrased questions fail the tests |
| Row-level security in the database | The service layer enforces roles first; add database policies for financial tables next |
| Mobile-optimised logging screens | Confirm the team needs it (OD-14) |
