jest.mock('../../../config/env', () => require('./envMock'));
import { chop, day, runTeam3, TEST_KNOBS } from './engine';
it('smoke', async () => {
  const bars = day('AAPL', '2026-10-06', [...chop(40), 101, { open: 100.9, close: 100.8 }, 100.3, 100.0, ...chop(20)]);
  const r = await runTeam3(bars, TEST_KNOBS);
  console.log(JSON.stringify(r.signals.map(s => ({ d: s.direction, q: s.qty, m: s.meta })), null, 1));
  console.log(JSON.stringify(r.fills.map(f => ({ s: f.side, q: f.qty, p: f.price, t: new Date(f.ts).toISOString() }))));
  console.log(r.strategy.book.violations, r.result.status, r.result.metrics.totalTrades);
});
