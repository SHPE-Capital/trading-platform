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
npm install
npm run dev:stack
```

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

Without Alpaca credentials the stack boots with local placeholders, but calls
that need Alpaca data or order execution will fail. Set `ALPACA_API_KEY` and
`ALPACA_API_SECRET` in your shell before starting for end-to-end paper testing.

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
- Keep Alpaca paper trading as the shared integration environment. Backtests
  already supply the deterministic clock and simulated execution needed for
  reproducible research; duplicating a second paper broker would add another
  execution model to reconcile without replacing broker-level validation.

## Reset or stop

```bash
npm run dev:reset
npm run dev:down
```

Reset destroys only the local Supabase database, reapplies migrations and seed,
and recreates the local lead. Never point these commands at a remote project.
