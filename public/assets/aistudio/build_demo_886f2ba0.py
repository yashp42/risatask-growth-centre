"""Build 06_seed_demo_2026.sql: a SIMULATED 2026-27 season in progress (week 5), for the demo.

Every row is record_class = 'simulated' (or operating_plan for D-010 gates and inventory), loaded
as one import batch that can be removed as a whole. Brand names are invented; renewal sponsors
reuse the fictional 2025 sponsor names. This is demo data, not a forecast: it does not change
D-009 or D-010, and no number here is presented as expected performance.

Story (as of 25 Nov 2026, W5): slightly behind the base pacing gate at W4 (₹4.70L signed vs base
₹5.1L, above 0.8 × base), renewals in the "change" band (7 interested < 8), introductions in the
"work all" band (9 committed), a few leaked qualified leads for the B1 SLA, one pre-season
presenting deal (B5), advances partly collected.
Usage: python3 build_demo.py <out_dir>
"""
import sys
from pathlib import Path
from datetime import date, timedelta
from build_seeds import q, insert, HEADER, GUARD

OUT = Path(sys.argv[1])
RC, IB, BY, EV = "simulated", "IB-SIM-2026", "seed:06_seed_demo_2026", "T"
ED = "ED-2026-DEMO"
T = lambda s: s + ":00+05:30" if len(s) == 16 else s + " 10:00:00+05:30"
prov = lambda ref="simulated demo season (build_demo.py)": [RC, IB, ref, EV, BY]
PC = ["record_class", "import_batch_id", "source_ref", "evidence_class", "created_by"]

S = [HEADER.format(name="06_seed_demo_2026.sql",
                   purpose="SIMULATED demo season 2026-27 at week 5 (record_class = simulated, one import batch IB-SIM-2026). Demo data only: not real records, not a forecast.")]
S.append("BEGIN;")
S.append(GUARD.format(ib=IB))
S.append(insert("import_batch", ["import_batch_id", "batch_type", "record_class", "row_count", "validation_status", "source_ref", "evidence_class", "created_by"],
                [(IB, "simulation", RC, None, "passed", "build_demo.py (deterministic)", EV, BY)]))
S.append(insert("festival_edition", ["edition_id", "name", "city", "starts_at", "ends_at", "season_start", "preseason_start", "currency", "is_fictional", "is_current"] + PC,
                [(ED, "Demo season 2026-27 (simulated)", "Bengaluru", T("2027-01-09"), "2027-01-10 20:00:00+05:30", "2026-10-26", "2026-09-21", "INR", False, True, *prov())]))

# --- team and roles -------------------------------------------------------------------------
team = [("SIM-LEAD", "Shantanu Nimbalkar", ["coordination_lead", "admin"]), ("SIM-OPS", "Aarav Mehta", ["pipeline_ops"]),
        ("SIM-FIN", "Meera Iyer", ["finance_collections"]), ("SIM-PART", "Kavya Reddy", ["partnerships"]),
        ("SIM-COMM", "Rohan Das", ["community"]), ("SIM-NET", "Ishaan Gupta", ["network"]),
        ("SIM-PREM", "Tara Menon", ["premium_sales"]), ("SIM-VIEW", "Demo Viewer", ["viewer"])]
S.append(insert("team_member", ["member_id", "full_name", "fte_share", "active_from", "created_at"] + PC,
                [(m, n, 0.5, "2026-09-21", T("2026-09-21"), *prov()) for m, n, _ in team]))
ra = [(f"RA26-{m}-{r}", m, ED, r, T("2026-09-21"), T("2026-09-21"), *prov()) for m, _, roles in team for r in roles]
S.append(insert("role_assignment", ["role_assignment_id", "member_id", "edition_id", "role", "valid_from", "created_at"] + PC, ra))

# --- inventory (operating plan, D-009 stretch inventory) -----------------------------------------
S.append(insert("inventory_asset", ["asset_id", "edition_id", "asset_type", "slots_total", "is_premium", "sell_by_week", "lead_time_weeks", "deliverables", "record_class", "import_batch_id", "source_ref", "evidence_class", "created_by"],
                [("AS26-TITLE", ED, "title", 1, True, 7, "4/8/14", "Title naming rights", "operating_plan", IB, "D-009 stretch inventory", "T", BY),
                 ("AS26-PRES", ED, "presenting", 2, True, 4, None, "Presenting partner", "operating_plan", IB, "D-009 stretch inventory", "T", BY),
                 ("AS26-ACT", ED, "activation", 12, False, None, None, "On-ground activation stall", "operating_plan", IB, "D-009 stretch inventory", "T", BY),
                 ("AS26-DIG", ED, "digital", 3, False, None, None, "Digital campaign package", "operating_plan", IB, "D-009 stretch inventory", "T", BY)]))

