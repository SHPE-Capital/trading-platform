# Stream C: Funded account simulator

Back to [MOMENTUM_TASKS.md](MOMENTUM_TASKS.md). Repo: **research-python**.

**This is the critical path.** Every search evaluation, every validation, every
forward week and every benchmark runs through C4. Give it to the strongest
systems person and give them a dedicated reviewer.

C1, C2 and C3 are separable pure functions that can go to different people.
C4 assembles them.

Existing code to build on: T1 (`trade/exits.py` `StopState`, `trade/simulate.py`,
after 0-E merges it), T2 `trade/sizing.py`, T5 `trade/costs.py`, T4
`trade/risk.py`.

---

## C1 Screening fill proxy and cost scenarios

- **Owns:** `src/shpe_research/trade/fill_proxy.py`, tests
- **Depends on:** 0-C
- **Spec:** §5 "Historical execution in two levels"
- **Work:** the entry limit is the signal close × 1.0020; it fills at the **next
  bar's open** only if open ≤ limit, otherwise it is canceled. A missing next
  bar means no fill. Apply a per-side cost of 5, 10 or 20 bps (10 is used for
  selection) as an account deduction. Exits use the same per-side cost.
- **Done when:** unit tests cover fill, cancel above the limit, missing next
  bar, and all three cost scenarios. The proxy is selectable alongside T1's
  platform `FillModel` without changing it.

## C2 Common trailing exit package

- **Owns:** `src/shpe_research/trade/exit_package.py`, tests (reuse
  `trade/exits.py` from T1 where it fits; **Coordinate** before editing it)
- **Depends on:** 0-E (T1 merged)
- **Spec:** §4 "A common trailing exit package", §5 "For protective stops
  already active …", §3 "Closing"
- **Work:**
  - Use the ATR14 value **at entry**, fixed for the life of the trade.
  - Initial stop is 1.5 ATR below the filled entry.
  - Trailing starts once a completed close is at least 1 ATR above entry: the
    stop becomes the highest completed close since entry − 1.5 ATR, and it
    never moves down.
  - A new stop level applies only from the **next** bar.
  - A gap through the stop fills at the (lower) open plus adverse cost;
    otherwise the stop fills when the bar's low crosses it.
  - Max hold is 60 minutes after the first fill.
  - Session exit: at close − 5 min, cancel pending entries and exit
    everything. Early closes use their actual close.
  - When the order of events inside a bar is unclear, take the less favorable
    feasible outcome and **flag** it.
- **Done when:** there are hand-worked tests for each exit reason, a gap, the
  trailing activation, and an early close.

## C3 Sizing and capacity

- **Owns:** `src/shpe_research/trade/funded_sizing.py`, tests
- **Depends on:** 0-C
- **Spec:** §4 "One finite account for every comparison"
- **Work:** quantity = floor(min of):
  - 8% of current equity ÷ planned entry price
  - 0.25% of equity ÷ the initial stop distance (1.5 ATR)
  - remaining cash after reservations ÷ price
  - remaining room under the 80% total-exposure cap ÷ price
  - liquidity cap: 1% of the median share volume in the **same minute** across
    the preceding 20 sessions (at least 15 valid observations, otherwise zero)

  Zero means no order (logged as a rejection with its reason). There is no
  borrowing. Equity = cash + marked position value.
- **Done when:** the guide's worked example (160 shares) passes, plus a test
  where each cap binds in turn.

## C4 Chronological multi-stock account engine

- **Owns:** `src/shpe_research/trade/account.py` (implements the 0-C stub), tests
- **Depends on:** 0-C; C1, C2, C3 (stub them until merged)
- **Spec:** §3 "Each completed minute" steps 1–5, §4 "Account protection", §9
  "Account simulation is the primary result"
- **Per minute, in this order:**
  1. Update state from the completed bar.
  2. Process exits (C2) and fills.
  3. Find candidate signals (from the `SignalMask`) for stocks not yet entered
     today.
  4. Rank by descending 20-session median daily dollar volume, with the stable
     asset ID as tie-break.
  5. Allocate within at most 10 concurrent positions; reserve cash for pending
     orders.
  6. Submit through the fill proxy (C1).
