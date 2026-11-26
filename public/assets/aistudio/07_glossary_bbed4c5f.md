# Glossary

Repository-wide glossary (Phase 7, version 1.0, 2026-11-26). It explains every abbreviation and identifier scheme used across the repository. The master report also has its own shorter glossary (report Table 0.3). Where one prefix is used for two different things, the context that tells them apart is given.

## 1. Evidence labels and record classes

| Label | Meaning |
|---|---|
| [D] | Dataset fact: computed from the synthetic 2025 assignment data |
| [B] | Benchmark: external research, almost always an asking price |
| [A] | Assumption: a judgement used as a model input |
| [C] | Calculation or model output |
| [T] | Approved operating target or rule (D-010), or a proposal labelled as such |
| [U] | Unknown: not answerable from available material; never filled in |
| `historical_synthetic`, `external_research`, `model_assumption`, `model_output`, `operating_plan`, `live`, `simulated` | The seven record classes (`02_DATA_FOUNDATION/data_dictionary/provenance_framework.md`). They are never mixed in one total |
| Signed value / cash-type / in-kind / cash collected | Signed (confirmed) value is the agreed value of a partnership. Cash-type is signed value whose consideration is cash. In-kind is goods or services. Cash collected is money received before the festival: the North Star. The 2025 data has signed value only |

## 2. Identifier schemes

| Pattern | What it identifies | Where defined |
|---|---|---|
| D-001 … D-010 | Decisions. D-009 = approved financial baseline (frozen v4.1 model); D-010 = approved five-bet strategy | `05_STRATEGY/D009_approved/`, `D010_approved/`, decision-log snapshot |
| P-01 … P-03 | Standing principles (e.g. P-03: every decision maps to data the product tracks) | Decision-log snapshot |
| A-001 … A-003, W-001 | Analysis and workstream decisions (SQL foundation; prospect research workstream) | Decision-log snapshot |
| B1 … B5, B4a, B4b | The five growth bets: B1 fix the funnel, B2 cash discipline, B3 gated VC/alumni introductions, B4 warm flywheel (B4a renewals, B4b creator scale-up), B5 pre-season premium inventory. (B1–B12 is also the prefix of audit checks, below) | D-010 |
| SC-01 … SC-14 | Scenarios. Only SC-01 Base, SC-02 Plan, SC-03 Stretch, SC-04, SC-05 are approved | `04_FINANCIAL_MODELLING/scenario_catalogue.csv` |
| F1 … F7, F4b, F4c | Frozen v4.1 output files (base ladder, grid, best feasible, headlines, bridge, title exclusivity, sensitivity; F4b base downside; F4c stretch downside). Rows of the F1 base ladder are steps S0, S1, … (not the D-010 S-files) | `04_FINANCIAL_MODELLING/` |
| A_*, B_* files | v4.1 calibration (A) and pricing (B) outputs | `04_FINANCIAL_MODELLING/calibration/`, `inventory/` |
| S1 … S10 | D-010 strategy outputs (Shapley attribution, bridge, effort, ranking, cold saving, small-sample intervals) | `05_STRATEGY/D010_approved/out/` |
| AS-01 … | Model assumptions | `02_DATA_FOUNDATION/curated_data/model_assumptions.csv` |
| K-NS-01, K-G-xx, K-B1-xx … K-F-xx | KPIs (North Star, gates, per bet, capacity, funnel) | `05_STRATEGY/kpi_dictionary.csv` |
| M-01 … M-30 | Metric definitions (formula, SQL) under the KPIs | `06_BUSINESS_KNOWLEDGE_BASE/metric_definitions/metric_dictionary.csv` |
| EX-B1a … EX-B5 | Experiments and operational decision rules | `05_STRATEGY/experiment_register.csv` |
| R-01 … R-20, R-SEASON | Risks | `05_STRATEGY/risk_register.csv` |
| C1 … C16 | Version-reconciliation entries (superseded vs current figures). In `04_FINANCIAL_MODELLING/audit/AUDIT.md`, C1, C2 are instead **critical findings** of the independent model audit | `05_STRATEGY/VERSION_RECONCILIATION.md` |
| M1 … M5, m1 … m7 | Major and minor findings of the independent v4.1 model audit (not metric IDs) | `04_FINANCIAL_MODELLING/audit/AUDIT.md` |
| U, R, T, G, B, C + number (e.g. U1, R1–R14, T7, G1, B12) | The 51 data-audit checks in `audit.results`: U uniqueness, R referential, T time, G target versions, B business rules, C categorical values | `02_DATA_FOUNDATION/sql/03_audit.sql`, `data_quality_report.md` |
| CL-01 … CL-41 | Claims in the evidence-to-claim register | `01_MASTER_REPORT/evidence_register.csv` |
| SRC-001 … | External sources (URL, publisher, access date) | `03_MARKET_RESEARCH/source_register.csv` |
| V1, V2, V3, A, U_local, U, U_out | Prospect route classes: A actual introduction; V1 structured route open to fests; V2 investor or network route; V3 local presence plus sourced activity; U_local Bengaluru HQ only; U unverified; U_out decision-makers outside Bengaluru | `03_MARKET_RESEARCH/prospect_methodology.md` |
| T1, T2 | Category tiers (T1 fintech, EV, quick commerce; T2 D2C, gaming). (T1–T7 is also the prefix of time audit checks) | D-008 |
| KB-01 … KB-18, KB-NN.M | Knowledge documents and their chunks | `06_BUSINESS_KNOWLEDGE_BASE/` |
| T-01 … T-66 | Chatbot test cases | `07_AI_EVALUATION/chatbot_test_bank.csv` |
| L1 … L5 | AI permission levels: read, analyse, recommend, draft, execute after confirmation (proposed) | KB-18 |
| FR-, DR-, NFR- | Functional, data and non-functional requirements (proposed) | `09_PRODUCT_BLUEPRINT_HANDOFF/architecture_requirements.md` |
| INV-01 … INV-12 | Business invariants of the conceptual data model (proposed) | `09_PRODUCT_BLUEPRINT_HANDOFF/conceptual_data_model.md` §5 |
| IN-01 …, OUT-01 … | Inbound and outbound integrations (proposed) | `integration_requirements.md` |
| OD-01 … OD-28 | Open technical and product decisions for Stage 8 | `open_technical_decisions.md` |
| 2025 record IDs (A027, SCON054, SC01–SC06, SI…, SA…, BQ…, O0xx, OH…, L001, T01/T02/T05) | Brand, contact, campaign, interaction, attempt, qualification-version, opportunity, stage-version, activation and owner IDs in the synthetic dataset | `02_DATA_FOUNDATION/data_dictionary/` |

