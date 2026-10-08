# Documentation

| Folder | What's in it |
|---|---|
| [guides/](guides/) | How to do things: [local development](guides/local-development.md), [deployment](guides/deployment.md), [backtesting](guides/backtesting.md), [replay](guides/replay.md), [live paper trading](guides/live-paper-trading.md), [testing](guides/testing.md), [member instructions](guides/member-instructions.md) |
| [architecture/](architecture/) | How it is built: [system design](architecture/design.md) and the risk, OMS, sizing, execution and broker-ledger layers |
| [strategies/](strategies/) | [Strategy overview](strategies/overview.md) and per-strategy write-ups |
| [history/](history/) | Point-in-time handoffs and PR summaries. Accurate when written, not kept current |

## Repository layout

```
backend/    services and their Dockerfile, nodemon configs in backend/config/nodemon/
frontend/   Next.js app and its Dockerfile
supabase/   local Supabase config, migrations, seed
docker/     docker-compose.dev.yml (hot reload), docker-compose.local.yml (built images)
deploy/     docker-compose.prod.yml, Caddyfile, server.env.example (copied to EC2 by CI)
scripts/    local-stack.mjs (npm run dev:stack), check-strategy-versions.mjs
```

Rules of thumb: a Dockerfile lives next to the app it builds; Compose files live in
`docker/` (local) or `deploy/` (production); tool configs that must sit at a package
root (tsconfig, jest, eslint) stay there; everything else goes in a subfolder.
