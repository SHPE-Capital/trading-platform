# Team 3 Reversal: Master Doc

The living overview of the whole strategy: what's in it, what's left, and where
each piece is documented. **Update this file whenever a component is added,
changes status, or gets ablation results** (see [AGENT_GUIDE.md](AGENT_GUIDE.md)).

**Strategy VERSION:** 2  ·  **Branch:** `team3/reversal`  ·  **Last updated:** 2026-11-17
**Deadlines:** algorithm Nov 22 · paper Nov 25 · presentation Nov 28/30

## The baseline
On every regular-session 1-minute bar, fade the move: sell after an up bar,
buy after a down bar. Every component below is an on/off switch on top of it.
With all switches off, the strategy trades exactly like Beginner Reversal.

## Components

Order is the order they run. Entry filters: the first one that says no blocks the trade.

| # | Component | Type | Status | Owner | Write-up | Ablation rows |
|---|---|---|---|---|---|---|
| 1 | Time of Day | entry filter | stub | | [time-of-day](components/time-of-day.md) | |
| 2 | VWAP Regime | entry filter | **done, tested** | Alejandro | [vwap-regime](components/vwap-regime.md) | |
| 3 | VWAP Stretch | entry filter | **done, tested** | Alejandro | [vwap-stretch](components/vwap-stretch.md) | |
| 4 | Big Move | entry filter | stub, **may be repurposed** | | [big-move](components/big-move.md) | |
| 5 | Volume | entry filter | stub | | [volume](components/volume.md) | |
| 6 | Relative to SPY | entry filter | stub | | [relative-to-spy](components/relative-to-spy.md) | |
| 7 | Vol Sizing | sizing | **done, tested** | Alejandro | [vol-sizing](components/vol-sizing.md) | |
| 8 | Hold Until Back | exit rule | stub | | [hold-until-back](components/hold-until-back.md) | |

Status values: `planned` → `stub` → `done, tested` → `ablated` (has rows) → `kept` / `dropped`.

## Shared pieces (not switches)
- `vwap.ts`: session VWAP, sigma, z and crossing count per symbol, reset daily. Used by VWAP Regime and VWAP Stretch.
- `session.ts`: New York clock helpers (regular session, minutes since open, trading day).
- `sizing.ts`: the vol sizing formula.

## Universe
- **Core:** SPY, QQQ, AAPL, MSFT, GOOGL, AMZN
- **Momentum:** SPY, NVDA, AMD, MU, TSLA, META

## What's left
- [ ] Decide Big Move: keep as an entry filter, fold into Vol Sizing, or drop (VWAP Stretch already covers "big moves only").
- [ ] Teammates fill in their stubs (rule, tests, write-up).
- [ ] Confirm in-sample / out-of-sample dates in [ablation.md](ablation.md).
- [ ] Run ablation order: baseline → each component alone → best combo → + exit → + vol sizing.
- [ ] Candidates: Hold Until Back exits at VWAP; force-exit when the day turns trending.

## Results summary
_(One line per kept/dropped decision, pointing to ablation rows. Filled after testing.)_
