# Deployment

Backend on EC2 (Docker, Caddy for TLS), frontend on Vercel, database on Supabase.
Pushing to `main` runs CI; when CI passes, [deploy.yml](../../.github/workflows/deploy.yml)
builds the backend image, pushes it to GHCR tagged with the commit SHA, copies
`deploy/` to the server, pulls the image, restarts, health-checks, and rolls back on
failure. Vercel deploys the frontend on its own from the same push.

## One-time setup

### AWS
1. Allocate an Elastic IP and attach it to the instance.
2. Security group inbound: 22 (your IP only), 80 and 443 (anywhere). Nothing else.
3. Disk of 20 GB or more. Run `uname -m`; if it prints `aarch64`, set the GitHub
   variable `DEPLOY_PLATFORM=linux/arm64`.
4. DNS: A records `api.<domain>` and `paper.<domain>` to the Elastic IP. With no
   domain, use `<ip-with-dashes>.sslip.io` as `DOMAIN` and skip DNS.

### Server (SSH as `ubuntu`)
Docker with the compose plugin installed, then:
```bash
mkdir -p ~/app && cd ~/app
nano .env && chmod 600 .env     # contents: deploy/server.env.example
```
Append the deploy public key to `~/.ssh/authorized_keys`.

### Supabase
- Run migrations from your machine, before the first deploy and after any new migration:
  `cd backend && DATABASE_URL=<session pooler URL> npm run db:migrate`
- Authentication → URL Configuration: Site URL = the Vercel URL; add
  `https://<app>.vercel.app/**` to redirect URLs.

- Onboarding a lead (they choose their own password; you never see it):
  1. Authentication → Users → **Invite user**. The invite creates a `pending` profile.
  2. Promote them: `update app_users set role = 'lead', membership_status = 'active' where email = '…';`
  3. They open the emailed link, which signs them in and lands on `/set-password`.
  4. Later resets go through `/forgot-password`, linked from the sign-in page.
  Invite and recovery links expire quickly; re-invite or use the reset page if one lapses.
  Enable MFA for leads under Authentication → Multi-Factor if you want a second factor.

### GitHub
- Merge into `main` (the workflow only triggers from there).
- Generate a key: `ssh-keygen -t ed25519 -f deploy_key -N ""`. Public half goes on the server.
- Secrets: `EC2_HOST` (Elastic IP), `EC2_SSH_KEY` (private key, including BEGIN/END lines).
- Settings → Actions → General → Workflow permissions: read and write.

### Vercel
Import the repo; Root Directory `frontend`; Production Branch `main`. Environment variables:
```
NEXT_PUBLIC_API_BASE_URL=https://paper.<DOMAIN>/api
NEXT_PUBLIC_BACKTEST_API_BASE_URL=https://api.<DOMAIN>/api
NEXT_PUBLIC_LIVE_API_BASE_URL=https://live.<DOMAIN>/api     # intentionally not served: live actions fail closed
NEXT_PUBLIC_WS_BASE_URL=wss://paper.<DOMAIN>
NEXT_PUBLIC_ENABLE_WEBSOCKET=true
NEXT_PUBLIC_APP_NAME=SHPE Capital Trading Platform
NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key only, never the service-role key>
```
Then put the Vercel URL into the server's `CORS_ORIGIN` and restart the stack.

## Server `.env`
See [deploy/server.env.example](../../deploy/server.env.example). Keep
`EXECUTION_TARGET=sim` until you intentionally move to `alpaca-paper`.

## Operating it
```bash
cd ~/app
dc="docker compose --env-file .deploy.env -f docker-compose.prod.yml"
$dc ps
$dc logs -f paper-trading
$dc up -d            # re-apply after editing .env
```
- First deploy: Actions → Deploy → Run workflow.
- Rollback: re-run Deploy on an older commit.
- Health: `curl https://api.<DOMAIN>/health`, `curl https://paper.<DOMAIN>/health`.
- Trades and events: Supabase tables `orders`, `fills`, `signals`, `risk_rejections`,
  `run_events`, `event_logs`, `portfolio_snapshots`.

## Hardening

TODO: switch the deploy from SSH to GitHub OIDC + AWS SSM Run Command. The current
pipeline needs port 22 open to `0.0.0.0/0` (GitHub-hosted runners have no fixed IPs)
and keeps a long-lived private key in the `EC2_SSH_KEY` secret. Do this before real
money or the club's Alpaca account is involved:

1. Create an IAM OIDC identity provider for `token.actions.githubusercontent.com`.
2. Create a role trusted only by this repo's `main` branch, allowed `ssm:SendCommand`
   on the instance.
3. Attach an instance profile with `AmazonSSMManagedInstanceCore`.
4. In `deploy.yml`, assume the role with `aws-actions/configure-aws-credentials` and
   replace the scp/ssh steps with SSM commands; deliver `deploy/` files via S3 or the image.
5. Close port 22 (use SSM Session Manager for shell access) and delete `EC2_HOST` and
   `EC2_SSH_KEY`.
6. Until then, keep password login off and consider `fail2ban`.

## Troubleshooting
- scp/ssh step fails: malformed `EC2_SSH_KEY` or public key not in `authorized_keys`.
- No certificate: ports 80/443 closed or DNS wrong; check `$dc logs caddy`.
- Login loops or CORS errors: `CORS_ORIGIN` or Supabase redirect URLs don't match the Vercel URL.
