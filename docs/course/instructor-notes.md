# Instructor notes: running the lesson in a club meeting

For the person teaching [the course](README.md). Learners should read
[learner-prep.md](learner-prep.md) first. This page covers where learners tend to
get stuck, how to fit the lesson into limited meeting time, and known doc gaps.

## Meeting plan (about 15 minutes of talk)

| Min | What | Notes |
|---|---|---|
| 5 | The one-diagram explanation | market data → evaluate() → signal → risk → order. Stop there. |
| 5 | Live demo of the finished answer key | Run **Beginner Reversal (course)** so people see the goal. |
| 5 | Common errors, one slide | Name mismatch, forgot to restart, no data outside market hours, Docker not running. |

Do **not** walk through setup live. Make it homework with a hard deadline, and
give people a place to get unstuck: a Discord channel, plus a short office-hours
slot for those still blocked.

## Where people will likely get stuck

1. **Setup is a project by itself.** It needs Git, Node 22+, Docker Desktop,
   GitHub repo access, and personal Alpaca keys, then a first `dev:stack` that
   takes several minutes. On a mixed-OS club expect about one in four people to
   fail somewhere. This cannot happen in the meeting. Use `npm run doctor` as the
   pass/fail check and ask for a screenshot.
2. **Step 2 is the cliff.** Step 1 is about 15 lines. Step 2 asks for a 50-line
   manifest plus edits to three other files (`backend/src/types/strategy.ts`,
   `backend/src/config/strategyCatalog.ts`, `frontend/types/strategy.ts`). The
   name must match in four places, and one typo gives a confusing error.
3. **TypeScript syntax is assumed.** The code uses `extends`, `interface`, `Map`,
   `?.`, `??`, spread (`...`), `as`, and `readonly`. The lesson comments explain
   some of these; the cheat sheet in [learner-prep.md](learner-prep.md) and the
   [glossary](glossary.md) now cover them.
4. **Market hours.** Steps 3–5 show output only when bars arrive live. For
   evening or weekend meetings nobody sees a trade until they use the backtest
   workaround, which is buried in setup. Tell them up front.
5. **"Restart the backend" is vague.** On Windows with Docker, host edits do not
   reload the container. The command is in the README and in learner-prep, but
   the step-by-step handout only says "restart". Say it aloud.
6. **Shared files.** If everyone adds a line to `StrategyType` and
   `strategyCatalog.ts` in the same repo, expect merge conflicts. Tell learners to
   keep all existing lines and append only their own, or work in separate
   clones and combine afterward.

## Known doc issues

- The glossary previously listed status as `planned`/`ready`/`retired` while the
  lesson uses `experimental`. The glossary is now corrected.
- Exercise 3 points to the answer key's `warmUp` idea, which the lesson never
  teaches. Either demo `warmUp` in the answer key beforehand or skip the exercise.
- The README budgets 30 minutes for Steps 1–5. That is optimistic for true
  beginners; plan for a second session or have learners finish Steps 3–5 as
  homework.
- Learners will ask whether the strategy makes money. It is not expected to. Say
  so early (see learner-prep).

## Improvements worth making

- **A scaffold script** (for example `npm run new-strategy <name>`) that creates
  the folder, manifest, and the three registration edits. This removes the Step 2
  cliff, the name-matching typos, and most merge conflicts. Not built yet.
- **Step tags** `step-1` … `step-6` in your own copy of the repo so a lost
  learner can `git checkout step-3` and rejoin. The README notes these are a
  one-time instructor job and do not exist yet.
- **A fill-in-the-blank `strategy.ts`** with `// TODO` markers for learners who
  will not type along from the handout.
- **A backtest-first path** for evening and weekend meetings, so Steps 3–5 do not
  depend on live bars.
