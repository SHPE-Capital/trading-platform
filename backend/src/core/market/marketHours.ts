/**
 * core/market/marketHours.ts
 *
 * Whether the equity market is open, for the risk engine's MARKET_CLOSED check.
 * A market order sent while the market is closed sits at the broker until the
 * open and fills at whatever price the open brings — never what the strategy
 * saw when it decided.
 *
 *   - regularSessionHours: NYSE regular session (09:30–16:00 America/New_York,
 *     weekdays). No holiday calendar, so it errs towards "open" on holidays.
 *   - AlpacaClockHours: follows Alpaca's /v2/clock, which knows holidays and
 *     early closes. Refreshed in the background; between refreshes it trusts the
 *     last reported window and falls back to the regular session past it.
 *   - alwaysOpen: for replayed sessions, whose bars are already in-session.
 */

import { logger } from "../../utils/logger";

export interface MarketHours {
  isOpen(ts: number): boolean;
}

export const alwaysOpen: MarketHours = { isOpen: () => true };

const NY_PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const OPEN_MINUTE = 9 * 60 + 30;
const CLOSE_MINUTE = 16 * 60;

export const regularSessionHours: MarketHours = {
  isOpen(ts: number): boolean {
    const parts = Object.fromEntries(NY_PARTS.formatToParts(new Date(ts)).map((p) => [p.type, p.value]));
    if (parts.weekday === "Sat" || parts.weekday === "Sun") return false;
    const minute = Number(parts.hour) * 60 + Number(parts.minute);
    return minute >= OPEN_MINUTE && minute < CLOSE_MINUTE;
  },
};

export interface AlpacaClock {
  is_open: boolean;
  next_open: string;
  next_close: string;
}

export class AlpacaClockHours implements MarketHours {
  private open: boolean | null = null;
  /** Until when `open` holds: the next close while open, the next open while closed. */
  private validUntil = 0;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly fetchClock: () => Promise<AlpacaClock>,
    private readonly fallback: MarketHours = regularSessionHours,
  ) {}

  isOpen(ts: number): boolean {
    if (this.open !== null && ts < this.validUntil) return this.open;
    return this.fallback.isOpen(ts);
  }

  async refresh(): Promise<void> {
    try {
      const clock = await this.fetchClock();
      this.open = clock.is_open;
      this.validUntil = new Date(clock.is_open ? clock.next_close : clock.next_open).getTime();
    } catch (err) {
      logger.warn("AlpacaClockHours: clock refresh failed — using the regular session", { err: String(err) });
    }
  }

  /** Refreshes now, then every `intervalMs`. */
  async start(intervalMs = 60_000): Promise<void> {
    await this.refresh();
    this.timer = setInterval(() => void this.refresh(), intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
