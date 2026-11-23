# Agent brief: benchmark and compute (E1, E6, E8)

Suggested agent: `general-purpose` or `feature-implementer`. Owner: Person 1. Repos: **research-python** (harness) and trading-platform (E8).
Full packets: [../../momentum-tasks-E-evaluation.md](../../momentum-tasks-E-evaluation.md) (E1, E6, E8) and [../../momentum-config-reference.md](../../momentum-config-reference.md).

Follow the shared rules in [../README.md](../README.md): one task, one branch, one worktree (`<name>/MO-<ID>`); exclusive Owns lists; stage your own files by path (no `git stash`, no `git add -A`); every tunable comes from the protocol config (0-G); never claim a check passed without seeing it run. End with: what changed (files), verification and results, unresolved risks.

## State
The E1 harness exists in research-python on branch `momentum-e1-bench` (uncommitted): `scripts/momentum/bench.py`, `tests/unit/test_momentum_bench.py`, and `psutil` as a dev dependency. Steps 1 and 2 ran on a stand-in replay. Steps 3 and 4 are blocked on C4, B5 and A6. Rename its results folder from `rm1-` to `rm9-weekly-calibration`. `psutil` needs lead sign-off.

## Tasks
1. **Commit the harness** (by path) after the rename and sign-off.
2. **E6 compute intake** (`docs/compute/momentum_resources.md`): this machine is a Ryzen 7 3700X (8 cores, 16 threads), 15.9 to 17 GB RAM with only about 2.4 to 3.4 GB free, and a 2 TB NVMe with about 80 to 86 GB free. Add AWS, university HPC and teammate laptops.
3. **E1 real numbers** once C4, B5 and A6 exist: swap in the real replay; add the scale matrix N in {300, 500, 1,000} by years in {2, 5, 10}; record 1, 8 and 16 thread timings, RAM per worker and total, panel and disk bytes, and pull time; project the full run with and without the D6 week-chunk cache; read settings from 0-G. Deliver the one-page table by **Nov 17**.
4. **E8 platform cross-check** (after P1-3, B6, D8): replay a few finalists and weeks through the platform backtest engine and classify every difference.

## Rules
Run benchmarks natively, not in Docker (the compose CPU cap skews results). Never present a stand-in number as a C4 number. Do not touch the reserved period.
