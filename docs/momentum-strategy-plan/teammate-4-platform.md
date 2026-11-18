# Teammate 4: Platform and paper trading

Back to [README.md](README.md). Repo: **trading-platform** (backend), plus one script in
research-python for the cross-check.

The platform port is built and passes golden parity (P1-1 to P1-6), and the execution
pieces exist (P2-2 to P2-6, P2-8, P3-1). What is missing is **evidence from real runs** and
the path that carries a research artifact into the paper strategy.

Checks: `npm --prefix backend run typecheck`, `npm --prefix backend run lint`,
`npm --prefix backend test -- --runInBand <path>`.

**Safety:** only the dedicated project paper account, backend-only secrets (§16). Never launch
the combined dev command (it includes real trading). Each run below is started on purpose,
with the lead's go-ahead, never incidentally.

---

## T4-1 Run the bar-arrival and symbol-limit check (P2-7)

- **Owns:** `docs/guides/bar-arrival-timing.md` (results sections),
  `backend/src/runtime/verify/barArrival.ts` (fixes only)
- **Depends on:** nothing; **needed before the Nov 21 freeze**
- **Spec:** §3 batching paragraph, §16
- **Work:** first verify the per-connection symbol cap and the data-stream limit on our keys
  (the free IEX websocket is believed to allow about 30 symbols and one stream). Then record
  minute bars for the weekly universe (or as many symbols as allowed) over at least two
  sessions: arrival latency after the minute end, the fraction later than 1 s, missing bars,
  corrections. Choose the live-universe option: top K of the weekly universe (research
  replays the same K), REST polling of the full universe, or a paid plan.
- **Done when:** the doc has percentiles, a keep-or-change call on the 1 s batch deadline,
  the measured symbol limit and the chosen option, and the lead and Teammate 2 have them.

## T4-2 Run the Alpaca order-behavior spike (P2-1)

- **Owns:** `docs/guides/alpaca-order-behavior.md` (replace every UNVERIFIED line),
  `backend/src/runtime/verify/alpacaOrderBehaviorSpike.ts` (fixes only)
- **Depends on:** nothing
- **Spec:** §5 "If that behavior cannot be implemented safely, deployment remains disabled"
- **Work:** in the paper account, during market hours: stop-market creation and `stop_price`
  replace; a market sell while shares are held by a resting stop and the safe cancel-then-sell
  sequence; resizing a stop after a partial entry; limit entry with a 2 s cancel (cancel/fill
  race, partials); bracket and OTO as alternatives; rejection codes. If behavior differs from
  what `quoteGatedEntry.ts` and `exitStateMachine.ts` assume, fix them with tests.
- **Done when:** the doc is a verified recipe, or an explicit "unsafe, deployment disabled"
  finding.

## T4-3 Research-to-platform artifact path

- **Owns:** a backend upload script (for example `backend/src/runtime/momentum/uploadArtifact.ts`)
  and its test; **Coordinate** with Teammate 3 on the E2 summary upload
- **Depends on:** P1-2 loader, P3-1 `POST` and migration 0021 (built)
- **Work:** take a weekly artifact JSON written by `shpe momentum calibrate` (0-A schema) and an
  E2 summary, validate them, and upload through the P3-1 endpoint with backend-only auth. The
  loader then activates the config only for its week; a missing, stale or invalid artifact
  keeps entries disabled. Document the weekly step (copy from HPG, upload) in
  `docs/guides/live-paper-trading.md`.
- **Done when:** a real artifact from a development calibration loads in a platform backtest
  and the dashboard shows it.

## T4-4 End-to-end paper demo

- **Owns:** a demo runbook section in `docs/guides/live-paper-trading.md`
- **Depends on:** T4-2, T4-3, the lead's choice of live policy
- **Spec:** §15, §16
- **Work:** one paper session: session guard passes pre-open checks, the live policy trades
  from an uploaded artifact, the other two policies run as signal-only shadows (P2-8), the
  daily halt and exits behave, and every order has a complete audit chain (P2-6) with corrected
  bars in their own table.
- **Done when:** the session record and audit export exist and one traced trade goes to
  Teammate 3 for the deck. Target Nov 26.

## T4-5 Platform cross-check of finalists (E8)

- **Owns:** `scripts/momentum/platform_crosscheck.py` in research-python (or a platform-side
  script), `studies/momentum/rm9-weekly-calibration/crosscheck/`
- **Depends on:** reserved-run finalists from Teammate 2; a small panel export
- **Why:** calibration runs in research-python (about 1,000 times faster); the platform
  engine is only an independent check, never used for search.
- **Work:** pick a few finalists and weeks (include an early close, a gap through a stop, a
  halt and a rejection day). Replay through the platform backtest with the same bars and
  artifact; compare signals, ordered entries, fills, exits and daily returns. Classify every
  difference as expected (documented fill-model difference), a bug, or unresolved.
- **Done when:** a per-week agreement table exists and every difference is explained.

## T4-6 Schedule the weekly calibration (after Nov 30 unless time allows)

- **Owns:** a short ADR and the job definition
- **Work:** a scheduled HPG job (or other host) runs the weekend calibration, then the T4-3
  upload, with alerting on failure and credentials kept off the repo. A failed or missing run
  leaves entries disabled.
