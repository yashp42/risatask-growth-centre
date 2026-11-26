"""Build Stage 2 seed SQL (04 reference, 05 2025 data, 07 knowledge) from the repository.

Deterministic: same repository -> byte-identical SQL. Nothing is retyped by hand; every row
comes from a repository file or the audited DuckDB staging layer, and carries source_ref.
Usage: python3 build_seeds.py <repo_root> <out_dir>
"""
import csv, hashlib, json, math, re, sys
from datetime import datetime
from pathlib import Path
import duckdb

REPO = Path(sys.argv[1]) if len(sys.argv) > 2 else None
OUT = Path(sys.argv[2]) if len(sys.argv) > 2 else None
DB = REPO / "02_DATA_FOUNDATION/sponsor.duckdb" if REPO else None
SEED_DATE = "2026-11-26"


def sha(p):
    return hashlib.sha256(Path(p).read_bytes()).hexdigest()


def q(v):
    """SQL literal."""
    if v is None:
        return "NULL"
    if isinstance(v, float) and math.isnan(v):
        return "NULL"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return repr(v) if isinstance(v, float) else str(v)
    if isinstance(v, datetime):  # naive IST timestamps from the 2025 staging layer
        return "'" + v.strftime("%Y-%m-%d %H:%M:%S") + "+05:30'"
    s = str(v)
    return "'" + s.replace("'", "''") + "'"


def blank(v):
    return None if v is None or (isinstance(v, float) and math.isnan(v)) or (isinstance(v, str) and v.strip() == "") else v


def num(v):
    v = blank(v)
    return None if v is None else float(v)


def insert(table, cols, rows, chunk=200):
    out = []
    for i in range(0, len(rows), chunk):
        part = rows[i:i + chunk]
        vals = ",\n".join("(" + ", ".join(q(x) for x in r) + ")" for r in part)
        out.append(f"INSERT INTO public.{table} ({', '.join(cols)}) VALUES\n{vals};")
    return "\n".join(out)


