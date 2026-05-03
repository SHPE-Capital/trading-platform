import { PortfolioStateManager } from '../../core/state/portfolioState';
import type { Fill } from '../../types/orders';

function makeFill(overrides: Partial<Fill> = {}): Fill {
  return {
    id: 'fill-1',
    orderId: 'order-1',
    symbol: 'SPY',
    side: 'buy',
    qty: 10,
    price: 500,
    notional: 5000,
    commission: 1,
    ts: Date.now(),
    isoTs: new Date().toISOString(),
    ...overrides,
  };
}

describe('PortfolioStateManager', () => {
  const INITIAL = 100_000;
  let pm: PortfolioStateManager;

  beforeEach(() => {
    pm = new PortfolioStateManager(INITIAL);
  });

  describe('initial state', () => {
    it('getCash returns initialCapital', () => {
      expect(pm.getCash()).toBe(INITIAL);
    });

    it('getAllPositions is empty', () => {
      expect(pm.getAllPositions()).toEqual([]);
    });

    it('snapshot equity equals initialCapital', () => {
      expect(pm.getSnapshot().equity).toBe(INITIAL);
    });

    it('snapshot totalPnl is 0', () => {
      expect(pm.getSnapshot().totalPnl).toBe(0);
    });

    it('snapshot returnPct is 0', () => {
      expect(pm.getSnapshot().returnPct).toBe(0);
    });
  });

  describe('buy fill: new position', () => {
    it('decrements cash by qty × price + commission', () => {
      pm.applyFill(makeFill({ qty: 10, price: 500, commission: 1 }));
      // cash -= 10*500 (buy) then cash -= 1 (commission) = 100000 - 5000 - 1 = 94999
      expect(pm.getCash()).toBe(INITIAL - 10 * 500 - 1);
    });

    it('creates a position with correct fields', () => {
      pm.applyFill(makeFill({ qty: 10, price: 500 }));
      const pos = pm.getPosition('SPY');
      expect(pos).not.toBeNull();
      expect(pos!.qty).toBe(10);
      expect(pos!.avgEntryPrice).toBe(500);
      expect(pos!.costBasis).toBe(5000);
      expect(pos!.marketValue).toBe(5000);
      expect(pos!.unrealizedPnl).toBe(0);
    });
  });

  describe('buy fill: increase existing position', () => {
    it('computes weighted average entry price', () => {
      pm.applyFill(makeFill({ qty: 10, price: 500, commission: 0 }));
      pm.applyFill(makeFill({ qty: 10, price: 600, commission: 0 }));
      const pos = pm.getPosition('SPY');
      expect(pos!.qty).toBe(20);
      // (500*10 + 600*10) / 20 = 550
      expect(pos!.avgEntryPrice).toBe(550);
      expect(pos!.costBasis).toBe(550 * 20);
    });
  });

  describe('sell fill: full close', () => {
    it('removes position, updates cash, books realized PnL', () => {
      pm.applyFill(makeFill({ side: 'buy', qty: 10, price: 500, commission: 0 }));
      const cashAfterBuy = pm.getCash();

      pm.applyFill(makeFill({ side: 'sell', qty: 10, price: 600, commission: 0 }));

      expect(pm.getPosition('SPY')).toBeNull();
      // cash increases by 10 * 600 = 6000 (commission=0)
      expect(pm.getCash()).toBe(cashAfterBuy + 10 * 600);
      // realized PnL = 10 * (600-500) = 1000
      expect(pm.getSnapshot().totalRealizedPnl).toBe(1000);
      expect(pm.getSnapshot().totalUnrealizedPnl).toBe(0);
    });
  });

  describe('sell fill: partial close', () => {
    it('reduces qty, keeps avgEntry, books partial PnL', () => {
      pm.applyFill(makeFill({ side: 'buy', qty: 10, price: 500, commission: 0 }));
      pm.applyFill(makeFill({ side: 'sell', qty: 4, price: 600, commission: 0 }));

      const pos = pm.getPosition('SPY');
      expect(pos).not.toBeNull();
      expect(pos!.qty).toBe(6);
      expect(pos!.avgEntryPrice).toBe(500);
      expect(pos!.realizedPnl).toBe(400); // 4 * (600-500)
      expect(pos!.costBasis).toBe(6 * 500);
    });
  });

  describe('sell fill: no existing position (opens short)', () => {
    it('does not throw', () => {
      expect(() =>
        pm.applyFill(makeFill({ side: 'sell', qty: 5, price: 100, commission: 0 }))
      ).not.toThrow();
    });

    it('cash increases by short sale proceeds', () => {
      const before = pm.getCash();
      pm.applyFill(makeFill({ side: 'sell', qty: 5, price: 100, commission: 0 }));
      expect(pm.getCash()).toBe(before + 5 * 100);
    });

    it('opens a short position with correct fields', () => {
      pm.applyFill(makeFill({ side: 'sell', qty: 5, price: 100, commission: 0 }));
      const pos = pm.getPosition('SPY');
      expect(pos).not.toBeNull();
      expect(pos!.qty).toBe(-5);
      expect(pos!.avgEntryPrice).toBe(100);
      expect(pos!.marketValue).toBe(-500);
      expect(pos!.costBasis).toBe(-500);
      expect(pos!.unrealizedPnl).toBe(0);
    });
  });

  describe('sell fill: increase existing short', () => {
    it('computes weighted average entry price for a deepened short', () => {
      pm.applyFill(makeFill({ side: 'sell', qty: 5, price: 100, commission: 0 })); // short 5 at 100
      pm.applyFill(makeFill({ side: 'sell', qty: 3, price: 80, commission: 0 }));  // add 3 at 80
      const pos = pm.getPosition('SPY')!;
      expect(pos.qty).toBe(-8);
      // weighted avg = (100*5 + 80*3) / 8 = (500+240)/8 = 92.5
      expect(pos.avgEntryPrice).toBeCloseTo(92.5, 5);
    });
  });

  describe('buy fill: cover a short position', () => {
    it('realizes profit when covering at a lower price', () => {
      pm.applyFill(makeFill({ side: 'sell', qty: 10, price: 100, commission: 0 })); // short at 100
      pm.applyFill(makeFill({ side: 'buy', qty: 10, price: 80, commission: 0 }));   // cover at 80
      expect(pm.getPosition('SPY')).toBeNull();
      // pnl = (100 - 80) * 10 = 200
      expect(pm.getSnapshot().totalRealizedPnl).toBe(200);
    });

    it('realizes loss when covering at a higher price', () => {
      pm.applyFill(makeFill({ side: 'sell', qty: 10, price: 100, commission: 0 })); // short at 100
      pm.applyFill(makeFill({ side: 'buy', qty: 10, price: 120, commission: 0 }));  // cover at 120
      expect(pm.getPosition('SPY')).toBeNull();
      // pnl = (100 - 120) * 10 = -200
      expect(pm.getSnapshot().totalRealizedPnl).toBe(-200);
    });

    it('partial cover reduces short qty', () => {
      pm.applyFill(makeFill({ side: 'sell', qty: 10, price: 100, commission: 0 }));
      pm.applyFill(makeFill({ side: 'buy', qty: 4, price: 90, commission: 0 }));
      const pos = pm.getPosition('SPY')!;
      expect(pos.qty).toBe(-6);
      expect(pos.avgEntryPrice).toBe(100);
      // realized = (100 - 90) * 4 = 40
      expect(pos.realizedPnl).toBe(40);
    });
  });

  describe('sell fill: cross from long to short', () => {
    it('books long PnL and opens a short for the excess qty', () => {
      pm.applyFill(makeFill({ side: 'buy', qty: 5, price: 100, commission: 0 }));   // long 5 at 100
      pm.applyFill(makeFill({ side: 'sell', qty: 8, price: 110, commission: 0 }));  // sell 8: closes 5, shorts 3
      const pos = pm.getPosition('SPY')!;
      expect(pos.qty).toBe(-3);
      expect(pos.avgEntryPrice).toBe(110);
      // realized pnl from closing the long = 5 * (110 - 100) = 50
      expect(pm.getSnapshot().totalRealizedPnl).toBe(50);
    });
  });

  describe('updatePrice()', () => {
    it('updates marketValue, unrealizedPnl, unrealizedPnlPct', () => {
      pm.applyFill(makeFill({ qty: 10, price: 500, commission: 0 }));
      pm.updatePrice('SPY', 550);

      const pos = pm.getPosition('SPY')!;
      expect(pos.currentPrice).toBe(550);
      expect(pos.marketValue).toBe(10 * 550);
      expect(pos.unrealizedPnl).toBe(10 * (550 - 500));
      expect(pos.unrealizedPnlPct).toBeCloseTo(500 / 5000, 5);
    });

    it('snapshot equity equals cash + market value', () => {
      pm.applyFill(makeFill({ qty: 10, price: 500, commission: 0 }));
      pm.updatePrice('SPY', 550);
      const snap = pm.getSnapshot();
      expect(snap.equity).toBe(snap.cash + 10 * 550);
    });

    it('calling on unknown symbol does not throw', () => {
      expect(() => pm.updatePrice('UNKNOWN', 100)).not.toThrow();
    });
  });

  describe('getSnapshot() consistency', () => {
    it('invariants hold after buys + price updates + partial sell', () => {
      pm.applyFill(makeFill({ side: 'buy', qty: 10, price: 500, commission: 0 }));
      pm.applyFill(makeFill({ side: 'buy', qty: 5, price: 400, symbol: 'AAPL', commission: 0 }));
      pm.updatePrice('SPY', 520);
      pm.updatePrice('AAPL', 410);
      pm.applyFill(makeFill({ side: 'sell', qty: 3, price: 520, commission: 0 }));

      const snap = pm.getSnapshot();
      const positionsValue = pm.getAllPositions().reduce((s, p) => s + p.marketValue, 0);

      expect(snap.equity).toBeCloseTo(snap.cash + positionsValue, 5);
      expect(snap.totalPnl).toBeCloseTo(snap.totalUnrealizedPnl + snap.totalRealizedPnl, 5);
      expect(snap.returnPct).toBeCloseTo(snap.totalPnl / INITIAL, 5);
      expect(snap.positionCount).toBe(pm.getAllPositions().length);
    });
  });

  describe('reset()', () => {
    it('restores cash to initialCapital', () => {
      pm.applyFill(makeFill());
      pm.reset();
      expect(pm.getCash()).toBe(INITIAL);
    });

    it('clears all positions', () => {
      pm.applyFill(makeFill());
      pm.reset();
      expect(pm.getAllPositions()).toEqual([]);
    });

    it('clears totalRealizedPnl', () => {
      pm.applyFill(makeFill({ side: 'buy', qty: 10, price: 500, commission: 0 }));
      pm.applyFill(makeFill({ side: 'sell', qty: 10, price: 600, commission: 0 }));
      pm.reset();
      expect(pm.getSnapshot().totalRealizedPnl).toBe(0);
    });
  });
});
