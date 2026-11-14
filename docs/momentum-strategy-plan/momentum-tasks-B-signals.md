# Stream B: Signal components (Python reference implementation)

Back to [MOMENTUM_TASKS.md](MOMENTUM_TASKS.md). Repo: **research-python**.

This stream implements the five public components exactly as written in
Appendix A. **This code is the reference**: the platform (P1) ports it and must
reproduce it. Each indicator needs **two forms**:

1. a vectorized batch form (whole arrays; used by the search and simulator),
2. an incremental per-bar update (one bar in, state updated once; used for
   parity and live logic).

Both forms must agree to a documented tolerance on the same input.

B1, B2 and B3 are independent: **give them to three different people.**

Common rules (App. A): use completed regular-session minute bars only. Zero
denominators, missing inputs or insufficient warm-up make the signal invalid
(never `True`). Compare with a documented floating-point tolerance, not by
rounding prices. Recursive indicators carry across sessions; session VWAP
resets each session.

Suggested location: `src/shpe_research/features/momentum/` for indicator math
(one module per task below) and `src/shpe_research/strategies/momentum/breakout/`
for the grid and signals. The architect may move these; record any move in
ADR 0013.

---

## B1 ATR14 and ADX / ±DI (Wilder)

- **Owns:** `features/momentum/wilder.py`, `tests/unit/features/momentum/test_wilder.py`
- **Depends on:** nothing
- **Spec:** App. A "ATR14", "ADX direction and strength"; §2
- **Work:** Wilder ATR over 14 bars; Wilder-smoothed +DM, −DM and TR; +DI, −DI,
  DX, ADX for a ∈ {7, 14, 21}. Document the initialization and match a
  reference calculation (for example a hand-worked spreadsheet or a trusted
  library on a fixed series). ADX component signal: `ADX > q and +DI > −DI` for
  q ∈ {15, 20, 25, 30}.
- **Done when:** batch and incremental forms agree; hand-worked values match on
  a 30-bar example; the ATR from T1's `trade/exits.py` is either reused or
  replaced, with no duplicate implementations left.

## B2 Rolling-high breakout and EMA trend

- **Owns:** `features/momentum/breakout.py`, `features/momentum/ema_trend.py`, tests
- **Depends on:** B1 for ATR (use a stub ATR array to start)
- **Spec:** App. A "Breakout", "EMA trend"
- **Work:**
  - Breakout: `C > max(H over the preceding n bars) + b × ATR14`. **The
    current bar is excluded** from the preceding high. n ∈ {10, 20, 40, 60},
    b ∈ {0, 0.10, 0.25}.
  - EMA trend: `(EMAfast − EMAslow) / ATR14 > d` and EMAslow greater than its
    value 5 completed bars earlier. fast ∈ {5, 8, 12}, slow ∈ {20, 35, 60},
    d ∈ {0, 0.10, 0.25}. Smoothing factor is 2 / (length + 1).
- **Done when:** there is a test that the current bar never enters its own
  threshold, and EMA values match a hand calculation.

## B3 Clock-window relative volume and session VWAP band

- **Owns:** `features/momentum/clock_rvol.py`, `features/momentum/vwap_band.py`, tests
- **Depends on:** B1 for ATR (stub to start)
- **Spec:** App. A "Relative volume", "VWAP position"; §3 (VWAP resets daily)
- **Work:**
  - Relative volume: the sum of volume over the latest w **current-session**
    bars, divided by the **median** of the same clock-time window over the
    preceding 20 sessions, must be ≥ v. Require at least 15 usable historical
    windows. w ∈ {3, 5, 10}, v ∈ {1, 1.5, 2}. The opening window never carries
    over from the previous session. This differs from the existing
    `features/volume/relative_volume.py` (cumulative-from-open, mean); do not
    change that file.
  - VWAP band: session VWAP = cumsum(((H + L + C) / 3) × V) / cumsum(V), reset
    each session; require `0 ≤ (C − VWAP) / ATR14 ≤ e` for e ∈ {1, 2, 3}. This
    differs from the existing `vwap_distance.py`, which uses the bar `vwap`
    field.
- **Done when:** tests cover early-close days, an opening-window boundary,
  fewer than 15 historical windows giving invalid, and the VWAP reset.

## B4 Warm-up and readiness rules

