# AI Studio Reference Pack — Read This First

This is a curated subset of the RISA Growth Intelligence repository for building the Sponsorship Growth Platform. RISA is the assignment issuer, not the product name.

## Authority and usage

1. `01_conceptual_data_model.md` is the proposed canonical entity/attribute/relationship model. Use exact field names, enums, relationships and provenance rules. Do not invent fields to fit UI forms.
2. `02_architecture_requirements.md` and `10_technical_architecture_handoff.md` govern backend boundaries, permissions, APIs, record classes and metric calculation responsibilities. Where endpoint details are not exact, report the gap; do not silently invent a route.
3. `05_metric_dictionary.csv` is the single source of truth for metric IDs, names, formulas, units, denominators and inclusion/exclusion rules. Never infer metric meaning from an ID.
4. `06_campaign_performance_historical_synthetic.csv` is a curated historical campaign summary for the synthetic 2025 assignment dataset. It is a benchmark/reference only, not current live data and not permission to fabricate 2026 activity.
5. `08_D009_approved_baseline.md` and `09_D010_approved_strategy.md` contain approved decisions. Do not alter them or silently replace their assumptions.
6. `07_glossary.md` governs project terminology and identifiers.
7. `11_implementation_blueprint.md` describes build order and acceptance intent. It does not override the canonical data model or metric dictionary.

## Provenance rules

- `historical_synthetic`: supplied 2025 assignment dataset; preserve read-only.
- `simulated`: invented demo-season records; explicitly label as simulated.
- `live`: future real operating data; do not imply any exists yet.
- External research, assumptions and model outputs must retain their own provenance labels.

## Current build context

The application shell and Overview are already built in Google AI Studio. The Campaigns frontend module has also been generated, but no backend/database is connected and end-to-end persistence has not been verified. The current Campaigns implementation must be audited against these source files before additional modules are built.

## Campaign model quick reference

The canonical `CAMPAIGN` entity fields are:
- `campaign_id` (PK)
- `edition_id` (required FK)
- `name` (required)
- `channel_id` (required FK)
- `bet_id` (FK)
- `owner_member_id` (FK)
- `planned_start`
- `planned_end`
- `objective`
- `status` (`planned` / `active` / `stopped` / `closed`)

Do not add campaign-level `planned_person_weeks` or `planned_hours` unless a separately approved schema change is created. Planned person-weeks belong in `STAFFING_ALLOCATION`; logged hours belong in `TIME_LOG`, linked to tasks/member/bet.
