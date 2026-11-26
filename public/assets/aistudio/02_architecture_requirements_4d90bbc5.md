# Architecture requirements for the Growth Center

Phase 6 · version 1.0 · 2026-11-26 · **status: proposed** (requirements derived from approved decisions; the functional specification, priorities and first-release scope are decided in Stage 8).

This document says what any Growth Center architecture must support, and why. Every requirement traces to an approved decision (D-009, D-010), a KPI in `05_STRATEGY/kpi_dictionary.csv`, a principle (P-03) or the Stage 3 brief. It does not choose technology; `technology_options_report.md` compares options against these requirements.

Evidence labels follow the repository convention: [D] dataset fact, [A] assumption, [T] approved operating target or rule, [U] unknown.

## 1. Context the architecture must fit

| Fact | Label | Consequence for architecture |
|---|---|---|
| The 2025 dataset is synthetic: 180 brands, 270 contacts, 370 outreach attempts, 950 events, 58 opportunities, 24 partnerships | [D] | Data volumes are tiny. Even at several times this scale, the operational store holds thousands of rows per season, not millions. Scale is not a selection criterion; correctness, auditability and ease of operation are |
| Team: 60 window person-weeks plus 10 pre-season, about 6 FTE (≈ 12 students at half time) | [A] (D-010) | About 10–15 named users, few concurrent writers. Users are part-time and change every year |
| Roles: coordination lead, pipeline operations, finance and collections, partnerships, community, network, premium sales pair | [T] (D-010) | Role-based permissions map to these roles |
| Season: W−5 to W0 pre-season (premium selling), W1–W10 window, festival after W10; gates at W2, W4–W9 and T−7 | [T] | Availability matters most in a 15-week window; T−7 (cash gate) and weekly reviews are the critical moments |
| No cash budget exists | [U] | Prefer options with a free or low fixed tier; any spend needs an owner's approval (OD-19) |
| Current tools used by the team (email, calendar, messaging, accounting) are not recorded | [U] | Integrations are designed as optional adapters; the first release must work with manual entry (`integration_requirements.md`) |
| Who issues invoices (festival, institution finance office) and GST treatment are not recorded | [U] | The invoice model records invoice numbers and documents; issuing may stay outside the system (OD-15) |

## 2. Functional requirements

Priority is a proposal for Stage 8 (M = needed for the strategy to be measurable at all; S = needed in season; C = could wait). IDs are stable; Stage 8 may re-prioritise but should not renumber.

### 2.1 Pipeline and funnel (B1 Fix the funnel)

| ID | Requirement | Source | Priority |
|---|---|---|---|
| FR-01 | Register sponsors, contacts and categories; detect duplicates before insert; keep research targets separate from prospects until a recorded interaction with a named contact | Provenance rule 4; KB-03 | M |
| FR-02 | Log outreach attempts and their events (introduction received, inbound form, replied, meeting booked or held) against a campaign and channel | K-F-01, K-B1-07 | M |
| FR-03 | Record qualification as full-state versions; a "qualified" version starts the SLA clock | D-010 B1; K-B1-01, K-B1-02 | M |
| FR-04 | SLA tracking: deal record within 5 days and proposal within 10 days of qualification; alert at day 7 with no deal; list breaches | D-010 B1 playbook | M |
| FR-05 | A drop reason is mandatory to close or drop an opportunity, and for any qualified lead dropped without a deal | K-B1-05 | M |
| FR-06 | Flag recovered leads and tag every opportunity with the bet that produced it (definition of "recovered" open, OD-21) | K-B1-03, K-B1-04, K-B1-06 | S |
| FR-07 | Cold-only channels are inactive from W1 day 1; activating one needs a recorded decision | D-010 B1; K-B1-07 | M |
| FR-08 | Weekly review view: SLA breaches, handoffs, stalled proposals (definition of "overdue" open, OD-20) | D-010 B1 | S |
| FR-09 | Ownership history: who owned a sponsor or opportunity when, so handoff delays and owner load can be measured | 2025 leak analysis (KB-06.7) | S |

### 2.2 Cash discipline (B2)

