# Agent brief: data and universe (stream A)

Suggested agent: `general-purpose` or `feature-implementer`; A1, A2 and A3 can run as separate agents. Owner: Person 2. Repo: **research-python**.
Full packets: [../../momentum-tasks-A-data.md](../../momentum-tasks-A-data.md).

Follow the shared rules in [../README.md](../README.md): one task, one branch, one worktree (`<name>/MO-<ID>`); exclusive Owns lists; stage your own files by path (no `git stash`, no `git add -A`); every tunable comes from the protocol config (0-G); never claim a check passed without seeing it run. End with: what changed (files), verification and results, unresolved risks.

## Tasks
1. **A1 archive audit and pull.** Start with a **two-year pilot**; size follows 0-F (recommended N 500 to 1,000, 5 to 10 years, pool about 3 times N, includes delisted names). Use the SIP feed for research. **Measure the real rate limit and bars per request.** Before the big pull, **shard or replace the JSON manifest** in `data/store.py` (it rewrites everything every 20 units) and check free disk. Pulls must be resumable. Needs Alpaca data keys in `.env`; do not commit them.
2. **A2** missing-bar classification, **A3** corporate actions and stable asset IDs.
3. **A4** weekly eligibility screen, **A5** weekly universe schedule (extend the config-driven `data/universe.py`), **A7** market descriptors.
4. **A6** memory-mappable panel loader, **needed early by Person 1's E1**. Build per week chunk; 1,000 stocks by 10 years is about 20 GB, more than this machine's RAM.

## Do not
Put data in the repo, or read the reserved period. Run data pulls only as the task states.

## Verify
`uv run pytest`, `uv run ruff check`, plus the future-bar tamper test for A4.
