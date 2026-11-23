# Agent brief: calibration (stream D)

Suggested agents: D1, D2, D4 in parallel now (synthetic series); D3, D5, D6 after 0-B and 0-C; D7 and D8 integrate. Owner: Person 2. Repo: **research-python**, package `calibration/`.
Full packets: [../../momentum-tasks-D-calibration.md](../../momentum-tasks-D-calibration.md).

Follow the shared rules in [../README.md](../README.md): one task, one branch, one worktree (`<name>/MO-<ID>`); exclusive Owns lists; stage your own files by path (no `git stash`, no `git add -A`); every tunable comes from the protocol config (0-G); never claim a check passed without seeing it run. End with: what changed (files), verification and results, unresolved risks.

## Tasks
- **D1** score J (coefficient from config). **D2** weights: Uniform, Recency, Similarity, 20% uniform mix, ESS target about 60% solved without looking at returns; scaling fitted on search history only. **D4** surrogate: five scikit-learn `HistGradientBoostingRegressor`s, mean and disagreement.
- **D3** group-aware evolutionary search: budget, seeds, population, proposals, evaluations per round and their split, and finalists per seed all come from config; deterministic per seed; full audit trail.
- **D5** acceptance rules and finalist selection (floors from config; also report every finalist at 20 bps).
- **D6** evaluation cache **per config and per week chunk**; weight changes reuse paths; selection at a cutoff never reads a chunk at or after the cutoff.
- **D7** weekend calibrator (needs D1 to D6, C4, B5, A5, 0-A), **D8** walk-forward driver with forward accounts, resume-after-kill and the hard `reserved_start` guard.

## Rules
Never read the reserved period before the frozen protocol hash. A crashed job is an operational failure, resumed from checkpoint, never filled with an invented result.

## Verify
`uv run pytest`, `uv run ruff check`; planted-optimum test for D3; ESS and fallback tests for D2; resume-after-kill for D8.
