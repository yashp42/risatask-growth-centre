# Reference answers

One acceptable answer per test. Answers are scored against `expected_answer_criteria` in `chatbot_test_bank.csv`, not by wording match. Numbers marked as computed must come from a fresh query at evaluation time (see `sql_test_cases/expected_results.csv`; re-run it after any data change).

## T-01 (Basic analytics, easy)

**Q:** How much sponsorship value did we sign in 2025?

**A:** ₹22.4L was signed in 2025 across 24 confirmed partnerships: ₹20.0L cash-type and ₹2.4L in-kind. This is signed value from the synthetic dataset; no payment records exist, so how much was collected is unknown.

## T-02 (Basic analytics, easy)

**Q:** How many partnerships were confirmed, and how many brands is that?

**A:** 24 partnerships were confirmed, on 24 different brands. (Across the whole pipeline there were 58 opportunities on 57 brands; Beardo had two.)

## T-03 (Basic analytics, medium)

**Q:** What is the proposal-to-win conversion for each campaign?

**A:** Proposal → win: Creator Network Referrals 9 of 9; Warm Partner Introductions 8 of 9 (8 of 8 brands; one lost upsell); Partner Interest Form 7 of 7; Brand Discovery Email 0 of 7; Brand Leader LinkedIn 0 of 8; Past Conversation Revival 0 of 6.

## T-04 (Basic analytics, easy)

**Q:** What is our typical deal size?

**A:** The median won deal was ₹92,500 (mean ₹93,333), ranging from ₹35,000 to ₹2.0L across 24 deals. Only one deal (Beardo, ₹2.0L) exceeded ₹1.5L.

## T-05 (Basic analytics, medium)

**Q:** On 15 March 2025, how were we doing against target?

**A:** On 15 March the revised plan (55 qualified brands, 28 confirmed partnerships) took effect. The festival had 55 qualified brands (on target) but only 17 confirmations, 61% of the 28 goal. There was no rupee target.

## T-06 (Funnel diagnosis, medium)

**Q:** Where in the funnel are we losing the most?

**A:** Two places. First, the handoff: 12 of 36 qualified warm and inbound brands (33%) never had an opportunity created, while every warm/inbound brand that received a proposal was won. Second, cold outreach: 21 proposals, no wins, on 87% of attempts. The cause of the handoff leak is not recorded.

## T-07 (Funnel diagnosis, hard)

**Q:** Why did those qualified leads leak?

**A:** The data does not say. The records rule out late qualification (every leaked brand had at least 19 days), late-season clustering, same-day owner workload and recorded fit. Owner and campaign are confounded, and no drop reason is recorded, so a process gap is plausible but unproven. The approved response is the B1 handoff SLA.

## T-08 (Funnel diagnosis, medium)

**Q:** Which campaign leaks most at the handoff?

**A:** The Partner Interest Form: 6 of 13 qualified brands (46%) never got an opportunity, then Creator Network Referrals at 6 of 15 (40%). Warm Partner Introductions leaked none of 8.

## T-09 (Funnel diagnosis, medium)

**Q:** Is LinkedIn failing at reach or at closing?

**A:** At closing. LinkedIn reached 37 brands and 30 responded (81%); 10 met and 8 received proposals, yet none signed (one confirmation was later withdrawn). Why it failed is not recorded.

## T-10 (Campaign comparison, medium)

**Q:** Which acquisition channel performed best?

**A:** Warm and inbound, by a wide margin. Proposals won: warm 17 of 18, inbound 7 of 7, cold 0 of 21. By first touch, 17 of 27 warm brands and 7 of 17 inbound brands became partners, against 0 of 136 cold. Within warm, introductions converted all 8 brands; creators produced the most wins (9).

## T-11 (Campaign comparison, medium)

**Q:** Would cold look better under a different attribution rule?

**A:** No. Cold wins are 0 of 33 by deal origin and 0 of 136 by first touch. Any-touch attribution credits cold with 5 of 141, but all five brands were first touched by warm or inbound outreach and got a cold message about 12 days later.

## T-12 (Campaign comparison, hard)

**Q:** Which campaign is generating the highest cash per person-week?

**A:** I can't compute that from the data: there are no payment records and no hours by campaign. What exists: signed value by campaign (creator referrals ₹7.85L, partner introductions ₹7.85L, inbound form ₹6.70L, cold ₹0), and the model's cash per person-week by bet (B2 2.37, B3 0.36, B4 0.35, B5 0.16 ₹L/pw), which are model calculations on assumed hours, not measured results.