| ID | Requirement | Source | Priority |
|---|---|---|---|
| FR-10 | Contracts with lines split into cash and in-kind; signed value = sum of lines; in-kind tracked with its own delivery status and never counted as cash | D-009 cash definition; K-G-01 | M |
| FR-11 | Payment schedule per contract (default: 50% advance at signing, balance at T−7; 100% upfront when the rule fires) | D-010 B2 playbook | M |
| FR-12 | Record invoices (or proforma invoices) issued on signing day; invoice numbers sequential and immutable once issued | K-B2-01 | M |
| FR-13 | Record receipts with date, amount, method and bank reference; allocate to schedule items or invoices; mark reconciled | K-NS-01, K-G-02, K-B2-02 | M |
| FR-14 | Compute outstanding and overdue balances from schedule and allocations (never typed) | M-07 | M |
| FR-15 | Payment reminders on day 3 and day 7 after signing; branding go-live gated on the advance clearing | D-010 B2 playbook | S |
| FR-16 | Flag deals whose cash will arrive after the fest (net-30/60 corporates) and exclude them from the North Star | D-010 B2 contingency | S |

### 2.3 Warm flywheel, introductions and premium inventory (B4a, B4b, B3, B5)

| ID | Requirement | Source | Priority |
|---|---|---|---|
| FR-17 | Renewal screening: list the 24 sponsors of the previous edition, log 24 screening calls by end of W2, record interest | K-B4a-01, K-B4a-02 | S |
| FR-18 | Network partners (creators, VC funds, alumni) with recruitment dates; referrals with commitment status; only committed introductions (named contact and agreed meeting) count | K-B4b-01, K-B3-02, K-B3-04 | S |
| FR-19 | Inventory assets, slots and a versioned rate card; holds with expiry; one sale per slot; sell-by dates (title W7) | K-B5-03, K-B5-05; D-010 B5 | S (only if B5 runs) |
| FR-20 | Exclusivity grants with scope (narrow or broad) attached to a title or presenting contract; no overlapping grants; one premium asset per category | K-B5-06; D-010 | S (only if B5 runs) |
| FR-21 | Realised price ÷ ask per premium deal, using the rate-card version in force | K-B5-04 | C |

### 2.4 Execution, gates and capacity

| ID | Requirement | Source | Priority |
|---|---|---|---|
| FR-22 | Tasks with owner, due date, status, dependencies and a link to the sponsor, opportunity, invoice, referral or campaign | Brief Part E | M |
| FR-23 | Threshold rules as versioned records; when a rule fires, raise an escalation to an owner and track it to closure (escalation owners are proposed, OD-22) | D-010 §7; KB-13.8 | S |
| FR-24 | Signed-value pacing gates W4–W9 and the T−7 cash gate, per approved scenario | K-G-01, K-G-02 | M |
| FR-25 | Hours log by task type and bet from W1; planned staffing per week | K-C-01, K-C-02, K-C-03 | S |
| FR-26 | Spend log against a cap (cap not set, OD-19) | K-C-04 | C |

### 2.5 Analytics, forecasting and AI

| ID | Requirement | Source | Priority |
|---|---|---|---|
| FR-27 | One metric layer: every KPI on the dashboard and in the AI comes from `metric_dictionary.csv` definitions and tested SQL | Brief Part F §D; KB-12 | M |
| FR-28 | Point-in-time queries ("as of D" = records before D + 1 day) for every versioned entity | Phase 4 rules | M |
| FR-29 | Show approved scenarios (SC-01–SC-03) read-only; never edit them | D-009 | M |
| FR-30 | In-season re-forecast as a separate, reviewed forecast version run with the frozen v4.1 model on observed values (process proposed, OD-12) | KB-13.7 | C |
| FR-31 | Experiment register with decision rules fixed before start and recorded results | 05_STRATEGY/experiment_register.csv | S |
| FR-32 | AI analyst answering through structured tools, document retrieval or both, with citations, under the permission model (proposed in KB-17, KB-18; see `AI_knowledge_architecture.md`) | Brief Part F | S |
| FR-33 | The AI test bank (66 cases) passes before the AI is released to the team | 07_AI_EVALUATION | S |
| FR-34 | Export of any list or KPI view to CSV or Excel | Finance and faculty reporting [A] | S |

## 3. Data requirements

