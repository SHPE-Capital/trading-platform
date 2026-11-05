# Learner prep: read this before the lesson

The strategy idea is small. Most trouble comes from setup and from code syntax
you may not have seen. This page covers both, so you can fix problems before the
meeting.

## Do this before the meeting (homework)

Setup is a project by itself and **is not done live**. Finish
[setup.md](setup.md) by the deadline your lead gives you, then confirm:

- [ ] `git --version`, `node --version` (v22 or newer), and `docker info` all work
- [ ] `npm run dev:stack` starts and http://localhost:3000 loads
- [ ] You can sign in with the local login from the setup guide
- [ ] `npm run doctor` (second terminal, repo root) passes. **Post a screenshot of
      it in the club channel.** This is the single pass/fail signal.

The first `dev:stack` takes several minutes. Expect roughly one in four people to
hit a snag on a mixed Windows/macOS/Linux club. That is normal; ask in the
channel or at office hours instead of struggling alone. See the
[common setup problems](setup.md#common-setup-problems) table first.

## The picture to keep in your head

```
market data → state → evaluate() → signal → risk checks → paper order
                      ^^^^^^^^^^
                      the only part you write
```

Your strategy only *decides*. The platform places orders and enforces risk
limits.

## Common errors (the short list)

| Symptom | Almost always |
|---|---|
| Strategy type not in the picker, or a confusing TypeScript/registration error | **Name mismatch.** The type string must be identical in four places: `StrategyType` in `backend/src/types/strategy.ts`, the class and config in `strategy.ts`, `DEFAULTS` and the manifest in `manifest.ts`, and `frontend/types/strategy.ts`. Compare them character by character. |
| You changed the code and nothing changed | **You did not restart.** On Windows with Docker, edits do not reload on their own. Run `docker compose -f docker/docker-compose.dev.yml restart paper-trading api backtest-worker` from the repo root. |
| Strategy runs but nothing prints | **No bars.** Live bars only arrive during market hours (US stock market, weekdays). Outside them, run a **backtest** over a past week instead. The first bar is also only a baseline; you need two bars to compare. |
| Nothing starts, or no data | **Docker is not running**, or the Alpaca data keys in `backend/.env` are missing or wrong. Open Docker Desktop, then run `npm run doctor`. |
| Git conflict when combining work | **Shared files.** Everyone appends to `StrategyType` and `strategyCatalog.ts`. Keep every existing line, add only yours, and ask before resolving someone else's lines. |

When in doubt: **read the backend terminal first.** It says what the strategy
decided or why an order was blocked.

## No live bars? Use a backtest

Steps 3–5 print a line only when a bar arrives. If you work evenings or weekends,
open **Backtests**, pick your strategy, choose a past weekday, and run. It is the
same strategy code on historical bars. Details: [backtesting](../guides/backtesting.md).

## TypeScript you will see in the lesson

You do not need to know TypeScript beforehand. These are the constructs the
lesson code uses, with the plain meaning.

| You will see | Meaning | Example from the lesson |
|---|---|---|
| `interface` | A description of the shape of an object: which fields it has and their types. | `interface ReversalConfig { type: "..."; maxPositionQty: number }` |
| `extends` | "Build on top of." A class that extends another inherits its methods; an interface that extends another inherits its fields. | `class JcavallinReversalStrategy extends BaseStrategy` gets `buildSignal()` for free |
| `readonly` | Set once, never reassigned. | `readonly type = "jcavallin_reversal"` |
| `static` | Belongs to the class itself, not to each instance. | `static readonly VERSION = 1` |
| `Map` | A lookup table from keys to values. | `lastBar`: ticker symbol → last bar seen for it |
| `?.` (optional chaining) | "If the thing on the left exists, keep going; otherwise stop and give `undefined`." Prevents crashes on missing data. | `context.symbolState.get(symbol)?.latestBar` |
| `??` (nullish default) | "Use the right side if the left is `null` or `undefined`." | `getPosition(symbol)?.qty ?? 0` means a missing position counts as 0 shares |
| `...` (spread) | Copy all properties of an object into a new one; later ones overwrite earlier ones. | `{ ...DEFAULTS, ...config }` fills in defaults, then applies your saved settings |
| `as` | Tells TypeScript "treat this as that type." It checks nothing at runtime. | `mergedConfig as ReversalConfig` |
| `import type` | Brings in a type only; it disappears when the code runs. | `import type { EvaluationContext } ...` |
| `"buy" \| "sell"` | A type that allows only those exact values. | `let side: "buy" \| "sell"` |
| `null` as a return | "No signal this time." | `return null` |

## Why a reversal strategy on 1-minute bars?

It is a teaching strategy, not a money-maker. It exists because it is small
enough to write in an hour and shows the whole workflow. A rule like "sell after
an up bar, buy after a down bar" has no real edge once spreads, fees, and
slippage are counted, and you should not expect it to be profitable. The lesson
is about the **loop** (write, register, configure, paper trade, record the
change), not the returns.

## References

**Language and tools**
- [TypeScript in 5 minutes](https://www.typescriptlang.org/docs/handbook/typescript-in-5-minutes.html): covers most of the syntax above.
- [MDN: JavaScript `Map`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Map): the per-symbol memory the strategy uses.
- [MDN: optional chaining (`?.`)](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Optional_chaining) and [nullish coalescing (`??`)](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Nullish_coalescing).
- [MDN: spread syntax](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Spread_syntax).
- [Git downloads](https://git-scm.com/downloads) and a short Git basics video (search "Git basics for beginners"): enough to clone, commit, and resolve a simple conflict.
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) and its "Get started" guide.

**Broker and data**
- [Alpaca paper trading guide](https://docs.alpaca.markets/us/docs/paper-trading): generating your paper keys.
- The repo's [live paper trading](../guides/live-paper-trading.md), [backtesting](../guides/backtesting.md), and [strategy troubleshooting](../guides/troubleshooting-strategies.md) guides.

**Trading concepts** (search the title on Investopedia)
- *Mean reversion* and *momentum*: the two ideas the course contrasts.
- *Short selling*: what a negative position means.
- *Slippage* and *bid-ask spread*: why simple strategies lose in practice.

Vocabulary used in the lesson: [glossary.md](glossary.md).
