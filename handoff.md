# Engineering Handoff — SHPE Capital Trading Platform

**Date:** 2026-10-03
**Branch:** `JC` (one commit ahead of `main`: `8116797`)
**Scope:** Everything covered in the engineering conversation that produced this document — strategy mechanics, a production process-isolation bug and its fix, the shared-book architecture redesign, nine schema migrations, a GitHub-PR-style review workflow, an explicit-backtest-save feature, and an AWS deployment plan with partial Docker scaffolding.

This document is a snapshot, not a changelog — it describes what's true as of the date above. Treat anything it says about "current state" as something to re-verify (`git status`, `git log`, re-read the referenced files) before acting on it, since work continued on this repo outside the conversation this document summarizes.

---

## 1. How the strategies work

### 1.1 Pairs trading (`backend/src/strategies/pairs/`)

**The idea.** Two instruments sharing an economic driver should hold a stable linear relationship. Trade the residual, not either price.

**Spread:** `S_t = P1_t − β·P2_t`. **Z-score:** `z_t = (S_t − mean(S)) / std(S)`, computed over a rolling window (`rollingWindowMs`).

**Decision rule** (defaults: `entryZScore=2`, `exitZScore=0.5`, `stopLossZScore=4`):

| condition | action |
|---|---|
| z ≤ −2 | enter long spread: buy leg1, sell leg2 |
| z ≥ +2 | enter short spread: sell leg1, buy leg2 |
| \|z\| ≤ 0.5 | exit (reverted) |
| \|z\| ≥ 4 | stop-loss exit |
| position age ≥ `maxHoldingTimeMs` | forced exit |

Exits are checked before entries every tick (a `??` chain in `evaluate()`), so an exit always wins over a simultaneous entry signal.

**Hedge ratio.** `"fixed"` (the shipped default) just uses a static ratio. `"rolling_ols"` runs a full **Engle-Granger two-step cointegration test** every `olsRecalcIntervalBars` bars:
1. OLS of leg1 on leg2 (`services/indicators/ols.ts`) — β minimizes `Var(P1 − βP2)`, i.e. the most stationary residual available.
2. Dickey-Fuller test on the residuals (`services/indicators/cointegration.ts`) — more negative τ means stronger mean-reversion evidence. Compared against MacKinnon (1991) critical values (−3.90 / −3.34 / −3.05 at 1%/5%/10%).

β is only updated while the pair is cointegrated; entry is blocked (not exit) while it's failing the test.

**v4 fix — cointegration hysteresis.** The original (v3) gate compared τ to the bare critical value every recalculation. In production, a real pair's τ settled almost exactly on the threshold and jittered by thousandths per recalc, producing dozens of alternating "lost/regained cointegration" log lines within milliseconds and stuttering the hedge ratio (β only updates while "cointegrated," so flapping state means flapping β). Fixed with `applyCointHysteresis()` — a 0.15 deadband: entering cointegration requires clearing the threshold by the full band; leaving requires missing it by the full band. A regression test replays the actual logged τ sequence from the incident: the old logic flips 6+ times on it, the new logic flips zero, and still reacts correctly to a genuine regime change (a real τ swing of several tenths). `PairsStrategy.VERSION` bumped 3→4 so cached backtest results from the old logic are never silently reused.

**Known gaps, not yet fixed** (flagged during a deep read, not acted on):
- The traded spread (`P1 − βP2`) omits the OLS intercept α, while the cointegration test's residuals include it — the two aren't measuring quite the same series.
- `spreadWindow` isn't rebuilt when β changes mid-position — old entries in the window were computed with a stale β.
- Exit quantity is recomputed from the *current* price rather than remembered from entry, so a position that moved materially between entry and exit exits at a slightly wrong size.
- The Dickey-Fuller test is unaugmented (no lag terms) — fine for a genuinely mean-reverting pair, worth knowing before trusting a τ near the critical value.

### 1.2 Avellaneda-Stoikov market making (`backend/src/strategies/marketMaking/`)

**The idea** (Avellaneda & Stoikov, 2008): a market maker posts both sides, centered not on the market mid but on its own inventory-adjusted "reservation price," so the quotes themselves lean toward flattening inventory.

