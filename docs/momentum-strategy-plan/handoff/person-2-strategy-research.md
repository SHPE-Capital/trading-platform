# Person 2: strategy and research (research-python)

Back to [README.md](README.md). You work in `research-python`. Branch names
`<name>/MO-<ID>`. Read its `AGENTS.md` first.

**This is the larger load.** It contains the critical path (C4). Stream C is never
merged with anything else. Use agents for the separable pieces (listed below), and
see "If time runs short" for what to cut.

## Your tasks, in waves

### Wave 0 (Nov 13 to 14): contracts everyone else waits on

| Task | What | Agent brief |
|---|---|---|
| **0-C** account I/O contract, `calibration/` layer, ADR 0013 | Unblocks C4, A6, D6, D7 and Person 1's E1. Needs lead approval for the ADR | [r0-contracts](agents/r0-contracts.md) |
| **0-A** weekly config artifact schema (pydantic plus JSON Schema) | Person 1 needs it for P1-2 and P3-1 | r0-contracts |
| **0-B** config grid and stable config ID (69,732 configs by default, domain loaded from config) | Person 1 needs it for P1-2 | r0-contracts |
| **0-G** protocol config (`MomentumProtocol`) | Every number comes from here | r0-contracts |
| **0-D** golden parity fixture format | Person 1 approves it | r0-contracts |
| **0-E** merge the T1 trade simulator branch `juancavallin/T1` | Unblocks C2. Check which of T1 and T4 really exist (`docs/tasks.md` on main says Open) | you (git work, do it carefully) |
| **0-F** scope proposal (draft) | The lead decides Nov 17 | you plus Person 1's E1 table |

### Wave 1 (Nov 14 to 17): run in parallel

| Slice | Tasks | Notes | Agent brief |
|---|---|---|---|
| **Signals** | B1, B2, B3 (independent), then B4, B5, B6 | Batch and incremental forms must agree. B6 golden files unblock Person 1's P1-6 and E8 | [r2-signals](agents/r2-signals.md) |
| **Account (critical path)** | C1, C2, C3 (separable), then **C4**; C7 tests written first | C4 must land about **Nov 16** for a real E1 | [r3-account](agents/r3-account.md) |
| **Data** | A1 (pilot pull first), A2, A3, then A4, A5, A6, A7 | Fix the manifest scaling before the big pull. A6 is needed for E1 | [r1-data](agents/r1-data.md) |
| **Calibration** | D1, D2, D4 on synthetic series now; D3, D5, D6 against fakes once 0-B and 0-C land | D6 caches per config and per week chunk | [r4-calibration](agents/r4-calibration.md) |
| **Evaluation** | E5 study folder and assumption register, E4 as skipped tests, E2 and E3 on synthetic series | E6 and E1 are Person 1's | [r5-evaluation](agents/r5-evaluation.md) |

### Wave 2 (Nov 17 to 21)

- **C5** Numba pass (needs `numba` ADR and lead approval), start a thin kernel beside C4.
- **D7** weekend calibrator, **D8** walk-forward driver (needs D1 to D6, C4, B5, A5, 0-A).
- **E4** leakage and reproducibility tests un-skipped.
- **E5** frozen protocol and hash, **Nov 21 freeze**.

### After the freeze

Reserved-period run with checkpoints, then **E2** report and bootstrap, **E3**
diagnostics, **E7** presentation. **C6** quote replay if in scope. Stream F (learned
ranking, entry model, sizing) is **not** part of Nov 30.

## What you wait for

| From | What | Needed for |
|---|---|---|
| Lead | 0-C ADR approval; `numba` approval; 0-F decision (Nov 17) | C4, C5, A1 sizing, D8 length |
| Person 1 | 0-D approval | B6, P1-6 |
| Person 1 | E1 table | 0-F |
| Person 1 | P2-7 arrival timing, symbol limit | can change the replay semantics before the freeze |

## What you hand to Person 1

0-A, 0-B, 0-C, 0-D early (Nov 14); B6 golden fixtures (about Nov 19); a working
C4 + B5 + A6 (about Nov 16) so E1 can swap its stand-in; D8 finalists for E8.

## Design points to keep

- Search and validation replays start every session from a **fixed reference equity**,
  so a session's return does not depend on other sessions (lets D6 cache per week
  chunk). Forward accounts carry real equity. The lead should confirm this against
  guide §12.
- C4 and D3 expose the seams stream F needs (ranker function, optional entry-score
  threshold, size-multiplier input, candidate features in the ledger), all off by default.
- Keep pure-Python C4 as the oracle for C5.
- Selection at a cutoff must never read a cache chunk at or after the cutoff (E4 test).

## If time runs short (cut in this order)

1. C6 quote replay.
2. Number of seeds, then search budget.
3. History length, then N (the plan's own fallback). Keep the 300-stock, 2-year stage
   working before reaching for 500 and 1,000.
4. Never cut: C4 correctness (C7), the leakage tests, the protocol hash and the
   reserved-period guard.

## Using agents

Separable slices that can run at once in separate worktrees: B1, B2, B3; C1, C2, C3;
A1 and A2 and A3; D1, D2 and D4. Never two agents on the same file; the contracts
(0-A to 0-G) should be one agent. Review rule: Person 1 reviews your platform-facing
contracts; an independent reviewer (`pr-review-toolkit:review-pr`) checks C4 and the
leakage tests.
