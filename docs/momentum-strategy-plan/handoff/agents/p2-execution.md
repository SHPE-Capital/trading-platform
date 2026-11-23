# Agent brief: platform execution (P2)

Suggested agent: `feature-implementer`; run `reliability-auditor` before any paper run. Owner: Person 1. Repo: **trading-platform**, backend.
Full packets: [../../momentum-tasks-P2-platform-execution.md](../../momentum-tasks-P2-platform-execution.md).

Follow the shared rules in [../README.md](../README.md): one task, one branch, one worktree (`<name>/MO-<ID>`); exclusive Owns lists; stage your own files by path (no `git stash`, no `git add -A`); every tunable comes from the protocol config (0-G); never claim a check passed without seeing it run. End with: what changed (files), verification and results, unresolved risks.

## Goal
Make orders, exits, the daily halt and the session guard behave correctly against Alpaca paper, with an audit trail, and measure real feed timing.

## Tasks, in order
1. **P2-7 bar arrival recorder.** First verify the free-plan websocket **symbol cap** (believed about 30) and one-stream-per-account on our keys. Report the chosen live-universe option (top-K subset, REST polling, or paid plan). Read-only market data only.
2. **P2-1 order-behavior spike** (partial fills on IOC, paper fill timing about 1 s).
3. **P2-2 quote-gated entry order**, **P2-3 exit state machine and protective stops**, **P2-4 daily 1% halt with liquidation**, **P2-5 session guard** (pre-open reconciliation and health), **P2-6 audit trail and corrected bars**.
4. **P2-8 shadow policies:** one policy live, two signal-only. No capital reservation for shadow instances. Check what `core/live/signalRecorder.ts` records.

## Known platform facts
Free plan: one data stream per account; IEX quotes go quiet (STALE_QUOTE rejects); SIP history is allowed except the latest 15 minutes; paper fills about 1 s after submit and multi-share IOC orders partially fill.

## Do not
Launch the combined dev command, run migrations, or send orders beyond bounded paper probes with your own keys. Coordinate on `core/oms/` and `core/engine/orchestrator.ts`.

## Verify
Typecheck, lint, focused Jest. Document any live probe results with timestamps.
