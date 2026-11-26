# D-009: approved financial and modelling baseline

| Field | Value |
|---|---|
| Decision ID | D-009 |
| Decision | Adopt the v4.1 model's numbers and assumptions as the strategy baseline |
| Status | **Approved** |
| Approved by / when | User, 25 Nov 2026, 22:41 IST. Restated 22:47 IST: "D-009 is approved as the financial and modelling baseline. We are proceeding with the ₹21.2L base, ₹26.1L plan and ₹28.6L stretch. Do not reopen the research or rebuild v4.1." |
| Supersedes | D-005 (targets: base ₹26.1L / stretch ₹55.9L / downside ₹8.0L) and D-006 (old five bets) |
| Confidence | Medium. About half of the base rests on assumptions with no data: collection, recovery of leaked leads, renewals |
| Authoritative content | `04_FINANCIAL_MODELLING/frozen_v41_model/V4_README.md` (approved version with errata †) = project doc `claude/RISA_v4_model.md` |
| Frozen model | `04_FINANCIAL_MODELLING/frozen_v41_model/` (checksums in `frozen_v41_checksums.txt`) |
| Runnable release | `08_REPRODUCIBILITY/risa_v41_reproducibility.zip` (clean-room byte-identical; pre-dates F4c and the README errata) |

## Approved scenarios (₹ lakh, cash collected before the fest; in-kind excluded)

| Scenario | Configuration | Expected | P10–P90 | P(≥ 25 / 30 / 40) | Joint downside | In-kind | Capacity (window + pre-season) | P(over capacity) | Source |
|---|---|---|---|---|---|---|---|---|---|
| **Base** | Stop cold + handoff SLA + cash discipline + gated renewals | **21.2** | 15.0–27.5 | 22% / 4% / 0% | 14.9 | 2.8 | 50 + 0 | 0.0% | F1, F4b |
| **Plan** | Base + gated VC/alumni (reserve 12) + creator scale-up (+11), no premium inventory | **26.1** | 17.9–34.6 | 56% / 27% / 2% | 16.6 | 3.8 | 50 + 0 | 3.6% | F4 |
| **Stretch** | Plan + core premium inventory (title with broad exclusivity 0.5, 2 presenting, 12 activations, 3 digital), pre-season start | **28.6** | 19.8–37.7 | 70% / 42% / 5% | 17.3 (P10 8.7) | 4.2 | 60 + 10 | 4.7% | F2, F4c |
| Option (not part of the approved stretch) | Stretch + headline nights (only if an act is booked) | 29.1 | 19.7–38.5 | 72% / 45% / 7% | 16.7 | 4.4 | 60 + 10 | 8.8–9.7% (borderline) | F4 |

- **Base vs last year:** P(base cash ≥ "last year ~₹17L") = 80%. The ₹17L is an **assumption** (₹20.0L cash-type × 85%), not a dataset fact.
- **Precision:** P10–P90 figures come from seed-averaged Monte Carlo runs. The stretch row is from the F2 grid (2 seeds × 1,500 draws); the others from F1/F4 (2 seeds × 4,000 and 4 seeds × 3,000).

## Decision-log row (verbatim, `05_STRATEGY/decision_log/RISA_project_state.md`)
> | D-009 | **v4.1 model numbers and assumptions adopted as the strategy baseline** (user, 22:41). Base ₹21.2L expected @50 pw (P10–P90 15.0–27.5; P(≥~₹17L last year) 80%; downside 14.9) · Plan ₹26.1L @50 pw, no premium inventory (base + gated VC/alumni + creator scale-up) · Stretch ₹28.6L @60 window + 10 pre-season pw (core premium inventory: title w/ narrow exclusivity, 2 presenting, 12 activations, 3 digital; + VC + creator); P10–P90 19.8–37.7; P(≥30) 42%, P(≥40) 5%; downside 17.3. Headline nights only if an act is booked (+0.5L). Stop cold outreach; no standalone category exclusives. … | **Approved** | Medium …

**Correction note (does not change D-009):** the log row's phrase "title w/ narrow exclusivity" describes the strategy's *intent*. The approved ₹28.6L was computed with **broad** exclusivity (`EXCL_SCOPE = 0.5`, F2 configuration). D-010 (§3) records this, and the repository treats broad exclusivity as the scenario assumption. Narrow exclusivity is an unbudgeted upside of +0.47 (F6).
