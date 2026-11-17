# Team 3 Agent Guide: how to add to the repo

Read this before adding anything to `backend/src/strategies/team3Reversal/`.
It applies to people and agents alike. Four rules:

1. **Every new component gets a component doc** (one short write-up per filter).
2. **Every test run gets an ablation row, using the standard protocol.**
3. **Every row reports the required reversal metrics.**
4. **Update [MASTER.md](MASTER.md)** when a component is added, changes status, or gets results.

The research paper is written from these files, so keep them short and exact.

---

## 1. Component docs

A component is anything that changes trading: an entry filter, an exit rule,
a sizing rule, or a shared helper (like `vwap.ts`).

- Write it as `docs/team3/components/<kebab-name>.md` when you work on the repo
  directly (agents, editor). Copy [`components/_TEMPLATE.md`](components/_TEMPLATE.md).
- Write a `.docx` with the same headings only if the team is reviewing offline.
  The `.md` stays the source of truth.
- Put the doc path in the code file's header comment (`Docs: docs/team3/components/...`).
- Keep it to about one screen. Use bullets, not paragraphs.

**Required sections, in this order:**

| Section | What goes in it |
|---|---|
| Main idea | One or two plain sentences. No jargon. |
| Objective | The one losing trade type it removes, or what it improves, and how we'll know (which metric should move). |
| How it works for us | Where it hooks in (entry / exit / sizing), switch and knobs with defaults, what happens with missing data. |
| Math | Formulas in small steps: one short reason, then the formula. Define every symbol. |
| Source | Paper or reference, plus one line on what we took from it and what we changed. |
| Tests | Test file path and what each case proves. |
| Ablation rows | IDs of the rows in [`ablation.md`](ablation.md) that test it (filled after testing). |

Worked examples: [vwap-regime](components/vwap-regime.md),
[vwap-stretch](components/vwap-stretch.md), [vol-sizing](components/vol-sizing.md).

**Code checklist (before the doc is "done"):**

- One switch (`useX`, default `false`), as few knobs as possible, added to
  `team3ReversalConfig.ts` (field, default, validation) and `manifest.ts` (form field).
- With the switch off, behavior is the baseline. The baseline-equality test must still pass.
- Bump `Team3ReversalStrategy.VERSION` (CI enforces it).
- Tests pass: `npx jest src/tests/strategy/team3Reversal` from `backend/`.

---

## 2. Ablation table

[`ablation.md`](ablation.md) is the single results table. It is the paper's
evidence, so a row only counts if it follows the protocol.

**Standard protocol (do not change per run; change it only here, then rerun every row):**

| Setting | Value |
|---|---|
| Data | 1-minute bars (`dataGranularity: "bar"`), regular session only |
| Symbol groups | **Core**: SPY, QQQ, AAPL, MSFT, GOOGL, AMZN. **Momentum**: SPY, NVDA, AMD, MU, TSLA, META (SPY included for benchmarks) |
| Windows | **In-sample (tune here)** and **Out-of-sample (report here)**, dates set in the header of `ablation.md` |
| Capital | `initialCapital: 100000` |
| Costs | `slippageBps: 5`, `commissionPerShare: 0.005` (never run with zero costs) |
| Fill model | Platform default (bar). Note it if you use `quote` |
| Sizing | Fixed 1 share unless the row tests sizing. Sizing rows use `maxPositionQty: 1000` |

**Before adding a row, check all of these (if one fails, don't add the row):**

- [ ] Used exactly the protocol above (group, window, capital, costs).
- [ ] Changed **one thing** versus the row it's compared with (`Compared to` column).
- [ ] Knobs were tuned on in-sample only. The out-of-sample row uses the same knobs, untouched.
- [ ] Strategy `VERSION` and full config recorded; result **saved** (staged results expire) and its `backtestId` recorded.
- [ ] Every required metric filled in (section 3). Unknown = rerun, not blank.
- [ ] The baseline row for the same group and window exists.

**How to add a row:** next ID (`A01`, `A02`, ...), then one line per run in the
table. Record the config as only the switches and knobs that differ from the
defaults, e.g. `useVwapRegime, minVwapCrossings=4`. Add one sentence in
**Notes**. Never edit or delete an old row: if it was wrong, add a corrected
row and mark the old one `superseded by Axx`.

**Suggested order:** baseline → each component alone → best combination →
combination + vol sizing. Run each on both groups.

---

## 3. Metrics for a reversal strategy

Fading 1-minute bars wins small and often and loses big on trend days, and
costs decide whether it makes money at all. These metrics show exactly that.

**Required in every row:**

| Metric | How | Why it matters for reversal |
|---|---|---|
| Net P&L ($) | After slippage and commissions | The bottom line |
| Trades | Round trips | Too few = not significant; too many = cost bleed |
| Avg net P&L / trade (bps) | Net P&L ÷ traded notional × 10,000 | Edge per trade. It must beat costs (~5+ bps) |
| Win rate (%) | Winning trades ÷ trades | Reversal should be high; low = fading trends |
| Payoff ratio | Avg win ÷ avg loss | Reversal often < 1. Shows how large losses are |
| Profit factor | Gross wins ÷ gross losses | > 1.2 is worth presenting |
| Sharpe (daily, annualized) | Mean ÷ std of daily P&L × √252 | Risk-adjusted. Vol sizing should raise it |
| Max drawdown ($ and %) | Peak-to-trough equity | The trend-day damage the filters target |

**Optional, add when the row is about that topic:**

- **Cost share** = costs ÷ gross P&L (for exit and holding changes).
- **Avg holding time (bars)** (for exit rules).
- **Worst day P&L** and **% of days profitable** (for regime filters).
- **P&L std across symbols** (for sizing: should shrink with vol sizing).
