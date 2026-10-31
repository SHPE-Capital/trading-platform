# Paper and real-money trading

This guide owns the workflow for launching and managing runs. Installation,
local ports/login, and environment forwarding live in
[local development](local-development.md). Component behavior lives in
[system architecture](../architecture/design.md).

## Choose where orders go

| Target | Where orders execute | Runtime |
|---|---|---|
| `sim` | Local simulated book | `paper-trading.ts` (default) |
| `alpaca-paper` | Your selected Alpaca paper account | `paper-trading.ts` |
| `alpaca-live` | Alpaca real-money account | Separately gated `real-trading.ts` |

Paper is a runtime mode; it can use a local simulator or a broker paper account.
A local simulated order will not appear in Alpaca's dashboard.

## Use your personal Alpaca paper account locally

Get keys from your personal Alpaca **Paper Trading** account. The club account
is protected and refused outside its permitted runtime origin. Use matching
personal account credentials for market data and orders.

For Docker `dev:stack`, set trading credentials and target in the shell that
launches the stack. File-only trading settings in `backend/.env` are not forwarded.

**PowerShell, from the repo root:**

```powershell
$env:EXECUTION_TARGET = "alpaca-paper"
$env:ALPACA_API_KEY = "your-personal-paper-key"
$env:ALPACA_API_SECRET = "your-personal-paper-secret"
npm run dev:stack
```

**bash/zsh, from the repo root:**

```bash
export EXECUTION_TARGET=alpaca-paper
export ALPACA_API_KEY="your-personal-paper-key"
export ALPACA_API_SECRET="your-personal-paper-secret"
npm run dev:stack
```

Shell assignments containing secrets can remain in terminal history. Do not
commit credentials. If a previous stack is running, stop it before relaunching
with changed variables. To return to the simulator, set the shell's target to
`sim` and relaunch. Direct Node processes instead read `backend/.env`; see
[the no-Docker guide](local-development-no-docker.md#market-data-and-execution).

## Membership

Authentication alone does not grant application access. New `app_users` profiles
start `pending`. Local Docker bootstrap activates its built-in lead; hosted
projects need an administrator to verify and activate members.

In the intended project's SQL editor, activate a verified member:

```sql
update public.app_users
set membership_status = 'active'
where email = 'member@example.com';
```

Use `suspended` to revoke access without deleting history. Lead invitations and
role assignment belong to [deployment onboarding](deployment.md#supabase).

## Save, start, observe, stop

1. Sign in and open **Strategies**. Choose a type eligible in this runtime.
   [Strategy policy](../architecture/strategy-policy.md) defines release/profile
   eligibility; local development can launch eligible experimental strategies.
2. Save a named configuration. Subsequent changes create immutable versions with
   a change note. Select the version to run.
3. Start the selected version on paper. Members start their own configurations;
   leads can also start another member's configuration. A run records its owner,
   configuration version, algorithm version, build, origin, budget and expiry.
4. Inspect the run page's signal funnel, orders/fills, runner events and
   performance. For broker paper execution, compare the Alpaca paper dashboard.
5. Stop the run when finished. **Stopping evaluation does not automatically
   flatten its positions or prove working broker orders were canceled.** Inspect
   remaining holdings/orders and manage them explicitly. Drift reports identify
   holdings left by stopped runs.

Default sandbox limits are 2 active paper runs per member, a 5% capital cap, and
a 24-hour TTL; see the `SANDBOX_*` settings in `backend/.env.example`. Effective
settings depend on the runtime environment, not just the strategy's form values.

Restarts can adopt persisted running runs after lease recovery. The run uses
current algorithm code plus its saved configuration. Optional warm-up hooks
rebuild rolling history; arbitrary private strategy state is not persisted.

## API integration

Use the trading runner's API base (local `http://localhost:8080/api`) with a
Supabase bearer token and active membership. The control-plane API cannot
activate a strategy without a runner context.

| Request | Purpose |
|---|---|
| `GET /strategies/configs/types` | Definitions and allowed actions for forms/pickers |
| `POST /strategies/configs` | Create `{ strategy_type, name, config }` and its first version |
| `PUT /strategies/configs/:configId` | Save `{ name, config, changeSummary }` as a new configuration version |
| `POST /strategies/start` | Start `{ strategyId, versionId }`; no inline/ad-hoc strategy launch |
| `GET /strategies` or `/strategies/:runId` | Run records and whether this runner holds them (`isLive`) |
| `POST /strategies/:runId/stop` | Stop a run, subject to ownership/lead checks |

For account truth, attribution and run-report endpoints, use
[broker ledger](../architecture/broker-ledger.md). If a run is silent or blocked,
follow [strategy troubleshooting](troubleshooting-strategies.md).

## Real-money boundary

Self-service starts are paper-only. Real-money runs require the existing proposal
and lead-approval workflow on the separately configured live API. Lifecycle must
be `ready`, including under the development profile.

`runtime/real-trading.ts` requires **all three** startup gates:
`EXECUTION_TARGET=alpaca-live`, `ALPACA_TRADING_MODE=live`, and
`ENABLE_LIVE_TRADING=true`. Account preflight still applies. Setting only a live
URL or trading mode does not start a live runtime. The default local and
production Compose stacks omit this service; deployment of it is a separate
operational change, not part of `npm run dev:stack`.