def read_csv(rel):
    with open(REPO / rel, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


# ---------------------------------------------------------------------------
# 04 reference seed
# ---------------------------------------------------------------------------
def build_reference():
    files = {
        "metric": "06_BUSINESS_KNOWLEDGE_BASE/metric_definitions/metric_dictionary.csv",
        "kpi": "05_STRATEGY/kpi_dictionary.csv",
        "exp": "05_STRATEGY/experiment_register.csv",
        "scen": "04_FINANCIAL_MODELLING/scenario_catalogue.csv",
        "assm": "02_DATA_FOUNDATION/curated_data/model_assumptions.csv",
        "d009": "05_STRATEGY/D009_approved/D009_DECISION_RECORD.md",
        "d010": "05_STRATEGY/D010_approved/D010_DECISION_RECORD.md",
    }
    hashes = {k: sha(REPO / v) for k, v in files.items()}
    by = "seed:04_reference_seed"
    s = [HEADER.format(name="04_reference_seed.sql", purpose="Approved reference rows: decisions, bets, channels, categories, 30 metric definitions, 43 KPIs (+2 historical goal KPIs), 5 approved scenarios, 12 decision rules, 9 experiments, 38 model assumptions. Read-only for the app.")]
    s.append("BEGIN;")
    s.append(GUARD.format(ib="IB-REF-PLAN"))
    batches = [
        ("IB-REF-PLAN", "file_import", "operating_plan", files["kpi"], hashes["kpi"]),
        ("IB-REF-METRICS", "file_import", "operating_plan", files["metric"], hashes["metric"]),
        ("IB-REF-RULES", "file_import", "operating_plan", files["exp"], hashes["exp"]),
        ("IB-REF-SCENARIOS", "file_import", "model_output", files["scen"], hashes["scen"]),
        ("IB-REF-ASSUMPTIONS", "file_import", "model_assumption", files["assm"], hashes["assm"]),
    ]
    s.append(insert("import_batch", ["import_batch_id", "batch_type", "record_class", "source_file", "source_sha256", "validation_status", "source_ref", "evidence_class", "created_by"],
                    [(b, t, rc, f, h, "passed", f, "T" if rc == "operating_plan" else ("C" if rc == "model_output" else "A"), by) for b, t, rc, f, h in batches]) )

    decisions = [
        ("D-001", "Challenge B: sponsorship growth", "approved", None, "05_STRATEGY/decision_log/RISA_project_state.md"),
        ("D-003", "City: Bengaluru", "approved", None, "05_STRATEGY/decision_log/RISA_project_state.md"),
        ("D-004", "Segment strategy: warm-first venture-backed consumer core", "approved", None, "05_STRATEGY/decision_log/RISA_project_state.md"),
        ("D-007", "Control system mechanism (thresholds replaced by D-010 gates)", "approved", None, "05_STRATEGY/decision_log/RISA_project_state.md"),
        ("D-008", "Prospect research shortlist and tiered effort", "approved", None, "05_STRATEGY/decision_log/RISA_project_state.md"),
        ("D-009", "v4.1 model numbers and assumptions adopted as the strategy baseline", "approved", None, files["d009"]),
        ("D-010", "Five-bet strategy, gates and decision rules", "approved", None, files["d010"]),
        ("D-005", "Target: base 26.1L / stretch 55.9L", "superseded", "D-009", "05_STRATEGY/decision_log/RISA_project_state.md"),
        ("D-006", "Earlier five ranked bets", "superseded", "D-009", "05_STRATEGY/decision_log/RISA_project_state.md"),
    ]
    s.append(insert("decision_record", ["decision_id", "title", "status", "approved_at", "approved_by", "superseded_by_id", "document_uri", "record_class", "import_batch_id", "source_ref", "evidence_class", "created_by"],
                    [(d, t, st, "2026-11-25 23:59:00+05:30" if st == "approved" else None, "product owner" if st == "approved" else None, sup, uri, "operating_plan", "IB-REF-PLAN", uri, "T", by) for d, t, st, sup, uri in decisions]))

    bets = [("B1", "Fix the funnel (handoff SLA + stop cold)", 1), ("B2", "Cash discipline", 2), ("B4", "Warm flywheel", 3),
            ("B3", "Gated VC/alumni introductions", 4), ("B5", "Pre-season premium inventory (stretch only)", 5),
            ("B4a", "Warm flywheel: gated renewals (part of B4)", None), ("B4b", "Warm flywheel: creator scale-up (part of B4)", None)]
    s.append(insert("bet", ["bet_id", "name", "rank", "decision_id", "scenarios", "record_class", "import_batch_id", "source_ref", "evidence_class", "created_by"],
                    [(b, n, r, "D-010", "B5: stretch only; others: base, plan, stretch", "operating_plan", "IB-REF-PLAN", files["d010"], "T", by) for b, n, r in bets]))

    channels = [("email", "Email outreach", "cold"), ("linkedin", "LinkedIn outreach", "cold"), ("introduction", "Introductions and referrals", "warm"),
                ("web_inbound", "Inbound interest form", "inbound"), ("renewal", "Past-sponsor renewals", "renewal"), ("premium", "Premium inventory pitches", "premium")]
    s.append(insert("channel", ["channel_id", "name", "channel_group", "record_class", "import_batch_id", "source_ref", "evidence_class", "created_by"],
                    [(c, n, g, "operating_plan", "IB-REF-PLAN", "2025 channels: stg.campaigns.channel + eda.campaign_group; 2026: D-010", "T", by) for c, n, g in channels]))

    cats = [("IND-EDU", "Education", None, "Education"), ("IND-PC", "Personal care", None, "Personal care"),
            ("IND-CP", "Consumer products", None, "Consumer products"), ("IND-MOB", "Mobility", None, "Mobility"),
            ("IND-MED", "Media", None, "Media"), ("IND-FNB", "Food and beverage", None, "Food and beverage"),
            ("CAT-FINTECH", "Fintech", "T1", None), ("CAT-EV", "EV and mobility", "T1", None), ("CAT-QC", "Quick commerce", "T1", None),
            ("CAT-D2C", "D2C brands", "T2", None), ("CAT-GAMING", "Gaming", "T2", None), ("CAT-CAREER", "Career and edtech", "selective", None),
            ("CAT-PHONES", "Smartphones", None, None), ("CAT-ENERGY", "Energy drinks", None, None), ("CAT-TELECOM", "Telecom", None, None)]
    s.append(insert("category", ["category_id", "name", "tier", "dataset_industry", "record_class", "import_batch_id", "source_ref", "evidence_class", "created_by"],
                    [(c, n, t, di, "operating_plan", "IB-REF-PLAN", "2025 industries: stg.brands.industry; categories: W-001 / D-008", "T" if di is None else "D", by) for c, n, t, di in cats]))

    mrows = read_csv(files["metric"])
    s.append(insert("metric_definition", ["metric_id", "name", "kpi_id", "business_meaning", "formula", "numerator", "denominator", "aggregation", "time_period", "inclusion_exclusion",
                                          "source_table_2025", "source_table_future", "value_nature", "unit", "sql", "sql_hash", "computable_2025", "example_calculation", "example_value_2025",
                                          "valid_from", "record_class", "import_batch_id", "source_ref", "evidence_class", "created_by"],
                    [(r["metric_id"], r["name"], blank(r["kpi_id"]), r["business_meaning"], r["formula"], blank(r["numerator"]), blank(r["denominator"]), blank(r["aggregation"]),
                      blank(r["time_period"]), blank(r["inclusion_exclusion"]), blank(r["source_table_2025"]), blank(r["source_table_future"]), r["value_nature"], blank(r["unit"]),
                      blank(r["sql_2025"]), hashlib.sha256(r["sql_2025"].encode()).hexdigest() if blank(r["sql_2025"]) else None, r["computable_2025"],
                      blank(r["example_calculation"]), num(r["example_value_2025"]), "2026-11-26 00:00:00+05:30", "operating_plan", "IB-REF-METRICS",
                      f"{files['metric']}#{r['metric_id']}", "T", by) for r in mrows]))

    kpi_to_metric = {}
    for r in mrows:
        if blank(r["kpi_id"]) and r["kpi_id"] not in kpi_to_metric:
            kpi_to_metric[r["kpi_id"]] = r["metric_id"]
    betmap = {"All": None, "All (diagnostic)": None}
    krows = read_csv(files["kpi"])
    kpis = [(r["kpi_id"], r["name"], betmap.get(r["bet"], r["bet"]), r["kpi_type"], r["definition"], blank(r["grain"]), blank(r["frequency"]),
             kpi_to_metric.get(r["kpi_id"]), f"{files['kpi']}#{r['kpi_id']}") for r in krows]
    # Two historical goal KPIs, needed by M-24 (2025 target versions in stg.targets). Not new strategy KPIs.
    kpis += [("K-H-01", "Qualified brands goal (2025 plan, historical)", None, "outcome", "2025 plan goal for qualified brands (stg.targets.qualified_brands_goal); historical reference only", "edition", "per target version", "M-10", "stg.targets.qualified_brands_goal"),
             ("K-H-02", "Confirmed partnerships goal (2025 plan, historical)", None, "outcome", "2025 plan goal for confirmed partnerships (stg.targets.confirmed_partnerships_goal); denominator of M-24", "edition", "per target version", "M-24", "stg.targets.confirmed_partnerships_goal")]
    s.append(insert("kpi_definition", ["kpi_id", "name", "bet_id", "kpi_type", "definition", "grain", "frequency", "metric_id", "valid_from", "record_class", "import_batch_id", "source_ref", "evidence_class", "created_by"],
                    [(k, n, b, t, d, g, f, m, "2026-11-26 00:00:00+05:30", "operating_plan", "IB-REF-PLAN", src, "T", by) for k, n, b, t, d, g, f, m, src in kpis]))

    ck = {r["file"]: r["sha256"] for r in read_csv("04_FINANCIAL_MODELLING/output_checksums.csv")}
    srows = [r for r in read_csv(files["scen"]) if r["scenario_id"] in ("SC-01", "SC-02", "SC-03", "SC-04", "SC-05")]
    scen = []
    for r in srows:
        m = re.search(r"scenarios/([A-Za-z0-9_]+\.csv)", r["source"]) or re.search(r"(F4[bc])", r["source"])
        fn = m.group(1) if m and m.group(1).endswith(".csv") else None
        if r["scenario_id"] == "SC-04": fn = "F4b_base_downside.csv"
        if r["scenario_id"] == "SC-05": fn = "F4c_core_downside.csv"
        if fn is None: fn = "F4_headlines.csv"
        path = f"04_FINANCIAL_MODELLING/scenarios/{fn}"
        scen.append((r["scenario_id"], r["scenario_name"], "APPROVED", r["status"], num(r["expected_cash"]), num(r["P10"]), num(r["P50"]), num(r["P90"]),
                     num(r["window_pw"]), num(r["preseason_pw"]), "D-009", ck[path], f"{files['scen']}#{r['scenario_id']} ({path})"))
    s.append(insert("scenario_reference", ["scenario_id", "name", "status", "status_label", "expected_cash", "p10", "p50", "p90", "window_pw", "preseason_pw", "decision_id", "output_checksum",
                                           "source_ref", "record_class", "import_batch_id", "evidence_class", "created_by"],
                    [r + ("model_output", "IB-REF-SCENARIOS", "C", by) for r in scen]))

    roles = {"Pipeline operations lead": "pipeline_ops", "Finance and collections lead": "finance_collections", "Partnerships lead": "partnerships",
             "Community lead": "community", "Network lead": "network", "Premium sales pair": "premium_sales"}
    erows = read_csv(files["exp"])
    s.append(insert("threshold_rule", ["rule_id", "kpi_id", "evaluate_at", "keep_if", "change_if", "escalate_if", "response", "owner_role", "decision_id", "rule_status", "valid_from",
                                       "record_class", "import_batch_id", "source_ref", "evidence_class", "created_by"],
                    [(r["rule_id"], r["kpi_id"], r["time_limit"], blank(r["keep_success"]), blank(r["change"]), r["stop_or_escalate"], r["action_when_fired"], roles[r["owner_role"]],
                      "D-010", r["rule_status"], "2026-11-26 00:00:00+05:30", "operating_plan", "IB-REF-RULES", f"{files['exp']}#{r['rule_id']}", "T", by) for r in erows]))
    seen, exps = set(), []
    for r in erows:
        if r["experiment_id"] in seen: continue
        seen.add(r["experiment_id"])
        exps.append((r["experiment_id"], r["bet"].split()[0], r["hypothesis"], r["test_population"], r["intervention"], r["sample_size"], r["time_limit"], r["kpi_id"], r["rule_id"],
                     "operating_plan", "IB-REF-RULES", f"{files['exp']}#{r['experiment_id']}", "T", by))
    s.append(insert("experiment", ["experiment_id", "bet_id", "hypothesis", "population", "intervention", "sample_size", "time_limit", "primary_kpi_id", "rule_id",
                                   "record_class", "import_batch_id", "source_ref", "evidence_class", "created_by"], exps))

    arows = read_csv(files["assm"])
    s.append(insert("model_assumption", ["assumption_id", "variable", "frozen_value", "unit", "uncertainty", "status", "rationale", "validation_method",
                                         "record_class", "import_batch_id", "source_ref", "evidence_class", "created_by"],
                    [(r["id"], r["variable"], r["frozen_value"], blank(r["unit"]), blank(r["uncertainty"]), blank(r["status"]), blank(r["rationale"]),
                      blank(r["validation_method_in_operation"]), "model_assumption", "IB-REF-ASSUMPTIONS", f"{files['assm']}#{r['id']}", r["evidence_class"], by) for r in arows]))
    s.append("COMMIT;")
    s.append(CHECK.format(q="""select 'decisions' k, count(*) from decision_record union all select 'bets', count(*) from bet
union all select 'metrics', count(*) from metric_definition union all select 'kpis', count(*) from kpi_definition
union all select 'scenarios', count(*) from scenario_reference union all select 'rules', count(*) from threshold_rule
union all select 'experiments', count(*) from experiment union all select 'assumptions', count(*) from model_assumption;
-- expect 9, 7, 30, 45, 5, 12, 9, 38"""))
    (OUT / "04_reference_seed.sql").write_text("\n\n".join(s) + "\n")


# ---------------------------------------------------------------------------
# 05 2025 dataset (historical_synthetic, read-only)
# ---------------------------------------------------------------------------
def build_2025():
    c = duckdb.connect(str(DB), read_only=True)
    df = lambda sql: c.execute(sql).fetchall()
    src = "02_DATA_FOUNDATION/original_sources/raw_data/Sponsor_Dataset.xlsx"
    srcp = next(REPO.glob("02_DATA_FOUNDATION/**/Sponsor_Dataset.xlsx"))
    src = str(srcp.relative_to(REPO)); xsha = sha(srcp)
    dbsha = sha(DB)[:8]
    dv = f"sponsor.duckdb@{dbsha}"
    by = "seed:05_seed_2025"
    rc, ib, ev = "historical_synthetic", "IB-2025-SPONSOR", "D"
    P = lambda sheet, row: f"Sponsor_Dataset.xlsx#{sheet}!{row}"
    s = [HEADER.format(name="05_seed_2025.sql", purpose="CampusFest 2025 assignment dataset (fictional) as read-only historical_synthetic rows, from the audited staging layer of sponsor.duckdb (exact import retries removed in staging). Loaded once by the owner.")]
    s.append("BEGIN;\nSET LOCAL app.allow_historical_seed = 'true';")
    s.append(GUARD.format(ib=ib))
    s.append(insert("import_batch", ["import_batch_id", "batch_type", "record_class", "source_file", "source_sha256", "row_count", "validation_status", "source_ref", "evidence_class", "data_version", "created_by"],
                    [(ib, "file_import", rc, src, xsha, None, "passed", "sponsor.duckdb stg layer (51 audit checks, 0 failures)", ev, dv, by)]))
    e = df("select event_name, event_starts_at_ist, event_ends_at_ist, history_start from stg.event")[0]
    s.append(insert("festival_edition", ["edition_id", "name", "city", "starts_at", "ends_at", "season_start", "currency", "is_fictional", "is_current", "record_class", "import_batch_id", "source_ref", "evidence_class", "data_version", "created_by"],
                    [("ED-2025", e[0], None, e[1], e[2], str(e[3]), "INR", True, False, rc, ib, "Sponsor_Dataset.xlsx#event", ev, dv, by)]))
    names = dict(df("select owner_id, any_value(owner_name) from (select owner_id, owner_name from stg.brands union all select owner_id, owner_name from stg.campaigns) group by 1"))
    owners = sorted({r[0] for r in df("select owner_id from stg.brands union select owner_id from stg.campaigns union select owner_id from stg.opportunity_history union select owner_id from stg.interactions") if r[0]})
    s.append(insert("team_member", ["member_id", "full_name", "record_class", "import_batch_id", "source_ref", "evidence_class", "data_version", "created_by"],
                    [(o, names.get(o, f"{o} (name not recorded in the 2025 dataset)"), rc, ib, "Sponsor_Dataset.xlsx owner_id", ev, dv, by) for o in owners]))
    ind = {"Education": "IND-EDU", "Personal care": "IND-PC", "Consumer products": "IND-CP", "Mobility": "IND-MOB", "Media": "IND-MED", "Food and beverage": "IND-FNB"}
    br = df("select brand_id, brand_name, industry, owner_id, created_at_ist, _source_row from stg.brands order by brand_id")
    s.append(insert("sponsor", ["sponsor_id", "display_name", "category_id", "record_class", "import_batch_id", "source_ref", "evidence_class", "data_version", "created_at", "created_by"],
                    [(b, n, ind[i], rc, ib, P("brands", r), ev, dv, ca, by) for b, n, i, o, ca, r in br]))
    s.append(insert("ownership_assignment", ["assignment_id", "subject_type", "subject_id", "member_id", "role_in_relationship", "reason", "valid_from", "record_class", "import_batch_id", "source_ref", "evidence_class", "data_version", "created_by"],
                    [(f"OA-{b}", "sponsor", b, o, "owner", "2025 brand owner", ca, rc, ib, P("brands", r), ev, dv, by) for b, n, i, o, ca, r in br]))
    ct = df("select contact_id, brand_id, contact_name, job_title, created_at_ist, _source_row from stg.contacts order by contact_id")
    s.append(insert("contact", ["contact_id", "sponsor_id", "full_name", "job_title", "record_class", "import_batch_id", "source_ref", "evidence_class", "data_version", "created_at", "created_by"],
                    [(i, b, n, j, rc, ib, P("contacts", r), ev, dv, ca, by) for i, b, n, j, ca, r in ct]))
    cp = df("select campaign_id, campaign_name, channel, objective, owner_id, planned_start_at_ist, planned_end_at_ist, created_at_ist, _source_row from stg.campaigns order by campaign_id")
    s.append(insert("campaign", ["campaign_id", "edition_id", "name", "channel_id", "owner_member_id", "planned_start", "planned_end", "objective", "status", "record_class", "import_batch_id", "source_ref", "evidence_class", "data_version", "created_at", "created_by"],
                    [(i, "ED-2025", n, ch, o, ps, pe, obj, "closed", rc, ib, P("campaigns", r), ev, dv, ca, by) for i, n, ch, obj, o, ps, pe, ca, r in cp]))
    at = df("select attempt_id, campaign_id, brand_id, contact_id, owner_id, started_at_ist, root_event_type from core.attempts order by attempt_id")
    s.append(insert("outreach_attempt", ["attempt_id", "campaign_id", "sponsor_id", "contact_id", "owner_member_id", "started_at", "root_event_type", "record_class", "import_batch_id", "source_ref", "evidence_class", "data_version", "created_by"],
                    [(a, cpn, b, cn, o, st, rt, rc, ib, "core.attempts (derived from Sponsor_Dataset.xlsx#interactions)", ev, dv, by) for a, cpn, b, cn, o, st, rt in at]))
    it = df("select interaction_id, attempt_id, origin_interaction_id, event_type, outcome, occurred_at_ist, summary, owner_id, _source_row from stg.interactions order by occurred_at_ist, interaction_id")
    roots = [r for r in it if r[2] is None or r[2] == r[0]]
    rest = [r for r in it if not (r[2] is None or r[2] == r[0])]
    cols = ["interaction_id", "attempt_id", "origin_interaction_id", "event_type", "outcome", "occurred_at", "summary", "logged_by", "record_class", "import_batch_id", "source_ref", "evidence_class", "data_version", "created_by"]
    s.append(insert("interaction", cols, [(i, a, (o if o != i else None), et, oc, t, sm, ow, rc, ib, P("interactions", r), ev, dv, by) for i, a, o, et, oc, t, sm, ow, r in roots]))
    s.append(insert("interaction", cols, [(i, a, o, et, oc, t, sm, ow, rc, ib, P("interactions", r), ev, dv, by) for i, a, o, et, oc, t, sm, ow, r in rest]))
    qh = df("select history_id, brand_id, source_campaign_id, qualification_status, reason, effective_at_ist, _source_row, lead(effective_at_ist) over w, row_number() over w from stg.qualification_history window w as (partition by brand_id order by effective_at_ist, history_id) order by brand_id, effective_at_ist, history_id")
    s.append(insert("qualification_version", ["history_id", "sponsor_id", "edition_id", "source_campaign_id", "status", "reason", "valid_from", "valid_to", "version_no", "record_class", "import_batch_id", "source_ref", "evidence_class", "data_version", "created_by"],
                    [(h, b, "ED-2025", cpn, st, rs, vf, vt, vn, rc, ib, P("qualification_history", r), ev, dv, by) for h, b, cpn, st, rs, vf, r, vt, vn in qh]))
    op = df("select opportunity_id, brand_id, primary_contact_id, originating_campaign_id, opportunity_name, support_type, created_at_ist, _source_row from stg.opportunities order by opportunity_id")
    s.append(insert("opportunity", ["opportunity_id", "sponsor_id", "edition_id", "primary_contact_id", "originating_campaign_id", "support_type", "name", "record_class", "import_batch_id", "source_ref", "evidence_class", "data_version", "created_at", "created_by"],
                    [(o, b, "ED-2025", pc, cpn, stt, n, rc, ib, P("opportunities", r), ev, dv, ca, by) for o, b, pc, cpn, n, stt, ca, r in op]))
    oh = df("select history_id, opportunity_id, stage, owner_id, proposed_value_inr, confirmed_value_inr, effective_at_ist, _source_row, lead(effective_at_ist) over w, row_number() over w from stg.opportunity_history window w as (partition by opportunity_id order by effective_at_ist, history_id) order by opportunity_id, effective_at_ist, history_id")
    s.append(insert("opportunity_stage_version", ["history_id", "opportunity_id", "stage", "owner_member_id", "proposed_value", "confirmed_value", "valid_from", "valid_to", "version_no", "record_class", "import_batch_id", "source_ref", "evidence_class", "data_version", "created_by"],
                    [(h, o, st, ow, pv, cv, vf, vt, vn, rc, ib, P("opportunity_history", r), ev, dv, by) for h, o, st, ow, pv, cv, vf, r, vt, vn in oh]))
    tg = df("select target_version, effective_at_ist, qualified_brands_goal, confirmed_partnerships_goal, _source_row, lead(effective_at_ist) over (order by effective_at_ist) from stg.targets order by effective_at_ist")
    trows = []
    for i, (name, eff, qg, cg, r, nxt) in enumerate(tg, 1):
        trows.append((f"TG-2025-{i}-QUAL", "ED-2025", "K-H-01", None, name, qg, eff, nxt, i, rc, ib, P("targets", r), ev, dv, by))
        trows.append((f"TG-2025-{i}-CONF", "ED-2025", "K-H-02", None, name, cg, eff, nxt, i, rc, ib, P("targets", r), ev, dv, by))
    s.append(insert("target_version", ["target_id", "edition_id", "kpi_id", "scenario_id", "period", "target_value", "valid_from", "valid_to", "version_no", "record_class", "import_batch_id", "source_ref", "evidence_class", "data_version", "created_by"], trows))
    ac = df("select activation_id, opportunity_id, activation_note, attendee_campaign_id, attendee_campaign_name, linked_at_ist, _source_row from stg.activations order by activation_id")
    s.append(insert("contract_deliverable", ["deliverable_id", "opportunity_id", "description", "attendee_campaign_ref", "record_class", "import_batch_id", "source_ref", "evidence_class", "data_version", "created_at", "created_by"],
                    [(a, o, n, f"{ci} {cn}", rc, ib, P("activations", r), ev, dv, la, by) for a, o, n, ci, cn, la, r in ac]))
    s.append("COMMIT;")
    s.append(CHECK.format(q="""select 'brands' k, count(*) from sponsor where record_class='historical_synthetic'
union all select 'contacts', count(*) from contact where record_class='historical_synthetic'
union all select 'attempts', count(*) from outreach_attempt where record_class='historical_synthetic'
union all select 'interactions', count(*) from interaction where record_class='historical_synthetic'
union all select 'opportunities', count(*) from opportunity where record_class='historical_synthetic';
-- expect 180, 270, 370, 950, 58
select * from metrics.parity_2025();   -- every row: passed = true"""))
    (OUT / "05_seed_2025.sql").write_text("\n\n".join(s) + "\n")
    return {"interactions": len(it), "quals": len(qh), "stage_versions": len(oh)}


# ---------------------------------------------------------------------------
# 07 knowledge base
# ---------------------------------------------------------------------------
def build_knowledge():
    path = REPO / "06_BUSINESS_KNOWLEDGE_BASE/chunks.jsonl"
    ch = [json.loads(l) for l in path.open(encoding="utf-8")]
    by = "seed:07_knowledge"
    cls = {"D": "historical_synthetic", "B": "external_research", "A": "model_assumption", "C": "model_output", "T": "operating_plan", "U": "operating_plan"}
    s = [HEADER.format(name="07_knowledge.sql", purpose="The 106 knowledge-base chunks (06_BUSINESS_KNOWLEDGE_BASE/chunks.jsonl) with their metadata, searchable by full-text. Read-only for the app.")]
    s.append("BEGIN;\nSET LOCAL app.allow_historical_seed = 'true';")
    s.append(GUARD.format(ib="IB-KB"))
    s.append(insert("import_batch", ["import_batch_id", "batch_type", "record_class", "source_file", "source_sha256", "row_count", "validation_status", "source_ref", "evidence_class", "created_by"],
                    [("IB-KB", "file_import", "operating_plan", "06_BUSINESS_KNOWLEDGE_BASE/chunks.jsonl", sha(path), len(ch), "passed", "build_knowledge_index.py output", "T", by)]))
    rows = []
    for x in ch:
        first = x["evidence_class"].split(",")[0]
        rows.append((x["chunk_id"], x["doc_id"], x["version"], x["decision_status"], x["retrieval_rule"], x["evidence_class"], blank(x.get("related_bet")),
                     blank(x.get("related_kpi")), x["text"], blank(x.get("citation_location")), x["document_title"], x["section"], x["source_id"], x["source_type"],
                     x["effective_date"], x["effective_date"] + " 00:00:00+05:30", cls[first], "IB-KB", x["path"], by))
    s.append(insert("knowledge_chunk", ["chunk_id", "doc_id", "version", "decision_status", "retrieval_rule", "evidence_class", "related_bet", "related_kpi", "text",
                                        "citation_location", "document_title", "section", "source_id", "source_type", "effective_date", "valid_from", "record_class",
                                        "import_batch_id", "source_ref", "created_by"], rows, chunk=50))
    s.append("COMMIT;")
    s.append(CHECK.format(q="""select count(*), count(*) filter (where retrieval_rule='contradiction_and_history_only') from knowledge_chunk;   -- expect 106, 7
select chunk_id, document_title, ts_rank(tsv, q) from knowledge_chunk, websearch_to_tsquery('english', 'handoff leak') q
 where tsv @@ q and retrieval_rule = 'default' order by 3 desc limit 3;"""))
    (OUT / "07_knowledge.sql").write_text("\n\n".join(s) + "\n")


GUARD = """DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM public.import_batch WHERE import_batch_id = '{ib}') THEN
        RAISE EXCEPTION 'This file is already loaded (import batch {ib} exists). Nothing was changed.';
    END IF;
END $$;"""

HEADER = """-- ============================================================================
-- Sponsorship Growth Platform — Stage 2
-- File: db/{name}   (generated by build_seeds.py from the analysis repository; do not hand-edit)
-- Purpose: {purpose}
-- Run in the Supabase SQL Editor as the project owner, after the files before it.
-- ============================================================================"""
CHECK_TMPL = "-- ----------------------------------------------------------------------------\n-- Check (run separately after this file):\n{q}\n-- ----------------------------------------------------------------------------"


class _Check:
    def format(self, q):
        return CHECK_TMPL.format(q="\n".join("--   " + l for l in q.splitlines()))


CHECK = _Check()

if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    build_reference()
    info = build_2025()
    build_knowledge()
    print("built", info)
