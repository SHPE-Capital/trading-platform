# Shared Book Handoff

**SHPE Capital · Algorithmic Trading Platform · Engineering handoff**
**Written:** 3 Oct 2026 · **Covers:** sessions of 10, 11, 22 and 23 Sep 2026 · **Owner:** Juan Cavallin (Algo Trading lead)
**Companion docs:** [RFC-001 Shared Book Architecture](https://claude.ai/artifact/LsnNjvA8kFA9riNLQCkpxN) · [Shared Book Schema](https://claude.ai/artifact/HYtYcVuFt8t3BASi8uYmXa) · [`handoff.md`](handoff.md) (a parallel conversation; see [How this relates to `handoff.md`](#how-this-relates-to-handoffmd))

This covers everything built across these sessions. It starts with a backtest that corrupted the live paper session's clock. It ends with a platform where backtests run in queued workers, live runs are leased to one runner, and strategies reach the book only through a lead's approval. It also covers what state that work is in, and what has to happen before it runs.

## Current state

| Area | Status | Detail |
|---|---|---|
| Code | **Pushed through `84c001c`** | `JC` is one commit ahead of `origin/JC`. The unpushed commit is `3d6a94d`, which adds `handoff.md` from another session. No pull request was opened in these sessions. |
| Database | **Not migrated** | Migrations `0010`–`0011` have never been applied by tooling. `DATABASE_URL` in `backend/.env` is still the `db.your-project` placeholder. |
| Security | **Open hole** | Until `0011` is applied, any signed-in member can set their own `app_users.role` to `lead` through the public anon key, then approve their own proposals. |
| Local files | **Needs a call** | `backend/Dockerfile`, `backend/.dockerignore` and `docker-compose.yml` are staged but not committed. `backend/.env.bak-20260910164223` holds real credentials. It is git-ignored but still on disk. |
| Tests | **Green** | Backend 897/897 (65 suites); frontend 47/47 (8 files), as of 23 Sep. Typecheck and build are clean. Everything is tested against mocks only; nothing has run against real Supabase or Alpaca. |

**Contents:** [Before anyone runs this](#before-anyone-runs-this) · [How it fits together](#how-it-fits-together) · [What happened, in order](#what-happened-in-order) · [What's built](#whats-built) · [Migrations](#migrations) · [Commits](#commits) · [Runbook](#runbook) · [Decisions and why](#decisions-and-why) · [Open items](#open-items) · [How this relates to `handoff.md`](#how-this-relates-to-handoffmd) · [References and conventions](#references-and-conventions)

---

## Before anyone runs this

The code expects database functions that don't exist yet.

> **Why it blocks.** Without `0011`, the backtest worker's claim function doesn't exist, so backtests queue forever. Trading runtimes also can't adopt runs, so a strategy marked running won't resume after a restart. Without `0010`, the approvals page's All tab errors.

Do these in order, from `backend/`:

1. **Point the tools at the database.** In `backend/.env`, set `DATABASE_URL` from the Supabase dashboard (Connect → Session pooler). Optionally, set `DATABASE_CA_CERT` to the downloaded Supabase root certificate so the server's identity is verified; otherwise the connection is encrypted but unverified. The running app never uses this connection, only the migration tools do.
2. **See what's recorded.** `npm run db:status` lists each migration as applied, pending, or *pending, but its objects already exist*. Migrations `0001`–`0009` were most likely run by hand in the SQL editor: auth, proposals and explicit save all worked in the app on 23 Sep.
3. **Record the hand-run ones.** `npm run db:baseline -- 0009` (or whatever version `db:status` suggests) marks them as applied without re-running them. The migrate step refuses to run over objects that already exist, so this matters.
4. **Apply the rest.** `npm run db:migrate` runs each pending file in its own transaction. It records them in `supabase_migrations.schema_migrations`, the Supabase CLI's table, so `supabase db push` and this runner stay interchangeable.
5. **Verify.** `npm run db:verify` must pass every check: required objects present, row-level security on every public table, views that respect the caller's RLS, and backend-only functions the anon key can't call.
6. **Delete the credentials backup.** Remove `backend/.env.bak-20260910164223`. It was never committed (`.env.bak*` is ignored now), so rotate the Alpaca and service-role keys only if that file ever left this machine.
7. **Start with a worker.** `npm run dev` now starts four processes, including `worker`. Look for `BacktestWorker: started` in the logs before trying a backtest.

---

## How it fits together

One Alpaca account and one book, with many authors. The club trades a single account. Members author strategies; a lead promotes tested versions to the live book.

The two paths have opposite needs. A backtest must touch nothing real, so it runs in disposable worker processes. A live run touches the one real book, so each run is leased to exactly one trading process. The full reasoning is in [RFC-001](https://claude.ai/artifact/LsnNjvA8kFA9riNLQCkpxN).

| Process | Port | Entry | Role |
|---|---|---|---|
| paper-trading | 8080 | `runtime/paper-trading.ts` | The paper book: orchestrator, Alpaca market data and order stream, run leases, warm-up, rejection recording. Also serves the full REST API; approvals target it because approving starts a strategy. |
| real-trading | 8081 | `runtime/real-trading.ts` | The same, against the real-money account. Exits immediately unless `ALPACA_TRADING_MODE=live`; that exit is expected in development. |
| api | 8082 | `src/index.ts` | REST only, no engine. The frontend's backtest calls and progress streams go here. |
| backtest worker | — | `runtime/backtestWorker.ts` | Claims queued backtests and runs them through the shared bar cache, one job per process. Scale by running more. |
| frontend | 3000 | Next.js 16 | Uses Supabase only for sign-in and token refresh. All data goes through the backend, which uses the service-role key. |

---

## What happened, in order

Thirty-four requests across four working days. Each entry is what was asked and what came of it.

### 10 Sep: strategies and a bad run

- Explained the pairs strategy (z-score of a hedged spread, gated by an Engle-Granger cointegration test) and Avellaneda-Stoikov market making, including a one-line slide summary of the latter. Recommended **XOM/CVX** as a demo pair.
- Pointed out where the settings live: `rollingWindowMs` is the spread window and `maxHoldingTimeMs` the forced exit.
- Diagnosed the XOM/CVX run. Millisecond values had been typed into fields that take **minutes**, making the windows 60,000× too large (about 1,150 years). Nothing was ever evicted and the z-score turned O(n²). Separately, the pair's cointegration test sat right on the critical value and flapped "lost/regained" on every recalculation.

### 11 Sep: isolation and the RFC

- **Root cause of the live-clock bug:** each trading runtime mounted the whole REST API, and the frontend defaulted to port 8080, so a UI backtest ran *inside* the paper process. `setClockOverride` fed simulated 2025 time to live quote timestamps, risk cooldowns and window eviction. The CPU-bound loop also starved the Alpaca WebSocket into a reconnect.
- Talked through the architecture and settled on **one shared book**, not per-member accounts. Published RFC-001 with seven implementation parts.
- **Checkpoint 1 (Part 01):** `lockClockForLive` makes `setClockOverride` throw once a trading engine owns the process. `BacktestEngine.run()` refuses up front, the HTTP edge returns 409, and the frontend sends backtests and their progress streams to port 8082 via `NEXT_PUBLIC_BACKTEST_API_BASE_URL`.
- **Test speed:** ts-jest became transpile-only (new `tsconfig.spec.json`), `forceExit` works around Jest's Windows teardown stall, and a new `npm run typecheck` covers tests too. The suite went from never finishing to about 12 seconds. `backtestLoader.test.ts` still hung and was excluded until 23 Sep.
- **Part 07:**
  - a hysteresis deadband on the cointegration gate (0.15; `PairsStrategy` to version 4);
  - O(1) rolling mean and variance (`RollingNumericWindow`);
  - editable holding-time and cooldown fields;
  - a one-year cap on window fields, with a message that names the minutes mistake.
- Wrote the schema for Parts 02–06 as migrations `0001`–`0005`. Not applied.

### 22 Sep: identity and approvals

- Recapped the work and agreed the clock lock is a compensating control; the real fix is the Part 02 worker. Designed identity (Supabase Auth → `app_users` via a trigger, plus a `requireAuth` middleware) and published the Shared Book Schema.
- Committed everything so far as `8116797`, flagged WIP and without a Claude co-author, as requested.
- **Approvals design, over several rounds:**
  - A pending-approvals view, with approval as the single go-live moment.
  - Per-member capital caps dropped in favour of capital set per approval.
  - A GitHub-PR-style review with discussion.
  - Versions kept in their own `strategy_versions` table rather than a composite key on `strategies`, because live dedup and every order reference depend on `strategies.id` staying stable.
  - Teams deferred.
- **Implemented:** migrations `0006`–`0008`, auth on the backend and frontend, the approvals backend and pages, and 32 tests.
- **Lint:** the backend had ESLint installed but no config, so lint had never actually run. Added an ESLint 9 flat config, fixed 25 errors, normalized both lockfiles; 0 vulnerabilities.
- Explained why the frontend holds a Supabase client: sign-in and token refresh only. Every data request still goes through the backend.
- Work from the parallel conversation appeared in the tree: `0009` explicit backtest save (with its controller and UI), the Dockerfile, `docker-compose.yml`, and `backend/.env.example`. See [`handoff.md`](handoff.md) §7–§8.

### 23 Sep: fixes, then items 1–6

- **"Failed to fetch" on backtests** wasn't an expired token; that would have been a 401. The api process on 8082 had died under nodemon, which only restarts on file changes, not crashes. A second `npm run dev` tree had also collided on 8080. Killed both trees; no code change.
- **"This strategy has no versions yet"** when proposing: creating a strategy never wrote its first version, only editing did. Now `createStrategy` writes version 1 and rolls back if that fails. Creating and editing configs require sign-in (any member), and the strategy form shows version history with authors.
- Committed incrementally as `baa7a7d`–`fb73464`, leaving the Docker files out.
- **Approvals page:**
  - In progress / All tabs.
  - A non-terminal **changes requested** state (`0010`), separate from a deliberate Reject.
  - A fix for backtests never linking to proposals: `strategy_version_id` was never being written. Juan committed this as `9a42755`.
- **Items 1–6** (below): migration tooling, the code for Parts 02, 03, 05 and 06, the loader hang fix, commits, frontend tests, and the review-page panels. Committed as `eca2d13`–`84c001c`.

---

## What's built

Organized by the part of the system a reader will be working in, not by when it landed.

### Backtests: queue, worker, bar cache (Parts 02, 03)

- **Request.** `POST /api/backtests/run` answers immediately. It reuses a saved identical result if one exists, then an identical unsaved one still inside its save window. Otherwise it enqueues a job.
  - A partial unique index on the config fingerprint makes a concurrent identical request join the job already in flight, across every API process.
  - Any process may accept the request, trading runtimes included, so the old 409 guard is gone. The clock lock stays.
- **Worker.** Claims the oldest runnable job with `FOR UPDATE SKIP LOCKED`, heartbeats a 60-second lease every 15 seconds, and writes progress at most once a second. The engine yields every ~200 ms so those timers fire; it aborts at the next yield if the lease is lost.
  - A worker crash: the lease lapses and another worker reclaims the job.
  - Three lapsed leases on one job: it is failed as poison.
  - Each member may have at most 2 jobs running at once.
  - On shutdown, the worker hands its job back to the queue.
  - Every 5 minutes it sweeps expired staged results and finished jobs older than 72 h.
- **Results.** Finished output is staged in `backtest_job_artifacts` (a summary plus 1,000-item chunks of orders and fills) for 30 minutes. Only `POST /:id/save` writes `backtest_results`, so explicit save behaves as `0009` intended. The page shows when an unsaved run will be discarded.
- **Progress.** `GET /:id/stream` sends `status`, `progress`, then `complete` or `error`. Each API process polls the job row once a second per job and fans it out to every open tab. That survives a worker handoff and needs no direct Postgres connection. The page also warns when a job sits queued with no worker to run it.
- **Bar cache.**
  - Days recorded complete in `bar_coverage` are read from `bars` in 10-day slices via one RPC call each.
  - Missing runs of days are fetched from Alpaca and backfilled. Empty days (weekends, holidays) are recorded too, so they are never refetched.
  - The most recent day is never marked complete, because Alpaca revises recent bars.
  - If the cache fails, the loader falls back to Alpaca rather than failing the backtest.
- **Loader hang.** A page that wasn't sorted left every buffer above the drain horizon, so `while(true)` spun without ever yielding and even Jest's timeout couldn't stop it. Pages are now sorted on arrival, and an iteration that makes no progress throws.

Files: `core/backtest/{backtestWorker,barCache,backtestLoader,backtestEngine,backtestStreamManager,strategyFactory}.ts`, `runtime/backtestWorker.ts`, `adapters/supabase/{backtestJobRepository,barCacheRepository}.ts`, `app/controllers/backtestController.ts`, `frontend/hooks/useBacktest.ts`

### Live runner: leases, warm-up, auto-disable (Part 05)

- **Leases.** A runtime trades only the runs it holds a lease on. Every 30 seconds (a third of `RUN_LEASE_SECONDS=90`) it:
  - heartbeats every lease it holds;
  - drops any run another runner took;
  - adopts running runs of its **own execution mode** that no live runner holds. Before this, boot resumed every running run regardless of mode, so the real-money runtime would have traded paper runs.

  If heartbeats fail for 80% of a lease, it stops trading everything rather than risk two writers on one account. On shutdown it releases all its leases so a successor adopts immediately.
- **Start and stop.** Starting or approving a run: warm up, then insert the row already leased to this runner, then start trading. A crash in between leaves a leased row that gets adopted, never a strategy trading with no row behind it. Stopping marks the row stopped first, then releases the lease, so no other runner adopts it back.
- **Warm-up.** A strategy primes its rolling windows from history before it trades, at boot and on approval. History comes through the bar cache.
  - Hook: optional `IStrategy.warmUp` / `warmUpLookbackMs`. `PairsStrategy` replays bars through the same window update `evaluate()` uses and never reaches the entry or exit logic.
  - Depth: the longest window (the OLS window when `rolling_ols`) plus 1 h, capped at 90 days.
  - Timeout: 60 s; after that the strategy starts cold.
- **Auto-disable.** After `MAX_CONSECUTIVE_STRATEGY_ERRORS` (default 5) evaluate errors in a row, the orchestrator deregisters the strategy. The runtime marks the run `error` with a `disabled_reason` and releases its lease. The error streak is persisted and resets on a clean evaluate. Backtests keep the old behavior (no limit).
- **Approval fixes.**
  - Approved configs carried no `id`, so every approved strategy shared one risk budget. The strategy now takes its `strategies.id`.
  - Approving a strategy that is already live now returns 409.
  - A failed approval note no longer rolls back a run that already started.
- **Strategy card.** Distinguishes *running elsewhere* (leased to another runner) from *awaiting runner*, and shows an auto-disable reason and the current error streak.

Files: `core/live/{liveRunCoordinator,strategyWarmer}.ts`, `runtime/bootstrap.ts`, `core/engine/orchestrator.ts`, `adapters/supabase/runLeaseRepository.ts`, `strategies/pairs/pairsStrategy.ts`

### Contention tracking (Part 06)

- **Recording.** `RISK_REJECTED` events now name the check that fired (`STRATEGY_BUDGET`, `CASH_RESERVE`, `KILL_SWITCH`, …). Capital shortfalls are recorded as `CAPITAL_UNAVAILABLE`. Rejections are buffered and batch-written to `risk_rejections` every 5 s with the accountable member. Owner lookups are cached for 5 minutes; at most 5,000 rows are buffered during an outage.
- **Viewing.** `GET /api/governance/contention?days=7|30|90` (signed-in) and a new **Contention** page. Blocked orders are grouped by member, then strategy and check, each check with a plain-language gloss.
- **Not built.** The per-member allocation tier from RFC-001. `0008` replaced it with capital set per approval, enforced by the existing strategy budget.

### Review workflow

- **Versions.** `strategy_versions` rows are immutable and numbered by a trigger. Every save writes one, and creating a strategy writes version 1. A proposal cites a head version. A new version auto-attaches to the strategy's single open proposal, the way new commits land on an open PR.
- **States.** Open, approved, rejected, withdrawn. **Changes requested** is derived rather than stored: it holds while a `request_changes` comment is newer than the head version, and clears itself when the author pushes a version.
- **Actions.** Leads can:
  - **Approve & start**, with an optional capital override applied to `riskBudget.maxCapitalPct`;
  - **Request changes**, which posts feedback and leaves the proposal open;
  - **Reject**, which is terminal and deliberately separate.

  Authors can withdraw. Comments and suggestions are open to every member.
- **Review page.**
  - Backtests run against the exact head version.
  - A field-level diff against the previous version, or any version picked in the sidebar.
  - A **book-allocation** panel: live runs' capital caps plus this one (or the typed override), with a warning when the total passes 100% of the book.
  - A merged activity timeline.
- **Lists.** Approvals has an **In progress** tab (the queue, oldest first, with changes-requested and no-backtest badges) and an **All** tab (history with how each proposal was settled).
- **Backtest link.** The backtest form tags runs with the selected config's newest version, and saving writes `strategy_version_id`. This is best-effort: editing fields after picking a config still tags that version.

### Auth and access

- **Sign-in.** Supabase Auth (password or magic link) in the frontend. Every API call carries the JWT. The backend's `requireAuth` / `requireRole` / `optionalAuth` load the member's `app_users` profile; `GET /api/auth/me` returns it.
- **Roles.** `member` (the default, set by the sign-up trigger) and `lead` (set by SQL). Only leads can approve, reject, or leave verdict comments.
- **Signed-in only.** Config create and edit, versions, proposals, comments, backtest save, contention. Running a backtest is open to anyone, but attributed when signed in.
- **Database.** The backend uses the service-role key, so RLS is the second net rather than the first. Once applied, `0011`:
  - enables RLS on every public table;
  - makes views respect it (`security_invoker`);
  - revokes execute on the queue, lease and bar functions from the anon and user roles.

---

## Migrations

Statuses are inferred from what the app could do on 23 Sep; nothing in these sessions read the live database. `npm run db:status` is authoritative.

| File | Adds | Status |
|---|---|---|
| `0001_backtest_jobs` | Job queue table, fingerprint dedup index, change-notify trigger | Likely hand-run |
| `0002_bars_cache` | `bars`, `bar_coverage` | Likely hand-run |
| `0003_identity` | `app_users`, `owner_id` columns, RLS on four tables | Applied (auth worked) |
| `0004_run_leases` | Lease columns, one-live-run-per-strategy index, error streak | Likely hand-run |
| `0005_governance` | `risk_rejections`, contention view, allocations (dropped by `0008`) | Likely hand-run |
| `0006_strategy_versions` | Immutable versions, numbering trigger, backtest version link | Applied (versions used) |
| `0007_strategy_proposals` | Proposals, comments, review queue and timeline views | Applied (proposals used) |
| `0008_auth_provisioning` | Sign-up trigger, backfill, drops superseded columns | Applied (profiles existed) |
| `0009_backtest_explicit_save` | `saved_at`, owner insert policy | Applied (saves worked) |
| `0010_proposal_review_state` | Derived `changes_requested`, `proposal_summaries` view | **Unknown** |
| `0011_runtime_rpc` | Queue, lease and bar functions; RLS on all tables; `security_invoker` views | **Not applied** |

The older `backend/src/db/migrations/001`–`005` predate this series. They created the original tables (`strategy_runs`, `orders`, `fills`, `strategies`, …) and are already live.

---

## Commits

Fourteen commits on `JC` since `7aa3bb6` (merge of PR #49), oldest first.

| Hash | Date | What |
|---|---|---|
| `8116797` | 22 Sep | WIP: process isolation (Checkpoint 1), Part 07 strategy fixes, test speed, migrations `0001`–`0005` |
| `baa7a7d` | 22 Sep | ESLint 9 flat config and lint fixes |
| `ab0bbe8` | 22 Sep | Migrations `0006`–`0009` |
| `bded11b` | 22 Sep | Supabase Auth: middleware, `/auth/me`, frontend sign-in, JWT on every request |
| `156bbc8` | 22 Sep | Explicit backtest save |
| `fb73464` | 22 Sep | Review and approval workflow, version-on-create fix, version history |
| `9a42755` | 22 Sep | Approvals tabs, changes-requested state, backtest-to-proposal link (Juan) |
| `eca2d13` | 23 Sep | Loader hang fix |
| `fa2aa51` | 23 Sep | `0011`, RLS hardening, migration runner and verifier |
| `1129e88` | 23 Sep | Job queue, worker, SSE relay, bar cache, backtest UI |
| `79d4dcb` | 23 Sep | Leases, warm-up, auto-disable, contention tracking, capital-exposure API |
| `99906d3` | 23 Sep | Version diff and book-allocation panel on the review page |
| `84c001c` | 23 Sep | Frontend Vitest suite |
| `3d6a94d` | 3 Oct | `handoff.md` from the parallel conversation (**not pushed**) |

---

## Runbook

### Run it locally

```bash
# backend/ — paper :8080, real :8081 (exits in paper mode), api :8082, worker
npm run dev
npm run dev:worker          # a worker on its own

# frontend/ — :3000
npm run dev
```

The backend reads `backend/.env`, documented in `backend/.env.example` including the new lease, worker and migration variables. The frontend needs `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`; without them it shows a setup screen. `NEXT_PUBLIC_API_BASE_URL` defaults to port 8080 and `NEXT_PUBLIC_BACKTEST_API_BASE_URL` to 8082.

### Make someone a lead

```sql
update app_users set role = 'lead' where email = 'someone@ufl.edu';
```

### Check and test

```bash
# backend/
npm test                     # 65 suites
npm run typecheck            # src and tests
npm run lint                 # 0 errors, 21 `any` warnings
npm run db:status            # also: db:migrate, db:baseline -- <ver>, db:verify

# frontend/
npm test                     # Vitest + Testing Library
npm run build
```

### When things go wrong

| Symptom | Cause and fix |
|---|---|
| "Failed to fetch" on a backtest | The api process on 8082 is probably down. nodemon only restarts on file changes, not on a crash. Check with `curl http://localhost:8082/health`. Also make sure only one `npm run dev` tree is running: `netstat -ano \| findstr :808`, then `taskkill /F /T /PID <root>`. In Git Bash, double the slashes. |
| A backtest stays queued | No worker is running, or `0011` isn't applied. The worker logs `claim_backtest_job failed` when the function is missing. |
| A strategy shows "awaiting runner" | No runtime holds its lease. A paper runtime adopts it within one heartbeat, about 30 s. After a crash, the dead runner's lease must lapse first (up to 90 s). |
| Approving returns 409 | That strategy is already live. Stop the running version first; its open positions need a deliberate hand-off. |
| Duration fields look wrong | Strategy duration fields take **minutes**, not milliseconds; the form rejects anything over a year. |

### Docker

`docker compose up` starts api, paper-trading and backtest-worker; real-trading runs only with `--profile real-trading`. `backend/Dockerfile`, `backend/.dockerignore` and `docker-compose.yml` are **staged but not committed**. They came from the parallel conversation, and Juan asked to hold them back. The worker service was added to the compose file on 23 Sep. `docker build` has never been run (see `handoff.md` §8).

---

## Decisions and why

The calls a successor is most likely to question, with the reasoning that settled them.

- **One shared book, not per-member accounts.** The club trades one account. Multi-user means multi-author, which the existing single-portfolio design already models; per-member accounts would be a different system.
- **Backtests in workers, live runs leased to one runner.** A backtest touches nothing real, so it can fan out freely. A live run writes to a shared account, and two writers would each reserve the same cash and overcommit it.
- **Versions in their own table.** A composite key on `strategies` was proposed. It was turned down because live dedup, run links and every order reference rely on `strategies.id` meaning one strategy.
- **Proposals separate from runs.** A rejected proposal never traded. `strategy_runs` stays a record of things that actually ran, written once, at approval.
- **Edits happen by new version, not on the review page.** Changing a strategy needs a backtest. The review page is discussion only, and a new version re-points the open proposal.
- **Changes requested is derived, not a status.** It keeps "one open proposal per strategy" simple and clears itself when a version lands. Reject stays terminal and is reserved for proposals that shouldn't continue.
- **Capital per approval, not per member.** Teams share strategies, so a fixed per-person cap didn't fit. The approving lead sets `maxCapitalPct`, which the existing strategy budget already enforces on every order.
- **Service-role backend, RLS as second net.** The runner and workers act for the whole club. Ownership checks live in the controllers; RLS guards any path that ever uses a user's token, and blocks the public anon key outright.
- **Unsaved results staged in the database.** With workers, the API process no longer holds results in memory, so staging moved to the database. Staging in `backtest_results` was rejected: under `0009` a row there means someone chose to keep it.
- **Polling the job row instead of LISTEN/NOTIFY.** There's no direct Postgres connection; the backend talks only to PostgREST. Polling also survives a worker handoff for free. It is worth switching only if a session-mode connection is ever configured.
- **No automatic swap when promoting a new version of a live strategy.** The new instance knows nothing about the old one's open positions. Approving returns 409 until the live run is stopped deliberately.

---

## Open items

Ordered by what blocks the most.

### Do first

- Apply and verify the migrations, and delete the `.env.bak` file. See [Before anyone runs this](#before-anyone-runs-this).
- Smoke-test end to end against real Supabase and Alpaca paper; none of this has run outside mocks:
  - Queue a backtest, kill the worker mid-run, and watch the job get reclaimed.
  - Save it, propose it, request changes, push a version, and approve with a capital override.
  - Restart the paper runtime and confirm the run is adopted and warmed up.
  - Start two paper runtimes and confirm only one trades the run.
  - Force an error streak and confirm the strategy is auto-disabled.
  - Check that the Contention page fills.
- Push or drop `3d6a94d` (the `handoff.md` commit) and decide whether to keep two handoff docs. See [How this relates to `handoff.md`](#how-this-relates-to-handoffmd).

### Next

- Decide on the staged Docker files and the AWS plan (EC2 + Lambda + Vercel, in `handoff.md` §8). The plan puts backtests on Lambda; the worker built here is a long-running poller suited to a container. `BacktestWorker.runOnce()` (claim one job, run it, finish it) is the natural seam for a Lambda handler. `docker build` still has to succeed first.
- Open a pull request from `JC`.
- Fix the 5 frontend lint errors that predate this work: setState called synchronously in an effect, in `app/dashboard/page.tsx`, `SystemHealthCard`, `BacktestForm`, `StrategyForm` and `useWebSocket`.
- Design a hand-off for promoting a new version of a live strategy. Today the only path is stop, then approve.
- Align the backtest form with the strategy form. It still hardcodes cooldown and holding time, which is why version tagging is best-effort.
- Decide whether a lead may approve their own proposal. No two-person rule is built (also raised in `handoff.md` §11).

### Known limitations

- Teams and team members are deferred by request (TODO in `0008`). Ownership stays individual.
- Anonymous backtest runs skip the per-member concurrency cap.
- Saving a backtest is three inserts, not one transaction; a partial failure reports "already saved" on retry.
- The proposal's backtest list doesn't filter by status. The queue's count does.
- The bar cache key has no data-feed dimension, so IEX and SIP bars would mix after a plan upgrade.
- `risk_rejections` has no retention policy.
- The engine's simulated clock is process-global, which is why each worker runs one job at a time.
- Backend lint carries 21 `no-explicit-any` warnings at Supabase and event boundaries.
- From `handoff.md` §10, still open: a `meta` column on `backtest_orders`, an `AttributionCollector` for trade replay, and peak/trough-preserving equity-curve downsampling.

---

## How this relates to `handoff.md`

`handoff.md` was written on 3 Oct by a parallel conversation. That conversation produced the explicit-save feature (`0009`), the Docker files and the AWS plan. It is the better reference for:

- strategy mechanics in depth (§1);
- explicit save internals (§7);
- the AWS deployment plan and its cost reasoning (§8).

Its snapshot predates the 23 Sep work here, so these parts are out of date:

| `handoff.md` says | Now |
|---|---|
| §9: `JC` is one commit past `main` (`8116797`); auth, proposals and migrations `0006`–`0008` are unaudited and uncommitted | Everything through `84c001c` is committed and pushed; the auth and proposals work came from these sessions |
| §9: `backtestLoader.test.ts` hangs, excluded from runs | Fixed in `eca2d13`; it runs in the normal suite |
| §6: `bars`/`bar_coverage`, `strategy_runs.lease_*` and `risk_rejections` have no code reading or writing them | All three are wired (`1129e88`, `79d4dcb`) |
| §10 items 1–3: no `backtest_jobs` consumer, no bar-cache read-through, no lease heartbeat or warm-up | Built: worker, bar cache, leases and warm-up |
| §10 item 11: remove the backtest routes from the live process | Superseded: the engine never runs in-process now, so the 409 guard was removed and any process may enqueue |
| Migrations end at `0009` | `0010` and `0011` exist; see [Migrations](#migrations) |

---

## References and conventions

- [RFC-001 Shared Book Architecture](https://claude.ai/artifact/LsnNjvA8kFA9riNLQCkpxN): the topology, the two paths, and the seven parts.
- [Shared Book Schema](https://claude.ai/artifact/HYtYcVuFt8t3BASi8uYmXa): the ER diagram as of 22 Sep. It predates `0009`–`0011`; the migration table above is current.
- The full session transcript lives on Juan's machine at `~/.claude/projects/c--Users-juanc-Local-Dev-trading-platform/c8bdf893-9a18-40a6-920b-c5f39416926f.jsonl`.

### How this work was run

- "Don't make code changes yet" requests got recommendations only. Implementation waited for an explicit go-ahead.
- Commits are incremental, one per area. The WIP commit carries no Claude co-author, per request.
- The frontend is Next.js 16, which has breaking changes. `frontend/AGENTS.md` requires reading `node_modules/next/dist/docs` before writing frontend code.
- Development is on Windows: Git Bash and PowerShell, with processes managed by PID through `taskkill`.
- One slip to avoid repeating: a test file was overwritten by creating a "new" file at an existing path, and was restored from git before commit. Check `git ls-files` first.
