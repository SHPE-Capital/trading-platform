# Intro course: your first trading strategy

A 60–90 minute live-coding lesson for beginners. Learners write a very small
strategy, release it on the platform, and watch it trade on a paper account.

- First-time setup: [setup.md](setup.md) (Git, Node.js, Docker, and your own Alpaca paper keys)
- Learner handout: [lesson-steps.md](lesson-steps.md) (six runnable steps + exercises)
- Vocabulary: [glossary.md](glossary.md)
- Answer key: `backend/src/strategies/beginnerReversal/` (temporarily `ready` and visible as **Beginner Reversal (course)** for UI verification)

## The one-diagram explanation (10 min)

Draw this and come back to it all lesson. Everything learners write lives in the
fourth box; the platform does the rest.

```
market data → state (latest bar, position) → evaluate() → signal → risk checks → paper order
                                              ^^^^^^^^^^
                                              your code
```

## Timeline

| Min | Part | What happens |
|---|---|---|
| 0–10 | Big picture | The diagram. "A strategy only decides; the platform trades safely." |
| 10–20 | Read a finished one | Walk through `minuteReversalStrategy.ts`, then close it. |
| 20–50 | Steps 1–5 | Live-code `my_reversal`. Learners type along; each step ends with something to run. |
| 50–65 | Step 6 | Move a number into the form; save, version, relaunch. |
| 65–90 | Exercises | Pairs of learners; the instructor circulates. |

Pace by the checkpoints, not the clock: every step has a **Check it** line. If a
learner's check fails, they fix it before moving on.

## The teaching moment: experimental to ready

Register a strategy as `experimental` to backtest it and run it on a local simulated
book or personal paper account. The local stack selects the development policy.
The same strategy is available for backtesting in the cloud, but shared trading
requires `ready`. Explain the distinction between technical capability, release
status, and where orders go. Real money always requires readiness and lead approval.
Exercise 4 (`retired`) stops new trading launches while preserving active runs and
historical backtests. Beginner Reversal is currently visible and runnable as the
reference implementation; learners still register their own named strategy.

## Before class (do this the day before)

Start with the [beginner setup guide](setup.md) if this is your first time running
the repo. It covers installation, local login, and the difference between local
simulated orders and orders on your own Alpaca paper account.

1. **Run it locally, in sim.** Each learner (or pair) runs their own stack: `npm run dev:stack`
   ([local development](../guides/local-development.md)), or the
   [no-Docker path](../guides/local-development-no-docker.md) on a locked-down laptop. The
   paper runner starts with `EXECUTION_TARGET=sim`, which fills orders in a local book.
   Nobody shares the club account, and nobody fights over Alpaca's
   one-data-stream-per-account limit.
2. **Market data: every learner brings their own free Alpaca paper keys.** They go in
   `backend/.env` as `ALPACA_DATA_KEY`/`ALPACA_DATA_SECRET` ([setup](setup.md#3-get-your-own-alpaca-paper-keys));
   without them the runner has no data and refuses to start strategies. Live data is the
   IEX stream and only moves during market hours, so schedule the "watch it trade" steps
   for market hours. Outside them, run the same strategy as a **backtest** over a past week
   instead; the navbar badge shows which situation a learner is in.
3. **Restarts.** After you edit backend code you must restart the backend. With the Docker
   stack on Windows, edits on the host may not trigger nodemon in the container, so be ready
   to restart the containers yourself (`docker compose -f docker/docker-compose.dev.yml restart
   paper-trading api backtest-worker`). Backtests run in `backtest-worker`, so an after-hours
   backtest of edited code needs that one restarted too. Rehearse this; a
   reload that doesn't fire in front of a class is the most common stumble. A run left
   running is adopted again automatically after the restart.
4. **Sandbox limits.** Each member has a cap on active sandbox runs and a capital cap. Stop old
   runs before class.
5. **Check Docker is up** (and the machine stays awake) before learners arrive.
6. **Dry-run the steps** yourself once, at the time of day you will teach: live bars during
   market hours, or backtests over a past week outside them. Every code
   block in `lesson-steps.md` was compiled step by step, but your environment is the one that
   matters.

## Verify the reference before writing your own

Choose **Beginner Reversal (course)** on Strategies, keep the default SPY/AAPL
symbols and one-share size/cap, save a configuration, and start its selected
version on paper. A fresh runner waits for this first subscription, then starts
cached playback automatically. It needs two distinct bars to make its first
decision and a later bar to fill a queued simulator order. Accelerated replay
still uses wall-clock risk cooldowns, so a `60x` replay can skip orders during
the default five-second cooldown. A completed replay is finite; restart the
paper runner to replay the selected window again.

On Backtests, choose the same reference (or its saved configuration), select
the exact seeded date range, and run. Cached complete days work without Alpaca
data keys; an uncovered range needs personal data credentials. Wait for the
worker's result, inspect orders/fills, and **Save** it to retain it. See
[backtesting](../guides/backtesting.md) for the API and CLI workflows.

For a code-level check without Docker, credentials, or broker orders, run from
`backend/`:

```text
npm test -- --runInBand src/tests/int/beginnerTrading.test.ts src/tests/adapters/replayBarFeed.test.ts
```

These tests exercise cached historical backtesting, a strategy launched after
an empty replay boot, journaled local fills, and the paper adapter's submission
path with mocked HTTP responses. They do not establish connectivity to your
running database or personal Alpaca account.

## Making it easy to follow along

- Show the editor and the Strategies page side by side.
- Have learners keep the backend terminal visible: Steps 3–5 print a plain-English
  line for every decision, which is the best way to see "what the strategy is thinking".
- Tag a starting commit and a commit per step (`step-1` … `step-6`) in your own
  copy so a lost learner can `git checkout step-3` and rejoin. (These tags are not
  created by the repo; they are a one-time job for the instructor.)
- Hand out the glossary on paper.

## When something doesn't work

Point learners at [Is my strategy doing what I expect?](../guides/troubleshooting-strategies.md). The short
version for the lesson: *read the backend terminal first*. It says when a symbol has no data, when an order was
blocked and by which check, and (in Steps 3–5) what the strategy decided and why. For the position-cap case, set
`LOG_LEVEL=debug` to also see the "first bar" and "unchanged close" lines.

## What this lesson deliberately skips

The optional backtest checkpoint uses the same strategy; the core lesson skips
backtest methodology, risk limits, order types, and the review/approval workflow for going
live. Mention that they exist ("the risk layer is why you can't blow up the account
from here") and point to the architecture docs for a second session.