**Reservation price:** `r = s − (q − q_target)·γ·σ²·(T−t)`. Long inventory pushes r below mid — the ask tightens, the bid backs off.

**Optimal half-spread:** `δ = ½·[γ·σ²·(T−t) + (2/γ)·ln(1 + γ/κ)]`. First term is inventory-risk compensation, decaying to zero at the horizon. Second term is the order-flow/intensity component and does *not* decay — it's why a real market maker doesn't quote a zero spread in the last minute of a session.

Guardrails layered on top: inventory caps (suppress one side past a threshold), kill-switches (suppress both sides on vol spike or inventory breach), min/max half-spread clamps, tick-size snapping.

**A real, unfixed bug found during review: σ is in the wrong units.** The model assumes σ in *price* units; the code feeds it σ from *log returns* (dimensionless, ~0.001 for a realistic per-bar return). At the balanced preset's defaults, the inventory term works out to roughly 7 orders of magnitude smaller than the flow term — the spread is effectively a constant set by γ and κ alone, and the inventory skew for 100 shares comes out to about $0.00005, erased entirely by a 1-cent tick. The elegant part of the model — quotes that actually lean against inventory — is inert. The fix is one line (`σ_price = σ_return × mid`) but it's a signal-logic change needing its own version bump and re-tuned γ/κ; **not done**. Worth noting: the AS strategy has no `VERSION` field at all today, unlike `PairsStrategy` — so this class of bug has no version-based cache-invalidation protection if someone does fix it.

Other known-but-unfixed gaps: two of the three presets' computed half-spreads are pinned at their configured cap (so the presets' γ/κ differences are largely decorative), `maxQuoteQty` is structurally inert (`min(maxQuoteQty, baseOrderQty)` where validation already requires `maxQuoteQty ≥ baseOrderQty`), there's no cancel-on-refresh (stale resting orders accumulate across requotes), and `_timeToCloseFraction` never resets across session boundaries in a multi-day backtest.

---

## 2. Checkpoint 1 — the process-isolation bug and its fix (shipped, committed)

**The incident (10 Sept 2026).** A backtest launched from the UI ran *inside* the live paper-trading process. For the duration of the run, every `nowMs()` call in the live path — quote timestamps, risk cooldowns, rolling-window eviction — silently returned the backtest's simulated 2025 clock instead of wall time, while the backtest's CPU-bound bar loop blocked the event loop badly enough that the Alpaca WebSocket missed its ping and reconnected.

**Root cause.** `runtime/bootstrap.ts` mounts the *full* Express API (via `createApp()`) inside every trading runtime, and `app/routes/index.ts` mounts `backtestRoutes` unconditionally — so `POST /api/backtests/run` genuinely existed on the paper-trading process (port 8080), not just the intended API-only process (port 8082).

**The fix — three independent layers**, each closing a different gap rather than one being a superset of the others:

1. **`utils/time.ts`** — `lockClockForLive(mode)` / `isClockLockedForLive()`. `setClockOverride()` now **throws** if something tries to install a simulated clock while the process has claimed the live clock (clearing to `null` is always still allowed, so cleanup paths can't deadlock). `bootstrap.ts` calls the lock right after `orchestrator.start()`.
2. **`core/backtest/backtestEngine.ts`** — `run()` checks the lock and throws immediately, before fetching any market data, if called inside a locked process.
3. **`app/controllers/backtestController.ts`** — returns **409** at the HTTP edge the moment `req.app.locals.ctx.orchestrator` is present, before the request body is even validated.

**Why three layers instead of just removing the route.** The real fix is removing `backtestRoutes` from the trading runtime's router entirely, making the question "is the clock locked" unaskable rather than answered. That's a larger, riskier change than fit in this checkpoint (it touches how `app/index.ts` assembles its router based on mode). The three layers are compensating controls until that split exists — and the clock-lock layer specifically is worth keeping *permanently*, even after the route is removed, because it's a two-line invariant check that turns "a future debug script calls `setClockOverride` against the wrong environment" from silent data corruption into an immediate crash. **Not done, offered but never requested:** actually removing the route mount for live processes.

**Frontend half of the fix:** `NEXT_PUBLIC_BACKTEST_API_BASE_URL` (defaults to the API-only process, port 8082) — all backtest HTTP calls and the SSE progress stream route there instead of `NEXT_PUBLIC_API_BASE_URL`.

**Shipped in commit `8116797`**, along with:

- **O(1) rolling stats** — `RollingNumericWindow` (`core/state/rollingWindow.ts`) maintains a running sum and sum-of-squares incrementally (with a periodic exact rebuild every 4096 pushes to bound floating-point drift), replacing an O(n) array-copy-and-scan on every bar in the pairs z-score calculation. This was the dominant cost in why a year-long backtest previously took minutes.
- **StrategyForm fixes** (`frontend/features/strategy/StrategyForm.tsx`) — `maxHoldingTimeMs` and `cooldownMs` were hardcoded in the payload builder and unreachable from the UI; now real fields. Added a `MAX_WINDOW_MINS` range guard with a clear error message, because a real production mistake (typing a millisecond value into a field labeled "minutes") had silently produced a ~1,150-year rolling window with no complaint from the form.
- **Test infrastructure** — diagnosed why the full backend suite "took forever": `ts-jest`'s default preset full-program-type-checks every test file in every worker, compounded by the base `tsconfig.json`'s `declaration: true` emitting unused `.d.ts` output for every test file. New `backend/tsconfig.spec.json` (`isolatedModules`, no declaration emit) plus an explicit transpile-only Jest transform brought the suite from *never completing* to **~13 seconds for 780+ tests**. Also added `forceExit: true` for a separate Jest-on-Windows worker-teardown hang (verified via `--detectOpenHandles` that nothing was actually leaking).
- **Known, still-open bug:** `backend/src/tests/core/backtestLoader.test.ts` hangs indefinitely. Confirmed this predates all of the above work (reproduced before any changes were made) — it is excluded from every full-suite run referenced in this document via `--testPathIgnorePatterns="backtestLoader"`. Never diagnosed further; the hang happens before any test body runs, which rules out a slow test and points at something in module-level setup or a mock.

---

## 3. Shared-book architecture — the design that shaped everything after it

**The decision:** one shared Alpaca account for the whole club (SHPE Capital UF, ~12 members), not one account per member. Members are *authors*, not *tenants* — they compete for one pool of capital, and the club's P&L is the sum of what their strategies do.

**The reframing that drove the rest of the design:** backtests and live runs have *opposite* isolation requirements. A backtest must touch nothing real — maximum fan-out, zero coordination. A live run must touch exactly one real thing (the book) and never share that with another writer — exactly one instance, strict coordination. Treating them as the same kind of job (which the pre-Checkpoint-1 architecture effectively did, by running both in the same process type) gets one of them wrong.

Two design artifacts were published during this conversation as Claude Artifacts (private, link-shareable, not committed to the repo):
- **Shared Book Architecture** — the topology diagram (stateless control plane + N sandboxed backtest workers vs. exactly one leased live runner), the per-member capital cascade, the opportunity-cost/contention problem, and the original 7-part implementation sequence.
- **Shared Book Schema** — an ER diagram of every table that existed at that point in the conversation, existing tables in ink vs. proposed tables in dashed rust.

The 7 parts from that plan, and their actual status as of this document:

| Part | What it covers | Status |
|---|---|---|
| 1 | Process isolation | **Done** — Checkpoint 1, §2 above |
| 2 | Durable backtest job queue | Schema written (`0001_backtest_jobs.sql`), **zero consumer code** |
| 3 | Shared bar cache | Schema written (`0002_bars_cache.sql`), **no read-through** in `BacktestLoader` |
| 4 | Identity & RLS | Schema + most app code appears built (see §6, §7) — **not audited end-to-end in this conversation** |
| 5 | Live runner hardening (leases, warm-up) | Schema written (`0004_run_leases.sql`), **no heartbeat or warm-up code** |
| 6 | Shared-book governance | Superseded — see §4's capital-sizing redesign and §6's migration `0005`→`0008` history |
| 7 | Strategy correctness backlog | Partially done — hysteresis + O(1) stats shipped (§2); `meta` column, trade-replay, better downsampling all still open (§8) |

---

## 4. A real design pivot worth understanding, not just the end state

Early in the review-workflow design, capital allocation was modeled as a persistent per-member table (`member_allocations`, with a fixed `max_capital_pct`). The user pointed out the club is structured more as teams collaborating on algorithms than as individual capital-holders, and that the allowed amount should be **flexible and decided per approval**, not a static pre-set cap.

The resolution reused a mechanism that already existed rather than building a new one: `riskBudget.maxCapitalPct` was already a field on strategy config, already enforced at order time by `RiskEngine.checkStrategyBudget`, and already collected by the frontend's `RiskBudgetSection`. So `member_allocations` was dropped entirely (created in `0005_governance.sql`, dropped in `0008_auth_provisioning.sql`), and in its place: the approval action itself takes an optional `approvedCapitalPct` override, written into the proposal's config at the moment of approval — a lead can size a request down without bouncing it back for a full re-review round trip. No persisted ceiling anywhere; sizing is a fresh judgment call each time, using exactly the enforcement path that already runs in production.

Separately: `teams`/`team_members` tables were discussed and **explicitly deferred by the user** — "keep as a TODO for a later push after testing the larger changes." Confirmed absent from the schema as of this document; `strategies` has no `team_id` column.

---

## 5. The GitHub-PR-style review workflow

This was designed iteratively, and the design changed twice in response to real concerns — worth knowing both the final shape and why it isn't the first thing proposed.

**First proposal:** a `strategy_revisions` table tracking every edit, with live mid-review editing (push a new revision in response to a comment, the way a PR takes new commits).

**First revision, at the user's request:** avoid a second table — track every version via a composite `(strategy_id, version_id)` key directly on the existing `strategies` table.

**The problem surfaced before building that:** `strategies.id` is already the load-bearing stable identity of a strategy throughout the codebase — `orchestrator.hasStrategyWithConfigId()` uses it for live dedup, `startStrategyRun` uses it as the run's `strategyId`. Turning `strategies` into a table with multiple rows per logical strategy would mean every existing consumer of "the strategy's id" needs to learn the difference between the per-version row id and the stable cross-version id — a much bigger, riskier refactor than the review feature itself needed. This was flagged explicitly rather than silently built around.

**What actually got proposed and (per the repo's current state) built instead:** a *separate* `strategy_versions` table, keyed by its own `id` plus a `(strategy_id, version_number)` natural key for browsing history — `strategies.id` keeps its existing meaning untouched, zero ripple into the orchestrator or run linkage. This gets the same "trivial history query, one less table than first proposed" goal the user wanted, anchored somewhere that doesn't disturb a load-bearing assumption.

**Second real simplification, also at the user's request:** no mid-review editing at all. The reasoning given: modifying a strategy requires real testing, and it's better for whoever's iterating to create a full new version, backtest it properly, *then* attach it to the review — not dash off a quick edit mid-discussion the way a PR takes a quick commit. This produced a cleaner two-phase lifecycle:

1. **Author** — create/edit a strategy freely (new `strategy_versions` row each time), backtest it, iterate — no review involved yet.
2. **Propose** — open a `strategy_proposals` row pointing at one specific, already-tested `strategy_versions` row (`head_version_id`). A `unique (strategy_id) where status = 'open'` partial index guarantees at most one open proposal per strategy, which is what makes the next point safe:
3. **Automatic re-attachment** — if a new version lands for a strategy with one open proposal, the app bumps that proposal's `head_version_id` automatically (no manual "attach" click needed, since there's no ambiguity about which open proposal to attach to).
4. **Review** — comments only, no editing surface on the review page itself. `proposal_comments.kind` carries `comment` / `suggestion` / `approve` / `request_changes` — a lead's verdict *is* a comment, not a separate reviews table, which also means the whole timeline is one `created_at`-ordered query across versions + backtests + comments with no extra event-log table.
5. **Approve** → creates the `strategy_runs` row (the one and only write to that table for this lifecycle) and registers the strategy with the live orchestrator.

A nice side effect of version-tagging backtests directly (`backtest_results.strategy_version_id`, added in `0006`): a `proposal_backtests` join table that was in an earlier draft of this design turned out to be unnecessary — "which backtests support this proposal" is just `where strategy_version_id = proposal.head_version_id`, since a backtest is inherently run against one exact, immutable version.

**Build status — important to be precise about:** partway through this conversation, `requireAuth.ts`, `proposalsController.ts`, `reviewRepositories.ts`, `authRoutes.ts`, `proposalsRoutes.ts`, and the frontend `/approvals` + `/login` pages, `AuthContext`, `useProposals`, `authService`/`proposalsService` were found **already present** in the working tree. They were not written in the conversation this document summarizes — they appear to be the product of parallel work (directly in the IDE, or another session) tracking this exact design. Fragments were sampled and matched the design precisely (e.g. `approvedCapitalPct` correctly overrides `config.riskBudget.maxCapitalPct` at approval time, exactly as designed in §4). **This has not been audited end-to-end** — treat it as "substantially built, unverified," not "done," until someone reviews it as a whole.

---

## 6. Database schema — migrations 0001 through 0009

Every migration below is **written as a `.sql` file in `supabase/migrations/` and has never been applied to any live database.** This is the single largest latent gap in the whole project — the entire identity/proposals/governance design exists only as source code until someone runs these against a real Supabase project, in order, for the first time.

| # | File | Adds | Status beyond "written" |
|---|---|---|---|
| 0001 | `backtest_jobs.sql` | A durable job queue — `config_key` dedup (partial unique index on active jobs), `lease_owner`/`lease_expires_at`, a `pg_notify` trigger on status change for cross-replica SSE relay | No worker anywhere claims a row. Designed for `FOR UPDATE SKIP LOCKED` long-poll workers *or* a direct Lambda-invoke pattern — see §9, this choice was never finalized in code |
| 0002 | `bars_cache.sql` | `bars` (keyed `symbol, timeframe, ts`, BRIN-indexed) + `bar_coverage` (tracks known-complete ranges so a cache miss isn't confused with a real market holiday) | `BacktestLoader` still fetches from Alpaca on every call — confirmed via direct grep, no read-through exists |
| 0003 | `identity.sql` | `app_users` (id → `auth.users`, role `member`/`lead`), `owner_id` on `strategies`/`strategy_runs`/`backtest_results`, RLS enabled with "everyone reads, owners write" policies | App code for most of this appears built (§5's caveat applies) |
| 0004 | `run_leases.sql` | `lease_owner`/`lease_expires_at`/`last_heartbeat_at` + `consecutive_errors`/`disabled_reason` on `strategy_runs`; a partial unique index enforcing **at most one `running` row per strategy** at the DB level | No heartbeat code, no boot-time warm-up code |
| 0005 | `governance.sql` | Originally: `member_allocations`, promotion-link columns on `strategy_runs`, `risk_rejections` + a `member_contention_daily` view | `member_allocations` **dropped in 0008** per the §4 pivot; the rest (risk_rejections, the contention view) — never confirmed built |
| 0006 | `strategy_versions.sql` | The immutable per-edit version table (§5), `backtest_results.strategy_version_id` (soft reference) | Appears built per sampled code |
| 0007 | `strategy_proposals.sql` | `strategy_proposals`, `proposal_comments`, the single-open-proposal partial unique index, the timeline-supporting view | Appears built per sampled code |
| 0008 | `auth_provisioning.sql` | The `on_auth_user_created` trigger auto-creating an `app_users` row on signup; drops `member_allocations` | Appears built — `requireAuth.ts`'s own comment explicitly references this migration |
| 0009 | `backtest_explicit_save.sql` | `saved_at` column, wires up the previously-unused `owner_id` on `backtest_results`, an owner-scoped insert RLS policy | **Built and tested this session** — see §7 |

**Columns that exist with no code reading or writing them yet**, worth flagging explicitly so nobody assumes they're live: `bars`/`bar_coverage` (no reader), `strategy_runs.lease_*` (no heartbeat), `risk_rejections` (never confirmed wired to `RiskEngine`'s actual rejection paths).

---

## 7. Explicit backtest save — built and verified this session

**The problem.** Every completed backtest run was persisted automatically and unconditionally — full config, metrics, equity curve (already downsampled to 5,000 points), **and every order and fill with no cap at all**. With backtesting becoming a frequent, exploratory activity (parameter sweeps, iteration), most runs are throwaway, yet each one permanently wrote its full trade history. This was identified as the actual cause of Supabase's free tier filling up quickly — not an encoding/compression problem (Postgres already TOAST-compresses large `jsonb` transparently), an **unbounded row-count** problem.

**The fix.** Nothing is written to `backtest_results`/`backtest_orders`/`backtest_fills` until a member explicitly clicks Save.

- **`backend/src/adapters/supabase/repositories.ts`** — `insertBacktestResult(result, savedBy: UUID)` now takes the saving member's id, stamping `owner_id` and the new `saved_at` column. (`owner_id` previously existed from migration `0003` but was never written to by any code.)
- **`backend/src/app/controllers/backtestController.ts`** — the automatic persist-on-completion call was removed entirely. A second in-memory cache, `pendingSaveCache` (30-minute window, holds the *full* result including orders/fills — distinct from the existing `resultCache`, which deliberately strips those for the display path), is populated when a run completes. New `POST /:id/save` handler: checks for an existing DB row first (idempotent — double-clicking Save, or a dedup hit that already came from a saved row, just confirms rather than erroring), then persists from the pending cache. **Documented, not solved:** the three inserts (result → orders → fills) aren't transactional; if the result row writes but the orders insert then throws, a retry will see the row exists and report "already saved" rather than resuming the orders/fills write. This mirrors the exact risk the *original* auto-persist code already accepted in the same spot — not a regression, but still open. Closing it properly needs a Postgres function wrapping all three writes in one transaction.
- **`backend/src/app/routes/backtestRoutes.ts`** — the new route is gated by `requireAuth`.
- **`backend/src/runtime/backtest.ts`** (the CLI entry point) — now requires a `BACKTEST_CLI_OWNER_ID` env var, since there's no HTTP request/JWT to derive a saver identity from in a standalone script; fails fast with a clear message rather than hitting a cryptic FK violation.
- **Frontend chain:** `backtestService.saveBacktest(id)` → `useBacktest`'s new `save`/`isSaving`/`saveError` → `BacktestResults.tsx`'s `SaveControl` sub-component (a Save button that becomes a "✓ Saved" badge; a dedup-reused result — `reused_from_id` set — is treated as already-saved, since dedup only ever matches previously-saved rows now) → wired into both the single-result and side-by-side comparison views in `app/backtest/page.tsx`.

**Verification:** 817 backend tests passing (including new coverage specifically for the retry-without-re-running behavior and the orders-before-fills insert order), both backend and frontend `tsc --noEmit` clean. **Not committed** as of this document.

**Deliberately deferred, discussed but not built in this feature:** an `AttributionCollector` implementation for true trade-replay (the type shape, `ReplayAttribution`, and the TODO comments describing exactly what to subscribe to already exist in `core/replay/attributionCollector.ts` — `STRATEGY_SIGNAL_CREATED`/`ORDER_FILLED` are confirmed already published on the same event bus a backtest's own `BacktestEngine` instance uses, so this is a implementation gap, not a design gap); a `meta jsonb` column on `backtest_orders` to stop silently dropping the already-computed signal metadata (zScore, spread, hedge ratio, etc.) at persistence time; peak/trough-preserving downsampling for the equity curve chart (current uniform-stride sampling can visually hide a real drawdown that the metrics correctly reflect).

---

## 8. AWS deployment plan

**Confirmed architecture:** one EC2 instance running the backend API + live paper-trading engine, Supabase for the database, AWS Lambda for backtest execution, Vercel for the frontend.

**Why not Kubernetes or Fargate for the live engine.** The live trading engine is designed to run as *exactly one instance* — that's what the run-lease work (migration `0004`) exists to enforce. Kubernetes' and Fargate's core value is elastic scaling across many replicas; nothing here benefits from that, and a managed EKS control plane alone runs roughly $70+/month before a single pod launches — against a total proposed budget in the $15–20/month range for everything else, that would roughly quadruple spend for a capability this workload structurally can't use.

**Why Lambda for backtests specifically, over an always-on ECS worker service.** The core argument from the comparison: usage is bursty (12 people running backtests intermittently, not a constant stream), and Lambda bills per 100ms of actual compute versus an always-on task billing 24/7 regardless of load — at this usage shape, Lambda is plausibly within AWS's standing free tier. A 15-minute hard execution ceiling is the real tradeoff, mitigated by splitting a multi-symbol sweep into one invocation per pair (which also gets free parallelism, not just a workaround). Packaging plan: a multi-stage Dockerfile with a `server` target (what EC2 runs) and a future `lambda` target wrapping the same compiled `dist/` output for the Lambda Runtime API — one build, two deploy artifacts, not two parallel codebases.

**Why Vercel, not the same EC2, for the frontend.** Free at this traffic level (not just cheap), purpose-built for Next.js specifically (preview deployments, CDN caching, image optimization for free), and "push to main deploys" requires zero pipeline code via Vercel's native GitHub integration — versus building and maintaining that in the EC2 pipeline. One thing flagged to verify, not assumed: Vercel's free-tier terms lean personal/non-commercial; worth a quick check that a club's internal tool fits comfortably.

**The CI/CD pipeline design** (proposed, not built): GitHub Actions on push to `main` → build a Docker image, push to ECR → deploy via **AWS SSM Run Command**, not raw SSH (no open port 22, no SSH key to rotate in a GitHub secret, IAM-based auth, every deploy logged in CloudTrail) → `docker compose pull && up -d` on the instance → health-check the existing `/health` endpoint → on failure, re-point at the previous image tag rather than leaving a broken deploy live. Authenticate GitHub Actions to AWS via OIDC federation, not long-lived static access keys in repo secrets.

**Cost traps specifically named to avoid:** no NAT gateway (Lambda should never be VPC-attached — it only needs to reach Supabase's public connection pooler, not anything inside a VPC; a NAT gateway alone runs ~$32+/month, more than the rest of the stack combined), no Application Load Balancer for one instance (~$16–20/month minimum for a capability one EC2 instance with an Elastic IP + Caddy for TLS termination doesn't need), SSM Parameter Store over Secrets Manager for secrets (free at the standard tier vs. ~$0.40/secret/month).

**What's actually been written on disk** (uncommitted, in the working tree as of this document — and per IDE-detected changes, some of this has already evolved further outside this conversation, e.g. a `backtest-worker` service and several new env vars have appeared in `docker-compose.yml`/`.env.example` since they were last written here):

- `backend/Dockerfile` — multi-stage (`deps` → `build` → `prod-deps` → `server`), one image shared by all three server processes, selected via `command:` override; non-root user; a `HEALTHCHECK` against `/health`.
- `backend/.dockerignore` — deliberately *wider* than `.gitignore` (`.env*`, `*.bak*` patterns) specifically because the stray `.env.bak-...` file (see §9) demonstrated that a narrow, exact-name denylist misses backup files by filename technicality.
- `backend/.env.example` — every variable from `config/env.ts`, marked required vs. optional; doubles as the checklist for what needs an SSM Parameter Store entry in production.
- `docker-compose.yml` (repo root) — `api` + `paper-trading` services; `real-trading` defined but gated behind a compose **profile**, so starting it requires a deliberate `--profile real-trading` flag rather than happening as a side effect of `docker compose up`. This was a deliberate choice, not an oversight: real-money trading was explicitly scoped *out* of the first deployment, since the club is still validating the approvals workflow on paper.
- **Never actually verified.** Docker Desktop was not running in the development environment this was built in, so `docker build` was never executed — everything above is grounded in direct reads of the real `package.json` scripts and `src/index.ts`, but is unexecuted. **First concrete next step: get a real `docker build` to succeed before building anything on top of it (GitHub Actions, Lambda packaging).**
- Fixed a real gap found while building this: the root `.gitignore`'s env-file rules (`'.env'`, `'.env.local'`, `'.env.*.local'`) didn't match `.env.bak-20260910164223` by filename technicality — that's exactly how that file ended up sitting untracked in the repo for most of this conversation. Added broader `.env.bak*` patterns.

---

## 9. Current repository state (verify before relying on this)

- **Branch:** `JC`. **One real commit beyond main:** `8116797` ("wip(backtest): isolate backtest engine from live trading process"), containing all of §2 and the Part 07 fixes.
- **A large set of modified and untracked files beyond that commit** — including extensive auth/proposals/review infrastructure (`requireAuth.ts`, `proposalsController.ts`, `reviewRepositories.ts`, migrations `0006`–`0008`, frontend `/approvals` and `/login`) that was **not produced by the conversation this document summarizes** and has not been audited here (§5's caveat). Also includes this session's explicit-backtest-save work (§7) and the Docker/AWS scaffolding (§8), both uncommitted.
- **`backend/.env.bak-20260910164223` is still sitting on disk, untracked, with real-looking Alpaca/Supabase key names.** Flagged repeatedly across this conversation; never deleted, since removing a file nobody explicitly asked to have removed isn't a call to make unprompted. **Action for whoever picks this up: confirm it isn't needed, then delete it.**
- **`backend/src/tests/core/backtestLoader.test.ts` hangs indefinitely** — confirmed pre-existing, never root-caused, currently just excluded from CI/local full-suite runs via a path ignore pattern.

---

## 10. What's left to implement, prioritized

**Zero code written, schema exists:**
1. A consumer for `backtest_jobs` — nothing claims a row, runs `BacktestEngine`, or writes a result back. This is the single biggest piece of unbuilt application logic in the whole plan, and the AWS decision (§8) depends on deciding its final shape (Lambda direct-invoke vs. a polling worker).
2. `bars`/`bar_coverage` read-through in `BacktestLoader` — confirmed every backtest still hits Alpaca directly.
3. Run-lease heartbeating and boot-time warm-up for the live runner (replay recent bars into `SymbolStateManager` on restart, so strategies aren't blind for the full `minObservations` window after every deploy).

**AWS pieces:**
4. Verify the Docker build actually succeeds (blocks everything downstream).
5. The GitHub Actions workflow itself (build → ECR → SSM deploy → health-check rollback) — fully unstarted.
6. The Lambda packaging stage and the backtest-job consumer that runs inside it.
7. Caddy/TLS/Elastic IP/domain setup — none of it exists yet.

**Smaller, explicitly scoped-out fast-follows:**
8. `meta` column on `backtest_orders` (data already computed, just currently dropped at insert — the cheapest win on this list).
9. `AttributionCollector` implementation for real trade-replay.
10. Peak/trough-preserving equity-curve downsampling.
11. Actually removing (not just 409-guarding) the backtest routes from the live process's router.

**Explicitly deferred by the user, not a gap:**
12. `teams`/`team_members` schema — correctly absent, per an explicit "later push" instruction.

**Recommended single next action:** get Docker Desktop running and confirm `docker build -t trading-backend:smoke-test -f backend/Dockerfile backend` actually succeeds, then smoke-test the `api` service against dummy credentials (it never touches Alpaca at startup, so this is a safe, complete test). Everything else in §8 is built on top of that image.

---

## 11. Assumptions made along the way — confirm or correct these

- **Leads can approve their own proposals** — no two-person control was built in. If the club wants a lead unable to approve their own submission, that's a real policy decision affecting `proposalsController.ts`, not yet made.
- **Editing rule:** a strategy that's never been approved can be freely revised with no review; any edit to one that's currently live or under review must go through a new version + the existing open proposal. This was my recommendation during design, not something explicitly requested — worth confirming it matches intent.
- **Real-money trading is deliberately excluded from the first AWS deployment** (the `real-trading` compose profile is defined but not started by default). This was a judgment call made while building the Docker scaffolding, not an explicit instruction — confirm before it either stays excluded or gets enabled.
- **Capital treatment is per-approval, not pre-allocated per member or per team** (§4) — confirmed as the direction, but the *policy* for how a lead should decide an `approvedCapitalPct` (equal treatment? first-come? performance-weighted?) was never specified and isn't encoded anywhere.
- **Specific numeric defaults chosen during this work**, worth a second look rather than treated as load-bearing: the 30-minute `pendingSaveCache` window (§7), the 0.15 cointegration hysteresis band (§1.1), the 527,040-minute (~1 year) ceiling on the strategy form's duration fields (§2).

---

*This document summarizes one engineering conversation's worth of work. Where it says a file or behavior "exists" or is "confirmed," that was checked by reading the actual source at the time this was written — but given how much changed even during the conversation (the auth/proposals discovery in §5, the docker-compose/`.env.example` drift noted in §8), re-verify anything load-bearing before depending on it.*
