# Guides

Guides explain how to use, develop, and operate the current implementation.
[Architecture](../architecture/design.md) explains the underlying components and
contracts. [Historical plans](../history/implementation-plans/README.md) preserve
earlier proposals; their checklists are not current setup instructions.

| Task | Start here |
|---|---|
| Install and run the local Docker stack | [Local development](local-development.md) |
| Work without Docker | [Local development without Docker](local-development-no-docker.md) |
| Contribute changes | [Member instructions](member-instructions.md) |
| Implement/register a strategy | [Adding a strategy](adding-a-strategy.md) |
| Run historical experiments and save results | [Backtesting](backtesting.md) |
| Start, inspect, and stop a paper run | [Paper and real-money trading](live-paper-trading.md) |
| Choose a replay workflow | [Replay](replay.md) |
| Diagnose missing signals/orders/fills | [Strategy troubleshooting](troubleshooting-strategies.md) |
| Run checks | [Testing](testing.md) |
| Measure processing and order latency | [Latency benchmark](latency-benchmark.md) |
| Deploy and operate the shared stack | [Deployment](deployment.md) |

## Documentation ownership

Keep full instructions in one place and link to them:

- Local development owns tool installation, local ports/login, Docker environment
  forwarding, local data seeding, and database reset/backup procedures.
- The no-Docker guide owns differences for directly run processes and hosted Supabase.
- Trading owns the member run workflow, paper-account opt-in, and membership activation.
- Backtesting owns the UI/API/CLI workflow and saving results. Execution timing,
  fill models, and their limitations belong to architecture.
- Adding a strategy owns the code-edit workflow. Lifecycle/profile eligibility
  belongs to [strategy policy](../architecture/strategy-policy.md).
- Deployment owns shared-host rollout, secrets, hosted onboarding and hardening.
- Architecture pages own component behavior and identify scaffolds explicitly.

The [course](../course/README.md) is a separate teaching area. It may repeat
setup or implementation material without becoming the reference for these guides.
