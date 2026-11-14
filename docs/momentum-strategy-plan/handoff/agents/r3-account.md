# Agent brief: funded account simulator (stream C, critical path)

Suggested agents: three `feature-implementer` agents for C1, C2, C3 (pure functions), **the strongest agent or Person 2 on C4**, and a second agent writing C7 first. Owner: Person 2. Repo: **research-python**. Never merge stream C with other work.
Full packets: [../../momentum-tasks-C-account.md](../../momentum-tasks-C-account.md).

Follow the shared rules in [../README.md](../README.md): one task, one branch, one worktree (`<name>/MO-<ID>`); exclusive Owns lists; stage your own files by path (no `git stash`, no `git add -A`); every tunable comes from the protocol config (0-G); never claim a check passed without seeing it run. End with: what changed (files), verification and results, unresolved risks.

## Tasks
1. **C1** screening fill proxy and cost scenarios (5, 10, 20 bps). **C2** common trailing exit package (needs T1 merged; **Coordinate** before editing `trade/exits.py`). **C3** sizing and capacity (the 160-share worked example must pass, plus a test where each cap binds).
2. **C7** correctness scenarios, written **before** C4 (test-first).
3. **C4** `trade/account.py`: chronological multi-stock engine. Ranking is a named function (default dollar volume with asset-ID tie-break); optional entry-score and size-multiplier hooks are off by default; search replays use a fixed reference equity. Deterministic, byte-identical output. **Target: working by about Nov 16** so Person 1's E1 can use it.
4. **C5** Numba pass (needs lead approval and an ADR). Start a thin kernel beside C4; keep pure Python as the oracle; match exactly or within a stated tolerance; profile at N = 300, 500, 1,000. Mind the memory-bound thread scaling.
5. **C6** quote replay for finalists, if 0-F keeps it in scope.

## Verify
`uv run pytest`, `uv run ruff check`; the C7 suite; a determinism test; Numba parity on random configs.