# --- campaigns ------------------------------------------------------------------------------
camps = [("C26-B4A", "Past-sponsor renewals", "renewal", "B4a", "SIM-PART", "2026-10-26", "2026-11-08", "Screen all 24 past sponsors; renew the interested"),
         ("C26-B4B", "Creator referrals", "introduction", "B4b", "SIM-COMM", "2026-10-26", "2026-12-20", "Recruit creators; convert referred brands"),
         ("C26-B3", "VC and alumni introductions", "introduction", "B3", "SIM-NET", "2026-10-26", "2026-12-20", "Turn committed introductions into meetings"),
         ("C26-IN", "Partner interest form", "web_inbound", "B1", "SIM-OPS", "2026-10-26", "2027-01-02", "Qualify inbound requests within the SLA"),
         ("C26-B5", "Premium inventory (pre-season)", "premium", "B5", "SIM-PREM", "2026-09-21", "2026-12-13", "Sell title and presenting slots before W7")]
S.append(insert("campaign", ["campaign_id", "edition_id", "name", "channel_id", "bet_id", "owner_member_id", "planned_start", "planned_end", "objective", "status", "created_at"] + PC,
                [(c, ED, n, ch, b, o, T(ps), T(pe), obj, "active", T(ps), *prov()) for c, n, ch, b, o, ps, pe, obj in camps]))

# --- network partners --------------------------------------------------------------------------
partners = [(f"NP26-CR{i}", "creator", f"Creator {nm}", "SIM-COMM", d) for i, (nm, d) in enumerate(
    [("Ananya Vlogs", "2026-10-27"), ("Campus Cartoons", "2026-10-28"), ("Tech with Tanmay", "2026-10-29"), ("Foodie Firki", "2026-10-30"), ("Gamer Guild IN", "2026-11-02"), ("Style Sutra", "2026-11-03")], 1)]
partners += [(f"NP26-VC{i}", "vc_fund" if i <= 5 else "alumnus", nm, "SIM-NET", d) for i, (nm, d) in enumerate(
    [("Northbridge Ventures", "2026-10-27"), ("Saffron Seed Fund", "2026-10-27"), ("Lakeview Capital", "2026-10-28"), ("Banyan Early Stage", "2026-10-29"),
     ("Monsoon Partners", "2026-10-30"), ("Alumnus: R. Shah (2012)", "2026-10-28"), ("Alumnus: P. Nair (2015)", "2026-10-29"), ("Alumnus: S. Bose (2010)", "2026-11-02")], 1)]
S.append(insert("network_partner", ["partner_id", "partner_type", "name", "owner_member_id", "recruited_at", "status", "created_at"] + PC,
                [(p, t, n, o, d, "active", T(d), *prov()) for p, t, n, o, d in partners]))

# --- sponsors, contacts ---------------------------------------------------------------------
past = [("Aster Active", "IND-FNB"), ("Aster Collective", "IND-MED"), ("Aster Devices", "IND-MOB"), ("Aster Learning", "IND-EDU"), ("Aster Living", "IND-CP"),
        ("Aster Pantry", "IND-CP"), ("Aster Studio", "IND-MED"), ("Aster Threads", "IND-FNB"), ("Aster Wellness", "IND-MOB"), ("Aster Works", "IND-EDU"),
        ("Beardo", "IND-PC"), ("Bramble Active", "IND-FNB"), ("Bramble Collective", "IND-MED"), ("Bramble Devices", "IND-MOB"), ("Bramble Learning", "IND-EDU"),
        ("Bramble Living", "IND-CP"), ("Bramble Pantry", "IND-CP"), ("Bramble Studio", "IND-MED"), ("Bramble Threads", "IND-FNB"), ("Bramble Wellness", "IND-MOB"),
        ("Harbor Beverages", "IND-FNB"), ("Juniper Foods", "IND-FNB"), ("Maple Devices", "IND-CP"), ("Mosaic Mobility", "IND-MOB")]
new = {  # name, category, campaign
    "creator": [("Haldi & Hive", "CAT-D2C"), ("Arcadia Loop Games", "CAT-GAMING"), ("Brewnova", "CAT-D2C"), ("Neonleaf Snacks", "CAT-D2C"), ("Shiksha Spark", "CAT-CAREER")],
    "vc": [("Rupeeroot", "CAT-FINTECH"), ("Voltyatra", "CAT-EV"), ("Minutekart", "CAT-QC"), ("Coinmesh", "CAT-FINTECH"), ("Trailrider EV", "CAT-EV"), ("Ledgerly Pay", "CAT-FINTECH")],
    "inbound": [("Kaveri Threads", "CAT-D2C"), ("Swiftsip", "CAT-D2C"), ("Pebblebox", "CAT-QC"), ("Orbit Arena", "CAT-GAMING"), ("Campus Crate", "CAT-QC"), ("Tiffinto", "CAT-QC"), ("Zestora Foods", "CAT-D2C")],
    "premium": [("Skyline Telecom Co", "CAT-TELECOM"), ("Novaphone", "CAT-PHONES"), ("Fizzpeak Energy", "CAT-ENERGY"), ("Paywave Bank", "CAT-FINTECH"), ("Gridline Motors", "CAT-EV"), ("Crestmark Apparel", "CAT-D2C")],
}
sponsors = {}  # name -> (sponsor_id, contact_id, campaign, owner)
rows_s, rows_c, rows_o = [], [], []
first = ["Aditi", "Rahul", "Neha", "Vikram", "Pooja", "Arjun", "Sneha", "Karan", "Divya", "Siddharth", "Ritu", "Manav"]
last = ["Sharma", "Rao", "Kulkarni", "Menon", "Joshi", "Pillai", "Verma", "Bhat", "Chopra", "Naidu"]
def add_sponsor(name, cat, campaign, owner, lifecycle, src, created):
    i = len(sponsors) + 1
    sid, cid = f"S26-{i:03d}", f"P26-{i:03d}"
    sponsors[name] = (sid, cid, campaign, owner)
    rows_s.append((sid, name, cat, lifecycle, src, "Bengaluru", T(created), *prov()))
    rows_c.append((cid, sid, f"{first[i % 12]} {last[i % 10]}", "Brand partnerships lead", "decision_maker", "prior_sponsor" if src == "renewal" else "referral_intro",
                   T(created), *prov()))
    rows_o.append((f"OA26-{sid}", "sponsor", sid, owner, "owner", "campaign owner", T(created), *prov()))
