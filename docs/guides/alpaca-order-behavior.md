# Alpaca order behavior (P2-1 spike)

Status: **DRAFT, nothing here has been observed yet.** The spike script was
written but no order was placed and Alpaca was not called. Every claim about
Alpaca is from existing adapter code or from Alpaca's documentation as
remembered when this was written, and is marked **UNVERIFIED** until a paper run
fills the results template below. Do not implement P2-2/P2-3 against an
UNVERIFIED line without first running the spike.

Spec: momentum plan §5 ("verify how protective orders are created, resized after
partial fills, replaced, and canceled; if that cannot be implemented safely,
deployment remains disabled"). Packet: `momentum-tasks-P2-platform-execution.md`
P2-1.

## 1. How to run the spike

Script: `backend/src/runtime/verify/alpacaOrderBehaviorSpike.ts` (throwaway; not
in any runtime or package script). It places real **paper** orders.

Prerequisites: dedicated project paper account, keys in the backend environment
(`ALPACA_API_KEY`, `ALPACA_API_SECRET`, `ALPACA_TRADING_MODE=paper`), US market
open, no existing position in the probe symbol, an otherwise idle account (the
script runs `DELETE /v2/orders` to cancel everything between scenarios).

```
cd backend
# dry plan, no orders
npx ts-node src/runtime/verify/alpacaOrderBehaviorSpike.ts
# real paper run, one scenario at a time is recommended the first time
npx ts-node src/runtime/verify/alpacaOrderBehaviorSpike.ts --confirm-paper --symbol SPY --qty 10 --scenarios stop-replace
npx ts-node src/runtime/verify/alpacaOrderBehaviorSpike.ts --confirm-paper --symbol SPY --qty 10 --scenarios all --out p2-1-run1.json
```

Guards: refuses unless `--confirm-paper`, trading mode is paper and the base URL
is a paper host, the market is open (override `--allow-closed`), and the symbol
is flat. It logs every HTTP call and every `trade_updates` event with
millisecond offsets to a JSON file, and flattens the symbol on exit. Do not run
it alongside the paper runtime (shared account, one trade stream per account is
not assumed). Do not commit the output JSON; summarize it in section 4.

Scenarios map to the packet bullets:

| Scenario | Packet item |
|---|---|
| `stop-replace` | stop-market sell creation; PATCH of `stop_price` as the trail moves |
| `held-sell` | market sell while a resting stop holds the shares |
| `cancel-then-sell` | safe cancel-then-sell sequence and timing |
| `partial-resize` | stop resize after a partial entry fill |
| `limit-cancel-race` | limit entry with a 2s cancel: race and partial fills |
| `bracket-oto` | bracket/OTO as an alternative |
| `rejections` | rejection codes |

## 2. What the existing adapter already does

From `backend/src/adapters/alpaca/orderExecution.ts` (code facts, not Alpaca facts):

- `submitOrder` POSTs `/v2/orders` with `client_order_id`, `symbol`, `qty`, `side`,
  `type`, `time_in_force`, plus `limit_price` / `stop_price` when set. No
  `order_class`, no `stop_loss`/`take_profit`, no `extended_hours`.
- `cancelOrder` DELETEs `/v2/orders/{id}`, treats 204 as success, and returns
  after the HTTP response. It does **not** wait for the `canceled` event.
- **There is no replace (PATCH) method.** P2-3's trailing stop needs one.
- There is **no way to read the broker's held quantity** (`qty_available`) or a
  single order by broker id; only `orders:by_client_order_id` in reconciliation.
- Stream events handled: `fill`, `partial_fill` (qty from the per-event `qty`,
  cumulative from `order.filled_qty`), `canceled`, `expired`, `rejected`.
  Everything else, including `replaced`, `pending_cancel`, `pending_replace`,
  `new`, `accepted`, `done_for_day`, is dropped to a debug log. A replace would
  therefore be invisible on the bus today.
- Order identity is the intent id parsed from `client_order_id`
  (`parseClientOrderId`). A replace that mints a new broker order must keep
  that mapping, see Q2.
- Reconnect does not replay missed events; `reconcileOrders` reads orders back
  by client id. Only `partial_fill`/`fill`, `canceled`, `expired`, `rejected` are
  reconstructed.

## 3. Behavior checklist and current knowledge

Each row: what to observe, what Alpaca is believed to do, and the status.
"Evidence" is filled from the run log (section 4).

### Stops: creation and replace

| ID | Question | Believed behavior | Status |
|---|---|---|---|
| S1 | Stop-market sell creation: fields, time in force | `type=stop`, `stop_price`, `qty`; `day` or `gtc` accepted; extended-hours not supported for stops; status goes `accepted` then `new`. | UNVERIFIED |
| S2 | Does the stop trigger on last trade or quote, and how does paper simulate it | Live: triggers on SIP/consolidated trade prints; becomes a market order. Paper: simulated from the feed. Expect fill price gap vs `stop_price`. | UNVERIFIED |
| S3 | `PATCH /v2/orders/{id}` with `stop_price` | Allowed fields: `qty`, `limit_price`, `stop_price`, `trail`, `time_in_force`, `client_order_id`. Returns the new order, whose **id differs** from the old one; old goes `replaced` with `replaced_by` set. | UNVERIFIED |
| S4 | Does the replaced order keep or change `client_order_id` | Believed: new order keeps original unless you pass a new one in the PATCH; PATCH with a new `client_order_id` is needed if reusing the same value is rejected. | UNVERIFIED |
| S5 | Stream events during a replace | `pending_replace` then `replaced` for the old order; `new`/`accepted` for the replacement. | UNVERIFIED |
| S6 | Replace latency (PATCH response vs stream confirmation) | Unknown; measure p50/max over the three raises. | UNVERIFIED |
| S7 | Does Alpaca refuse lowering a stop | Believed: no, any stop_price on the correct side is allowed. The no-lowering rule must live in our code. | UNVERIFIED |
| S8 | PATCH of an order already filled/canceled/in `pending_*` | Believed 422 with a message; possible race with a trigger. | UNVERIFIED |
| S9 | Two protective stops for the same shares | Believed: second is rejected because the first holds the quantity (see H1). | UNVERIFIED |

### Held quantity

| ID | Question | Believed behavior | Status |
|---|---|---|---|
| H1 | Market sell for held shares while a stop rests | Believed: rejected HTTP 403, message "insufficient qty available for order (requested: N, available: 0)", code `40310000`, because the resting stop's quantity is held. Position shows `qty_available` < `qty`. | UNVERIFIED |
| H2 | Partial sell of fewer shares than held by the stop | Same rejection when `available` < requested; `available` is `qty` minus the sum of open sell orders. | UNVERIFIED |
| H3 | `DELETE /v2/positions/{symbol}` while a stop rests | Believed: also fails or cancels the open orders first; behavior differs between close-position and the orders API. | UNVERIFIED |
| H4 | Safe cancel-then-sell: is held qty released by the DELETE response, or only after `canceled` | Believed: DELETE returns 204 immediately but the order can sit in `pending_cancel`; a sell issued in that window can still be rejected for qty. Wait for the `canceled` event (or poll status) before the market sell. | UNVERIFIED |
| H5 | Timing of H4 | Unknown; measure DELETE-to-`canceled` latency over 3 trials. | UNVERIFIED |
| H6 | Stop fills while we are cancelling it (exit race) | Believed: cancel can fail with 422 "order is not cancelable" because it already filled; we must treat that as "position is flat" after confirming via position read, never send the market sell. | UNVERIFIED |

### Partial fills and resize

| ID | Question | Believed behavior | Status |
|---|---|---|---|
| R1 | Do multi-share marketable IOC limits fill partially on paper | Project notes (handoff brief) say yes, paper fills about 1 s after submit and multi-share IOC partially fills. | UNVERIFIED (not re-observed by this spike) |
| R2 | Stop sized to filled qty, then PATCH `qty` down/up | Down to a smaller qty believed OK; qty above the position believed rejected (insufficient qty). | UNVERIFIED |
| R3 | Can the stop be created before the entry finishes | Believed: no for a sell stop exceeding the **filled** position (the shares do not exist yet), so the stop must be placed/resized from `partial_fill`/`fill` events, or use OTO (B1). | UNVERIFIED |
| R4 | Partial fill of a resting limit entry | Not forceable by the script. Observe when `limit-cancel-race` happens to hit one, or in a fast market. Required: whether `partial_fill` arrives, then `canceled` with `filled_qty` < `qty`. | UNVERIFIED |

### Limit entry with cancel after 2s

| ID | Question | Believed behavior | Status |
|---|---|---|---|
| L1 | Cancel vs fill race | Cancel may return 204 and the order still end `filled`/`partially_filled` (fill printed before the cancel is processed), or return 422 when already filled. The final truth is the order status/`filled_qty`, not the DELETE response. | UNVERIFIED |
| L2 | Stream order of events in the race | `fill` can arrive after we sent DELETE; `canceled` arrives with `filled_qty` possibly > 0 after a `partial_fill`. | UNVERIFIED |
| L3 | Does the adapter's `cancelOrder` throwing on 422 break the P2-2 flow | Adapter throws `Alpaca cancel order failed (422)`; P2-2 must catch it and re-read the order. | UNVERIFIED |

### Bracket / OTO

| ID | Question | Believed behavior | Status |
|---|---|---|---|
| B1 | OTO (`order_class=oto`, `stop_loss`) on a market buy | Stop leg is created as a child, activated on fill, sized to the filled qty including partials. Leg visible with `nested=true`. | UNVERIFIED |
| B2 | PATCH the OTO/bracket stop leg | Believed allowed for `stop_price`; leg ids returned in `legs`. | UNVERIFIED |
| B3 | Market sell while the legs rest | Believed to hit the same held-qty rejection as H1. | UNVERIFIED |
| B4 | Does a bracket need a take-profit leg, and is it incompatible with the momentum exit design | Bracket requires both legs; OTO allows a stop only. Momentum exits (trail, 60 min time exit) need our own replace and sells either way. | UNVERIFIED |
| B5 | Do OTO/bracket parents support `ioc`/limit entries | Believed: bracket requires `day`/`gtc`; unclear for `ioc`. | UNVERIFIED |

### Rejections

| ID | Probe | Believed result | Status |
|---|---|---|---|
| X1 | Insufficient buying power | 403, code `40310000`, "insufficient buying power". | UNVERIFIED |
| X2 | Insufficient qty for sell | 403, code `40310000`, "insufficient qty available for order". | UNVERIFIED |
| X3 | Bad price tick (sub-penny above $1) | 422, code `42210000`, "invalid limit_price ... sub-penny increment". | UNVERIFIED |
| X4 | Unknown symbol | 404, code `40410000`, "asset ... not found". | UNVERIFIED |
| X5 | Duplicate `client_order_id` | 422, "client_order_id must be unique". Matters for replayed events (no second order). | UNVERIFIED |
| X6 | Invalid qty (0, fractional with stop) | 422. | UNVERIFIED |
| X7 | Invalid TIF combos (market+ioc, stop+ioc, stop+extended_hours) | 422 with a message. Market+ioc may be valid. | UNVERIFIED |
| X8 | Cancel/PATCH an unknown or terminal order | 404 / 422. | UNVERIFIED |
| X9 | Asset halted or not tradable | `rejected`/422 at submit or later `rejected` event; not probed here (needs a halt). | UNVERIFIED |
| X10 | Rate limit | 429; the adapter has no retry on POST (by design, orders are not idempotent without `client_order_id`). | UNVERIFIED |

## 4. Results template

Copy per run. Record the date, symbol, session phase, and JSON log filename
(kept locally, not committed).

```
Run: <YYYY-MM-DD HH:MM ET>   symbol: <S>   qty: <n>   log: <file>   account: paper

ID   Observed (HTTP status/code/message, event sequence, latency ms)   Matches belief? (Y/N)
S1
S3   new order id differs? ____  old status ____  replaced_by ____
S5   events seen in order: ____
S6   PATCH response ms ____ ; stream confirm ms ____
S7   lower stop accepted? ____
H1   status ____ code ____ message ____ ; position.qty_available ____
H4   DELETE->canceled ms: t1 ____ t2 ____ t3 ____ ; immediate sell result ____
H6   (note any observed stop-fill vs cancel race)
R1   IOC filled ____ of ____
R2   PATCH qty down ____ ; above position ____
L1   trial 1..N: cancelHttp ____ finalStatus ____ filled ____
B1   legs ____ ; sized to ____
B2   PATCH leg ____
X1..X10   status/code/message each
```

## 5. Draft order-flow recipe (conditional on the results)

This is the design P2-2/P2-3 should implement **if** the believed behavior is
confirmed. Replace each step's UNVERIFIED tag with the evidence, or rewrite the
step if the run differs.

1. **Entry (P2-2).** Marketable-limit buy, `day`, `client_order_id` from the
   intent. After the configured cancel delay, send DELETE. Whatever happens,
   the order's final status and `filled_qty` (from the stream, falling back to
   `orders:by_client_order_id`) decide what the position is. A 422 on cancel
   means "already terminal": re-read, do not retry. (L1, L3) UNVERIFIED
