# Agent brief: reuse across runs and strategies (B7, D6b, D9)

Suggested agents: **one `feature-implementer` per task**, in this order: B7, then D6b (needs the
cache keys from B7), then D9 (needs both). Owner: Person 2 (D6 owner coordinates with Person 1,
whose stand-in cache is on research-python branch `p1/MO-D6-bench`). Repo: **research-python**.
Full packets: B7 in [../../momentum-tasks-B-signals.md](../../momentum-tasks-B-signals.md); D6b and
D9 in [../../momentum-tasks-D-calibration.md](../../momentum-tasks-D-calibration.md). Context and
cost model: [../multi-strategy-and-benchmark-changes.md](../multi-strategy-and-benchmark-changes.md).

Follow the shared rules in [../README.md](../README.md): one task, one branch, one worktree
(`<name>/MO-<ID>`); exclusive Owns lists; stage your own files by path (no `git stash`, no
`git add -A`); every tunable comes from the protocol config (0-G); no broker calls or data pulls;
never claim a check passed without seeing it run. End with: what changed (files), verification
and results, unresolved risks.

## Goal
Compute each expensive thing once. The first benchmarks suggested the cold indicator build was the
cost floor, but a harness bug (the kernel's per-panel preparation redone for every config and chunk,
10 to 15 times too slow) explained the measured cost, so **B7's value is unproven until the corrected
rerun**. Start with whatever the corrected benchmark shows is largest. At N = 1,000 over 10 years with
several strategies, reuse is what makes the calibration fit the calendar.

## The cache-key spec (all three tasks use this; keep it in `calibration/keys.py`)

A reused result is correct only if **every** input that can change it is in its key. A missing
field is a silent wrong answer, so each key lists its fields explicitly and has a test that
changes each field and expects a miss.

| Layer | Key fields |
|---|---|
| Panel chunk id | data version, universe schedule version, week start, hash of the chunk's asset IDs, calendar version, dtype |
| Indicator array | panel chunk id, warm-up prefix length (sessions), indicator name, parameters, code version of `features/momentum` |
| Signal array | the indicator keys it reads, threshold parameters, readiness rule version |
| Mask (final) | `mask_hash` = SHA-256 over the packed final boolean mask **and** the ATR array key (ATR changes sizing and exits) |
| Return path (D6) | context (data version, universe version, execution model, `account_hash`, code version, warm-up length) + chunk + `mask_hash`; a `config_id` alias table maps each config to its mask hash for audit |

Strategy rules: indicator and panel keys contain **no** strategy id, so strategies share them.
Return paths are keyed by `mask_hash`, so identical masks share them across configs and across
strategies **only when the account settings are identical**. `config_id` stays in the audit trail.
Reuse never crosses a different universe or N (stocks compete for cash), different exits, sizing,
costs or code version. Weights are never in a key. A chunk at or after the cutoff is never read when
selecting at that cutoff (D6 guard stays).

## Tasks
- **B7** persisted indicator store: save indicator and signal arrays per week chunk as `.npy`
  beside the panel chunk, memory-mapped read-only, compute-and-write on a miss, process-pool cold
  builds across chunks. Hit and miss counters per layer.
- **D6b** mask-hash deduplication and optional per-session keys on top of the D6 cache: compute
  `mask_hash` per (config, chunk) before replay; replay only unseen hashes; alias the rest. Keep
  chunk keys by default; per-session keys are a switch, because positions are flat every night.
- **D9** strategy registry and chunk-major scheduler (see the D packet): several strategies with
  their own grids share one panel, one indicator store and one return cache.

## Rules
- Reused output must be **byte-identical** to recomputed output: a test replays both ways and
  compares bytes, for indicators, masks and return paths.
- Warm-up prefix length is part of the key or the code version, because recursive indicators carry
  state across sessions.
- Tamper test: change one input bar, expect a new panel chunk id and a miss at every layer above.
- Counters are part of the contract: E1 reads hits, misses, new chunks and bytes per layer.
- Numba is already in; keep the NumPy reference path selectable.

## Verify
`uv run pytest tests/unit/calibration tests/unit/strategies tests/unit/features -q`, `uv run ruff check`,
`uv run lint-imports`. Measure and report: seconds for a cold versus warm chunk build at N = 300,
disk bytes per chunk for the indicator store, RSS per worker with and without memory-mapping, and the
mask-hash hit rate on 1,000 random configs. Do not run large timing sweeps while other benchmarks run.
