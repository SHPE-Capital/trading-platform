# Lesson steps: build and launch your first strategy

You will write a tiny trading strategy, release it, and watch it trade on a paper
account from the platform's web page. Every step ends with something you can
**run and see**, so you are never more than a minute from a working state.

## Before you start: local setup

Follow [the setup guide](setup.md) to install Git, Node.js, and Docker Desktop,
download this repo, configure your own Alpaca paper keys, and sign in locally.
It includes both local simulation with live data and optional execution on your
personal Alpaca paper account. Finish its startup checks before Step 1 below.

> The finished version of this strategy already exists as the **answer key**:
> `backend/src/strategies/beginnerReversal/`. Don't open it until you have tried
> the steps. You will build your own copy, `jcavallin_reversal`, next to it.

## Choose your own strategy name

Use the **first letter of your first name + your last name**, lowercase, followed
by `_reversal`. For example, first initial `j` and last name `cavallin` become
`jcavallin_reversal`. This keeps learners' strategy types, files, and catalog
entries distinct when their work is combined in the same repo.

The examples below use that name. **Replace the example prefix with your own
throughout every step**, keeping these forms consistent:

| Where | Example |
|---|---|
| Strategy type and log prefix | `jcavallin_reversal` |
| Folder | `jcavallinReversal` |
| Strategy file | `strategy.ts` (same filename for everyone) |
| Manifest file | `manifest.ts` (same filename for everyone) |
| Strategy class | `JcavallinReversalStrategy` |
| Config interface | `ReversalConfig` (same name in each learner's module) |
| Manifest export | `jcavallinReversalManifest` |
| Display name | `Jcavallin Reversal` |

Only the folder, strategy class, manifest export, display name, and strategy
type use your personal prefix. Keep `strategy.ts`, `manifest.ts`, `ReversalConfig`,
`createStrategy`, and `DEFAULTS` as written: each file is a separate module, so
these local names can be reused in another learner's folder. The folder keeps
files separate; the type string identifies the strategy to the platform.

Use only letters for the personal prefix; omit spaces, hyphens, and apostrophes.
If another learner has the same first initial and last name, agree on a distinct
suffix before registering your types. Append your entry to the existing type
lists and catalog; preserve everyone else's entries.

**The strategy in one sentence:** if a stock's latest 1-minute bar closed *higher*
than the bar before, sell one share; if it closed *lower*, buy one share.

## The two files you will write

- **`strategy.ts`** contains your settings type and decision
  logic: read market/position state, then return a signal or `null`.
- **`manifest.ts`** registers how the platform builds and displays that strategy:
  its identity, defaults, release status, constructor, and editable form fields.

Paths below are from the repo root. Each full-file example shows **what that file
should look like at the end of that step**; replace the previous version of that
file rather than adding a second class. Step 6 shows the final versions of both
files. Catalog/type-list snippets are edits inside existing files.

`// ADDED` marks new code; `// CHANGED` marks code replacing an earlier line.
Other inline comments explain matching names, inherited behavior, and settings.
Markers compare each step with the preceding version of the same file; unmarked
code is carried forward. An `ADDED block` comment marks the whole enclosed block.

---

## Step 1: An empty strategy

A strategy is a class with one method, `evaluate()`. The platform calls it every
time a new 1-minute bar arrives (that is what the `triggers` line asks for). It
returns a **signal** ("do this") or `null` ("do nothing"). For now it always says
nothing.

First, tell the platform the new type's name. In `backend/src/types/strategy.ts`,
add one line to the `StrategyType` list:

```ts
  | "beginner_reversal"
  | "jcavallin_reversal";   // ADDED: your type name; move the final semicolon to this line
```

Create `backend/src/strategies/jcavallinReversal/strategy.ts`:

```ts
// backend/src/strategies/jcavallinReversal/strategy.ts
import { BaseStrategy } from "../base/strategy";
import type { EvaluationContext } from "../base/strategy";
import type { BaseStrategyConfig, StrategySignal, StrategyType } from "../../types/strategy";
import type { MarketEventKind } from "../../types/market";

export interface ReversalConfig extends BaseStrategyConfig { // Inherits shared settings; adds this strategy's settings.
  type: "jcavallin_reversal"; // Must match StrategyType, class type, and manifest type.
}

export class JcavallinReversalStrategy extends BaseStrategy { // Inherits start(), stop(), and buildSignal().
  readonly type: StrategyType = "jcavallin_reversal"; // Same identifier as the config and manifest.
  static readonly VERSION = 1;
  readonly version = JcavallinReversalStrategy.VERSION; // Use this class's VERSION.
  readonly triggers: readonly MarketEventKind[] = ["bar"]; // call evaluate() only when a bar arrives

  constructor(readonly myConfig: ReversalConfig) { // Must use the config interface declared above.
    super(myConfig); // Pass settings to BaseStrategy.
  }

  // Generate signals, later ingested by the core engine for live and paper trading
  evaluate(_context: EvaluationContext): StrategySignal | null {
    // we will fill this in the next steps
    return null; // null = no signal generated; do nothing on this evaluation
  }
}
```

**Check it:** `cd backend && npm run typecheck`. No errors means the platform
accepts your class.

---

## Step 2: Register it and launch it locally

A strategy must be **registered** before it can run. Use `experimental` while developing
locally; `ready` releases it for shared trading.
Create the manifest, the strategy's "ID card" for the platform. Every actual
top-level property below is required by `StrategyManifest` except `params`,
which this lesson needs for the generic form. The commented optional properties
are future references; leave them commented for now. `DEFAULTS` contains config
values, while `params` describes which of those values the user can edit.
`./strategy` imports the file in the **same folder** as this manifest. It does
not search other learners' folders, even when their files are also called
`strategy.ts`. The catalog uses a longer folder path to select each manifest.

This entire file is new in Step 2:

```ts
// backend/src/strategies/jcavallinReversal/manifest.ts
import type { StrategyManifest } from "../../config/strategyManifest";
import { JcavallinReversalStrategy, type ReversalConfig } from "./strategy"; // "./" selects strategy.ts in this folder; match its exported names.

const DEFAULTS = {
  name: "Jcavallin Reversal", // Default configuration name
  type: "jcavallin_reversal", // IMPORTANT: must match the class/config type and StrategyType entries.
  symbols: ["SPY"], // IMPORTANT: Must match the params key below.
  rollingWindowMs: 60_000,
  maxPositionSizeUsd: 10_000,
  cooldownMs: 0,
  enabled: true, // false makes evaluate() return null without generating a signal.
};

function createStrategy(config: Record<string, unknown>): JcavallinReversalStrategy {
  // Take default config and replace with passed values before creating the strategy. Allows creating strategy when values are missing by defaulting to the values in DEFAULTS
  const mergedConfig = {
    ...DEFAULTS,
    ...config,
  };

  // Optional future step: call a validation function here to reject invalid values.
  const strategyConfig = mergedConfig as ReversalConfig; // Give the merged settings the expected TypeScript type.
  const strategy = new JcavallinReversalStrategy(strategyConfig); // Create an instance using those settings.
  return strategy; // Give the instance back to the platform; starting it is a separate step.
  // One-line alternative: return new JcavallinReversalStrategy(config as ReversalConfig);
  // Without merging, every required setting must already exist; older configs may lack new fields.
}

export const jcavallinReversalManifest: StrategyManifest = { // Export name must match the catalog import.
  // Required values for all strategies
  type: "jcavallin_reversal", // IMPORTANT: Must match the same type identifier as the strategy and DEFAULTS.
  status: "experimental", // experimental = work in progress (allows backtest and paper trading), later switch to "ready"
  label: "Jcavallin Reversal", // Title that shows up in the UI
  description: "Sell after an up bar, buy after a down bar.",
  version: JcavallinReversalStrategy.VERSION, // IMPORTANT: must match the imported class's VERSION.
  defaultConfig: DEFAULTS, // Pass default values defined above
  create: createStrategy, // Pass the method used to create the strategy

  // Optional, with the values listed needed for this particular strategy. Displayed in the UI
  params: [
    {
      key: "symbols", // IMPORTANT: match the config/defaults property.
      label: "Symbols", // Required per field: display text, not a code identifier.
      kind: "symbols", // Required per field: number, text, symbols, or boolean.
      // Optional per field: min, max, step (numbers), and hint (help text).
      // Example for a numeric field: min: 1, max: 10, step: 1, hint: "Whole shares".
    },
  ],
  // Other optional manifest fields for later: hidden, backtestable, validate.
  // hidden: true hides pickers; backtestable: false disables historical simulation.
};
```

`create` is a **factory function** stored on the manifest, not an override of a
`BaseStrategy` method. The platform calls it with the configuration for a run
or backtest, after supplying an instance ID and the registered strategy type.
This function merges settings, invokes your constructor with `new`, and returns
the instance. It does not start trading by itself.

`create: createStrategy` assigns the function defined above to the manifest's
`create` property. There are no parentheses because the platform will call it
later. `Record<string, unknown>` describes the incoming settings object; the
return type says the function produces a `JcavallinReversalStrategy` instance.

The spread syntax copies object properties from left to right. For example,
`DEFAULTS.symbols` is `["SPY"]`; incoming `{ symbols: ["AAPL"] }` replaces it
with `["AAPL"]` while keeping defaults for omitted fields. This is a shallow
merge: a supplied array or nested object replaces that whole value.

`DEFAULTS` has no ID. The platform preserves an incoming `config.id` or generates
one before calling this factory. The ID passes through `mergedConfig`, the
constructor, and `super(myConfig)` to `BaseStrategy`, which stores it as `this.id`.

The `as` assertion only helps TypeScript handle the generic incoming object; it
does not inspect or reject values at runtime. A validation function called in
the factory can reject invalid settings before construction. The optional
manifest `validate` hook can also reject them when saving, and constructor checks
can enforce rules for direct construction. This example does not add runtime
validation merely by using a cast.

If every setting is already complete, the factory body could be the one-line
return shown in the comment. That skips default filling: partial input and older
saved configurations missing a newly introduced field would keep it undefined.
Keeping the merge makes those cases work with the current defaults.

`params` is a separate list of form descriptions, not constructor arguments.
For each entry, `key` selects the configuration property to edit, `label` is
the text displayed beside its input, and `kind` selects the input control.
Step 6 adds a numeric field with optional `min`, `step`, and `hint` settings;
the saved values are passed to `create` as part of `config`.

Then add it to the list in `backend/src/config/strategyCatalog.ts`:

```ts
import { jcavallinReversalManifest } from "../strategies/jcavallinReversal/manifest"; // ADDED: match the folder and manifest export.

export const STRATEGY_CATALOG: readonly StrategyManifest[] = [
  // Keep all existing entries exactly as they are, including hidden metadata.
  jcavallinReversalManifest, // ADDED: same export name as the import above.
];
```

Also add `| "jcavallin_reversal"` to `StrategyType` in `frontend/types/strategy.ts`;
the spelling must match the backend type entry exactly.

**Check it:** use `STRATEGY_POLICY_PROFILE=development` and `EXECUTION_TARGET=sim`
(the local Docker stack already sets these). Restart the backend, open the **Strategies** page, and pick
**Jcavallin Reversal** in *Strategy Type*. Click *Save as new configuration*, then
*Start Selected Version on Paper*. A run appears under *All Runs* and... does
nothing. That is correct: it is running, and has nothing to say yet.

> The `params` list draws the trading and backtest forms. No separate backtest
> factory registration is needed. On a shared runtime, this experimental strategy
> appears on Backtests but is excluded from new trading launches.

---

## Step 3: Fill in evaluate() in strategy.ts to generate signals based on incoming bars

`evaluate()` is called once per arriving bar. We still remember the last bar we
looked at, and only act when a **new** one arrives, so a bar that is ever delivered
twice is not counted twice.

```ts
// backend/src/strategies/jcavallinReversal/strategy.ts
import { BaseStrategy } from "../base/strategy";
import { logger } from "../../utils/logger"; // ADDED: print decisions in the runner log.
import type { EvaluationContext } from "../base/strategy";
import type { BaseStrategyConfig, StrategySignal, StrategyType } from "../../types/strategy";
import type { MarketEventKind } from "../../types/market";

export interface ReversalConfig extends BaseStrategyConfig {
  type: "jcavallin_reversal";
}

export class JcavallinReversalStrategy extends BaseStrategy {
  readonly type: StrategyType = "jcavallin_reversal";
  static readonly VERSION = 1;
  readonly version = JcavallinReversalStrategy.VERSION;
  readonly triggers: readonly MarketEventKind[] = ["bar"];

  /** The last bar we looked at, per symbol. */
  private readonly lastBar = new Map<string, { ts: number; close: number }>(); // ADDED: independent memory per ticker.

  constructor(readonly myConfig: ReversalConfig) {
    super(myConfig);
  }

  evaluate(context: EvaluationContext): StrategySignal | null { // CHANGED: use context; replace the empty method with this block.
    if (!this.isActive || !this.myConfig.enabled) return null; // ADDED: skip when stopped or disabled.
    const { symbol } = context; // ADDED: the ticker that triggered this evaluation.

    const bar = context.symbolState.get(symbol)?.latestBar; // ADDED: read the latest completed bar.
    if (!bar) return null; // ADDED: no data, no action.

    const prev = this.lastBar.get(symbol); // ADDED: retrieve this ticker's previous bar.
    if (prev && bar.ts <= prev.ts) return null; // ADDED: ignore duplicate or older bars.
    this.lastBar.set(symbol, { ts: bar.ts, close: bar.close }); // ADDED: remember this bar for next time.

    logger.info(`jcavallin_reversal: ${symbol} new bar, close ${bar.close}`); // ADDED: log only new bars.
    return null; // Still no signal; do nothing on this evaluation.
  }
}
```

**Check it:** restart the backend (see *Before class* in the README). A run left
running is adopted again automatically, now using your new code; if you stopped it,
start it again. Watch the backend terminal: you will see one line per symbol per
bar (replayed bars arrive fast when `REPLAY_SPEED` is raised; live bars arrive once a
minute during market hours).

---

## Step 4: Decide, and send a signal

Compare the new bar with the one before it. The first bar has nothing to compare
against, so it only sets the baseline. Use `if/else` to choose the order side
and return the corresponding signal. `sell`/`buy` are order sides;
`short`/`long` are signal directions. In Step 5, we also distinguish closing an
existing position from opening one.

```ts
// backend/src/strategies/jcavallinReversal/strategy.ts
import { BaseStrategy } from "../base/strategy";
import { logger } from "../../utils/logger";
import type { EvaluationContext } from "../base/strategy";
import type { BaseStrategyConfig, StrategySignal, StrategyType } from "../../types/strategy";
import type { MarketEventKind } from "../../types/market";

export interface ReversalConfig extends BaseStrategyConfig {
  type: "jcavallin_reversal";
}

export class JcavallinReversalStrategy extends BaseStrategy {
  readonly type: StrategyType = "jcavallin_reversal";
  static readonly VERSION = 2; // CHANGED: update version since signal behavior changed.
  readonly version = JcavallinReversalStrategy.VERSION;
  readonly triggers: readonly MarketEventKind[] = ["bar"];

  private readonly lastBar = new Map<string, { ts: number; close: number }>();

  constructor(readonly myConfig: ReversalConfig) {
    super(myConfig);
  }

  evaluate(context: EvaluationContext): StrategySignal | null {
    if (!this.isActive || !this.myConfig.enabled) return null;
    const { symbol } = context;

    const bar = context.symbolState.get(symbol)?.latestBar;
    if (!bar) return null;

    const prev = this.lastBar.get(symbol);
    if (prev && bar.ts <= prev.ts) return null;
    this.lastBar.set(symbol, { ts: bar.ts, close: bar.close });

    if (!prev || bar.close === prev.close) return null; // ADDED: first bar is a baseline; unchanged close means no action.

    let side: "buy" | "sell"; // ADDED block: reverse the last price move.
    if (bar.close > prev.close) {
      side = "sell";
    } else {
      side = "buy";
    }
    logger.info(`jcavallin_reversal: ${symbol} ${prev.close} -> ${bar.close}, so ${side} 1 share`); // CHANGED: log the decision.

    if (side === "sell") { // CHANGED block: return the signal for the selected side.
      return this.buildSignal({
        symbol,
        direction: "short",
        qty: 1,
        triggerLabel: "bar_up_sell",
      });
    } else {
      return this.buildSignal({
        symbol,
        direction: "long",
        qty: 1,
        triggerLabel: "bar_down_buy",
      });
    }
  }
}
```

**Check it:** restart the backend. On the next bar that moves, the log explains the
decision and an order shows up on the **Portfolio** page (and on the run's own page,
reached from *All Runs*). **That is a real paper trade, placed by code you wrote.**

---

## Step 5: Don't pile up

Right now a long run of up bars would keep selling short. Add a safety cap, and
label trades that *reduce* a position as closes.

```ts
// backend/src/strategies/jcavallinReversal/strategy.ts
import { BaseStrategy } from "../base/strategy";
import { logger } from "../../utils/logger";
import type { EvaluationContext } from "../base/strategy";
import type { BaseStrategyConfig, SignalDirection, StrategySignal, StrategyType } from "../../types/strategy"; // CHANGED: add SignalDirection for the helper.
import type { MarketEventKind } from "../../types/market";

const MAX_POSITION = 1; // ADDED: most shares we will hold, long or short

export interface ReversalConfig extends BaseStrategyConfig { // Inherits shared settings; adds this strategy's settings.
  type: "jcavallin_reversal"; // Must match StrategyType, class type, and manifest type.
}

export class JcavallinReversalStrategy extends BaseStrategy { // Inherits start(), stop(), and buildSignal().
  readonly type: StrategyType = "jcavallin_reversal"; // Same identifier as the config and manifest.
  static readonly VERSION = 3; // CHANGED: position-cap and close-label behavior changed.
  readonly version = JcavallinReversalStrategy.VERSION; // Use this class's VERSION.
  readonly triggers: readonly MarketEventKind[] = ["bar"]; // call evaluate() only when a bar arrives

  private readonly lastBar = new Map<string, { ts: number; close: number }>();

  constructor(readonly myConfig: ReversalConfig) { // Must use the config interface declared above.
    super(myConfig); // Pass settings to BaseStrategy.
  }

  evaluate(context: EvaluationContext): StrategySignal | null {
    if (!this.isActive || !this.myConfig.enabled) return null;
    const { symbol } = context;

    const bar = context.symbolState.get(symbol)?.latestBar;
    if (!bar) return null;

    const prev = this.lastBar.get(symbol);
    if (prev && bar.ts <= prev.ts) return null; // same bar as last time
    this.lastBar.set(symbol, { ts: bar.ts, close: bar.close });

    if (!prev || bar.close === prev.close) return null;

    let side: "buy" | "sell";
    if (bar.close > prev.close) {
      side = "sell";
    } else {
      side = "buy";
    }

    const position = context.portfolioState.getPosition(symbol)?.qty ?? 0; // ADDED: current signed share position; missing means zero.
    let after: number; // ADDED block: calculate the position if this trade fills.
    if (side === "buy") {
      after = position + 1;
    } else {
      after = position - 1;
    }
    if (Math.abs(after) > MAX_POSITION) return null; // ADDED: skip a trade beyond the cap.

    logger.info(`jcavallin_reversal: ${symbol} ${prev.close} -> ${bar.close}, so ${side} 1 share`);

    if (side === "sell") {
      return this.buildSignal({
        symbol,
        direction: this.directionFor(side, position), // CHANGED: distinguish opening from closing.
        qty: 1,
        triggerLabel: "bar_up_sell",
      });
    } else {
      return this.buildSignal({
        symbol,
        direction: this.directionFor(side, position), // CHANGED: distinguish opening from closing.
        qty: 1,
        triggerLabel: "bar_down_buy",
      });
    }
  }

  private directionFor(side: "buy" | "sell", position: number): SignalDirection { // ADDED block: label position reductions as closes.
    if (side === "buy") {
      if (position < 0) {
        return "close_short";
      } else {
        return "long";
      }
    } else {
      if (position > 0) {
        return "close_long";
      } else {
        return "short";
      }
    }
  }
}
```

**Check it:** restart the backend and watch the position on the **Portfolio** page
stay between -1 and +1.

---

## Step 6: Make the cap a setting

Move the hard-coded `MAX_POSITION` into configuration so it appears in the form.
First make the small edits below; the complete files follow for reference.

**1. Strategy changes** in `strategy.ts`:

Delete `const MAX_POSITION = 1;`, add the setting to the config interface, bump
`VERSION`, and replace the position-cap guard:

```ts
export interface ReversalConfig extends BaseStrategyConfig {
  type: "jcavallin_reversal";
  maxPositionQty: number; // ADDED: same key as the default and form field.
}
```

```ts
  static readonly VERSION = 4; // CHANGED: the cap is now configurable.
```

```ts
    if (Math.abs(after) > this.myConfig.maxPositionQty) return null; // CHANGED: replace MAX_POSITION with the setting.
```

**2. Manifest changes** in `manifest.ts`:

Add this property inside `DEFAULTS`:

```ts
  maxPositionQty: 1, // ADDED: fills the setting for new and older configurations.
```

Append this field to the existing `params` array, keeping the symbols field:

```ts
    { // ADDED: numeric form field; key must match the config and DEFAULTS.
      key: "maxPositionQty",
      label: "Max position (shares)",
      kind: "number",
      min: 1,
      step: 1,
      hint: "Largest absolute share position per symbol",
    },
```

`params` controls the form, not trading behavior. A setting needs a config field,
a default, and strategy code that reads it. Add/remove a parameter entry to
show/hide an input; hiding it does not delete values from old saved configs.
`min`, `max`, and `step` guide inputs; use the optional manifest `validate` hook
for server checks, including positive whole-share values and relationships
between fields. Older saved configs receive the new default through `create`.

### Complete final files

These are the full implementations after Step 6, without comments. Use your own
name prefix consistently, as in the earlier steps.

**`backend/src/strategies/jcavallinReversal/strategy.ts`**

```ts
import { BaseStrategy } from "../base/strategy";
import { logger } from "../../utils/logger";
import type { EvaluationContext } from "../base/strategy";
import type { BaseStrategyConfig, SignalDirection, StrategySignal, StrategyType } from "../../types/strategy";
import type { MarketEventKind } from "../../types/market";

export interface ReversalConfig extends BaseStrategyConfig {
  type: "jcavallin_reversal";
  maxPositionQty: number;
}

export class JcavallinReversalStrategy extends BaseStrategy {
  readonly type: StrategyType = "jcavallin_reversal";
  static readonly VERSION = 4;
  readonly version = JcavallinReversalStrategy.VERSION;
  readonly triggers: readonly MarketEventKind[] = ["bar"];

  private readonly lastBar = new Map<string, { ts: number; close: number }>();

  constructor(readonly myConfig: ReversalConfig) {
    super(myConfig);
  }

  evaluate(context: EvaluationContext): StrategySignal | null {
    if (!this.isActive || !this.myConfig.enabled) return null;
    const { symbol } = context;

    const bar = context.symbolState.get(symbol)?.latestBar;
    if (!bar) return null;

    const prev = this.lastBar.get(symbol);
    if (prev && bar.ts <= prev.ts) return null;
    this.lastBar.set(symbol, { ts: bar.ts, close: bar.close });

    if (!prev || bar.close === prev.close) return null;

    let side: "buy" | "sell";
    if (bar.close > prev.close) {
      side = "sell";
    } else {
      side = "buy";
    }

    const position = context.portfolioState.getPosition(symbol)?.qty ?? 0;
    let after: number;
    if (side === "buy") {
      after = position + 1;
    } else {
      after = position - 1;
    }
    if (Math.abs(after) > this.myConfig.maxPositionQty) return null;

    logger.info(`jcavallin_reversal: ${symbol} ${prev.close} -> ${bar.close}, so ${side} 1 share`);

    if (side === "sell") {
      return this.buildSignal({
        symbol,
        direction: this.directionFor(side, position),
        qty: 1,
        triggerLabel: "bar_up_sell",
      });
    } else {
      return this.buildSignal({
        symbol,
        direction: this.directionFor(side, position),
        qty: 1,
        triggerLabel: "bar_down_buy",
      });
    }
  }

  private directionFor(side: "buy" | "sell", position: number): SignalDirection {
    if (side === "buy") {
      if (position < 0) {
        return "close_short";
      } else {
        return "long";
      }
    } else {
      if (position > 0) {
        return "close_long";
      } else {
        return "short";
      }
    }
  }
}
```

**`backend/src/strategies/jcavallinReversal/manifest.ts`**

```ts
import type { StrategyManifest } from "../../config/strategyManifest";
import { JcavallinReversalStrategy, type ReversalConfig } from "./strategy";

const DEFAULTS = {
  name: "Jcavallin Reversal",
  type: "jcavallin_reversal",
  symbols: ["SPY"],
  rollingWindowMs: 60_000,
  maxPositionSizeUsd: 10_000,
  cooldownMs: 0,
  enabled: true,
  maxPositionQty: 1,
};

function createStrategy(config: Record<string, unknown>): JcavallinReversalStrategy {
  const mergedConfig = {
    ...DEFAULTS,
    ...config,
  };
  const strategyConfig = mergedConfig as ReversalConfig;
  const strategy = new JcavallinReversalStrategy(strategyConfig);
  return strategy;
}

export const jcavallinReversalManifest: StrategyManifest = {
  type: "jcavallin_reversal",
  status: "experimental",
  label: "Jcavallin Reversal",
  description: "Sell after an up bar, buy after a down bar.",
  version: JcavallinReversalStrategy.VERSION,
  defaultConfig: DEFAULTS,
  create: createStrategy,
  params: [
    {
      key: "symbols",
      label: "Symbols",
      kind: "symbols",
    },
    {
      key: "maxPositionQty",
      label: "Max position (shares)",
      kind: "number",
      min: 1,
      step: 1,
      hint: "Largest absolute share position per symbol",
    },
  ],
};
```

**Check it:** restart. The form now has a **Max position** box. Change it to `2`, write
*"allow 2 shares"* in *What changed?*, press *Save changes*, and start the latest
version. Every save is stored as a new immutable version with your note attached;
that is how a team can later see who changed what, and why.

You have now done the whole loop that professional quant teams do: **write → register
→ configure → paper trade → record what changed.**

---

## Backtest your strategy

After step 5 (or step 6), open **Backtests**, choose **Jcavallin Reversal (experimental)**,
and choose your saved configuration or enter a new one. Select dates with cached
or fetchable 1-minute bars, choose the initial capital and fill model, then press
**Run Backtest**. Inspect orders, fills, rejected orders, and the equity curve. If you
edit a saved configuration for a test, save a new configuration/version before using
the result as evidence for that exact saved version.

The historical worker and paper runner instantiate the same class through the
catalog. Historical playback and live execution use different data/execution adapters,
so their fills need not match. Backtesting a prototype is allowed on shared cloud
runtimes too; it does not release it for shared paper or real-money trading.

When you want the team to launch it on the shared paper account, change its manifest
status to `ready`, review/test the change, and deploy it. Real-money runs still need
the existing lead approval. The Beginner Reversal answer key is currently visible
as **Beginner Reversal (course)** so you can compare its behavior in the UI.

---

## Exercises

1. **Flip it.** Swap `"sell"` and `"buy"` so it follows the move instead of
   fading it (momentum). Bump `VERSION`. Run both side by side.
2. **A threshold.** Only trade if the bar moved more than 0.1%. Add it as a
   config parameter.
3. **Restart blindness.** Stop and start the backend mid-session. What does the
   strategy do with its first bar? Why? (Hint: the answer key's `warmUp` idea.)
4. **Retire it.** Set `status: "retired"` and restart. What disappears from the
   picker? What happens to a run that was already going?
