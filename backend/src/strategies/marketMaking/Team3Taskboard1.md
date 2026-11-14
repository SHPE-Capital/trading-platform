What the file is

backend\src\strategies\marketMaking\imbalanceForecastStrategy.ts is a teaching strategy. 

It has four parts:

1. SETTINGS holds the tunable knobs: threshold 0.6, max spread 1 tick, qty 1, max position 5, max hold 60s, and a 1s decision interval.
2. Pure feature functions are imbalance(quote), spreadTicks(quote) and isUsableQuote(quote). They take a quote and return a number or boolean, so they are easy to test.
3. ImbalanceForecastStrategy extends BaseStrategy has evaluate(context), which runs these steps in order:
   - Check that the strategy is active and the quote is usable.
   - Throttle to one decision per second.
   - Read the current position.
   - Close the position if it has been held too long.
   - Compute imbalance and spread.
   - Skip if the spread is too wide.
   - Go long if imbalance is at least +0.6, short if it is at most −0.6, otherwise return null.
4. Exercises at the bottom point to a test file, tests/strategy/imbalanceForecastStrategy.test.ts, which doesn't exist yet.