for n, c in past: add_sponsor(n, c, "C26-B4A", "SIM-PART", "past_sponsor", "renewal", "2026-10-26")
for n, c in new["creator"]: add_sponsor(n, c, "C26-B4B", "SIM-COMM", "prospect", "referral", "2026-11-03")
for n, c in new["vc"]: add_sponsor(n, c, "C26-B3", "SIM-NET", "prospect", "referral", "2026-11-02")
for n, c in new["inbound"]: add_sponsor(n, c, "C26-IN", "SIM-OPS", "prospect", "inbound", "2026-10-28")
for n, c in new["premium"]: add_sponsor(n, c, "C26-B5", "SIM-PREM", "prospect", "research", "2026-09-22")
won = {"Aster Living", "Juniper Foods", "Mosaic Mobility", "Haldi & Hive", "Kaveri Threads", "Rupeeroot", "Skyline Telecom Co"}
rows_s = [r[:3] + (("active" if r[1] in won else r[3]),) + r[4:] for r in rows_s]
S.append(insert("sponsor", ["sponsor_id", "display_name", "category_id", "lifecycle_status", "first_source", "city", "created_at"] + PC, rows_s))
S.append(insert("contact", ["contact_id", "sponsor_id", "full_name", "job_title", "decision_role", "consent_basis", "created_at"] + PC, rows_c))
S.append(insert("ownership_assignment", ["assignment_id", "subject_type", "subject_id", "member_id", "role_in_relationship", "reason", "valid_from"] + PC, rows_o))

# --- referrals (B3 committed introductions; B4b creator referrals) -------------------------------
ref = []
vc_partner = {"Rupeeroot": "NP26-VC1", "Voltyatra": "NP26-VC2", "Minutekart": "NP26-VC3", "Coinmesh": "NP26-VC4", "Trailrider EV": "NP26-VC6", "Ledgerly Pay": "NP26-VC7"}
statuses = {"Rupeeroot": "met", "Voltyatra": "met", "Minutekart": "met", "Coinmesh": "met", "Trailrider EV": "met", "Ledgerly Pay": "committed"}
for k, (n, p) in enumerate(vc_partner.items(), 1):
    sid, cid, _, _ = sponsors[n]
    ref.append((f"RF26-B3-{k}", p, sid, cid, "C26-B3", statuses[n], T("2026-11-0" + str(min(k + 1, 9))), T("2026-10-30"), T("2026-11-0" + str(min(k + 1, 9))), *prov()))
# three more committed introductions to brands not yet contacted (counted in K-B3-02, no attempt yet)
for k, (p, nm, cat) in enumerate([("NP26-VC5", "Lumen Insure", "CAT-FINTECH"), ("NP26-VC8", "Ampere Grid", "CAT-EV"), ("NP26-VC3", "Basketly", "CAT-QC")], 7):
    add_sponsor(nm, cat, "C26-B3", "SIM-NET", "prospect", "referral", "2026-11-18")
    sid, cid, _, _ = sponsors[nm]
    S.append(insert("sponsor", ["sponsor_id", "display_name", "category_id", "lifecycle_status", "first_source", "city", "created_at"] + PC, [rows_s[-1] if False else (sid, nm, cat, "prospect", "referral", "Bengaluru", T("2026-11-18"), *prov())]))
    S.append(insert("contact", ["contact_id", "sponsor_id", "full_name", "job_title", "decision_role", "consent_basis", "created_at"] + PC, [rows_c[-1]]))
    ref.append((f"RF26-B3-{k}", p, sid, cid, "C26-B3", "committed", T("2026-11-18"), T("2026-11-10"), T("2026-11-18"), *prov()))
