# Local development

The complete local environment uses the official Supabase CLI for Supabase's
containers and Docker Compose for the application processes. This keeps the
database/auth stack aligned with Supabase releases without copying its internal
Compose file into this repository.

## Prerequisites

- Node.js 22+
- Docker Desktop (or a Docker-compatible engine)
- Optional Alpaca paper credentials for live market-data and order testing

## First start

```bash
npm install        # repo root (not backend/ or frontend/)
npm run setup      # one-time and idempotent: deps, env files, prerequisite check
npm run dev:stack
```

Run all `npm run` commands below from the repo root. Docker Desktop must be
running first.

The command starts local Supabase, applies every migration, provisions a local
active lead, and starts the frontend, API, paper runner, and one backtest worker.
Source directories are bind-mounted, so the Next.js and Node processes reload
as files change. Dependencies remain in Docker volumes instead of being copied
between host and Linux installations.

- App: http://localhost:3000
- API: http://localhost:8082
- Paper runner: http://localhost:8080
- Supabase Studio: http://localhost:54323
- Local login: `lead@local.test` / `local-development-only`

Local runners never trade the club's Alpaca account. The paper runner starts
with `EXECUTION_TARGET=sim`: orders fill locally against market data and are
recorded in your local Supabase, which acts as the sim broker's ledger.

| You have | Set in your shell before `npm run dev:stack` | What happens |
|---|---|---|
| Nothing | — | Sim book, replaying cached bars. Seed them with `npm run data:pull` (below). |
| Free Alpaca account (data only) | `ALPACA_DATA_KEY`, `ALPACA_DATA_SECRET` | Sim book on live IEX bars. |
| Your own Alpaca paper account | `EXECUTION_TARGET=alpaca-paper`, `ALPACA_API_KEY`, `ALPACA_API_SECRET` | Orders go to **your** paper account and sync into your local Supabase. |

The club account is listed in `backend/src/config/protectedAccounts.ts`; a
runner that resolves to it from any origin other than `aws-prod` exits at boot
with the reason. Your own account registers itself in the local
`broker_accounts` table the first time it boots.

### Seeding replay data

`npm run data:pull` copies bars from the club's hosted bar cache into your
local one. It reads only what backtests have already cached there and never
calls Alpaca:

```bash
cd backend
HOSTED_API_URL=https://<hosted-api>/api \
HOSTED_SUPABASE_URL=... HOSTED_SUPABASE_ANON_KEY=... \
HOSTED_EMAIL=you@ufl.edu HOSTED_PASSWORD=... \
SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_SERVICE_ROLE_KEY=<local key> \
npm run data:pull -- --symbols SPY,QQQ --from 2026-10-01 --to 2026-10-07
```

Then start the stack with `REPLAY_FROM=2026-10-06 REPLAY_TO=2026-10-07` (and
optionally `REPLAY_SPEED=10`).

## Ports, data safety, and troubleshooting

`dev:stack` tries Supabase's default ports (54321...) first. If any are
unavailable (Windows/Hyper-V reserves ranges there, or another project uses
them) it picks the next free block (44321..., 34321..., 24321...). The repo's
`supabase/config.toml` is never edited; a remapped copy is generated in the
gitignored `.local/supabase-workdir/`, and the same ports are passed to the
app containers.

**Your data does not depend on ports.** The database lives in the Docker volume
`supabase_db_<project_id>`, so moving ports reuses it. `dev:stack` also:

- never moves a Supabase that is already running (it reuses its ports);
- applies pending migrations to an existing database;
- compares row counts with the last run and **refuses to start** if users or
  strategies went missing, or if the volume vanished (Docker reset or
  `docker volume prune`), printing the newest safety copy;
- writes a safety copy of the whole database to `.local/backups/` on every
  start (newest three kept). Restore one with
  `docker exec -i supabase_db_<project_id> psql -U postgres -d postgres < <file>`;
- `npm run dev:stack -- --fresh` accepts an empty database on purpose.

`npm run doctor` is a read-only health report: Node, Docker, ports, volume,
migrations, data counts, login, and the app containers.

| Symptom | Fix |
|---|---|
| `Docker is not running` | Start Docker Desktop, wait for "Engine running", check `docker info` |
| `Missing script: "dev:stack"` | You are in `backend/` or `frontend/`; run from the repo root |
| No free port block | See `netsh interface ipv4 show excludedportrange protocol=tcp`; `net stop winnat` then `net start winnat` (admin) |
| Cannot sign in | `npm run dev:stack` re-creates `lead@local.test`; check `frontend/.env*` does not override the Supabase URL |
| Backend edits not picked up (Windows) | Bind mounts do not trigger nodemon; `docker restart shpe-trading-dev-<service>-1` |
| `npm audit` warnings | Dev-tooling only; do not run `npm audit fix --force` |

## Database boundaries

- Every engineer runs an isolated local Supabase database. Local data is
  disposable and must never be used as a source for production state.
- `supabase/migrations/` is the schema source of truth. Add an append-only
  migration for every schema change, reset locally, and review it with the code.
- Staging and production use separate Supabase projects and credentials. The
  app containers receive only the project for their environment through secrets.
- Backtest jobs and summarized results live in Postgres. If result payloads or
  market datasets become large, put those blobs in object storage and retain
  their immutable URI/checksum in Postgres rather than scaling the control
  database as a file store.

For this team size, managed Supabase is the default deployment recommendation.
Self-hosting Supabase on one EC2 instance creates a database, backups, upgrades,
TLS, email/auth, and incident-response burden on the engineering team. Only
self-host it when there is a concrete compliance or network requirement and a
named owner for those operations. The workers and API can still run on EC2/ECS
while using managed Supabase.

## Membership

Creating a Supabase login does not grant application access. New profiles start
as `pending`; a lead activates known members in the `app_users` table. When the
membership migration first reaches an existing environment, existing leads stay
active and existing member accounts become pending for one-time verification.
For local development the bootstrap script activates the built-in lead automatically.

For a deployed environment, activate an invited member through Supabase Studio
or a controlled admin migration/query:

```sql
update public.app_users
set membership_status = 'active'
where email = 'member@example.com';
```

Use `suspended` to revoke application access without deleting the member's
authorship and audit history. Membership gates access; it does not add a second
approval step to paper launches.

## Paper and live lifecycle

- Any active member can start their own saved strategy version on paper.
- Each paper run records its exact strategy version, build SHA, runtime origin,
  owner, start time, and expiry. Capital, concurrent-run, and TTL limits bound
  the shared paper environment.
- Promotion to real money remains a separate proposal reviewed by a lead and is
  accepted only by the live runtime. The frontend sends approval to the
  separately configured `NEXT_PUBLIC_LIVE_API_BASE_URL`; the default local
  stack deliberately does not launch a real-money runtime.
- The club's Alpaca paper account is the shared book, traded only by the
  `aws-prod` runtime. Everyone else tests in a sim book or on their own Alpaca
  paper account, so a local experiment can never move the club's positions.

## Reset or stop

```bash
npm run dev:reset
npm run dev:down
```

Reset destroys only the local Supabase database, reapplies migrations and seed,
and recreates the local lead. Never point these commands at a remote project.
