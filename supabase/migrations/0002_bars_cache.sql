-- Part 03 — Shared bar cache
--
-- BacktestLoader pages 10,000 bars at a time from Alpaca. A year of one pair is
-- ~20 page requests; twelve members running sweeps re-download the same bars
-- hundreds of times and hit the rate limit long before CPU saturates.
--
-- Loader reads here first, falls back to Alpaca on a miss, and backfills.

create table bars (
  symbol      text        not null,
  timeframe   text        not null,   -- '1Min', '1Day', ... as passed to streamBars
  ts          timestamptz not null,

  open        double precision not null,
  high        double precision not null,
  low         double precision not null,
  close       double precision not null,
  volume      double precision not null,
  trade_count integer,
  vwap        double precision,

  -- Alpaca revises recent bars; track ingest time so a backfill can refresh them.
  fetched_at  timestamptz not null default now(),

  primary key (symbol, timeframe, ts)
);

-- The loader's access pattern: one symbol+timeframe over a date range, in order.
-- The PK already covers this, but BRIN is far smaller for the append-only scan.
create index bars_ts_brin on bars using brin (ts);

-- Records which (symbol, timeframe, day) ranges are known-complete, so a miss can
-- be distinguished from a genuinely empty day (holiday, halt, pre-listing).
create table bar_coverage (
  symbol      text not null,
  timeframe   text not null,
  day         date not null,
  bar_count   integer not null,
  complete    boolean not null default true,
  fetched_at  timestamptz not null default now(),
  primary key (symbol, timeframe, day)
);
