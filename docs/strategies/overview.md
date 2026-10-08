## Example Strategy Types

### **Pairs Trading**
- **Uses:**
  - two related instruments
  - spread or residual series
  - rolling mean/std
  - z-score thresholds
  - hedge ratio configuration

- **Typical logic:**
  - estimate the relationship between two instruments
  - compute the spread or residual between them
  - compare the current spread to its rolling mean and standard deviation
  - enter when deviation is large enough
  - exit when the spread reverts toward normal

- **What to parameterize:**
  - pair selection
  - rolling-window duration
  - hedge ratio method
    - fixed ratio
    - rolling regression
    - externally defined ratio
  - z-score entry threshold
  - z-score exit threshold
  - max holding time
  - stop-loss level
  - position sizing logic
  - cooldown period after exit
  - data frequency or aggregation interval

- **Why it fits the platform:**
  - uses rolling windows heavily
  - works well in backtest, replay, and live paper trading
  - easy to visualize in the frontend with spread, mean, and z-score charts

---

### **Arbitrage**
- **Uses:**
  - cross-instrument pricing relationships
  - spread/relationship validation
  - execution coordination rules

- **Typical logic:**
  - compare prices of instruments that should maintain a pricing relationship
  - detect temporary dislocations
  - enter positions designed to profit when prices converge back to fair relationship
  - manage execution carefully because the opportunity may disappear quickly

- **What to parameterize:**
  - instruments involved
  - fair-value relationship model
  - minimum spread threshold
  - execution sequencing rules
  - slippage assumptions
  - timeout before cancel/exit
  - max exposure
  - transaction-cost assumptions
  - aggregation interval or event type used

- **Why it fits the platform:**
  - reinforces event-driven execution logic
  - highlights the importance of latency and execution coordination
  - useful for replay and simulated execution experiments

---

### **Avellaneda-Stoikov Inventory-Aware Market Making**
- **Uses:**
  - midprice
  - volatility estimate
  - inventory level
  - risk aversion
  - market order arrival assumptions
  - reservation price and optimal spread calculations

- **Typical logic:**
  - continuously quote both bid and ask around a dynamically adjusted fair value
  - shift quotes depending on current inventory so the strategy reduces inventory risk
  - widen or narrow spreads depending on volatility, market conditions, and model parameters
  - try to earn spread capture while controlling inventory buildup

- **Core idea:**
  - instead of only predicting direction, the strategy manages two-sided quoting
  - the model computes a **reservation price** that shifts away from the observed midprice when inventory becomes too long or too short
  - it then computes an **optimal spread** based on volatility, risk aversion, time horizon, and fill assumptions
  - quotes are posted around that reservation price

- **Typical model components:**
  - current midprice
  - current inventory
  - short-term volatility estimate
  - time remaining in trading horizon
  - arrival-rate sensitivity or liquidity parameter
  - risk-aversion coefficient

- **What to parameterize:**
  - symbol or instrument universe
  - quote update frequency
  - inventory limit
  - target inventory
  - risk-aversion coefficient
  - volatility lookback window
  - trading horizon length
  - minimum quote spread
  - maximum quote spread
  - order size per quote
  - max total notional exposure
  - reservation price formula options
  - spread calculation formula options
  - inventory skew strength
  - quote refresh interval
  - cancel/replace threshold
  - stale quote timeout
  - fill handling rules
  - session trading hours
  - kill-switch thresholds for extreme volatility or inventory imbalance

- **Important derived values to track:**
  - midprice
  - microprice
  - short-term realized volatility
  - current inventory
  - current reservation price
  - current optimal bid/ask quotes
  - quoted spread
  - fill rate
  - inventory drift over time
  - mark-to-market PnL
  - realized spread capture

- **Why it fits the platform:**
  - very strong example of event-driven trading architecture
  - naturally uses rolling windows and in-memory state
  - requires real-time recalculation of quotes as events arrive
  - highlights the importance of separating market data, state, strategy logic, risk, and execution
  - gives a more realistic view of HFT-style system design than slower directional strategies