| ID | Requirement | Source |
|---|---|---|
| DR-01 | Every stored row carries the provenance block (`record_class`, `import_batch_id`, `source_ref`, `evidence_class`, `data_version`, `created_at`, `created_by`, `ai_action_id`, `is_deleted`) | `provenance_framework.md`; `conceptual_data_model.md` §2 |
| DR-02 | Live and simulated records never share an environment; 2025 synthetic data, research and model outputs are reference data, never mixed into live totals | Brief Part E; principle 6 |
| DR-03 | No hard deletes; corrections are new versions or soft deletes | Brief: "Do not delete superseded work" (applied to records) |
| DR-04 | Records persist across editions (renewals need the previous edition's sponsors and values) | D-010 B4a |
| DR-05 | Business invariants INV-01–INV-12 enforced by the database or the service layer, not only by the UI | `conceptual_data_model.md` §5 |
| DR-06 | The approved scenario values and model outputs are loaded with their checksums and verified against `04_FINANCIAL_MODELLING/output_checksums.csv` | D-009; Phase 4 |

## 4. Proposed permission matrix

C = create, R = read, U = update (new version), A = approve or confirm, — = no access. "Own" means records the person owns. The AI acts with the permissions of the person asking and never more (KB-18, proposed).

| Data | Coordination lead | Pipeline ops | Partnerships / community / network / premium sales | Finance and collections | Viewer | AI analyst |
|---|---|---|---|---|---|---|
| Sponsors, contacts, research | CRU | CRU | CRU (own) | R | R | R; C/U via confirmed action (L5) |
| Attempts, interactions, meetings, qualification | CRU | CRU | CRU (own) | R | R | R; log via confirmed action |
| Opportunities and stage | CRUA | CRU | CRU (own) | R | R | R; draft only |
| Proposals | CRUA | CRU | CRU (own) | R | R | Draft (L4); never sends |
| Contracts and lines | CRUA | R | CR (own), U before signing | RU (payment terms) | R | Read |
| Payment schedule, invoices | R | R | R | CRUA | — | Read; draft reminder text only |
| Receipts and allocations | R | — | R (own deals, totals only) | CRUA | — | Read; **never writes** |
| Tasks | CRUA | CRU | CRU (own) | CRU (own) | R | C via confirmed action |
| Targets, rules, scenarios, metric definitions | R; changes need a decision record | R | R | R | R | Read; **never writes** |
| Forecast versions | A (publish) | R | R | R | R | Read; **never writes** |
| Escalations | CRUA | CRU | CRU (own) | CRU (own) | R | Read; may recommend |
| Hours, staffing | CRUA | CRU (own) | CRU (own) | CRU (own) | — | Read aggregates only |
| Audit log, AI logs | R | — | — | — | — | — |

An administrator role (system configuration, user accounts) is separate from every business role. Who holds it is OD-24.

## 5. Non-functional requirements

| ID | Requirement | Target (proposed) | Source |
|---|---|---|---|
| NFR-01 | Correctness of financial figures | Every rupee figure reproducible from rows and a metric definition; zero tolerance for AI-generated arithmetic on finance | Brief principle 15 |
| NFR-02 | Auditability | Every write attributable to a person (and to a confirmed AI action where relevant); append-only audit log | Brief Part J security |
| NFR-03 | Availability | Usable daily during W−5 to the festival; planned downtime outside working hours; a manual fallback (export) before T−7 | Season calendar [T] |
| NFR-04 | Recovery | Point-in-time restore or daily backups; restore tested once before W−5. Proposed RPO ≤ 24 h, RTO ≤ 1 working day | OD-17 |
| NFR-05 | Performance | Dashboards and AI tool queries return in a few seconds at expected volumes (≤ 10⁴ rows per table per season) | §1 volumes |
| NFR-06 | Concurrency | ~15 users, a handful writing at once; no lost updates on slots, receipts or stage changes (row-level locking or optimistic versioning) | §1 team |
| NFR-07 | Operability by a rotating student team | Managed services preferred over self-hosted; setup and handover documented; no component that needs a specialist to keep running | Team turnover [A] |
| NFR-08 | Cost | Fits a free or low fixed tier at expected volume; no cash budget exists [U] | OD-19 |
| NFR-09 | Security of sensitive data | Contact details (personal data), contract values, sponsor pricing and receipts restricted by role; minimum necessary data sent to any external AI provider | Brief Part J security |
| NFR-10 | Reproducibility | The 2025 analysis and the frozen v4.1 model stay reproducible byte-for-byte; the operational system never writes to them | D-009; Phase 4 |
| NFR-11 | Accessibility from phones | Core logging (interaction, meeting, task) usable in a mobile browser | Assumption [A]; confirm with the team (OD-14) |

## 6. Out of scope for the Growth Center (as currently defined)

- Changing the approved scenarios, the frozen model or D-010 thresholds from inside the product.
- Sending external messages on the team's behalf (KB-18 forbids it for the AI; for the product it is an integration decision, OD-13).
- Payment collection itself (gateway, UPI links). The system records receipts; collection happens in the festival's existing banking (OD-16).
- Attendee management and ticketing. Attendee metrics enter only as sponsor proof (`CONTRACT_DELIVERABLE`).

## 7. Traceability check

`08_REPRODUCIBILITY/phase6_verify.py` checks that every KPI cited here exists in the KPI dictionary, that every entity named in the requirements exists in the conceptual model, and that every role in the permission matrix matches the `ROLE_ASSIGNMENT` role list.
