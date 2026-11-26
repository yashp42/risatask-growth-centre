# 07 AI evaluation

Phase 5 · version 1.0 · 2026-11-26 · status: proposed evaluation design

A test bank for the future AI analyst, written before the analyst exists, so that it is judged against the approved metric definitions, the knowledge base and the permission model rather than against how plausible its answers sound.

| File | Contents |
|---|---|
| `chatbot_test_bank.csv` | 66 tests. Fields: test_id, category, difficulty, user_query, intent, route (sql / rag / hybrid / lookup / action / refuse), required_data_sources, expected_tool_or_query, expected_answer_criteria, expected_calculation, expected_citation, required_caveat, action_permission_level (L1–L5 or forbidden), failure_condition, rubric_dimensions, reference_answer, sql_test, test_setup, follow_up_of, must_not_cite |
| `sql_test_cases/` | 29 runnable read-only queries (`T-NN.sql`) and `expected_results.csv`, the result of executing each against `sponsor.duckdb` |
| `expected_answers/reference_answers.md` | One acceptable answer per test |
| `citation_tests/citation_key.csv` | Sources each answer must cite and anything it must not cite as current |
| `action_safety_tests/action_cases.csv` | The 8 action and permission tests: expected proposed-action payload, confirmation requirement, forbidden effects |
| `scoring_rubric.md` | Eight scoring dimensions, six gate failures, pass thresholds and procedure |
| `build_test_bank.py` | Generates everything above; re-run after any data change to refresh expected values |
| `validate_test_bank.py` | Checks coverage, fields, citations, SQL results and action consistency; exits 1 on any problem |

## Coverage

All 15 required categories (4–5 tests each) plus 2 follow-up and 2 changed-data tests. The brief's ten hard questions are T-51 (historical collection rate), T-23 (is ₹28.6L collected), T-12 (cash per person-week by campaign), T-52 (outstanding cash), T-27 (stretch depends on inventory), T-26 (fewer than 6 introductions), T-45 (decision-makers), T-40 (asking-price benchmarks), T-22 (base vs stretch) and T-47 (follow-up task for an overdue proposal).

Several tests have no numeric answer by design: the correct response is to say the data cannot answer and why (T-12, T-25, T-45, T-51–T-54). Others plant a false premise (T-17 introduction exists, T-55 base is ₹26.1L, T-57 stretch ₹55.9L) or ask for forbidden writes (T-59–T-62).

## Changed-data and follow-up tests

T-64 runs on a copy of the database with one inserted confirmed deal; the assistant passes only if it re-queries rather than adding to a remembered total. T-63 and T-66 are asked in the same session as T-01 and T-26 and test that context carries over without stale numbers.

## Run

```bash
python3 07_AI_EVALUATION/build_test_bank.py      # regenerate and re-execute SQL
python3 07_AI_EVALUATION/validate_test_bank.py   # integrity check
```

Scoring is manual or LLM-judged against `scoring_rubric.md` once the assistant exists (Stage 8). No assistant has been built or run against this bank.
