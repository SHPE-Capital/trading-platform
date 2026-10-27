# Is my strategy doing what I expect?

When a launched strategy isn't behaving, there are three places to look, in this order:

1. **The backend terminal** (the paper runner's log). It prints a plain-English line for each problem below.
2. **The run's page** (click the run under *All Runs*): the *Runner events* timeline and the *Signal funnel*.
3. **The run's status card**: the status badge, the algorithm version (`vN`), and any error streak.

For direct Node processes, set `LOG_LEVEL=debug` in `backend/.env` for extra
decision lines in strategies that provide them. Docker does not forward every
file setting: add an explicit service environment override for `LOG_LEVEL` and
recreate the affected service. See [environment forwarding](local-development.md#market-data-and-environment-forwarding).

## Symptom, cause, where to look

| Symptom | Likely cause | What you'll see |
|---|---|---|
| Type missing or launch disabled | Lifecycle/hidden metadata, runtime profile, or unsupported capability | Check server action reasons and [strategy policy](../architecture/strategy-policy.md) |
| Can't save a configuration | A value the strategy can't trade with | The form shows `Invalid configuration: <reason>` (HTTP 400). Nothing is saved |
| Save worked but **Start** fails | A version saved before checks existed, or by a strategy with no save-time check | `This version cannot run: <reason>` (HTTP 400). Save a corrected version and start that |
| Started, but **never trades** | The symbol gets no data (typo, not on your feed), the feed is down, or the market is closed | Terminal: `LiveRunCoordinator: run activated` lists the symbols and what the strategy decides on. After `DIAGNOSTICS_NO_DATA_SECONDS` (default 300) of silence while the market is open: warning `No bar data for XYZ since the run started…`, plus a **NO DATA** event on the run page |
| Data stopped part-way | Feed disconnected, a replay finished, or a quiet symbol | Warning `No new bar data for XYZ for N min…` and a **NO DATA** event; when data returns, **DATA RESUMED** |
| A signal appears but **no order** | A risk check blocked it | Terminal warning `<strategy>: buy 1 SPY was blocked by risk check <CHECK>: <reason>. It was NOT sent to the broker.` and a **BLOCKED** event (first time per check). The *Signal funnel* counts the blocked signals |
| Not enough capital | Allocation or other runs' reservations used it up | Warning `not enough unreserved capital … (needs $X, $Y available)` |
| Broker refused the order | Buying power, symbol not tradable, etc. | Warning `the broker rejected buy 1 SPY: <reason>` |
| Order never filled | Immediate-or-cancel order found no match | Info line `… expired without filling` |
| Strategy code throws | A bug in `evaluate()` | Status card: "N evaluation errors in a row"; an **ERROR** event; after `MAX_CONSECUTIVE_STRATEGY_ERRORS` (default 5) the run is disabled (**AUTO DISABLED**, with the last error) |
| Results don't match the code you just wrote | The backend wasn't restarted, or the run uses an older version | Check the `vN` badge and the version you started (the form shows *Running an older version…*); restart the backend |
| An old saved version behaves differently now | A run always uses the **current** algorithm, not the one the version was written for | The version list shows `algo vN` for each saved version; the form warns "saved for algorithm v1; the current algorithm is v2". Versions saved before this was recorded show no `algo` label |

## Repeated problems are summarised

A blocked strategy can be blocked on every bar. To keep the terminal readable, the first occurrence of each
kind is logged immediately and later ones inside a window are counted:

```
Strategy "My Reversal": more orders blocked by MAX_POSITION: 14 more in the last 60s (repeats are summarised, not logged one by one).
```

The run page's timeline records only the first occurrence per run and check, so it stays short.

## Settings

| Variable | Default | Meaning |
|---|---|---|
| `DIAGNOSTICS_NO_DATA_SECONDS` | `300` | Silence on a strategy's symbol (market open) before warning. Raise it for thinly traded symbols |
| `DIAGNOSTICS_LOG_WINDOW_SECONDS` | `60` | How long a repeated block is summarised rather than logged each time |
| `MAX_CONSECUTIVE_STRATEGY_ERRORS` | `5` | Evaluation errors in a row before a run is disabled |
| `LOG_LEVEL` | `info` | `debug` adds per-bar decision lines in strategies that provide them |

The data check uses the same session hours as the risk engine, so it stays quiet when the market is closed and
starts its clock again at the open. A keyless replay counts as always open.

## For strategy authors

Print *why* you didn't trade. The cheapest wins are:

- `logger.info` when a guard you wrote suppresses a trade you would otherwise have made (a position cap, a minimum
  move, a cooldown). Include the numbers.
- `logger.debug` for the routine "nothing to do" reasons, so they don't flood the terminal by default.

`backend/src/strategies/beginnerReversal/beginnerReversalStrategy.ts` shows both. Don't add shared logging helpers
under `strategies/base/`: changes there force a VERSION bump on every strategy.
