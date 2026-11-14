# Local development

This is the reference for installing tools, starting the local Docker stack,
providing data credentials, and managing local database state. For directly run
Node processes with hosted Supabase, use [the no-Docker path](local-development-no-docker.md).
For starting/stopping strategy runs and selecting a personal paper broker, use
[paper trading](live-paper-trading.md).

## Prerequisites

- [Git](https://git-scm.com/downloads) to clone the repository.
- [Node.js](https://nodejs.org/en/download), an LTS release **22 or newer**, with npm.
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) or a compatible
  engine with Docker Compose. Complete installation and start the engine.
- Optional personal Alpaca paper credentials for market data or paper orders.

After installation, open a new terminal and check `git --version`,
`node --version`, `npm --version`, and `docker info`. On Windows, use PowerShell;
if it blocks `npm.ps1`, use `npm.cmd` for the commands below.

## First start

```text
git clone https://github.com/SHPE-Capital/trading-platform.git
cd trading-platform
npm install
npm run setup
npm run dev:stack
```

If you already have a checkout, start in its root instead of cloning again.
All `npm run` commands in this guide run from the **repo root**, except the data
pull explicitly marked below. Repository access requires the appropriate GitHub
membership if GitHub asks you to authenticate.

Root `npm install` provides the pinned Supabase CLI. `setup` installs package
dependencies, creates missing environment files without overwriting existing
ones, and checks prerequisites. Docker must be running. The launcher uses the
official Supabase CLI for database/auth containers and
`docker/docker-compose.dev.yml` for app services; it applies migrations and
provisions an active local lead automatically.

| Service | Default address |
|---|---|
| App | http://localhost:3000 |
| Paper/sim runner | http://localhost:8080 |
| API/backtests | http://localhost:8082 |
| Supabase API | http://localhost:54321 |
| Supabase Studio | http://localhost:54323 |

Sign in as `lead@local.test` / `local-development-only`. Use the Supabase addresses
printed by the launcher when ports are remapped. Run `npm run doctor` from a
second terminal for a read-only health report.

Supabase's optional Logflare/Vector analytics services are disabled locally. This
avoids the Windows Docker TCP-port `2375` dependency; database, authentication,
storage, and app features still run normally. Read application logs in the stack
terminal or with `docker compose -f docker/docker-compose.dev.yml logs --tail 100`.
Supabase Studio's centralized log explorer is unavailable with analytics disabled.
If upgrading an already-running stack, stop the old optional containers once:
`docker stop supabase_vector_shpe-capital-trading-platform supabase_analytics_shpe-capital-trading-platform`.

Repeated HTTP `304 Not Modified` entries are successful cache checks. Pages poll
for updates, and the browser reuses its cached response when the data is unchanged.
They do not require a fix; `401` before login is also expected.

Source directories are bind-mounted; dependencies live in Docker volumes. If
backend edits do not trigger nodemon on Windows, restart the affected services.
Backtests run in `backtest-worker`, so include it after editing strategy code:

```text
docker compose -f docker/docker-compose.dev.yml restart paper-trading api backtest-worker
```

The default stack omits real-money trading and sets
`STRATEGY_POLICY_PROFILE=development`. Eligibility is defined in
[strategy policy](../architecture/strategy-policy.md), not by `NODE_ENV`.

## Market data and environment forwarding

Local execution defaults to `sim`: orders fill in a local book, priced on live
Alpaca data from **your own** keys. Without data keys the runner receives no
data, reports **No data** in the navbar badge, and refuses to start strategies.
Detailed fill behavior belongs to [backtest/sim execution](../architecture/backtest-execution.md#the-sim-runtime).

For live prices, sign in to your own [Alpaca paper account](https://app.alpaca.markets/),
select Paper Trading, and generate its Key ID and Secret in the API Keys panel.
Use personal paper credentials, not the club's account. Follow
[Alpaca's paper account documentation](https://docs.alpaca.markets/us/docs/paper-trading)
for account/key generation. Update `backend/.env`:

```dotenv
ALPACA_DATA_KEY=your-personal-paper-key
ALPACA_DATA_SECRET=your-personal-paper-secret
```

Then restart `npm run dev:stack`. Startup should report
`Market data: LIVE from your Alpaca keys`. The navbar badge then shows what the
paper runner is receiving (**Live**, **Idle**, **Market closed**, **Stale data**,
**Disconnected**, **No data**) and where orders fill; hover it for details. Each
run also records the data source it traded on. One-minute strategies need
completed bars; no movement outside market hours is not a setup failure. Test
outside market hours with a [backtest](backtesting.md).

Free keys stream the IEX feed (a few percent of market volume), while backtests
use the full SIP feed, so paper and backtest results differ somewhat.

| Setting | How `dev:stack` handles it |
|---|---|
| Data keys | Reads shell or `backend/.env`; falls back to trading-key values for data use |
| `LOCAL_STREAM_DATA=0` | Reads shell or `backend/.env`; turns the paper runner's live stream off (Alpaca allows one stream per account) |
| Trading keys and `EXECUTION_TARGET` | Must come from the launching shell to opt into personal paper orders; file values are not forwarded |
| Latency probe flags | Pass through the launching shell where Compose exposes them |
| Supabase URLs/keys and runtime ports | Generated/injected for the local containers by the launcher |
| Other backend `.env` settings | Do not assume they reach Docker; inspect `docker-compose.dev.yml` |

Non-empty shell values take precedence. REST data keys reach the API and worker
even when streaming is off. The launcher checks account identity and withholds
club market-data keys. Protected broker accounts are also checked inside the
runtime. Personal paper execution commands live in
[paper trading](live-paper-trading.md#use-your-personal-alpaca-paper-account-locally).
Keep credentials out of code, frontend variables, screenshots and commits.

If a backtest reports rejected or missing market-data credentials, its
symbol/date range is not fully covered by the local cache. Add personal
`ALPACA_DATA_KEY` and `ALPACA_DATA_SECRET` to `backend/.env`, stop the running
launcher, and rerun `npm run dev:stack` so the worker receives them. Restarting
only the worker does not inject newly edited `.env` credentials. Alternatively,
seed that exact symbol/date range from the hosted cache as described below. An
Alpaca `401` means the supplied data credentials were rejected; signing into
the app again does not resolve it. Fully cached historical ranges work without
Alpaca keys.

### Seeding cached bars

Backtests fetch missing bars from Alpaca with your keys and cache them. To
backtest without keys (or to avoid the download), `data:pull` copies bars
already cached by the hosted platform into your local Supabase cache. It never calls Alpaca. Obtain the hosted API base and a member
session/access details from your lead; the requested range must exist there.

The command runs **from `backend/`**, not the repo root. Supply these variables
to that process (shell values, or your gitignored `backend/.env`):

| Variable | Value |
|---|---|
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Your local target project; use the launcher's actual ports/keys, not hosted production credentials |
| `HOSTED_API_URL` | Hosted API base ending in `/api` |
| `HOSTED_API_TOKEN` | Member access token; alternatively use the four login settings below |
| `HOSTED_SUPABASE_URL`, `HOSTED_SUPABASE_ANON_KEY`, `HOSTED_EMAIL`, `HOSTED_PASSWORD` | Alternative way for the tool to sign in to the hosted source |

The Docker launcher injects local Supabase credentials into containers; it does
not automatically configure a separately launched host-side data-pull process.
Find the local project's keys in Supabase Studio/CLI status for the running
workdir (the remapped workdir, when used, is `.local/supabase-workdir`).

```text
cd backend
npm run data:pull -- --symbols SPY,AAPL --from 2026-10-01 --to 2026-10-07
```

Backtests over the seeded symbols and dates then run from the cache. Cached bars
feed backtests only; the paper runner always trades live data.

SPY/AAPL are the course reference's default symbols. Seed SPY/QQQ instead for
the default pairs strategy, or supply the symbols in your own configuration.

## Ports, data safety, and troubleshooting

The launcher tries Supabase's default block (54321...) then alternative free
blocks (44321..., 34321..., 24321...). It generates a remapped config under
`.local/supabase-workdir/` rather than modifying `supabase/config.toml`.
An already-running project retains its ports.

Database identity is the Docker volume `supabase_db_<project_id>`, not its port.
Startup compares row counts with the prior run, refuses unexpected data loss or
a missing volume, and writes a safety copy under `.local/backups/` (newest three
retained). Follow the reported backup path for recovery; do not bypass a refusal
without understanding the missing state.

For restoration, stop app services and restore into the intended local database
container with `psql`, following the backup format. Avoid shell redirection
examples from another shell/OS. `npm run dev:stack -- --fresh` explicitly accepts
an empty database; it is not a recovery command.

| Symptom | Check |
|---|---|
| Docker cannot connect | Start Docker Desktop and wait for its engine; run `docker info` |
| Missing `dev:stack` script | Terminal must be at repo root |
| Cannot sign in | Run `doctor`; check launcher bootstrap and actual Supabase addresses |
| Stream connection limit | Stop other clients using the same personal data account |
| Badge shows **No data** | Add your own Alpaca data keys to `backend/.env` and relaunch |
| Backtest fails: "Alpaca rejected the data request" | No usable data keys and the range is not cached: add keys, or seed it with `data:pull` |
| Changed `.env` has no effect | Check forwarding table above; relaunch/recreate services after changing container environment |

## Database boundaries

`supabase/migrations/` is the schema source of truth. Add append-only migrations;
do not bootstrap by pasting old table DDL from a guide. Each engineer owns an
isolated local database; it is not a source for production state. Shared
deployment migrations and credentials are managed through
[deployment](deployment.md).

## Membership

Activation procedures live in [paper trading](live-paper-trading.md#membership).
The local bootstrap account is an exception for this development stack, not a
hosted-user provisioning method.

## Paper and live lifecycle

Use [paper trading](live-paper-trading.md) for saved versions, starts/stops,
sandbox limits, and the separately gated real-money workflow.

## Reset or stop

```text
npm run dev:down
```

To deliberately destroy/rebuild the local database, use `npm run dev:reset`.
It reapplies migrations and seed data and recreates the local lead. This is a
destructive local-development action, not routine startup or a production tool.