## 3. Season calendar

| Term | Meaning |
|---|---|
| W−5 … W0 | The five pre-season weeks before the sales window (premium inventory selling, B5) |
| W1 … W10 | The ten weeks of the sales window |
| T−7 | Seven days before the festival starts: the cash gate (collected ÷ signed cash ≥ 0.85) |
| Pacing gates | Signed-value checkpoints at the end of W4–W9 (18 / 37 / 59 / 67 / 85 / 100% of expected signed value) |

## 4. Abbreviations

| Term | Meaning |
|---|---|
| ACTUAL / ASK / COST | Benchmark value kinds: a reported closed amount / a listed price / a cost to the organiser |
| AI | Artificial intelligence; here the proposed Growth Analyst assistant |
| API | Application programming interface |
| APM | Associate product manager (the assignment's role) |
| CRUA | Create, read, update, approve (permission matrix); combinations such as CR, RU or CRU use the same letters |
| CSV, DOCX, PDF, PNG, SVG, JSON, XLSX | File formats |
| CU-hour | Compute-unit hour (a database provider's billing unit) |
| D2C | Direct-to-consumer brands |
| DB | Database |
| DPDP | India's Digital Personal Data Protection Act (named only as a question for legal advice) |
| EDA | Exploratory data analysis (`eda.*` views) |
| ER diagram | Entity-relationship diagram |
| EV | Electric vehicle (sponsor category) |
| FK, PK, UQ | Foreign key, primary key, unique constraint |
| FMCG | Fast-moving consumer goods |
| FTE | Full-time equivalent |
| FX | Foreign exchange (USD listings converted to ₹) |
| FY | Financial year |
| GIN | Generalised inverted index (PostgreSQL full-text index) |
| GST | Goods and services tax |
| HQ | Headquarters |
| ID | Identifier |
| INR, ₹, lakh (L) | Indian rupee; 1 lakh = ₹1,00,000 |
| IST | India Standard Time (all 2025 timestamps are naive IST) |
| KPI | Key performance indicator |
| LLM | Large language model |
| LTS | Long-term support (software release line) |
| MB | Megabyte |
| MC | Monte Carlo simulation |
| MVT | Minimum viable test |
| NCR | National Capital Region (Delhi) |
| OS | Operating system |
| P10, P50, P90 | 10th, 50th and 90th percentiles of a simulated distribution |
| PO | Purchase order |
| PRI | The v4.1 model's dictionary of prior distributions (`model.py`), e.g. `PRI['collect_disc']` |
| pw | Person-week (40 hours) |
| QSR | Quick-service restaurant |
| RAG | Retrieval-augmented generation (answering from retrieved documents) |
| RNG | Random number generator (seeded in the v4.1 model) |
| RPO, RTO | Recovery point objective, recovery time objective (backups) |
| RRF | Reciprocal rank fusion (merging two search rankings) |
| SLA | Service-level agreement; here the B1 handoff rule (deal record ≤ 5 days, proposal ≤ 10 days after qualification) |
| SME | Small and medium enterprise |
| SQL | Structured query language |
| TLS | Transport layer security |
| UI | User interface |
| UPI | Unified Payments Interface (Indian instant payments) |
| URL | Web address |
| USD | US dollar |
| VC | Venture capital |
| VM | Virtual machine |

Proper names (festivals, institutions, companies) written in capitals, such as AYF, PULSE, NLSIU or KRAFTON, are names, not abbreviations, and are listed in `03_MARKET_RESEARCH/` registers with their sources.
