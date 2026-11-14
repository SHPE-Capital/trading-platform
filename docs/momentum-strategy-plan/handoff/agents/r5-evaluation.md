# Agent brief: evaluation, protocol and presentation (E2 to E5, E7)

Suggested agent: `general-purpose`; `pr-review-toolkit` reviewers for leakage tests. Owner: Person 2. Repo: **research-python** plus docs. (E1, E6 and E8 are Person 1's.)
Full packets: [../../momentum-tasks-E-evaluation.md](../../momentum-tasks-E-evaluation.md).

Follow the shared rules in [../README.md](../README.md): one task, one branch, one worktree (`<name>/MO-<ID>`); exclusive Owns lists; stage your own files by path (no `git stash`, no `git add -A`); every tunable comes from the protocol config (0-G); never claim a check passed without seeing it run. End with: what changed (files), verification and results, unresolved risks.

## Tasks
- **E5** (start now): `studies/momentum/rm9-weekly-calibration/` with README, protocol, assumptions register (each setting with value, why, evidence, what would change it) and notes; add the **RM9** row to `docs/teams/momentum.md`. The frozen protocol is the resolved 0-G YAML with a content hash. **Freeze Nov 21.**
- **E4** leakage and reproducibility tests: write as skipped tests now; assert earlier signals, universe and artifacts do not change when a later bar is tampered with; identical config and seed give identical artifacts; selection never reads cache chunks after the cutoff.
- **E2** policy comparison report on synthetic series first: paired block bootstrap of Similarity minus Recency (5-session blocks, 10 and 20 as sensitivity, resamples from config), same blocks for both policies; emit the JSON summary for P3-3.
- **E3** search diagnostics (score versus budget, seed stability, boundary optima, neighbor check, surrogate rank correlation).
- **E7** presentation package (rehearsal by Nov 27).

## Rules
Do not touch the reserved period before the freeze. Report results honestly, including no difference or no-deployment weeks.