- **Rules:** at most one filled entry per stock per session (a partial fill
  counts as entered). Daily halt: a 1% fall from start-of-day equity, including
  unrealized PnL, stops new entries, cancels pending ones and liquidates. No
  trade crosses a stage boundary. Weekly config changes happen while flat.
- **Outputs:** daily net returns for **every** session (zero-trade days
  included), the ledger, the rejection log with reasons, flags, and summary
  metrics (trades, active sessions, max drawdown, concentration by stock and
  date).
- **Configurable:** every cap and threshold comes from `AccountConfig` (built from
  the 0-G config), including max positions, percentages, liquidity cap, halt and
  starting equity. Ranking is a named function (default dollar volume with the
  asset ID tie-break), and there is an optional entry-score threshold and
  size-multiplier input, both off by default ([stream F](momentum-tasks-F-later-ideas.md)).
  Search and validation replays use a fixed reference equity per session so a
  session's return does not depend on other sessions (needed for the D6 week-chunk
  cache); forward accounts carry real equity.
- **Done when:** the §15 portfolio test list passes (see C7), the engine
  is deterministic: same inputs give byte-identical output, and the default
  hooks produce the same output as the guide's rules.

## C5 Performance pass (Numba)

- **Owns:** `src/shpe_research/trade/account_fast.py`, tests, `numba` in
  `pyproject.toml` (**needs lead approval**)
- **Depends on:** C4 correct and profiled; A6 panel
- **Spec:** §12 "Practical tool choices", §13 "The expensive part is repeated
  account evaluation"
- **Work:** profile C4 on a representative late-history window first. Port the
  hot loop to Numba (or vectorize). Decide float32 vs float64 based on parity.
  Keep the pure-Python C4 as the oracle.
- **Timing (added 2026-11-13):** start a thin Numba kernel alongside C4 rather
  than after it. A synthetic proxy on this machine ran a 63-session candidate at
  N = 1,000 in 0.114 s on one thread but scaled only 2.5× on 16 threads (memory
  bound), so the layout matters: float32, contiguous (stock-major or minute-major
  chosen by profile), no per-candidate allocations. Keep pure-Python C4 as the
  oracle.
- **Done when:** results match C4 exactly (or within a stated tolerance) on
  random configs, and the speedup is reported per candidate replay at N = 300,
  500 and 1,000. E1 feeds this number into the projection.

## C6 Quote replay for finalists and forward paths

- **Owns:** `src/shpe_research/trade/quote_replay.py`, tests
- **Depends on:** C4; tick data from `data/ticks.py`; 0-F decides whether this
  is in scope
- **Spec:** §5 "Starting order policy", "Finalists and forward policy paths
  receive targeted quote replay"
- **Work:** replay the live order policy on recorded quotes:
  - require a quote no older than 2s, uncrossed, with spread ≤ 0.10%
  - buy limit = ask + 0.05%, rounded to the tick
  - cancel after 2s; keep partial fills
  - replay the **whole account path**, because changed fills change later
    capacity
  - fetch only the event windows needed (entries, rejected entries, holding
    periods)
- **Done when:** for one forward policy path, there is a report of bar-proxy vs
  quote-replay differences (fill rate, slippage, PnL), and missing quote
  coverage is reported as such.

## C7 Correctness suite for the account engine

- **Owns:** `tests/unit/trade/test_account_scenarios.py`
- **Depends on:** C4 interface (write tests first, then implement)
- **Spec:** §15 "Correctness before large runs", §14 "First, verify one stock
  and a handful of sessions against hand-worked signals and trades"
- **Scenarios:** one stock over a few sessions, hand-worked; simultaneous
  signals competing for cash; cash reserved by a pending order; integer sizing;
  partial fill; rejected order; entry cancellation; stop replacement; daily-loss
  shutdown; early close; a gap through a stop; a halt preventing exit (the
  position stays open and is flagged, never filled at the desired price);
  replaying the same event twice places no second order.
- **Done when:** all scenarios are written. This is a good task for a second
  person to do **in parallel** with C4 (test-first).
