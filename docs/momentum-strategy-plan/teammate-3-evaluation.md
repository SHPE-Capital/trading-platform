# Teammate 3: Evaluation, dashboard and presentation

Back to [README.md](README.md). Repos: **research-python** (report and diagnostics) and
**trading-platform** frontend (results view).

Goal: the evidence for Nov 30: the Similarity − Recency comparison with honest uncertainty,
the search diagnostics that feed the freeze, the dashboard on real results, and the deck.
Build on synthetic daily series now; point at Teammate 2's outputs as they arrive.

Existing code: research-python `evaluation/stats.py` (`paired_block_bootstrap`,
`block_bootstrap`, `deflated_sharpe`), `evaluation/report.py`, `evaluation/trading.py`;
the calibration audit trail written by `calibration/search.py`; trading-platform
`frontend/features/momentum/results/` (P3-3 view on a mock summary, schema in `types.ts`).

---

## T3-1 Policy comparison report (E2)

- **Owns:** research-python `evaluation/policy_compare.py`, `scripts/momentum/report.py`, tests
- **Depends on:** the walk-forward output format (synthetic series now); reserved-run series
  from Teammate 2 by Nov 25
- **Spec:** §9 "The reported results", "Uncertainty without treating trades as independent"
- **Contents:** per policy: cumulative net return and ending equity, max drawdown, average
  daily return, downside variability, trades, active days, no-deployment weeks, average
  holding time, exposure, turnover, rejected signals, concentration by stock and date, cost
  sensitivity (5, 10, 20 bps) and calibration runtime. **Primary result:** daily net return of
  Similarity − Recency on paired dates with a paired block bootstrap (5-session blocks; 10 and
  20 as sensitivity; resamples from the protocol config). Uniform shown for context. All three
  equity curves on one calendar; whether gains concentrate in a few weeks or stocks. Emit a JSON
  summary that matches `frontend/features/momentum/results/types.ts` (change the TS type with
  the dashboard in the same PR if needed).
- **Done when:** the report renders from synthetic series, a test shows the bootstrap uses
  the **same blocks** for both policies, and it renders from the development walk-forward.

## T3-2 Search diagnostics (E3)

- **Owns:** research-python `evaluation/search_diagnostics.py`, tests
- **Depends on:** the D3/D4 audit trail (built); development runs from Teammate 2 (Nov 20)
- **Spec:** §10 "Development checks search convergence …", §15 "Search checks during
  development"
- **Work:** score-vs-budget curves (smaller against larger budgets on the same weeks),
  stability across seeds, how often optima sit on a parameter boundary, finalists that
  collapse on validation, a neighbor check around finalists, Jaccard similarity of signal
  masks (diversity only), surrogate rank correlation over time.
- **Done when:** the diagnostics run on the development weeks and a short findings note goes
  to Teammate 2 for the freeze (Nov 21).

## T3-3 Dashboard on real results

- **Owns:** trading-platform `frontend/features/momentum/results/`; **Coordinate** with
  Teammate 4 on the upload path (P3-1 `POST`, migration 0021 storage)
- **Depends on:** T3-1 JSON summary; T4-3 upload path
- **Work:** replace the mock with the uploaded E2 summary. Label every chart with the
  strategy, data version, cost model and forward period (guide "Document control").
- **Done when:** the results view renders the reserved-run summary and passes
  `npm --prefix frontend run lint`, `test` and `build`.

## T3-4 Quote replay for finalists (C6), only if the lead keeps it in scope

- **Owns:** research-python `trade/quote_replay.py`, tests
- **Depends on:** the account engine (built), tick data via `data/ticks.py`
- **Spec:** §5 "Starting order policy", "Finalists and forward policy paths receive targeted
  quote replay"
- **Work:** replay the live order policy on recorded quotes: quote no older than 2 s,
  uncrossed, spread ≤ 0.10%; buy limit = ask + 0.05% rounded to the tick; cancel after 2 s,
  keep partial fills; replay the **whole account path**; fetch only the needed event windows.
- **Done when:** one forward path has a bar-proxy vs quote-replay comparison (fill rate,
  slippage, PnL), with missing quote coverage reported.

## T3-5 Presentation package (E7)

- **Owns:** research-python `studies/momentum/rm9-weekly-calibration/presentation/`
- **Depends on:** T3-1, the reserved run; one traced trade and one weekend update from
  Teammates 2 and 4
- **Spec:** §16 "Practice explaining one trade, one weekend update, and one policy
  comparison", §15 "What a final evidence package contains"
- **Work:** charts (equity paths, paired difference with CI, cost sensitivity, runtime); one
  traced trade from bar to fill; one traced weekend update; a measured-limitations slide
  (interim universe if used, inferred grid rule, unverified broker behavior, paid vs free data);
  the evidence-package checklist.
- **Done when:** rehearsal is done by **Nov 27**.
