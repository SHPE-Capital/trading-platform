# Teammate 2: Calibration runs and protocol

Back to [README.md](README.md). Repo: **research-python**. Paths below are under
`src/shpe_research/` unless they start with `scripts/`, `tests/`, `configs/` or `studies/`.

Goal: turn the built calibrator (D1 to D9, `shpe momentum calibrate` and `walkforward`) into
real-data results: a corrected benchmark, development weeks, the **Nov 21 freeze**, and the
reserved run on HiPerGator. You own `config/momentum.py`; other teammates send you field lists.

The study folder is `studies/momentum/rm9-weekly-calibration/` (RM9, because RM1 to RM8 are
the ORB program's IDs).

---

## T2-1 Finish the protocol config (0-G rest)

- **Owns:** `config/momentum.py`, `configs/momentum/protocol.default.yaml`,
  `tests/unit/config/test_momentum_config.py`, and the `TODO(MO-0G-rest)` in
  `calibration/weekly.py`
- **Depends on:** field lists from Teammate 1 (universe, data, eligibility)
- **Work:** add the sections universe, data, eligibility, grid, signals, fill, costs, exit,
  account, bootstrap and quote_replay, with the guide's values as defaults and the 500 × 5 scope
  values from [config-reference.md](config-reference.md). Build `AccountConfig` from the
  protocol instead of its defaults. The grid domain joins the content hash.
- **Done when:** the default YAML round-trips; a misspelled key fails; changing any single
  field changes the hash; N, years, budget, seeds, finalists, validation sessions, cost
  scenarios and every account cap change from YAML with no code edit (a test for each); the
  weekly artifact stores the resolved config.

## T2-2 Corrected E1 benchmark on the real panel (HPG)

- **Owns:** `scripts/momentum/bench.py`, `scripts/momentum/hpg/bench.sbatch` (new),
  `studies/momentum/rm9-weekly-calibration/bench/`
- **Depends on:** T1-2 panels
- **Spec:** §13, §14 "The benchmark sequence"
- **Why:** `e1_table.md` still holds the runs where `prepare_panel` ran per config and chunk
  (10 to 15 times too slow). The prepare-once fix is in the code but was never rerun, and no
  run has used real signal density.
- **Work:** run steps 3 and 4 on the real 500 × 5 panel (`--panel-dir`) on HPG, at 1, 8 and
  16 workers. Measure seconds per candidate-window cold and warm, the 20-session history prefix
  cost per chunk, peak RAM per worker, cache reuse across consecutive weeks. Replace
  `e1_table.md`; label it "compute cost with stand-in selection" until real providers are in.
  Pick the largest budget and worker count whose projected time is under 70% of
  `compute.max_wall_hours` (36 h) and put them in the protocol config.
- **Done when:** the new table is committed, the old numbers are gone, and the lead and
  Teammate 3 have the chosen budget and workers.

## T2-3 Development calibrations and walk-forward on real data (HPG)

- **Owns:** `scripts/momentum/hpg/calibrate.sbatch`, `scripts/momentum/hpg/walkforward.sbatch`
  (new), run outputs under `/blue` (not in the repo)
- **Depends on:** `reserved_start` set by the lead; T1-2; T2-1; real providers from T1-6 and
  T1-7 or the lead's static fallback
- **Spec:** §7, §11 steps 1 to 6, §9
- **Work:** run `shpe momentum calibrate` at one early and one late development cutoff (all
  three policies), validate the artifacts against the 0-A schema, and inspect acceptance
  outcomes (floors may need to rise at N = 500; see the config reference). Then run
  `shpe momentum walkforward` over at least 8 consecutive development weeks, kill and resume it
  once on HPG, and confirm no week is duplicated or invented.
- **Done when:** artifacts, audit trails and per-policy daily series for the development
  weeks exist on `/blue`, the resume check passed, and Teammate 3 has the paths.

## T2-4 Leakage and reproducibility tests (E4)

- **Owns:** `tests/integration/momentum/test_no_lookahead.py`,
  `tests/integration/momentum/test_reproducible.py`
- **Depends on:** the calibrator (done); real providers when they land
- **Spec:** §15 "A deliberately altered future bar must not change an earlier signal,
  universe membership, or configuration"
- **Work:** tamper with a bar after a cutoff and assert that signals, universe and artifact
  before it are unchanged; run the same config and seed twice and require identical
  artifacts; check search and validation cutoffs are in every artifact; assert selection at a
  cutoff never reads a cache chunk at or after it.
- **Done when:** both pass in CI on fixture data.

## T2-5 Study folder, assumption register and freeze (E5)

- **Owns:** `studies/momentum/rm9-weekly-calibration/` (`README.md`, `protocol.md`,
  `protocol.yaml`, `assumptions.md`, `notes.md`), the RM9 row in `docs/teams/momentum.md`
- **Depends on:** T2-1, T2-3, Teammate 3's E3 findings, Teammate 4's bar-timing result
- **Spec:** §17 "Keep an assumption register", §7 "Before opening the reserved results,
  freeze …", App. B
- **Work:** assumption register (each setting, its value, why, the development evidence,
  what would justify a change). The frozen protocol is the resolved `MomentumProtocol` YAML
  with the grid domain and its hash; the walk-forward checks the hash before touching the
  reserved period. Record the lead's 0-F decisions here (scope 500 × 5 from a 1,500 pool on
  HPG, reserved date, quote replay, universe procedure). Changelog: any post-freeze change is
  dated and says whether the final evaluation is untouched.
- **Done when:** the protocol is frozen and hashed on **Nov 21** and referenced by the
  reserved run.

## T2-6 Reserved run (HPG, Nov 21 to 25)

- **Owns:** the frozen run outputs on `/blue`, the run record in the study folder
- **Depends on:** T2-5
- **Work:** `shpe momentum walkforward` with `frozen=true` and the protocol hash, at the
  budget fixed in T2-2. Announce the CPU use to the `dream_team` QOS users first. Each run is
  capped at 36 h and checkpoints; a crash is an operational failure to resume, never a filled
  result. Hand per-policy daily account series to Teammate 3 and finalists to Teammate 4.
- **Done when:** the reserved period is complete for all three policies with the run record
  written.

## T2-7 Engine follow-ups (only if time allows)

Not required for Nov 30; each is small and independent.

- C7 "halt prevents exit": the engine never blocks an exit, so the scenario is not modelled.
  Model it (position stays open and flagged) or document it as a limitation in the register.
- B5: pass the cached RVOL ratio into `readiness_masks` (about 1.2 s of each cold build).
- B7 persisted indicator arrays per week chunk: build only if T2-2 shows the indicator build
  dominates.
- Incremental per-bar indicator forms (B1 to B4): not needed while the platform golden parity
  passes; keep deferred.
