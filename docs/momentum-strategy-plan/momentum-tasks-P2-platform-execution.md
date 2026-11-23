# Stream P2: Platform execution, risk and operations

Back to [MOMENTUM_TASKS.md](MOMENTUM_TASKS.md). Repo: **trading-platform**,
backend.

Owns how orders actually reach Alpaca paper and how the account is protected.
P2-1 and P2-7 should start **today**: they produce the evidence the guide lists
as unresolved (broker order-state handling, actual bar arrival behavior).

Existing code to build on: `backend/src/adapters/alpaca/orderExecution.ts`
(already sends `stop_price`), `adapters/alpaca/marketData.ts` (subscribes to
quotes, trades and bars), `core/execution/`, `core/oms/capitalReservation.ts`,
`core/risk/riskEngine.ts` (drawdown kill switch from session-start equity),
`core/live/liveRunCoordinator.ts`, `core/live/marketDataMonitor.ts`,
`core/ledger/brokerSync.ts`, `runtime/paper-trading.ts`.

**Safety:** use only the dedicated project paper account with backend-only
secrets (§16). Never launch the combined dev command (it includes real
trading). Broker experiments in P2-1 are done in that paper account only.

---

## P2-1 Alpaca order-behavior spike

- **Owns:** `docs/guides/alpaca-order-behavior.md`, a throwaway script under
  `backend/src/runtime/verify/` (**do not wire it into any runtime**)
- **Depends on:** nothing
- **Spec:** §5 "The adapter must verify how protective orders are created,
  resized after partial fills, replaced, and canceled. If that behavior cannot
  be implemented safely, deployment remains disabled", refs [2], [3]
