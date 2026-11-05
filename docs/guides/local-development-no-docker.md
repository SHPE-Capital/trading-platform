# Local development without Docker

Use this alternative when Docker is unavailable. It replaces local Supabase
containers with **your own hosted development project**, and runs app processes
directly with Node. Keep that project separate from staging/production.
Common tool installation is in [local development](local-development.md#prerequisites).
You need Git, Node.js 22+, and a Supabase project; Docker and its launcher are
not used in this path.

## 1. Install dependencies and create environment files

Clone/open the repository. From the repo root, install each package:

```text
npm --prefix backend install
npm --prefix frontend install
```

Using your editor, copy `backend/.env.example` to `backend/.env`, and
`frontend/.env.example` to `frontend/.env.local` if they do not already exist.
Skip `npm run setup`, whose prerequisite check expects Docker. Root Supabase CLI
installation is not needed for this path.

## 2. Configure your development database

From your hosted Supabase project, obtain the project URL, anon key, service-role
key, and Postgres session-pooler connection string with your database password.
Set in `backend/.env`:

```dotenv
SUPABASE_URL=https://your-development-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
DATABASE_URL=your-postgres-session-pooler-connection-string
EXECUTION_TARGET=sim
STRATEGY_POLICY_PROFILE=development
APP_RUNTIME_ORIGIN=local-personal
```

Keep the same origin across this API, worker and paper runner. It scopes queued
jobs and run adoption; use a distinct origin if several personal environments
share one development project. `NODE_ENV` alone does not enable experimental
strategies; see [strategy policy](../architecture/strategy-policy.md).

If you use `DATABASE_CA_CERT`, supply the downloaded database root certificate
as required by the migration tool. Run from `backend/`:

```text
npm run db:migrate
npm run db:status
```

This applies `supabase/migrations/` through the repository's Node migration
runner, using `DATABASE_URL`. It does not require Docker or Supabase CLI.

## 3. Configure frontend authentication

Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` in
`frontend/.env.local` to this project's values. Never expose the service-role
key to the frontend. Keep the API URL defaults for local ports 8080/8082.

In Supabase authentication URL settings, allow the local app URL and redirects.
Create/invite your user through Supabase's user administration; the app has a
login screen, not a dedicated sign-up page. On your own development project,
activate your profile and grant yourself the lead role if needed:

```sql
update public.app_users
set membership_status = 'active', role = 'lead'
where email = 'you@example.com';
```

Unlike Docker bootstrap, this path does not create `lead@local.test`. Hosted
invitation/password procedures are in [deployment onboarding](deployment.md#supabase).

## 4. Start processes

Open four terminals. Start each command from the indicated package directory:

| Directory | Command | Purpose |
|---|---|---|
| `backend/` | `npm run dev:paper-trading` | Paper/sim runner on :8080 |
| `backend/` | `npm run dev:api` | API/backtests on :8082 |
| `backend/` | `npm run dev:worker` | Queued backtest execution |
| `frontend/` | `npm run dev` | App on :3000 |

Open http://localhost:3000 and sign in with your hosted development account.
Use these explicit commands rather than backend `npm run dev`, which also
launches the gated real-trading entry point. Stop each process with Ctrl+C.

## Market data and execution

Direct processes read `backend/.env`. There is **no Docker launcher filtering**
or `LOCAL_STREAM_DATA` switch on this path:

- With no data or trading credentials, a trading runner receives no market data
  and refuses to start strategies. Backtests can still run over seeded bars: see
  [data-pull instructions](local-development.md#seeding-cached-bars),
  substituting its hosted-development Supabase credentials for the local target.
- With personal `ALPACA_DATA_KEY` and `ALPACA_DATA_SECRET`, the runner streams
  live data and backtests can fetch historical bars. Keep `EXECUTION_TARGET=sim`
  to fill locally. Data credentials fall back to trading credentials only when
  the data variables are absent; empty template values do not trigger that fallback.
- To send personal paper orders, set `EXECUTION_TARGET=alpaca-paper`,
  `ALPACA_TRADING_MODE=paper`, and personal `ALPACA_API_KEY`/`ALPACA_API_SECRET`
  in this process's environment. Set the data-key fields to the same personal
  credentials as well, or remove the data-variable lines to allow fallback.
  Restart affected processes.

Broker preflight still refuses protected accounts outside their permitted
origin. Environment-file keys are gitignored; do not share them in code.

For managing runs, continue with [paper trading](live-paper-trading.md).
Docker volume backups, automatic port selection, `doctor`, and `dev:reset`
belong to the Docker path and do not manage this hosted project.