- **Frontend visualization ideas:**
  - current inventory over time
  - reservation price vs midprice
  - current bid/ask quotes
  - realized spread capture
  - quote update frequency
  - fill events and inventory changes

- **Notes on implementation:**
  - this strategy is much more sensitive to event timing and state updates than slower strategies
  - for a simple initial version, it can run on top-of-book quote updates only
  - later versions could incorporate order book imbalance, queue position estimates, and more advanced fill models

---

### **Neural Network Strategy Based on Technical Indicators**
- **Uses:**
  - derived indicator features instead of HFT-style microstructure signals
  - indicators such as SMA, EMA, ATR, RSI, MACD, Bollinger Bands, returns, and volume-based features
  - supervised learning to predict future return, direction, or regime

- **Typical logic:**
  - compute a set of technical indicators over historical price data
  - feed those indicators into a neural network model
  - train the model to predict a target such as:
    - next-period return
    - up/down direction
    - probability of favorable move
    - volatility regime
  - convert model output into trading decisions using configurable thresholds

- **Core idea:**
  - unlike the HFT-oriented strategies, this is more of a predictive modeling pipeline
  - it relies on feature engineering, model training, validation, and tuning
  - it is better suited to slower strategies based on bars rather than raw tick-by-tick execution
  - it still fits the platform because it can plug into the same backtest, replay, and portfolio framework

- **What to parameterize:**
  - symbol universe
  - bar timeframe
    - 1 minute
    - 5 minute
    - 1 hour
    - daily
  - prediction target
    - next return
    - next direction
    - multi-class regime
  - prediction horizon
  - training window length
  - validation/test split
  - retraining frequency
  - input feature set
  - neural network depth
  - hidden layer size
  - activation functions
  - dropout rate
  - learning rate
  - batch size
  - number of epochs
  - optimizer type
  - output threshold for entering trades
  - confidence threshold
  - stop-loss and take-profit settings
  - max position size
  - cooldown after signal

- **Indicators/features to support:**
  - SMA with configurable periods
  - EMA with configurable periods
  - ATR with configurable periods
  - RSI
  - MACD
  - Bollinger Bands
  - rolling volatility
  - rolling returns
  - volume change
  - price relative to moving averages
  - momentum over multiple horizons

- **How to handle “finding the best values” for indicators:**
  - treat indicator periods as hyperparameters
  - define a search space for things like:
    - SMA periods
    - EMA periods
    - ATR periods
    - RSI lookback
    - Bollinger window and band width
  - run systematic optimization during training/backtesting
  - compare candidate parameter sets using validation metrics
  - keep the best-performing feature configuration
  - then train the final neural network on the selected features/periods

- **Ways to optimize indicator/model settings:**
  - grid search
  - random search
  - Bayesian optimization later if needed
  - walk-forward validation to reduce overfitting
  - separate training, validation, and test periods

- **Important derived values to track:**
  - selected indicator parameters
  - current feature vector
  - model prediction
  - prediction confidence
  - training/validation metrics
  - feature importance approximations if available
  - live trade decisions generated from model output
  - performance by retraining period

- **Why it fits the platform:**
  - adds a very different class of strategy from HFT-style execution algorithms
  - shows that the platform can support both event-driven trading logic and ML-driven research workflows
  - works especially well in backtesting and replay
  - valuable for demonstrating modular strategy support and experimentation tooling

- **How it differs from the high-frequency strategies:**
  - relies more on historical feature engineering than ultra-low-latency event reaction
  - usually operates on bars rather than quote-by-quote market microstructure
  - focuses more on predictive modeling and parameter tuning
  - places more importance on training pipeline, validation, and overfitting control than execution speed alone

- **Frontend visualization ideas:**
  - selected indicators and their chosen periods
  - model predictions vs actual outcomes
  - training/validation loss
  - strategy equity curve
  - feature values at signal times
  - parameter search results
  - confusion matrix or directional accuracy metrics for classification-based models

- **Notes on implementation:**
  - this strategy should likely have a separate training workflow from live execution workflow
  - training can occur offline, while live trading only loads the trained model and computes current features
  - to keep architecture clean, the model-training pipeline can be treated as a research module that outputs a deployable strategy configuration and trained weights