for k, (p, nm) in enumerate([("NP26-CR1", "Haldi & Hive"), ("NP26-CR2", "Arcadia Loop Games"), ("NP26-CR3", "Brewnova"), ("NP26-CR4", "Neonleaf Snacks"), ("NP26-CR5", "Shiksha Spark")], 1):
    sid, cid, _, _ = sponsors[nm]
    ref.append((f"RF26-B4B-{k}", p, sid, cid, "C26-B4B", "met" if k <= 4 else "committed", T("2026-11-04"), T("2026-11-01"), T("2026-11-04"), *prov()))
S.append(insert("referral", ["referral_id", "partner_id", "sponsor_id", "contact_id", "campaign_id", "commitment_status", "committed_at", "ask_sent_at", "valid_from"] + PC, ref))

# --- outreach, interactions, meetings, qualification ----------------------------------------------
att, inter, meet, qual = [], [], [], []
def journey(name, start, events, qualified_on=None, status_after=None, root="outreach_sent"):
    sid, cid, camp, owner = sponsors[name]
    aid = f"SA26-{sid[4:]}"
    att.append((aid, camp, sid, cid, owner, T(start), root, *prov()))
    origin = None
    for j, (ev, oc, when) in enumerate(events):
        iid = f"SI26-{sid[4:]}-{j + 1}"
        inter.append((iid, aid, origin, ev, oc, T(when), None, owner, *prov()))
        origin = origin or iid
        if ev == "meeting_held":
            purpose = "renewal_screen" if camp == "C26-B4A" else ("title_pitch" if camp == "C26-B5" else "discovery")
            meet.append((f"MT26-{sid[4:]}", aid, None, sid, T(when), "held", purpose, "{" + owner + "}", None, *prov()))
    v = 1
    qual.append((f"QV26-{sid[4:]}-1", sid, ED, camp, "engaged", "first conversation", T(events[0][2]), None, v, *prov()))
    if qualified_on:
        qual[-1] = qual[-1][:7] + (T(qualified_on),) + qual[-1][8:]
        qual.append((f"QV26-{sid[4:]}-2", sid, ED, camp, "qualified", "budget, timing and fit confirmed", T(qualified_on), None, 2, *prov()))
    elif status_after:
        qual[-1] = qual[-1][:7] + (T(status_after[1]),) + qual[-1][8:]
        qual.append((f"QV26-{sid[4:]}-2", sid, ED, camp, status_after[0], "no budget this season", T(status_after[1]), None, 2, *prov()))
# renewals: 24 screened in W1-W2, 7 interested (qualified)
interested = {"Aster Living": "2026-10-29", "Juniper Foods": "2026-10-30", "Mosaic Mobility": "2026-11-02", "Beardo": "2026-11-03",
              "Bramble Active": "2026-11-04", "Aster Learning": "2026-11-05", "Bramble Devices": "2026-11-06"}
for k, (n, _) in enumerate(past):
    d0 = (date(2026, 10, 26) + timedelta(days=k % 3)).isoformat()
    if n in interested:
        qd = interested[n]
        journey(n, d0, [("outreach_sent", "sent", d0 + " 10:00"), ("replied", "positive", d0 + " 16:00"), ("meeting_booked", "scheduled", d0 + " 17:00"), ("meeting_held", "attended", qd + " 11:00")], qualified_on=qd + " 16:00")
    else:
        held = (date(2026, 10, 26) + timedelta(days=3 + k % 7)).isoformat()
        journey(n, d0, [("outreach_sent", "sent", d0 + " 10:00"), ("replied", "neutral", d0 + " 18:00"), ("meeting_held", "attended", held + " 15:00")], status_after=("dormant", held + " 18:00"))
# creator referrals
for n, qd in [("Haldi & Hive", "2026-11-06"), ("Arcadia Loop Games", "2026-11-09"), ("Brewnova", "2026-11-10"), ("Neonleaf Snacks", "2026-11-13")]:
    journey(n, "2026-11-04", [("introduction_received", "introduced", "2026-11-04 11:00"), ("meeting_booked", "scheduled", "2026-11-04 15:00"), ("meeting_held", "attended", qd + " 12:00")], qualified_on=qd + " 16:00", root="introduction_received")
journey("Shiksha Spark", "2026-11-19", [("introduction_received", "introduced", "2026-11-19 11:00")], root="introduction_received")
# VC / alumni introductions
for n, qd in [("Rupeeroot", "2026-11-05"), ("Voltyatra", "2026-11-10"), ("Minutekart", "2026-11-11"), ("Coinmesh", "2026-11-12"), ("Trailrider EV", "2026-11-17")]:
    journey(n, "2026-11-03", [("introduction_received", "introduced", "2026-11-03 10:00"), ("meeting_booked", "scheduled", "2026-11-03 14:00"), ("meeting_held", "attended", qd + " 11:00")], qualified_on=qd + " 15:00", root="introduction_received")
journey("Ledgerly Pay", "2026-11-20", [("introduction_received", "introduced", "2026-11-20 10:00"), ("meeting_booked", "scheduled", "2026-11-20 12:00")], root="introduction_received")
# inbound form
for n, qd in [("Kaveri Threads", "2026-11-03"), ("Swiftsip", "2026-11-05"), ("Pebblebox", "2026-11-09"), ("Orbit Arena", "2026-11-12"), ("Campus Crate", "2026-11-14")]:
    journey(n, "2026-10-30", [("web_inbound", "interest_submitted", "2026-10-30 09:00"), ("meeting_booked", "scheduled", "2026-10-31 10:00"), ("meeting_held", "attended", qd + " 11:00")], qualified_on=qd + " 17:00", root="web_inbound")
