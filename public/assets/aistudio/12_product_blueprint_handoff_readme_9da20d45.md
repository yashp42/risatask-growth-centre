# Product blueprint handoff

Phase 6 · version 1.0 · 2026-11-26 · **status: proposed handoff to Stage 8.** Nothing in this folder is a final design or technology decision, and nothing has been built.

## What the Growth Center is for

The approved strategy (D-010, five bets) and baseline (D-009: ₹21.2L base, ₹26.1L plan, ₹28.6L stretch of cash collected before the fest) can only be run and tested if the team records what the 2025 dataset never did: receipts, invoices, payment schedules, inventory sales, drop reasons, committed introductions, renewal interest, hours. Of the 43 KPIs that govern execution, 28 cannot be measured on the 2025 data and 3 more only partly (KPI dictionary, `available_in_2025_dataset`). The Growth Center is the system that makes them measurable, and the AI analyst is the interface that answers questions from it without inventing numbers.

## What is in this folder

| File | Contents |
|---|---|
| `architecture_requirements.md` | 34 functional, 6 data and 11 non-functional requirements, each traced to D-009, D-010, a KPI or the brief; proposed role permission matrix |
| `conceptual_data_model.md` | 59 entities in 7 domains, each with purpose, primary key, attributes, relationships, constraints, provenance and an example; record-class separation; 12 business invariants; lineage from the 2025 database; KPI coverage |
| `data_model/` | `er_diagram.svg` / `.png`, `entity_catalogue.csv`, `attribute_catalogue.csv`, `lineage_2025.csv`, `kpi_entity_coverage.csv` |
| `AI_knowledge_architecture.md` | Components, routing (SQL, retrieval, hybrid, lookup, action, refuse), knowledge-store filters, controls against invented numbers and unsafe actions, evaluation gate |
| `integration_requirements.md` | 13 inbound and 5 outbound flows, the first-release method for each, validation at every boundary; unknown team tools flagged |
| `technology_options_report.md` | Options, advantages, limitations, complexity, cost and a provisional recommendation for the database, analytical engine, retrieval, AI orchestration, storage and pipelines, security and governance |
| `open_technical_decisions.md` | 19 technology decisions and 9 business definitions Stage 8 must close, with options, provisional recommendation, dependencies and timing |
| `build/` | `model_spec.py` (the data model as code) and `build_data_model.py` (generates the model files and checks them against the KPI dictionary, metric dictionary and database) |

## Reading order for a product engineer

1. `05_STRATEGY/D010_approved/D010_DECISION_RECORD.md` and `04_FINANCIAL_MODELLING/scenario_catalogue.csv` (what is approved).
2. `architecture_requirements.md` (what the system must do).
3. `conceptual_data_model.md` with `data_model/er_diagram.svg` (what it must store).
4. `06_BUSINESS_KNOWLEDGE_BASE/metric_definitions/metric_dictionary.csv` (how every number is computed).
5. `AI_knowledge_architecture.md`, then `07_AI_EVALUATION/README.md` (how the AI works and how it is tested).
6. `technology_options_report.md` and `open_technical_decisions.md` (what is left to decide).

## What Stage 8 must design

1. **Workflows and screens** for each bet: the B1 handoff SLA and weekly review, B2 contract-to-cash (schedule, invoice, receipt, reconciliation), B4a renewal screening, B4b and B3 referral tracking, B5 inventory holds and sales (only if B5 runs), gates and escalations, hours logging.
2. **The physical schema** from the conceptual model: types, indexes, how the invariants INV-01–INV-12 are enforced, the polymorphic links, migrations.
3. **The metric runtime** and its parity test against the stored 2025 example values.
4. **The AI tool contract** in code (`get_metric`, `get_scenario`, `get_register`, `search_knowledge`, `propose_action`, `execute_action`), the answer checks and the logs.
5. **Environments, access and operations**: production and demo separation, roles, backups and a restore test, handover notes for next year's team.

## What Stage 8 must decide

The 28 items in `open_technical_decisions.md`. The ones that block everything else: first-release scope (OD-18), operational database and hosting (OD-01, OD-03), metric runtime (OD-02), the "overdue" and "recovered lead" definitions (OD-20, OD-21), invoice issuance and receipt capture (OD-15, OD-16), and actual team size (OD-27).

## What must not change

- D-009 values and the frozen v4.1 model (checksums in `04_FINANCIAL_MODELLING/output_checksums.csv`); the product reads them, never writes them.
- D-010 bets, ranking and thresholds; changes need a new decision record.
- Original source files and `sponsor.duckdb` (SHA-256 recorded); the product treats them as read-only history.
- The separation of cash, signed and in-kind value, and of synthetic, researched, modelled, simulated and live records.

## Verification

`08_REPRODUCIBILITY/phase6_verify.py` checks this folder: required files present, the data model builds and passes its own checks, every requirement's KPI and entity references resolve, the options report covers every area with every required heading, every open-decision reference resolves, every mermaid diagram renders, and the frozen and approved files are unchanged. Result: `08_REPRODUCIBILITY/VERIFY_PHASE6.md`.