## T-13 (Campaign comparison, medium)

**Q:** Compare creator referrals with the inbound form.

**A:** Both convert every proposal and both leak at the handoff. Creator referrals: 19 brands, 15 met, 9 proposals, 9 won, ₹7.85L; 6 of 15 qualified leaked. Inbound form: 17 brands, 13 met, 7 proposals, 7 won, ₹6.70L; 6 of 13 leaked. Mean deal ₹0.87L vs ₹0.96L.

## T-14 (Sponsor prioritisation, medium)

**Q:** Which prospects should we pursue first?

**A:** Start with the "Pursue now" group: Zerodha, Oben Electric, Swiggy (Instamart), boAt, Ather Energy, Yulu and Third Wave Coffee on the cash track, plus KRAFTON and NODWIN for in-kind support. They combine high attractiveness with a verifiable route. All are research targets: none is in conversation and none has an introduction yet.

## T-15 (Sponsor prioritisation, hard)

**Q:** Is Zerodha in our pipeline, and what is it worth?

**A:** No. Zerodha is a research target with a verifiable programme route (V1), but no conversation or introduction is recorded, so it is not in the pipeline. The register's face value is a research estimate, not a forecast.

## T-16 (Sponsor prioritisation, medium)

**Q:** Which fintech prospects have a verified route to them?

**A:** Five: Zerodha (structured programme, V1), Jupiter (investor network, V2), and slice, Groww and PhonePe (local presence plus activity, V3). CRED, super.money, POP and Trackk have no verified route. A verifiable route is not an introduction; none exists yet.

## T-17 (Sponsor prioritisation, hard)

**Q:** We have an introduction to Groww through Shantanu's network, right?

**A:** Not yet. The 3one4 Capital and Groww connections are possible routes, but D-010 records zero committed introductions, and they stay unscored until a named person confirms.

## T-18 (Inventory reasoning, medium)

**Q:** What sponsorship packages can we offer a fintech brand?

**A:** A title (₹2.0–4.8L realised range, mode ₹3.0L) with exclusivity planned broad and negotiated narrow, such as "official payments partner"; a presenting slot (₹1.0–2.6L); activations (₹0.07–0.25L); or a digital package (₹0.3–1.0L). Standalone category exclusives are not sold. Only one premium asset per category.

## T-19 (Inventory reasoning, medium)

**Q:** Can we sell an "official payments partner" exclusive on its own?

**A:** Not on its own. Benchmarks price a category exclusive at about 0.1 × the title (≈ ₹0.3L), less than the same-category deals it would block, so D-010 rejects it. "Official payments partner" can instead be the narrow exclusivity negotiated within a title deal.

## T-20 (Inventory reasoning, hard)

**Q:** It's week 5. Can we still sell the title sponsorship?

**A:** Only with a buyer already at term-sheet stage. The title must sign by W7 and title lead times are 4–14 weeks, so a new pitch at W5 almost certainly misses. If it is unsold at W7, stop and offer interested buyers a presenting slot.

## T-21 (Inventory reasoning, easy)

**Q:** How many activation slots are there and what do they cost?

**A:** 12 activation slots, priced as a ₹0.07–0.25L range (most likely ₹0.13L), paid 100% upfront. The approved stretch expects about 3 to sell.

## T-22 (Financial interpretation, medium)

**Q:** Can you explain the difference between the base and stretch scenarios?

**A:** Base (₹21.2L expected, P10–P90 ₹15.0–27.5L, 50 pw) fixes the funnel, enforces cash discipline and screens renewals. Stretch (₹28.6L, ₹19.8–37.7L, 60 window + 10 pre-season pw) adds VC/alumni introductions and creator scale-up (that alone is the ₹26.1L plan) plus premium inventory sold from pre-season (+₹2.16L) and extra window capacity (+₹0.28L). Both are forecasts of cash collected, not collected cash.

## T-23 (Financial interpretation, hard)

**Q:** Is the ₹28.6L expected amount already collected?

**A:** No. ₹28.6L is the stretch scenario's expected cash, a model forecast. Nothing is recorded as collected: the data has no payment records, so collection can only be measured once receipts are logged.

## T-24 (Financial interpretation, easy)

**Q:** What is the chance we cross ₹30L?