journey("Tiffinto", "2026-11-18", [("web_inbound", "interest_submitted", "2026-11-18 09:00")], root="web_inbound")
journey("Zestora Foods", "2026-11-21", [("web_inbound", "interest_submitted", "2026-11-21 09:00"), ("meeting_booked", "scheduled", "2026-11-22 10:00")], root="web_inbound")
# premium pitches (pre-season)
for n, qd in [("Skyline Telecom Co", "2026-09-29"), ("Novaphone", "2026-10-12"), ("Paywave Bank", "2026-10-20"), ("Fizzpeak Energy", "2026-11-05")]:
    journey(n, "2026-09-22", [("outreach_sent", "sent", "2026-09-22 10:00"), ("replied", "positive", "2026-09-23 12:00"), ("meeting_booked", "scheduled", "2026-09-24 10:00"), ("meeting_held", "attended", qd + " 15:00")], qualified_on=qd + " 18:00")
for n in ["Gridline Motors", "Crestmark Apparel"]:
    journey(n, "2026-09-22", [("outreach_sent", "sent", "2026-09-22 10:00"), ("replied", "not_interested", "2026-09-26 12:00")], status_after=("unqualified", "2026-09-26 13:00"))
# fill valid_to for the first qualification version where a second exists
nxt = {}
for r in qual:
    nxt.setdefault(r[1], []).append(r)
qual = [r for rs in nxt.values() for r in ([rs[0][:7] + (rs[1][6],) + rs[0][8:], rs[1]] if len(rs) == 2 else rs)]
S.append(insert("outreach_attempt", ["attempt_id", "campaign_id", "sponsor_id", "contact_id", "owner_member_id", "started_at", "root_event_type"] + PC, att))
S.append(insert("interaction", ["interaction_id", "attempt_id", "origin_interaction_id", "event_type", "outcome", "occurred_at", "summary", "logged_by"] + PC,
                [r for r in inter if r[2] is None]))
S.append(insert("interaction", ["interaction_id", "attempt_id", "origin_interaction_id", "event_type", "outcome", "occurred_at", "summary", "logged_by"] + PC,
                [r for r in inter if r[2] is not None]))
S.append(insert("meeting", ["meeting_id", "attempt_id", "opportunity_id", "sponsor_id", "scheduled_at", "status", "purpose", "attendee_member_ids", "outcome_note"] + PC, meet))
S.append(insert("qualification_version", ["history_id", "sponsor_id", "edition_id", "source_campaign_id", "status", "reason", "valid_from", "valid_to", "version_no"] + PC, qual))

