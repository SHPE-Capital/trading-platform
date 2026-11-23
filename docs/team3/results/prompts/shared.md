# Stage 2 session: shared instructions (every goal)

Team 3 research. First read `docs/team3/MASTER.md` ("Testing rules", "Parallel Stage 2", "Mechanism checks"), `docs/team3/research/README.md`, the research file for your goal, and your goal file in this folder. Use them as your instructions.

## Where you work
- **Only inside your own worktree** (the absolute path you were given), on its branch `team3/<goal>`. Never touch another worktree, the main checkout, or `team3/research`.
- Commit on your branch as you go: one commit per feature, and one per batch of results. **Never push.** End commit messages with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Run backend commands from `backend/`: `npx tsc --noEmit -p tsconfig.spec.json`, `npx eslint <files>`, and `npx jest --runInBand src/tests/strategy/team3Reversal`.

## What you may change
- Your own files, listed in your goal file. Config fields go **only between your goal's markers** (`// ---- R1 (team3/r1) ----` … `// ---- end R1 ----`) in `team3ReversalConfig.ts` (fields, defaults, validation) and `manifest.ts` (params).
- New tests go in a **new test file** named after your feature. Don't append to shared test files.
- Your mechanism metric goes in `backend/src/runtime/team3Metrics/<goal>.ts`. It receives signals, round trips, bars per symbol, daily P&L and the config; see `trades.ts`.

## What you must not change
- `MASTER.md`, `ablation.md`, `AGENT_GUIDE.md`, `contract/protocol.ts`, `runtime/team3Backtest.ts`, `runtime/team3Bootstrap.ts`, `contract/bootstrap.ts`, `contract/daily.ts`, `team3Metrics/index.ts` or `trades.ts`, any other goal's files or blocks, or any shared default.
- **Don't change VERSION.** Write "VERSION bump needed" in your ledger instead.
- Never promote anything to the baseline.

## Protocol
- **Baseline = VERSION 4 behaviour, frozen:** A03 Core `1872fd42-331a-4a8c-a488-460231ac8552`, A04 Momentum `4b060cbe-2834-4996-8b6b-c223bef772ed`. The code is VERSION 6; with every switch off it matches A03/A04 exactly.
- **In-sample only.** Never run out-of-sample days (never set `TEAM3_WINDOW=out`).
- **New features go behind a new switch, default off.** Once your feature code is in, prove that with the switch off the results still match A03 and A04 exactly (two parity runs, logged as V rows).
- **Pre-register** each row (config, predicted mechanism direction, any definition it needs) in your ledger **before** running it.
- **Every row runs on Momentum AND Core**, with the same config. Run backtests **one at a time**, never in parallel. From `backend/`:
  `TEAM3_GROUP=momentum TEAM3_CONFIG='{"knob":1}' npx ts-node --transpile-only src/runtime/team3Backtest.ts`
  It prints one `TEAM3_ROW {...}` line, including `mechanism.<goal>` from your metric file.
- **Bootstrap each row against its own universe's baseline:** `npx ts-node --transpile-only src/runtime/team3Bootstrap.ts <rowBacktestId>`. It picks A04 for Momentum rows and A03 for Core rows.
- **Stay within your budget.** V and D rows don't count.

## Report for each row (in `docs/team3/results/ledger-<goal>.md`)
- net P&L, trades, bps/trade
- reversion share (target exits ÷ trades; baseline 15.5% Core / 17.6% Momentum)
- exit mix
- bootstrap share and CI, and the result for each half of the in-sample period
- the mechanism check value
- keep-rule pass/fail on all five conditions:
  1. net improves on Momentum;
  2. bootstrap share ≥ 0.8 (Momentum);
  3. the mechanism check moves as predicted;
  4. both halves agree (both > 0);
  5. Core doesn't contradict.

## When done
Fill the ledger's Recommendation and "VERSION bump needed", then commit. Reply with **one table** (rows × the fields above) and a short recommendation, then **stop**.