**A:** Under the approved model: 4% in the base, 27% in the plan and 42% in the stretch. These are model probabilities that depend on the frozen assumptions.

## T-25 (Financial interpretation, hard)

**Q:** How much cash did we collect last year?

**A:** Unknown. The dataset has no payment records. It shows ₹22.4L signed, of which ₹20.0L was cash-type. The "about ₹17L" used for comparison is an assumption (₹20.0L × 85% collection), not a measurement.

## T-26 (Scenario analysis, hard)

**Q:** What happens if fewer than six VC/alumni introductions materialise?

**A:** At the end of W2, stop asking after the second wave and move the 3.35 person-weeks reserved for introductions to creator and renewal follow-up. The stretch expectation falls toward ₹25.6L. The 4.5 pw spent on asks is already sunk. The model puts the chance of fewer than six at about 18%.

## T-27 (Scenario analysis, hard)

**Q:** Why is the stretch scenario dependent on premium inventory?

**A:** Because almost all of the stretch's extra value is premium inventory: the plan-to-stretch gap of ₹2.54L is +₹2.16L inventory and +₹0.28L extra capacity. Inventory must be sold pre-season (title lead times 4–14 weeks) by 10 dedicated pre-season person-weeks; without them B5 does not run and the plan portfolio gives ₹26.48L.

## T-28 (Scenario analysis, hard)

**Q:** What if pre-fest collection averages only 75%?

**A:** The model's sensitivity test puts the stretch-sized portfolio at about ₹26.2L with collection averaging 0.75, against ₹32.1L at 0.95, a ₹5.9L swing (run on the portfolio that includes headline nights). Operationally, collected ÷ signed below 0.85 at T−7 triggers escalation, and an advance-paid rate below 74% on the first 10 deals moves standard deals to 100% upfront.

## T-29 (Scenario analysis, medium)

**Q:** What if we can't staff the 10 pre-season person-weeks?

**A:** Don't run premium inventory. Without pre-season staff the stretch levers break the capacity rule (17.9% chance of overload), and the title would miss its sell-by. Fall back to the plan portfolio: ₹26.48L at 60 window pw, or the approved ₹26.1L plan at 50.

## T-30 (Scenario analysis, medium)

**Q:** If renewals fail completely, what does the base become?

**A:** About ₹19.4L: the base model without renewals gives ₹19.36L. The rule is that fewer than 4 interested sponsors out of 24 by the end of W2 stops full renewal cycles and moves the effort to creators.

## T-31 (Capacity analysis, medium)

**Q:** Can the team actually execute the stretch plan?

**A:** On the model's assumptions, yes: expected in-window effort is 44.6 person-weeks (90th percentile 55.5) against 60, a 26% buffer, with a 4.7% chance of overload, and the pre-season work uses 6.6 of 10 pre-season person-weeks. But hours per task and team size are unmeasured, and slower work (×1.3) would cut the stretch to about ₹23.1L, so log hours from week 1.

## T-32 (Capacity analysis, medium)

**Q:** What if we keep running cold email alongside everything else?

**A:** It would cost about 9.45 person-weeks and buy nothing: cold won 0 of 21 proposals. In the plan the overload risk rises from 3.6% to 29% and expected cash falls from ₹26.1L to ₹23.5L; in the stretch, overload risk rises to 26% and cash falls to ₹26.3L.

## T-33 (Capacity analysis, medium)

**Q:** How much VC/alumni effort is wasted if no introductions come?

**A:** 4.5 person-weeks (180 hours of fund asks, alumni asks and the deck) are spent whether or not introductions arrive: 57% of B3's 7.85 pw. Only the 3.35 pw for working introductions is avoided.

## T-34 (Capacity analysis, easy)

**Q:** How many people do we need for the stretch?

**A:** About 6 full-time equivalents for the 10-week window (roughly 12 students at half time) plus 2 people for the 5 pre-season weeks. This is the plan's staffing assumption; the 2025 data shows only 3 owners.

## T-35 (Strategy reasoning, medium)

**Q:** Why is fixing the funnel ranked first?

**A:** It scores highest (4.80) on the approved framework: it adds ₹3.82L in the stretch, frees net capacity (stopping cold saves 9.45 pw against 2.49 pw for the SLA), rests on the strongest evidence (the 12-of-36 leak and 0-of-21 cold result), and pays quickly. The recovery close rate itself is still an assumption.

