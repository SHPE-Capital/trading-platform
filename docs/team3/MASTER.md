# Team 3 Reversal: Master Doc

The living overview of the whole strategy: what's in it, what's left, and where
each piece is documented. **Update this file whenever a component is added,
changes status, or gets ablation results** (see [AGENT_GUIDE.md](AGENT_GUIDE.md)).

**Strategy VERSION:** 3  ·  **Branch:** `team3/reversal`  ·  **Last updated:** 2026-11-21
**Deadlines:** algorithm Nov 22 · paper Nov 25 · presentation Nov 28/30

## The baseline: VWAP reversion ([baseline.md](components/baseline.md))
On today's regular-session 1-minute bars, fade a move only when it leaves price
at least `entryZ` sigmas from VWAP and the way back beats costs (`minEdgeBps`).
Hold until price is back at VWAP (or stop / time limit). Flat by the close.
Fixed dollars per trade, capped per symbol and in gross (shorts included).
Every component below is an on/off switch on top of it.

Reference row: the platform's `beginner_reversal` (fade every bar) under the same protocol.

## The platform contract ([CONTRACT.md](../../backend/src/strategies/team3Reversal/CONTRACT.md))
What we assume from the platform and what we promise back, each row enforced by
`contract.test.ts` against the real backtest engine. Only `contract/` touches
platform code. Platform bugs we work around, for a later PR: [UPSTREAM.md](UPSTREAM.md).

## Research: "Shallow code, deep reasons" ([research/README.md](research/README.md))
Every rule is one line built from primitives we already have, and it earns its
place only by naming the market mechanism that makes it pay. There are six
mechanism categories (R1 liquidity, R2 regime, R3 costs, R4 exit geometry,
R5 portfolio, R6 evidence). The README holds the merged experiment queue
(at most 10 tuning configs), 7 mis-specifications to fix before tuning, and
ranked one-line feature proposals. No backtest has run yet.

## Components

Order is the order they run. Entry filters: the first one that says no blocks the trade.

| # | Component | Type | Status | Owner | Write-up | Ablation rows |
|---|---|---|---|---|---|---|
| 1 | VWAP Regime | entry filter | **done, tested** | Alejandro | [vwap-regime](components/vwap-regime.md) | |
| 2 | Volume | entry filter | stub (switch refused) | | [volume](components/volume.md) | |
| 3 | Relative to SPY | entry filter | stub (switch refused) | | [relative-to-spy](components/relative-to-spy.md) | |
| 4 | Vol Sizing | sizing | **done, tested** | Alejandro | [vol-sizing](components/vol-sizing.md) | |
| – | VWAP Stretch | — | dropped: is the baseline entry | | [vwap-stretch](components/vwap-stretch.md) | |
| – | Hold Until Back | — | dropped: is the baseline exit | | [hold-until-back](components/hold-until-back.md) | |
| – | Time of Day | — | dropped: is the baseline session window | | [time-of-day](components/time-of-day.md) | |
| – | Big Move | — | dropped: redundant with `entryZ` | | [big-move](components/big-move.md) | |

Status values: `planned` → `stub` → `done, tested` → `ablated` (has rows) → `kept` / `dropped`.
A `stub` filter's switch is refused by config validation. Flip its `status` to
`"done"` in `filters/index.ts` in the same change that writes the rule and its tests.

## Shared pieces (not switches)
- `contract/`: frame (read), book (own fills and positions), emit (signals), protocol (engine settings).
- `history.ts`: today's session bars and VWAP per symbol.
- `rules.ts`: session window, entry idea, exit reasons.
- `risk.ts`: $ per symbol and $ gross caps.
- `vwap.ts`, `session.ts`, `sizing.ts`.

## Universe
- **Core:** SPY, QQQ, AAPL, MSFT, GOOGL, AMZN
- **Momentum:** SPY, NVDA, AMD, MU, TSLA, META

## What's left
- [ ] Teammates: write Volume and Relative to SPY (rule, tests, write-up, then status `done`).
- [ ] Decide the research runner's location (on hold), then run the protocol and fill rows.
- [ ] Confirm in-sample / out-of-sample dates in [ablation.md](ablation.md).
- [ ] Run ablation order: `beginner_reversal` reference → baseline → each component alone → best combo → + vol sizing.
- [ ] Candidates: force an exit when the day turns trending (regime flips mid-trade); tune `entryZ`/`minEdgeBps` in-sample only.

## Results summary
_(One line per kept/dropped decision, pointing to ablation rows. Filled after testing.)_
