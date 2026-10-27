# Documentation

Start with the task index in [guides](guides/README.md) or the component overview
in [system architecture](architecture/design.md).

| Area | Purpose |
|---|---|
| [Guides](guides/README.md) | Current setup, development, experiments, trading, troubleshooting and deployment procedures |
| [Architecture](architecture/design.md) | Current process boundaries and links to risk, OMS, sizing, execution, backtest semantics, strategy policy and broker ledger |
| [Strategies](strategies/overview.md) | Strategy-specific models and explanations; implementation workflow is [adding a strategy](guides/adding-a-strategy.md) |
| [Course](course/README.md) | Separate beginner teaching material; may repeat guide content |
| [History](history/) | Dated findings and [archived implementation plans](history/implementation-plans/README.md); not maintained as operating instructions |

## Repository layout

```text
backend/    TypeScript API, trading runners, historical worker, and tests
frontend/   Next.js App Router frontend and Vitest suites
supabase/   Local project configuration and authoritative schema migrations
docker/     Local development and built-image Compose stacks
deploy/     Production Compose/Caddy files and server environment template
scripts/    Local stack/setup/doctor tooling and strategy-version checks
```

For installation and local credentials, use [local development](guides/local-development.md).
For latency commands and measurement caveats, use
[the benchmark runbook](guides/latency-benchmark.md). Earlier proposals and
[the 2026-10-12 audit](history/latency-audit-2026-10-12.md) are historical evidence,
not claims about current performance.