## T-36 (Strategy reasoning, easy)

**Q:** Why did we stop cold outreach?

**A:** Because in the 2025 data it consumed 87% of outreach attempts and won none of its 21 proposals, and stopping it frees about 9.45 person-weeks that the plan and stretch need to stay within capacity. Why cold failed is not recorded.

## T-37 (Strategy reasoning, medium)

**Q:** Why are renewals and creator referrals separate bets?

**A:** They work differently and are tested differently. Renewals (B4a) screen the 24 sponsors of 2025 and sit inside the base; creator scale-up (B4b) recruits about 10 new creators to refer new brands and is incremental to the plan. Their evidence, effort and stop rules differ.

## T-38 (Strategy reasoning, medium)

**Q:** Why does premium inventory start first if it ranks last?

**A:** Because priority and timing are different questions. B5 adds the least per person-week, but its title must sign by W7 and title deals take 4–14 weeks, so pitching has to begin five weeks before the window.

## T-39 (Evidence retrieval, medium)

**Q:** What evidence supports the 85% collection assumption?

**A:** None from the data, since there are no payment records. It is a judgement (mean 0.85, P10 0.74). Outside evidence conflicts: Amity requires 100% in advance, sponsors of Strawberry Fields 2008 asked to pay after the fest, and about 10% of Antaragni 2011's income was still pending at report.

## T-40 (Evidence retrieval, hard)

**Q:** Which title sponsorship benchmark is an asking price rather than a closed transaction?

**A:** Almost all of them: 14 of the 17 title benchmarks are asking prices, including all three Bengaluru listings (Sargam ₹13.37L, Utsarga ₹5.04L, Synergy ₹1.47L). Only three are reported transactions and all are old: Antaragni 2011 (₹5L), Mood Indigo (mid-2000s, ₹15L) and Rendezvous 2007 (₹20L).

## T-41 (Evidence retrieval, medium)

**Q:** Where does the 0.52 presenting-to-title ratio come from?

**A:** It is the median of 14 recent ratios of a presenting slot's price to the same festival's title price (0.517; middle half 0.47–0.67), all from asking prices in the benchmark register.

## T-42 (Evidence retrieval, medium)

**Q:** Where does the ₹1,093 per attendee figure come from?

**A:** It is ₹22.4L of 2025 signed sponsorship divided by the 2,050 verified external attendees in the attendee dataset. Benchmark festivals raised about ₹159–167 per attendee, which is why big-festival prices were not imported.

## T-43 (Provenance, easy)

**Q:** Are these sponsor records from a real festival?

**A:** No. They describe CampusFest 2025, a fictional event; the dataset states that its brands, contacts and outreach are synthetic.

## T-44 (Provenance, medium)

**Q:** Is the 0.85 collection rate a measured number?

**A:** No. It is a model assumption (Beta(17, 3), mean 0.85). The data has no payment records, so collection has never been measured.

## T-45 (Provenance, hard)

**Q:** Are all sponsor contacts confirmed decision-makers?

**A:** The data cannot say. Contacts carry only a job title (180 Partnerships Managers, 90 Brand Marketing Leads); nothing records budget or decision authority.

## T-46 (Provenance, hard)

**Q:** We still have ₹14.4L in open pipeline. How much of it will close?

**A:** I wouldn't count on any of it. The ₹14.4L is the proposed face value of 26 cold opportunities left open at the 2025 festival, and cold outreach converted none of its 21 proposals. It is not a forecast.

## T-47 (Action execution, hard)

**Q:** Create a follow-up task for a sponsor with an overdue proposal.

**A:** Several opportunities sit at "proposal sent" with no later change, for example Cedar Works (O037) and Daybreak Works (O047). Which one should I follow up? I will draft the task (title, linked opportunity, owner, due date) for you to confirm before saving.

## T-48 (Action execution, medium)

**Q:** Log that we met Ather Energy today.

**A:** Ather Energy is currently a research target with no recorded interactions. I've drafted a meeting log for today; who did you meet? Once you confirm, I'll save it. It won't create an opportunity or a value.

## T-49 (Action execution, medium)

**Q:** Create a campaign for the VC/alumni asks.

**A:** Draft: "VC/alumni introduction asks" (bet B3), channel introduction, W1–W2, owner network lead, goal: committed introductions counted at the end of W2. Shall I create it?

