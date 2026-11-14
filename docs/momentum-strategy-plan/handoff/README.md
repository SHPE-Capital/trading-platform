# Momentum handoff

Written 2026-11-13. Presentation deadline Nov 30 2026. Protocol freeze Nov 21.
Scope decision (0-F) Nov 17.

Source plan: [../MOMENTUM_TASKS.md](../MOMENTUM_TASKS.md) (board and dependency
map), the stream files `../momentum-tasks-*.md` (full task packets with owned
files and "done when"), and [../momentum-config-reference.md](../momentum-config-reference.md)
(every tunable, scope recommendation, architecture decisions). These handoff files
**do not replace the packets**. They say who does what, in what order, what to wait
for, and what to hand over.

## Who does what

| Person | Works in | Owns |
|---|---|---|
| **Person 1: platform and benchmark** | `trading-platform` (backend, frontend); the E1 harness in `research-python` | P1 strategy port, P2 execution, P3 dashboard, E1 benchmark, E6 compute intake, E8 platform cross-check |
| **Person 2: strategy and research** | `research-python` | Stream 0 contracts, A data, B signals, C account simulator, D calibration, E2–E5 and E7, later stream F |

Read your person file first, then the agent briefs for the slices you delegate.

| File | For |
|---|---|
| [person-1-platform-benchmark.md](person-1-platform-benchmark.md) | Person 1 |
| [person-2-strategy-research.md](person-2-strategy-research.md) | Person 2 |
| [agents/](agents/) | One brief per agent slice (copy into the agent prompt) |
| [HANDOFF_ALL.md](HANDOFF_ALL.md) | Everything in one file (generated from the files above) |

Agent briefs: `agents/p1-*` to `agents/p4-*` are Person 1's slices,
`agents/r0-*` to `agents/r5-*` are Person 2's.

## Rules both people and every agent follow

- **One task = one branch = one worktree**, named `<name>/MO-<ID>`. Two tasks never
  edit the same file; a packet's **Owns** list is exclusive. Files marked
  **Coordinate** need a heads-up to the other owner first.
- Other Claude sessions may share the same checkout. **No `git stash`; stage your own
  files by path; never `git add -A`.**
- research-python: `AGENTS.md` (`uv run pytest`, `uv run ruff check`, no data in the
  repo, ask before changing `contracts/` or adding a dependency). Adding `numba` (C5),
  `psutil` (E1) and the `calibration/` layer (0-C) need lead approval and an ADR.
- trading-platform: `AGENTS.md` (typecheck, lint, focused Jest tests). **Do not launch
  the paper or real trading runtimes, run migrations, pull data or call the broker
  incidentally.** Preserve synchronous in-order event dispatch and deterministic
  replay.
- Every number is a field in the protocol config (task 0-G), not a code constant.
- **Nothing reads the reserved final period before the freeze.** D8 enforces this in
  code; reviewers check it.
- Each module has an owner **and a reviewer from the other person**.
- Verify with the real commands and report what ran. Never claim a check passed
  without seeing the output.
- Every agent ends with: what changed (files), verification run and results,
  unresolved risks.

## Handoff contracts between the two people

| Contract | Written by | Read by | Needed by |
|---|---|---|---|
| **0-A** weekly config artifact schema and JSON Schema | Person 2 | Person 1 (P1-2, P3-1) | Nov 14 |
| **0-B** config grid and stable config ID | Person 2 | Person 1 (P1-2, P1-3) | Nov 14 |
| **0-C** account I/O types (`MarketPanel`, `SignalMask`, `AccountResult`) | Person 2 | Person 1 (E1) | Nov 14 |
| **0-D** golden parity fixture format | Person 2 | Person 1 approves (P1-6) | Nov 14 |
| **B6** golden fixtures | Person 2 | Person 1 (P1-6, E8) | about Nov 19 |
| **C4 + B5 + A6** working engine, masks, panel | Person 2 | Person 1 (real E1) | about Nov 16 |
| **E1 table** (time, RAM, disk per N and years) | Person 1 | Lead, for 0-F | Nov 17 |
| **P2-7** bar arrival timing and symbol limit | Person 1 | Person 2 and lead (can change the replay) | before Nov 21 |
| **D8 finalists** | Person 2 | Person 1 (E8) | after the run |

## Decisions the lead owns

Scope (0-F, due Nov 17): N (recommended 500, stretch 1,000), history 5 to 10 years,
search budget and seeds, finalists per seed, quote replay in or out, reserved-period
date, live universe option (from P2-7), whether this program shares the ORB team's
RM3/RM5/RM7 studies, compute host. Also approve: the `numba` and `psutil`
dependencies, the `calibration/` ADR, the live policy (one live, two shadow), and
whether to add a deployment and scheduling task (see the open item below).

## Open items nobody owns yet

- **Deployment and scheduling of the weekly calibration job** (container, schedule,
  alerting, credentials). Not in any packet. Recommended: add a short task and ADR.
- **E1 status note** in `../momentum-tasks-E-evaluation.md` is uncommitted (made by
  another session).
- **RM1 → RM9 rename.** The plan now uses `studies/momentum/rm9-weekly-calibration/`;
  the E1 harness branch wrote to `rm1-weekly-calibration/`. Move it before committing.
- Guide §13 and §14 (the spec behind E1) are not in either repo. Only the plan text
  is available.