2. **Protective stop (P2-3).** Place the stop only for **filled** quantity,
   from `partial_fill`/`fill` events. On each additional partial fill, PATCH
   the stop `qty` to the new cumulative filled qty (or cancel and recreate if
   PATCH of `qty` is not accepted). The entry's remaining quantity is cancelled
   before the position is considered final. (R2, R3) UNVERIFIED
3. **Trail.** PATCH `stop_price` upward only; our code enforces never lowering.
   Treat the PATCH response id as the new broker order id and keep the same
   intent id mapping. Wait for the replacement's `new`/`accepted` event before
   the next PATCH. If a PATCH fails with "not replaceable", re-read the
   order: if filled, the position is flat. (S3-S8) UNVERIFIED
4. **Market exit with a resting stop (no duplicate sells).** (a) DELETE the
   stop. (b) Wait for the `canceled` stream event for the stop, with a polling
   fallback and a timeout. (c) If the cancel result is "already filled", stop:
   read the position and do not sell. (d) Otherwise send the market sell for the
   current position qty from the broker, not from our ledger. (e) If the sell
   is rejected for qty, re-read the position and open orders and retry once;
   otherwise record an exception and never assume flat. (H1-H6) UNVERIFIED
5. **Alternative: OTO.** Only worth it if B1 shows the stop leg sizes to partial
   fills and B2 shows its stop_price can be moved. It does not remove the need
   for step 4 at the time and session exits. (B1-B5) UNVERIFIED
6. **Rejections.** Map codes from X1-X10 to: retryable (429, 5xx, held-qty race),
   terminal (tick, buying power, unknown symbol) and exception (halt). The
   adapter should surface the Alpaca `code` and message, not only the string
   "failed (status)". UNVERIFIED

**Safety finding to decide after the run:** if H4/H6 show that a stop can fill
between our cancel and our market sell *and* the position read cannot resolve
it, or if a stop cannot be resized after a partial fill, write "unsafe,
deployment disabled" here, per the spec.

## 6. Adapter gaps this spike implies (for P2-2/P2-3 owners, not implemented here)

- Add `replaceOrder(brokerOrderId, { stopPrice?, qty?, limitPrice?, clientOrderId? })`
  returning the new broker order id.
- Handle `replaced`, `pending_cancel`, `pending_replace` trade events; today they
  are dropped.
- Read a position's `qty_available` and open orders by symbol.
- Let `cancelOrder` return a typed result (cancelled / already terminal) instead
  of throwing on 422.
- Surface Alpaca error `code` and `message` on submit failures.