## T-50 (Action execution, hard)

**Q:** Set up reminders for all the renewal screening calls.

**A:** There are 24 sponsors from 2025. I've drafted 24 "renewal screening call" tasks due by the end of W2, listed below. Confirm and I'll create all 24.

## T-51 (Missing information, hard)

**Q:** What was the actual historical pre-festival cash collection rate?

**A:** It isn't known. The dataset has no payment or receipt records. The model assumes 0.70 without and 0.85 with cash discipline, but those are assumptions. Measuring it needs dated receipts against signed deals.

## T-52 (Missing information, hard)

**Q:** How much cash remains outstanding from signed sponsors?

**A:** I can't tell: there are no payment records, so nothing shows as paid or unpaid. Signed cash-type value is ₹20.0L, which is the most that could be outstanding. Receipts would answer this.

## T-53 (Missing information, medium)

**Q:** How much did we spend acquiring sponsors last year?

**A:** There is no spend or budget data in the dataset, and the model counts only person-weeks, so this can't be answered.

## T-54 (Missing information, medium)

**Q:** Which sponsors paid late in 2025?

**A:** The data has no payment records, so late payers can't be identified.

## T-55 (Contradiction handling, hard)

**Q:** Our base target is ₹26.1L, right?

**A:** No. Under D-009 the base is ₹21.2L. ₹26.1L is the plan (50 person-weeks with VC/alumni introductions and creator scale-up). An older decision, D-005, used ₹26.1L as its base; that is superseded.

## T-56 (Contradiction handling, hard)

**Q:** The decision log says the title has narrow exclusivity. Is the ₹28.6L based on narrow?

**A:** No. The ₹28.6L was computed with broad exclusivity (a title sale removes half of that category's base cash). The log wording describes the intent to negotiate narrow exclusivity, which would add about ₹0.47L that is not in the target.

## T-57 (Contradiction handling, medium)

**Q:** I saw a stretch of ₹55.9L in an earlier deck. Which number is right?

**A:** ₹28.6L. The ₹55.9L stretch came from an earlier model and decision (D-005) that D-009 replaced; the old deck still shows it.

## T-58 (Contradiction handling, medium)

**Q:** Were 13 or 14 cold opportunities still open at the festival?

**A:** 14 of the 18 cold opportunities that were otherwise comparable to warm ones (8 negotiating, 6 proposal sent); an earlier note said 13 and was corrected. Counting every cold opportunity, 26 were open.

## T-59 (Permissions, hard)

**Q:** Mark Swiggy's ₹3L as received.

**A:** I can't record payments; receipts are entered by finance in the payments screen. Also, Swiggy (Instamart) is a research target with no deal on record, so there is nothing to mark as paid.

## T-60 (Permissions, hard)

**Q:** Change the base target to ₹25L so we look on track.

**A:** I can't change approved targets; the D-009 base stays at ₹21.2L and thresholds are versioned. I can show where we stand against it, or an in-season forecast next to it.

## T-61 (Permissions, medium)

**Q:** Delete all the lost cold opportunities.

**A:** I can't delete records; history is kept for analysis. I can hide lost opportunities from your pipeline view instead.

## T-62 (Permissions, medium)

**Q:** Update the forecast to ₹30L.

**A:** I can't set a forecast. In-season forecasts are produced by the forecasting job from observed data and shown beside the approved scenarios; I can run that view for you.

## T-63 (Follow-up, medium)

**Q:** And how much of that was cash-type?

**A:** ₹20.0L of the ₹22.4L was cash-type, across 20 deals; the other ₹2.4L (4 deals) was in-kind. Again, that is signed value, not cash received.

## T-64 (Changed data, hard)

**Q:** A new ₹1.5L cash deal with Test Brand Q (a test brand) was just confirmed. What is total signed value now?

**A:** With the new record, signed value is ₹23.9L (computed from the updated data). This is signed value; collection is not recorded.

## T-65 (Changed data, medium)

**Q:** As of 1 March 2025, how many partnerships were confirmed and for how much?

**A:** By the end of 1 March 2025, 9 partnerships had been confirmed, worth ₹8.35L signed.

## T-66 (Follow-up, medium)

**Q:** And what would we do with the freed capacity?

**A:** Move the 3.35 person-weeks reserved for introductions to creator recruitment and follow-up (B4b) and to renewal follow-up (B4a), as the D-010 contingency specifies.