# --- opportunities, contracts, stage history ----------------------------------------------------
# (name, renewal, created, stages[(stage, when, proposed, confirmed)], contract (signed, [(type, value, asset)]) | None, drop_reason)
deals = [
    ("Aster Living", True, "2026-10-30", [("prospecting", "2026-10-30 12:00", 120000, None), ("proposal_sent", "2026-11-01 12:00", 120000, None), ("partner_confirmed", "2026-11-05 16:00", 120000, 120000)], ("2026-11-05 15:00", [("cash", 120000, None)]), None),
    ("Juniper Foods", True, "2026-10-31", [("prospecting", "2026-10-31 12:00", 90000, None), ("proposal_sent", "2026-11-03 12:00", 90000, None), ("negotiating", "2026-11-06 12:00", 90000, None), ("partner_confirmed", "2026-11-10 16:00", 90000, 90000)], ("2026-11-10 15:00", [("cash", 90000, None)]), None),
    ("Mosaic Mobility", True, "2026-11-03", [("prospecting", "2026-11-03 12:00", 100000, None), ("proposal_sent", "2026-11-06 12:00", 100000, None), ("negotiating", "2026-11-13 12:00", 100000, None), ("partner_confirmed", "2026-11-20 16:00", 100000, 100000)], ("2026-11-20 15:00", [("cash", 100000, None)]), None),
    ("Beardo", True, "2026-11-04", [("prospecting", "2026-11-04 12:00", 200000, None), ("proposal_sent", "2026-11-09 12:00", 200000, None), ("negotiating", "2026-11-18 12:00", 180000, None)], None, None),
    ("Bramble Active", True, "2026-11-05", [("prospecting", "2026-11-05 12:00", 110000, None), ("proposal_sent", "2026-11-12 12:00", 110000, None)], None, None),
    ("Aster Learning", True, "2026-11-06", [("prospecting", "2026-11-06 12:00", 100000, None), ("proposal_sent", "2026-11-10 12:00", 100000, None), ("lost", "2026-11-19 12:00", 100000, None)], None, "budget_mismatch"),
    ("Bramble Devices", True, "2026-11-09", [("prospecting", "2026-11-09 12:00", 90000, None), ("proposal_sent", "2026-11-20 12:00", 90000, None)], None, None),
    ("Haldi & Hive", False, "2026-11-07", [("prospecting", "2026-11-07 12:00", 75000, None), ("proposal_sent", "2026-11-09 12:00", 75000, None), ("partner_confirmed", "2026-11-12 16:00", 75000, 75000)], ("2026-11-12 15:00", [("cash", 75000, None)]), None),
    ("Arcadia Loop Games", False, "2026-11-11", [("prospecting", "2026-11-11 12:00", 90000, None), ("proposal_sent", "2026-11-16 12:00", 90000, None)], None, None),
    ("Brewnova", False, "2026-11-12", [("prospecting", "2026-11-12 12:00", 60000, None)], None, None),
    ("Rupeeroot", False, "2026-11-06", [("prospecting", "2026-11-06 12:00", 150000, None), ("proposal_sent", "2026-11-10 12:00", 150000, None), ("negotiating", "2026-11-17 12:00", 150000, None), ("partner_confirmed", "2026-11-24 16:00", 150000, 150000)], ("2026-11-24 15:00", [("cash", 150000, None)]), None),
    ("Voltyatra", False, "2026-11-11", [("prospecting", "2026-11-11 12:00", 120000, None), ("proposal_sent", "2026-11-16 12:00", 120000, None)], None, None),
    ("Minutekart", False, "2026-11-13", [("prospecting", "2026-11-13 12:00", 100000, None), ("proposal_sent", "2026-11-23 12:00", 100000, None)], None, None),
    ("Kaveri Threads", False, "2026-11-04", [("prospecting", "2026-11-04 12:00", 85000, None), ("proposal_sent", "2026-11-07 12:00", 85000, None), ("partner_confirmed", "2026-11-17 16:00", 85000, 85000)], ("2026-11-17 15:00", [("cash", 60000, None), ("in_kind", 25000, None)]), None),
    ("Swiftsip", False, "2026-11-06", [("prospecting", "2026-11-06 12:00", 70000, None), ("proposal_sent", "2026-11-13 12:00", 70000, None), ("negotiating", "2026-11-21 12:00", 70000, None)], None, None),
    ("Pebblebox", False, "2026-11-16", [("prospecting", "2026-11-16 12:00", 80000, None)], None, None),
    ("Skyline Telecom Co", False, "2026-09-30", [("prospecting", "2026-09-30 12:00", 160000, None), ("proposal_sent", "2026-10-03 12:00", 160000, None), ("negotiating", "2026-10-09 12:00", 160000, None), ("partner_confirmed", "2026-10-15 16:00", 160000, 160000)], ("2026-10-15 15:00", [("cash", 160000, "AS26-PRES")]), None),
    ("Novaphone", False, "2026-10-13", [("prospecting", "2026-10-13 12:00", 300000, None), ("proposal_sent", "2026-10-20 12:00", 300000, None), ("negotiating", "2026-11-10 12:00", 300000, None)], None, None),
    ("Paywave Bank", False, "2026-10-21", [("prospecting", "2026-10-21 12:00", 250000, None), ("proposal_sent", "2026-10-28 12:00", 250000, None)], None, None),
]
opp, con, lines, sv, slots = [], [], [], [], []
for k, (n, ren, created, stages, contract, drop) in enumerate(deals, 1):
    sid, cid, camp, owner = sponsors[n]
    oid = f"O26-{k:03d}"
    opp.append((oid, sid, ED, cid, camp, {"C26-B4A": "B4a", "C26-B4B": "B4b", "C26-B3": "B3", "C26-IN": "B1", "C26-B5": "B5"}[camp],
                "mixed" if contract and len(contract[1]) > 1 else "cash", ren, "direct_past_owner" if ren else None, f"{n} 2026-27", T(created), *prov()))
    if contract:
        kid = f"K26-{k:03d}"
        con.append((kid, oid, T(contract[0]), sum(v for _, v, _ in contract[1]), "standard_50_50", cid, "active", T(contract[0]), *prov()))
        for j, (ty, v, asset) in enumerate(contract[1], 1):
            lines.append((f"KL26-{k:03d}-{j}", kid, asset, ty, v, *prov()))
            if asset:
                slots.append(("SL26-PRES-1", asset, 1, "sold", None, None, f"KL26-{k:03d}-{j}", *prov()))
    for j, (st, when, pv, cv) in enumerate(stages, 1):
        nxt_when = stages[j][1] if j < len(stages) else None
        sv.append((f"H26-{k:03d}-{j}", oid, st, owner, pv, cv, drop if st == "lost" else None, T(when), T(nxt_when) if nxt_when else None, j, *prov()))
