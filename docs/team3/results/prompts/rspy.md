# Goal: relativeToSpy filter (branch `team3/rspy`). Budget: 2 configs.
Research: `docs/team3/research/R2-regime.md` (the relativeToSpy part) and `docs/team3/components/relative-to-spy.md`. **The spec there is confirmed by the lead; don't change it.** Ledger: `docs/team3/results/ledger-rspy.md` (IDs RS-01…).

**Start from Alex Rivera's code** (PR #78, merged): `filters/relativeToSpy.ts` holds his 1-minute rule (move > 2 × |SPY move|). Turn it into the specced filter, and keep his credit in the file header and the component doc:
- β = 1; `resid = ret(stock) − ret(SPY)` over `lookbackBars` (30) of today's session bars ending at this bar; `total = ret(stock)` over the same bars.
- Enter only if `|resid| / |total| ≥ cutoff`, with a new knob `rtsMinOwnShare`. If SPY has no matching bars, block the entry, as Rivera's rule does.
- **SPY and QQQ are not traded while the switch is on** (knob `rtsExcludeSymbols`, default `["SPY","QQQ"]`). SPY is the benchmark only.
- Flip the registry status in `filters/index.ts` to `done` (that one line only).

| Row | Config | Mechanism check |
|---|---|---|
| RS-01 | `{"useRelativeToSpy":true,"rtsMinOwnShare":0.5}` | reversion share ↑; β of per-trade P&L to SPY's return over the holding window ↓ |
| RS-02 | `{"useRelativeToSpy":true,"rtsMinOwnShare":0.7}` | same |

**Exclusion-only reference.** To separate the filter's effect from the SPY/QQQ exclusion, also run `TEAM3_EXCLUDE=SPY,QQQ` on Core and `TEAM3_EXCLUDE=SPY` on Momentum, with no config change. That's the same config as R2's Q2.5 (runs are deterministic, so it's counted once); log it as an `RS-V` reference row. Bootstrap the RS rows against this reference too, with the two-id form: `team3Bootstrap.ts <refId> <rowId>`.

**Your files:**
- `filters/relativeToSpy.ts`
- its status line in `filters/index.ts`
- the RSPY config/manifest blocks
- `relativeToSpy.test.ts` (Rivera's tests stay; add yours)
- `runtime/team3Metrics/rspy.ts`
- `docs/team3/components/relative-to-spy.md`

You need a parity proof (switch off = A03/A04).

**Mechanism metric (`rspy.ts`):** the reversion share, and β from regressing per-trade gross bps on SPY's return (in bps) over the same holding window, using `barsBySymbol.get("SPY")`.

The new-signal version is **not** part of this session; it runs after the combining step.
