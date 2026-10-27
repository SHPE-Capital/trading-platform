# Before the lesson: set up your local environment

Do this once before [building your first strategy](lesson-steps.md). You will
download the repository, start your own local app and database, and connect your
own Alpaca paper keys for market data. The default setup fills orders locally;
an optional step below sends orders to your personal Alpaca paper account.

## 1. Install the tools

| Tool | Download | What you need it for |
|---|---|---|
| Git | [Git downloads](https://git-scm.com/downloads) | Downloads the repository and tracks code changes. On Windows, allow Git to be used from the command line during installation. |
| Node.js | [Node.js downloads](https://nodejs.org/en/download) | Install an LTS release, version **22 or newer**. It includes `npm`, which installs dependencies and runs the project commands. |
| Docker Desktop | [Docker Desktop](https://www.docker.com/products/docker-desktop/) | Runs the local database and application services. Complete its setup, restart if prompted, and leave Docker Desktop running. |

Use an editor such as [VS Code](https://code.visualstudio.com/) to edit the
strategy and configuration files. If you cannot run Docker on your laptop,
follow the [no-Docker setup](../guides/local-development-no-docker.md) instead.

Open a **new terminal** after installing: PowerShell on Windows, or Terminal on
macOS/Linux. Run each command separately:

```text
git --version
node --version
npm --version
docker --version
docker info
```

**Check it:** each version command prints a version, Node is at least `v22`, and
`docker info` connects to the running engine. If a command is not recognized,
reopen the terminal; if Docker cannot connect, open Docker Desktop and wait for
its engine to finish starting. On Windows, if PowerShell blocks `npm.ps1`, use
`npm.cmd` wherever this guide says `npm`.

## 2. Download and prepare the repository

In your terminal, navigate to the folder where you keep projects, then run:

```text
git clone https://github.com/SHPE-Capital/trading-platform.git
cd trading-platform
npm install
npm run setup
```

If GitHub refuses access, sign in with the GitHub account that has repository
access and ask a lead to check your invitation. If you already have the repo,
open its folder instead of cloning a second copy.

The **repo root** is the `trading-platform` folder containing `backend`,
`frontend`, and `package.json`. Run the commands in this setup guide from there
unless a step explicitly says otherwise.

`npm install` installs the project's pinned Supabase CLI. `npm run setup`
installs the backend/frontend dependencies, creates `backend/.env` and
`frontend/.env.local` from templates, and checks prerequisites. It preserves
existing environment files.

**Check it:** setup finishes successfully. Resolve any prerequisite failures
before continuing. You do not need to install Supabase separately or create a
hosted Supabase project for this Docker setup.

## 3. Get your own Alpaca paper keys

1. Create or sign in to your account at [Alpaca](https://app.alpaca.markets/).
2. Select your **Paper Trading** account, then find its **API Keys** panel.
3. Generate a key pair and save both the **Key ID** and **Secret Key** securely.
   If you lose the secret, generate a replacement pair.

Use the Trading API paper account described in
[Alpaca's paper-trading guide](https://docs.alpaca.markets/us/docs/paper-trading).
Paper and live credentials are separate. This lesson uses your own paper keys,
not the club's shared account. A paper-only account provides IEX market data,
which is the feed this repo uses by default.

## 4. Connect market data to the local simulator

Open `backend/.env` in your editor and fill in the existing data-key lines:

```dotenv
ALPACA_DATA_KEY=replace_with_your_paper_key_id
ALPACA_DATA_SECRET=replace_with_your_paper_secret
```

These keys are required: without them the paper runner receives no market data
and the app refuses to start strategies.

Replace the placeholders with your actual values. Keep
`ALPACA_TRADING_MODE=paper` and `EXECUTION_TARGET=sim` as provided by the template.
For this path, leave the trading-key fields (`ALPACA_API_KEY` and
`ALPACA_API_SECRET`) empty and do not set trading overrides in your shell.

These data keys allow the local runner to receive live prices. Orders fill in
the **local simulator**, so they appear in the local app, not in Alpaca's orders
page. The default Docker execution target is `sim`; the file's
`EXECUTION_TARGET` value is not forwarded by the launcher.

Keep secrets in `backend/.env`, which Git ignores. Do not put them in strategy
code, the frontend, screenshots, or commits. The launcher checks the account and
withholds market-data keys belonging to the club's protected account.

## 5. Start the app and sign in

With Docker Desktop running, run from the repo root:

```text
npm run dev:stack
```

The first start downloads/builds containers and can take several minutes. The
launcher configures local Supabase, applies migrations, creates a local login,
and starts the app services. It supplies the local database URLs and keys; you
do not need to fill those in manually for Docker.

Open **http://localhost:3000** and sign in with:

- Email: `lead@local.test`
- Password: `local-development-only`

Keep the stack terminal open. In a second terminal at the repo root, run:

```text
npm run doctor
```

**Check it:** the app loads, you can sign in, and the startup output reports
`Market data: LIVE from your Alpaca keys`. The navbar badge shows where data
comes from: **Live · IEX** while bars arrive, **Idle** until a strategy subscribes
to symbols, **Market closed** outside trading hours, and **No data** when the
runner has no keys. Hover it for details. A one-minute strategy needs two
distinct bars before it can compare closes.

Outside market hours the live stream is quiet, so test the strategy with a
**backtest** instead: open **Backtest**, pick your strategy, and choose a past
week. Backtests use the same strategy code on historical bars, with a simulated
clock.

## Optional: send orders to your own Alpaca paper account

Use this when you want trades to appear on **your Alpaca paper dashboard**.
The simulator above is enough for learning the strategy interface.

Stop the stack with Ctrl+C if it is running. In the same terminal you will use
to restart it, set the following variables. Replace the key placeholders with
your personal paper credentials.

**Windows PowerShell:**

```powershell
$env:EXECUTION_TARGET = "alpaca-paper"
$env:ALPACA_API_KEY = "replace_with_your_paper_key_id"
$env:ALPACA_API_SECRET = "replace_with_your_paper_secret"
npm run dev:stack
```

**macOS/Linux (bash or zsh):**

```bash
export EXECUTION_TARGET=alpaca-paper
export ALPACA_API_KEY="replace_with_your_paper_key_id"
export ALPACA_API_SECRET="replace_with_your_paper_secret"
npm run dev:stack
```

Use the same account for the data keys in `backend/.env` and the trading keys
above. The launcher can fall back to trading keys for data if the data-key
fields are empty. Trading keys and `EXECUTION_TARGET` must be set in the shell
for `dev:stack`; putting only those values in `backend/.env` does not enable
Alpaca paper execution. These shell settings apply to this terminal session,
and commands containing credentials may be retained in its history.

**Check it:** the runner connects to your personal paper account. Once you
launch a strategy that produces an accepted order, inspect its order status in
both the local app and your Alpaca paper dashboard. A signal alone does not
guarantee a fill.

To return to local simulation, stop the stack, set `EXECUTION_TARGET` to `sim`
in that shell, and rerun `npm run dev:stack`.

## Common setup problems

| Symptom | What to check |
|---|---|
| `Missing script: dev:stack` | Run from the repo root, not `backend/` or `frontend/`. |
| Alpaca authentication fails | Check both halves of the key pair, that they belong to your paper account, and whether you regenerated them. Restart after changing keys. |
| `406 connection limit exceeded` | Another process may be using your account's market-data stream. Stop it before reconnecting this runner. |
| Strategy runs but does nothing | Check market hours, incoming bars, the configured symbols, and the runner logs. The first bar is only a baseline; risk checks or the position cap can also block an order. |
| Backend edits do not appear on Windows | Restart the relevant service: `docker compose -f docker/docker-compose.dev.yml restart paper-trading api backtest-worker`. |

For more details, see [local development](../guides/local-development.md) and
[strategy troubleshooting](../guides/troubleshooting-strategies.md).

You are ready to start [Step 1: an empty strategy](lesson-steps.md#step-1-an-empty-strategy).