S.append(insert("opportunity", ["opportunity_id", "sponsor_id", "edition_id", "primary_contact_id", "originating_campaign_id", "bet_id", "support_type", "is_renewal", "renewal_route", "name", "created_at"] + PC, opp))
S.append(insert("contract", ["contract_id", "opportunity_id", "signed_at", "signed_value_total", "payment_terms", "signatory_contact_id", "status", "valid_from"] + PC, con))
S.append(insert("contract_line", ["contract_line_id", "contract_id", "asset_id", "consideration_type", "value"] + PC, lines))
slots.append(("SL26-PRES-2", "AS26-PRES", 2, "available", None, None, None, *prov()))
slots.append(("SL26-TITLE-1", "AS26-TITLE", 1, "held", "O26-018", T("2026-12-13"), None, *prov()))
S.append(insert("asset_slot", ["slot_id", "asset_id", "slot_no", "status", "held_for_opportunity_id", "hold_expires_at", "sold_contract_line_id"] + PC, slots))
S.append(insert("opportunity_stage_version", ["history_id", "opportunity_id", "stage", "owner_member_id", "proposed_value", "confirmed_value", "drop_reason", "valid_from", "valid_to", "version_no"] + PC, sv))

# --- money: schedules (50/50), invoices on signing day, receipts, allocations ------------------------
cash_of = {c[0]: sum(l[4] for l in lines if l[1] == c[0] and l[3] == "cash") for c in con}
psi, inv, rec, alloc = [], [], [], []
from datetime import date, timedelta
for c in con:
    kid, signed = c[0], c[2][:10]
    adv = cash_of[kid] / 2
    d_adv = (date.fromisoformat(signed) + timedelta(days=7)).isoformat()
    psi.append((f"PS26-{kid[4:]}-A", kid, "advance", adv, d_adv, *prov()))
    psi.append((f"PS26-{kid[4:]}-B", kid, "balance", cash_of[kid] - adv, "2027-01-02", *prov()))
    inv.append((f"IV26-{kid[4:]}", f"DEMO/2026/{kid[4:]}", kid, f"PS26-{kid[4:]}-A", T(signed + " 18:00"), adv, 0, "issued", *prov()))
paid = {  # contract -> (received, reconciled?)
    "K26-017": ("2026-10-20 11:00", True), "K26-001": ("2026-11-09 11:00", True), "K26-002": ("2026-11-20 11:00", True),
    "K26-008": ("2026-11-16 11:00", True), "K26-014": ("2026-11-24 11:00", False)}
opp_sponsor = {o[0]: o[1] for o in opp}
con_opp = {c[0]: c[1] for c in con}
for k, (kid, (when, ok)) in enumerate(sorted(paid.items()), 1):
    amt = cash_of[kid] / 2
    rid = f"RC26-{k:03d}"
    rec.append((rid, opp_sponsor[con_opp[kid]], T(when), amt, "bank_transfer", f"DEMO-UTR-{k:04d}", ok, T(when[:10] + " 18:00") if ok else None, "SIM-FIN", *prov()))
    alloc.append((f"AL26-{k:03d}", rid, f"IV26-{kid[4:]}", f"PS26-{kid[4:]}-A", amt, *prov()))
S.append(insert("payment_schedule_item", ["schedule_item_id", "contract_id", "kind", "amount_due", "due_date"] + PC, psi))
S.append(insert("invoice", ["invoice_id", "invoice_no", "contract_id", "schedule_item_id", "issued_at", "amount", "tax_amount", "status"] + PC, inv))
S.append(insert("receipt", ["receipt_id", "sponsor_id", "received_at", "amount", "method", "bank_reference", "reconciled", "reconciled_at", "recorded_by"] + PC, rec))
S.append(insert("receipt_allocation", ["allocation_id", "receipt_id", "invoice_id", "schedule_item_id", "amount"] + PC, alloc))

