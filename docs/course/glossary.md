# Glossary

| Word | Plain meaning |
|---|---|
| **Strategy** | A rule that looks at market data and decides "buy", "sell" or "do nothing". |
| **Bar** | A summary of one minute of trading: open, high, low, close prices and volume. |
| **Close** | The last price in a bar. "Closed up" means it is higher than the previous bar's close. |
| **Signal** | The strategy's decision, e.g. "sell 1 SPY". It is a request, not an order yet. |
| **Order** | What is actually sent to the broker after the platform's risk checks pass. |
| **Position** | How many shares you hold. Positive = long (you own them). Negative = short (you owe them). |
| **Long / short** | Betting a price rises (buy) / falls (sell first, buy back later). |
| **Paper trading** | Trading with pretend money on a real market feed. Real prices, no real risk. |
| **Symbol** | A stock's ticker: SPY, AAPL. |
| **Config** | The strategy's settings (symbols, max position). Same code, different config. |
| **Version** | A saved snapshot of a config. Every save makes a new one, so changes are traceable. |
| **Status** | Whether a strategy type may be launched: `planned` (hidden), `experimental` (backtest and personal paper/sim while developing), `ready` (shared trading), `retired` (no new launches; history kept). |
| **Run** | One launched instance of a strategy. It has a start, maybe a stop, and a history. |
| **Reversal** | Betting that a move will undo itself: sell after up, buy after down. |
| **Momentum** | The opposite bet: a move will continue. |
| **Backtest** | Running a strategy on past bars to see what it would have done. Works outside market hours. |
| **Manifest** | The strategy's "ID card" (`manifest.ts`): type, label, defaults, status, and the form fields. |
| **Catalog** | The list of all manifests (`strategyCatalog.ts`) the platform knows about. |
| **Interface** | A TypeScript description of an object's shape: its fields and their types. |
| **extends** | Build on something else: a class inherits methods, an interface inherits fields. |
| **readonly** | A value set once and never reassigned. |
| **Map** | A lookup table from keys (e.g. a ticker) to values (e.g. the last bar). |
| **`?.` optional chaining** | Stops safely with `undefined` if the value on the left is missing. |
| **`??` nullish default** | Uses the right-hand value if the left is `null` or `undefined`. |
| **Spread (`...`)** | Copies an object's properties into a new object; later ones overwrite earlier ones. |
| **`as` (type assertion)** | Tells TypeScript to treat a value as a type. It performs no runtime check. |