- **Verify in paper and write down:**
  - stop-market sell creation; `PATCH`/replace of `stop_price` as the trail
    moves
  - what happens when a market sell is sent while shares are held by a
    resting stop (Alpaca's quantity-held-for-orders behavior); the safe
    cancel-then-sell sequence and its timing
  - resizing a stop after a partial entry fill
  - limit entry with a 2s cancel: race between cancel and fill, and partial
    fills
  - bracket/OTO order classes as an alternative
  - rejection codes
- **Done when:** a written order-flow recipe exists that P2-2 and P2-3
  implement, or an explicit "unsafe, deployment disabled" finding.

## P2-2 Quote-gated entry order

- **Owns:** `backend/src/core/execution/quoteGatedEntry.ts`, test
- **Depends on:** P2-1
- **Spec:** §5 "Starting order policy"
- **Work:** an entry is allowed only with a current bid and ask that are
  uncrossed, a quote no older than 2s, and a relative spread ≤ 0.10%. Buy limit
  = ask × 1.0005, rounded to the allowed tick. Cancel after 2s; keep any
  partial fill and cancel the rest. A stock with any filled quantity is marked
  entered for the day. Every threshold comes from the weekly artifact or
  config.
- **Done when:** unit tests cover a stale quote, a crossed quote, a wide
  spread, tick rounding (above and below $1), timeout cancel, and a partial
  fill.

## P2-3 Exit state machine and protective stops

- **Owns:** `backend/src/strategies/momentum/exitStateMachine.ts` (or
  `core/oms/protectiveStops.ts`, decide with the OMS owner), tests
- **Depends on:** P2-1; spec from C2
- **Spec:** §4 "A common trailing exit package", "Account protection" (one
  order state machine), §3 "Closing and overnight work"
- **Work:** one state machine per position that feeds every exit path:
  - broker stop-market at entry − 1.5 ATR (using ATR at entry), resized after
    partial fills
  - trailing replace after a completed close ≥ entry + 1 ATR (never lowered)
  - time exit at 60 minutes
  - session exit at close − 5 min (actual close on early-close days): cancel
    pending entries and exit everything
  - emergency exit from P2-4
  - **no duplicate sells**: cancel the stop and confirm before a market exit,
    following the P2-1 recipe
  - an unresolved exit (halt, rejection) is recorded as an exception and never
    assumed flat
- **Done when:** tests cover each exit reason, a partial fill resize, a halt,
  and a replay of the same event producing no second order.

## P2-4 Daily 1% halt with liquidation

- **Owns:** changes in `backend/src/core/risk/riskEngine.ts` (**Coordinate**:
  shared by all strategies) plus test, or a strategy-scoped guard in
  `backend/src/strategies/momentum/dailyHalt.ts`
- **Depends on:** P2-3
- **Spec:** §4 "Account protection"
- **Work:** a 1% fall from start-of-day equity, including unrealized PnL,
  stops new entries, cancels pending entries and **requests liquidation** of
  all positions through P2-3. The existing kill switch only blocks orders.
  Prefer strategy scope so other strategies are not affected; confirm with the
  platform lead.
- **Done when:** a test shows the trigger, the cancel, and the liquidation
  requests in order.

## P2-5 Session guard: pre-open reconciliation and health

- **Owns:** `backend/src/core/live/sessionGuard.ts`, test; **Coordinate** with
  `liveRunCoordinator.ts`
- **Depends on:** P1-2
- **Spec:** §3 "Before the regular session"
- **Work:** before the open, load the approved weekly config and universe;
  check the exchange calendar (including early closes); confirm the account is
  **the dedicated project paper account** (see `config/protectedAccounts.ts`);
  reconcile orders and positions with the broker (`core/ledger/brokerSync.ts`);
  check the data and order connections. Any failure means **no new entries**,
  logged with the reason. Restart mid-session reconciles before trading
  resumes.
- **Done when:** tests cover each failure mode blocking entries, plus a
  restart.

## P2-6 Audit trail and corrected bars

- **Owns:** `supabase/migrations/0020_momentum_audit.sql` (**Coordinate**:
  check the next free number), the recorder in
  `backend/src/core/live/momentumAuditRecorder.ts`, the `updatedBars`
  subscription in `adapters/alpaca/marketData.ts` (**Coordinate**)
- **Depends on:** nothing to design; integrates with P1-3 and P2-3
- **Spec:** §5 "Alpaca also emits corrected bars", App. B "Each order record
  connects the first-seen data event to the signal, risk decision, order
  request, acknowledgment, fill or cancellation, and resulting account state …
  Store subsequent bar corrections separately"
- **Work:** persist the first-seen bar with local and exchange timestamps,
  link it to the signal, risk decision, order, ack, fill or cancel, and the
  resulting account state. Subscribe to Alpaca `updatedBars` and store them in
  a **separate** table that never overwrites what the live engine saw. Make
  the records exportable to Parquet for research (C6, R5).
- **Done when:** one paper session produces a complete chain for every order,
  and corrected bars sit in their own table.

## P2-7 Bar arrival timing recorder

- **Owns:** `backend/src/runtime/verify/barArrival.ts` (standalone, read-only
  market data), `docs/guides/bar-arrival-timing.md`
- **Depends on:** nothing
- **Spec:** §3 batching paragraph ("If the feed makes this deadline
  impractical, development changes it consistently in replay and live
  operation before evaluation is frozen"), §16 week of Nov 7 "Record a small
  paper stream to inspect arrival timing"
- **Work:** subscribe to minute bars for about 300 symbols (or the 0-F N) over
  at least two sessions. Record the arrival latency distribution after the
  minute end, the fraction later than 1s, missing bars, and how often bars are
  corrected.
- **First, check the symbol limit (added 2026-11-13):** this repo does not
  document how many symbols a stream may subscribe to. Alpaca's free (IEX)
  websocket is believed to cap symbols at about 30 per connection, and the free
  plan allows one data stream per account (already known). **Verify both on our
  keys before anything else.** If the cap is real, a live universe of 500 to
  1,000 symbols is impossible on free data, and the options are: (1) the live
  universe is the top K (about 30) of the weekly universe by the C4 ranking,
  with research replayed on the same K to keep parity; (2) poll minute bars by
  REST once a minute for the full universe (the bars endpoint takes many symbols
  per call; measure latency and rate limits); (3) a paid data plan. Report the
  chosen option to the lead for 0-F, because it changes what the paper run can
  say about the research N.
- **Done when:** the doc gives percentiles and a recommendation to keep or
  change the 1s batch deadline, plus the measured symbol limit and the chosen
  live-universe option. The result goes to the lead **before the Nov 21
  freeze** because it can change the research replay.

## P2-8 Shadow policies alongside the live policy

- **Owns:** `backend/src/strategies/momentum/shadowRun.ts` (or the recorder
  config), tests
- **Depends on:** P1-3, P1-2; **Coordinate** with `core/live/signalRecorder.ts`
  and `core/live/liveRunCoordinator.ts` owners
- **Spec:** §9 "The three selected policies then each maintain their own forward
  account"
- **Why:** the orchestrator can register several strategy instances, and CPU is
  not the limit (the audit's 20-instance test cut synthetic throughput from about
  40k to 15k frames/s, while 500 stocks of minute bars is about 8 bars/s). The
  limit is **one paper account**: instances share cash and capital reservations,
  so three policies trading live would distort each other.
- **Work:** run **one** policy live (the lead picks it at 0-F). Run the other two
  policies' weekly configs as **signal-only shadow instances** that record their
  signals, ranked candidates and hypothetical sizes, but send no orders. Confirm
  first that the signal recorder keeps enough to reconstruct a forward account
  in research. Each instance has its own risk budget and its own weekly
  artifact. Do not give shadow instances capital reservation.
- **Done when:** one paper session records signals for all three policies with
  the live policy's orders unaffected (compare with a live-only run), and the
  records are exportable for the research forward accounts. If three separate
  Alpaca paper accounts are used instead, first verify the data-stream limit per
  account on our keys.