# --- tasks, hours, escalation ------------------------------------------------------------------
tasks = [
    ("TK26-01", "Send proposal to Brewnova (SLA day 10)", "proposal", "SIM-COMM", "2026-11-22 18:00", "open", None, "opportunity", "O26-010", "B1"),
    ("TK26-02", "Create deal record for Neonleaf Snacks (qualified 13 Nov)", "follow_up", "SIM-COMM", "2026-11-18 18:00", "open", None, "sponsor", sponsors["Neonleaf Snacks"][0], "B1"),
    ("TK26-03", "Create deal record for Coinmesh (qualified 12 Nov)", "follow_up", "SIM-NET", "2026-11-17 18:00", "open", None, "sponsor", sponsors["Coinmesh"][0], "B1"),
    ("TK26-04", "Create deal record for Orbit Arena (qualified 12 Nov)", "follow_up", "SIM-OPS", "2026-11-17 18:00", "in_progress", None, "sponsor", sponsors["Orbit Arena"][0], "B1"),
    ("TK26-05", "Chase Mosaic Mobility advance (due 27 Nov)", "invoice", "SIM-FIN", "2026-11-27 18:00", "open", None, "opportunity", "O26-003", "B2"),
    ("TK26-06", "Reconcile Kaveri Threads advance against bank statement", "invoice", "SIM-FIN", "2026-11-26 18:00", "open", None, "opportunity", "O26-014", "B2"),
    ("TK26-07", "Title pitch follow-up: Novaphone term sheet", "pitch", "SIM-PREM", "2026-11-28 18:00", "in_progress", None, "opportunity", "O26-018", "B5"),
    ("TK26-08", "Renewal proposal: Aster Living", "proposal", "SIM-PART", "2026-11-01 18:00", "done", "2026-11-01 17:00", "opportunity", "O26-001", "B4a"),
    ("TK26-09", "Renewal proposal: Juniper Foods", "proposal", "SIM-PART", "2026-11-03 18:00", "done", "2026-11-03 16:00", "opportunity", "O26-002", "B4a"),
    ("TK26-10", "Discovery call: Rupeeroot", "call", "SIM-NET", "2026-11-05 18:00", "done", "2026-11-05 12:00", "opportunity", "O26-011", "B3"),
    ("TK26-11", "Proposal: Kaveri Threads", "proposal", "SIM-OPS", "2026-11-07 18:00", "done", "2026-11-07 15:00", "opportunity", "O26-014", "B1"),
    ("TK26-12", "Invoice advance: Aster Living", "invoice", "SIM-FIN", "2026-11-05 18:00", "done", "2026-11-05 18:00", "opportunity", "O26-001", "B2"),
    ("TK26-13", "Follow up Bramble Active proposal", "follow_up", "SIM-PART", "2026-11-19 18:00", "done", "2026-11-19 11:00", "opportunity", "O26-005", "B4a"),
    ("TK26-14", "Presenting pitch: Skyline Telecom Co", "pitch", "SIM-PREM", "2026-09-29 18:00", "done", "2026-09-29 16:00", "opportunity", "O26-017", "B5"),
]
S.append(insert("task", ["task_id", "title", "task_type", "owner_member_id", "due_at", "status", "completed_at", "linked_type", "linked_id", "bet_id", "origin", "created_at"] + PC,
                [(t[0], t[1], t[2], t[3], T(t[4]), t[5], T(t[6]) if t[6] else None, t[7], t[8], t[9], "manual", T("2026-10-27"), *prov()) for t in tasks]))
hours = {"TK26-08": 3.0, "TK26-09": 3.5, "TK26-10": 4.5, "TK26-11": 3.0, "TK26-12": 2.0, "TK26-13": 2.5, "TK26-14": 5.0}
tl = [(f"TL26-{k:02d}", t[3], t[0], t[9], t[2], t[6][:10], hours[t[0]], *prov()) for k, t in enumerate([t for t in tasks if t[5] == "done"], 1)]
S.append(insert("time_log", ["time_log_id", "member_id", "task_id", "bet_id", "task_type", "work_date", "hours"] + PC, tl))
S.append(insert("escalation", ["escalation_id", "rule_id", "raised_at", "owner_member_id", "status"] + PC,
                [("ES26-01", "EX-B4a", T("2026-11-09 10:00"), "SIM-LEAD", "acknowledged", *prov())]))

# --- D-010 pacing gates and T-7 cash gate for this edition (operating plan, read-only) -------------
base = [5.1, 10.3, 16.2, 18.5, 23.3, 27.6]; plan = [6.4, 13.0, 20.4, 23.4, 29.4, 34.8]
gates = []
for i, w in enumerate(range(4, 10)):
    gates.append((f"TG26-BASE-W{w}", ED, "K-G-01", "SC-01", f"W{w}", round(base[i] * 100000), "D-010"))
    gates.append((f"TG26-PLAN-W{w}", ED, "K-G-01", "SC-02", f"W{w}", round(plan[i] * 100000), "D-010"))
gates.append(("TG26-T7-CASH", ED, "K-G-02", None, "T-7", 0.85, "D-010"))
S.append(insert("target_version", ["target_id", "edition_id", "kpi_id", "scenario_id", "period", "target_value", "decision_id", "valid_from", "record_class", "import_batch_id", "source_ref", "evidence_class", "created_by"],
                [g + (T("2026-09-21"), "operating_plan", IB, "05_STRATEGY/kpi_dictionary.csv#K-G-01/K-G-02 (D-010)", "T", BY) for g in gates]))

S.append("COMMIT;")
S.append("""-- ----------------------------------------------------------------------------
-- Check (run separately after this file):
--   select metric_id, value, numerator, denominator, computable
--     from metrics.get_metric('M-08', 'simulated', 'ED-2026-DEMO', '2026-11-22', '{}')
--    union all select metric_id, value, numerator, denominator, computable
--     from metrics.get_metric('M-01', 'simulated', 'ED-2026-DEMO', '2026-11-25', '{}');
--   -- expect M-08 = 470000 (W4: below base gate 5.1L, above 0.8 × base) and M-01 = 222500
-- To remove the whole demo season later: delete is blocked by design; create a fresh project or
-- mark the batch: see DATABASE_FOUNDATION_README.md.
-- ----------------------------------------------------------------------------""")
(OUT / "06_seed_demo_2026.sql").write_text("\n\n".join(S) + "\n")
print("demo built:", len(sponsors), "sponsors,", len(att), "attempts,", len(inter), "interactions,", len(opp), "deals,", len(con), "contracts")
