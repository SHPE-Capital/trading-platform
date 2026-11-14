# Bar arrival timing recorder (P2-7)

Measures, on the real Alpaca minute-bar stream, how long after a minute ends its
bar arrives, how often bars are late, missing or corrected. The result decides
whether the 1 s batch deadline in the momentum spec stays, and it feeds the
live-universe decision (see symbol limit below).

**Status: code and unit tests done; no live measurement has been taken.** The
recorder was written without network access or keys. The numbers and the
recommendation below are placeholders to fill from a real run.

## 1. Symbol limit check (do this first)

What this repo says: nothing about a per-stream symbol cap. It documents only
"one market-data stream per account"
([local development](local-development.md), [latency benchmark](latency-benchmark.md))
and the default IEX stream URL `wss://stream.data.alpaca.markets/v2/iex`
(`backend/.env.example`). `AlpacaMarketDataAdapter` subscribes to whatever list it
is given and logs the server's `subscription` ack and `error` frames, but nothing
checks the count.

What Alpaca's docs say (recalled from Alpaca's market-data streaming docs;
**not re-fetched or verified in this session**, no web access): the free
Basic plan streams IEX data only, with **at most 30 symbols** subscribed at a
time and **one concurrent connection**. Going over the symbol cap returns error
`405 symbol limit exceeded`; a second connection returns `406 connection limit
exceeded`. Paid plans (Algo Trader Plus) lift the symbol cap and use SIP.
Treat these as the working assumption until the probe confirms them on our keys.

How to confirm on our keys (the recorder does this as a side effect, since it
stores `subscription` acks and any `error` frame, and stops on the first error):

```sh
# 31 symbols: expect error 405 if the cap is 30. Then repeat with 30 and expect acks.
cd backend
npx ts-node src/runtime/verify/barArrival.ts --symbols-file symbols31.txt --duration-min 2 --confirm-stream-owner
```

`summary.json` then holds `errors` (code 405 means the cap, 406 means another
stream already uses the key) and `subscriptionAcks` (how many symbols the server
accepted for `bars` and `updatedBars`). Use a second terminal with a second
connection to see 406 if you want that confirmed too; it is optional.

### Universe options if the cap is real

A live universe of 500 to 1,000 symbols is impossible on free streaming data.
The options from the task packet, to report to the lead for 0-F:

1. **Top-K subset (about 30)** of the weekly universe by the C4 ranking; research
   is replayed on the same K for parity.
2. **REST polling** of minute bars once a minute for the full universe. The bars
   endpoint takes many symbols per call, but latest-15-minutes SIP data is not
   allowed on the free plan, so only IEX bars are available, and rate limits
   (`ALPACA_DATA_REQUESTS_PER_MINUTE`, default 190) and polling latency must be
   measured. This recorder does not measure REST.
3. **Paid data plan.**

Chosen option: **not decided**; pending the probe above. Recommendation if the
cap is confirmed: option 1 for the Nov 21 freeze, because it keeps paper and
replay comparable without extra spend (see the project's AWS/credit budget).

## 2. Running the recorder (needs your own keys)

Prerequisites:

- Your own `ALPACA_DATA_KEY` / `ALPACA_DATA_SECRET` in `backend/.env` or the
  shell (falls back to `ALPACA_API_KEY` / `ALPACA_API_SECRET`). Paper keys are
  fine; the recorder never calls the trading API.
- **Nothing else streaming on those keys** (free plan: one stream). Stop the
  local stack or start it with `LOCAL_STREAM_DATA=0`.
- A synchronized clock (Windows: `w32tm /resync`). Latency is
  `local receive time - bar minute end`, so clock error shifts every number.
  The report counts negative latencies (`negativeLatencyCount`) as a skew signal.

Run during US regular hours (09:30 to 16:00 New York), one run per session, for
at least two sessions:

```sh
cd backend
npx ts-node src/runtime/verify/barArrival.ts \
  --symbols-file symbols.txt --duration-min 395 --confirm-stream-owner \
  --out ../bar-arrival-runs/2026-11-16
```

Flags: `--symbols a,b,c` or `--symbols-file` (comma/newline separated), `--duration-min`
(default 390), `--late-ms` (default 1000, the deadline under test), `--out`,
`--url` (default `ALPACA_DATA_STREAM_URL`, else the IEX URL), and the required
`--confirm-stream-owner`. Ctrl+C stops early and still writes results.
Start before 09:30 and stop after 16:00; the symbol list is up to 30 on free data.

Outputs in `--out`: `summary.json` and `bars.csv` (`symbol, minute_start,
rx_epoch_ms, latency_after_minute_end_ms`). Keep `bar-arrival-runs/` out of git.

## 3. Reading the results

| Field | Meaning |
|---|---|
| `latencyMs` p50/p90/p95/p99/max | Arrival delay after the minute end, nearest-rank |
| `lateFraction` | Share of bars later than `--late-ms` |
| `missing` | Expected (symbol, minute) bars with no bar, within first to last observed minute |
| `corrections` | `updatedBars` messages, share of delivered bars corrected, correction lag |
| `errors`, `subscriptionAcks` | Server 4xx frames and what it accepted (symbol-cap evidence) |

Caveats:

- **IEX bars only exist for minutes with an IEX trade.** A "missing" bar in an
  illiquid symbol is usually no trade, not feed loss. Judge missing bars on liquid
  symbols (SPY, QQQ) or compare against a REST bars pull for the same minutes.
- The default window is first to last observed minute, which hides an outage at
  the edges of the session; the run duration covers it manually.
- The recorder does not reconnect. A dropped socket ends the run, which is
  itself a finding.

## 4. Results (fill in after live runs)

| Session | Symbols | Bars | p50 | p95 | p99 | max | > 1 s | Missing | Corrected |
|---|---|---|---|---|---|---|---|---|---|
| _pending_ | | | | | | | | | |

Recommendation on the 1 s batch deadline: **pending data.** If p99 stays under
1 s keep it; if a material share (over a few percent) arrives later, move the
deadline in replay and live together before evaluation is frozen.
