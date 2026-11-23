# Stream P3: Dashboard and reporting

Back to [MOMENTUM_TASKS.md](MOMENTUM_TASKS.md). Repo: **trading-platform**
(frontend plus a small backend API).

The guide requires the SHPE adapter to publish status and results to the club
backend and dashboard (§12, §16). This stream is independent until the end:
build against mock data now and switch to real data when P1-2 and E2 land.

Frontend rule: `frontend/AGENTS.md` requires reading the installed Next.js
documentation before changing code. Checks: `npm --prefix frontend run lint`,
`npm --prefix frontend run test`, `npm --prefix frontend run build`.

---

## P3-1 Backend API for momentum status and results

- **Owns:** `backend/src/app/routes/momentum.ts`,
  `backend/src/app/controllers/momentumController.ts`, tests under
  `backend/src/tests/controllers/`; artifact storage decision with P1-2
  (**Coordinate** on any migration with P2-6)
- **Depends on:** 0-A schema; E2 JSON summary format
- **Work:**
  - `GET` the active weekly config (policy, config ID, filters and
    parameters, universe, activation week, freshness, `no_deployment` reason)
  - `GET` live status (entries enabled or disabled and why, open positions,
    daily halt state, last bar time)
  - `POST` (backend-only auth) to upload a weekly artifact and a research
    results summary
  - Never expose credentials or unneeded account details (§16).
- **Done when:** the endpoints are tested and return fixture data.

## P3-2 Momentum live page

- **Owns:** `frontend/app/momentum/`, `frontend/features/momentum/`, tests in
  `frontend/__tests__/`
- **Depends on:** nothing (mock data); P3-1 for real data
- **Work:** show the active weekly configuration in plain language (for
  example "20-minute breakout + EMA trend + relative volume"), artifact
  freshness, the universe, entries enabled or disabled with the reason, open
  positions with stop levels and time left before the 60-minute exit, today's
  PnL against the 1% halt line, and recent orders with their audit chain (from
  P2-6).
- **Done when:** the page renders with mock data and passes lint, tests and
  build.

## P3-3 Research results view

- **Owns:** `frontend/features/momentum/results/`
- **Depends on:** E2 JSON summary (mock it from E2's schema now)
- **Work:** the three policies' equity curves on one calendar, the paired
  Similarity − Recency difference with its bootstrap interval, cost
  sensitivity, a weekly table (selected config per policy, or no deployment),
  and calibration runtime. Label every chart with the strategy, data version,
  cost model and forward period (guide "Document control").
- **Done when:** it renders from the E2 fixture, and it is used in the
  presentation (E7).