- **Owns:** `features/momentum/readiness.py`, tests
- **Depends on:** B1–B3 interfaces
- **Spec:** App. A "Warm up with at least five times the longest recursive
  length and verify convergence", §3 "Indicators become eligible when their
  required inputs are ready"
- **Work:** compute, for each component setting, the first bar where it is
  valid. Run a convergence check (a short warm-up vs a long reference warm-up
  stays within tolerance) and extend the warm-up if it fails.
- **Done when:** a readiness mask per component setting exists, and there is a
  convergence report for the longest settings (EMA 60, ADX 21).
- **Status of B1 to B4 (2026-11-13):** batch forms are done on research-python
  `momentum-e1-real` (`features/momentum/*`, 27 tests plus 18 Numba parity tests). The
  **incremental per-bar forms are deferred** (needed for P1 parity and B6). The author did not
  have Appendix A, so these are **assumptions for Person 2 to confirm**: Wilder and EMA are
  seeded with the mean of the first n valid inputs (ATR14 first valid at bar 14, ADX(a) at
  2a-1); a non-finite input resets the recursion; true range, breakout window and EMA carry
  across sessions while VWAP and RVOL reset; RVOL needs w contiguous same-session bars. Numba
  kernels (`_kernels.py`) are the default; `SHPE_MOMENTUM_NUMBA=0` selects the NumPy reference
  path. Measured (300 stocks, 25 sessions): cold build of one config 20.8 s to 1.65 s.

## B5 Signal masks for a configuration, plus the indicator cache

- **Owns:** `strategies/momentum/breakout/signals.py`,
  `strategies/momentum/breakout/indicator_cache.py`, tests
- **Depends on:** 0-B (grid), B1–B4
- **Spec:** §2 "All selected conditions must be true for the same stock and
  completed minute", §12 "Cache … indicator arrays for each distinct parameter
  setting, binary signal masks"
- **Work:** `signal_mask(panel, config) -> SignalMask` (0-C type) = breakout AND
  the selected confirmations AND readiness. Compute each distinct
  indicator/parameter array **once** per panel and reuse it across all configs
  that share it. Retain the numeric indicator values so logs can carry them
  (§2 "What can change and when").
- **Done when:** evaluating 1,000 random configs on a 30-stock × 20-session
  panel reuses cached arrays (shown by cache-hit counters), and the masks match
  a slow reference.
- **Status (2026-11-13):** done (`indicator_cache.py`, `signals.py`). 1,000 random configs match
  the slow reference (the test takes about 6 minutes); warm mask 4 ms per config at N = 300
  over 63 sessions. Known gaps: the reference reuses the readiness masks instead of
  re-deriving them per config, and `readiness_masks` recomputes the RVOL ratio that the cache
  already holds (about 1.2 s of the cold build). Pass the cached ratio in (small follow-up for
  the B5 owner).

## B6 Golden parity fixture generator

- **Owns:** `scripts/momentum/make_golden.py`, `tests/fixtures/momentum_golden/` (generated files)
- **Depends on:** 0-D, B5; C3 and C4 for the sized-order section (that section
  can be added later)
- **Spec:** §12, §15
- **Work:** produce 2–3 small scenarios (a few symbols, a few sessions,
  including an early close, a missing minute and a warm-up boundary) in the 0-D
  format: input events, the config, expected indicator values per bar,
  expected signals, and, once C4 exists, expected ranked and sized orders for a
  scripted account state.
- **Done when:** the files are generated deterministically, checked in, and
  consumed by P1-6.

## B7 Persisted indicator cache (added 2026-11-13)

- **Owns:** `strategies/momentum/breakout/indicator_store.py`, tests
- **Depends on:** B5, A6
- **Why:** the indicator build is the cost floor and it is rebuilt for every week chunk in
  every run and every worker. Persisting it makes it a once-per-chunk cost and, memory-mapped,
  cuts RAM per worker (4.6 GB at N = 1,000, one thread).
- **Work:** save each distinct indicator array and signal array per week chunk as `.npy` next
  to the panel chunk. Key: data version, universe schedule version, indicator and parameter
  setting, warm-up length, code version. Open memory-mapped read-only. Fall back to compute
  and write. Parallelize cold builds across chunks with processes.
- **Done when:** a second run of the same chunk computes nothing, two processes share one
  mapped copy (RSS check), and a changed key component forces a rebuild.
