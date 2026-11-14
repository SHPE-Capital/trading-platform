# Agent brief: signal components (stream B)

Suggested agents: **three `feature-implementer` agents in parallel for B1, B2, B3**, then one for B4 to B6. Owner: Person 2. Repo: **research-python**.
Full packets: [../../momentum-tasks-B-signals.md](../../momentum-tasks-B-signals.md).

Follow the shared rules in [../README.md](../README.md): one task, one branch, one worktree (`<name>/MO-<ID>`); exclusive Owns lists; stage your own files by path (no `git stash`, no `git add -A`); every tunable comes from the protocol config (0-G); never claim a check passed without seeing it run. End with: what changed (files), verification and results, unresolved risks.

## Goal
The reference implementation of the five components (Appendix A). The platform ports it, so every indicator needs a vectorized batch form and an incremental per-bar form that agree to a documented tolerance.

## Tasks
- **B1** Wilder ATR14 and ADX/±DI. **B2** rolling-high breakout (current bar excluded) and EMA trend. **B3** clock-window relative volume (median of 20 prior sessions, at least 15 windows) and session VWAP band. Do not change the existing `relative_volume.py` or `vwap_distance.py`.
- **B4** warm-up and readiness (five times the longest recursive length, convergence report).
- **B5** `signal_mask(panel, config) -> SignalMask` with an indicator cache keyed per parameter setting. Needs 0-B and B1 to B4. Feeds C4.
- **B6** golden parity fixtures (2 to 3 small scenarios, including an early close, a missing minute and a warm-up boundary). Needs 0-D. **Person 1 needs them for P1-6 and E8.**

## Rules
Zero denominators, missing inputs or insufficient warm-up mean the signal is invalid, never true. Use completed regular-session bars only. Document tolerance rather than rounding prices.

## Verify
`uv run pytest`, `uv run ruff check`; batch versus incremental parity tests; a 1,000-config cache-hit test on a 30-stock by 20-session panel.
