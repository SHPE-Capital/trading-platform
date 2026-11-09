/**
 * strategies/team3Reversal/session.ts
 *
 * New York clock helpers. The strategy uses inRegularSession() so it only
 * trades 9:30-16:00 ET; the timeOfDay filter can use the minute helpers.
 */

const NEW_YORK_CLOCK = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});
const SESSION_OPEN_MINUTE = 9 * 60 + 30;
const SESSION_CLOSE_MINUTE = 16 * 60;

/** Minutes after midnight in New York for a bar's start time, plus its weekday. */
function newYorkMinute(barTs: number): { minute: number; weekend: boolean } {
  const parts = Object.fromEntries(NEW_YORK_CLOCK.formatToParts(barTs).map((p) => [p.type, p.value]));
  return {
    minute: Number(parts.hour) * 60 + Number(parts.minute),
    weekend: parts.weekday === "Sat" || parts.weekday === "Sun",
  };
}

/**
 * True for a 1-minute bar that opens in the regular session and closes before
 * the bell. The decision is made when the bar arrives, a minute after it
 * opens, so the 15:59 bar would be decided after the close.
 */
export function inRegularSession(barTs: number): boolean {
  const { minute, weekend } = newYorkMinute(barTs);
  return !weekend && minute >= SESSION_OPEN_MINUTE && minute + 1 < SESSION_CLOSE_MINUTE;
}

/** Minutes since 9:30 ET for a bar's start time (0 for the 9:30 bar). */
export function minutesSinceOpen(barTs: number): number {
  return newYorkMinute(barTs).minute - SESSION_OPEN_MINUTE;
}

/** Minutes left until 16:00 ET after a bar's start time (1 for the 15:59 bar). */
export function minutesUntilClose(barTs: number): number {
  return SESSION_CLOSE_MINUTE - newYorkMinute(barTs).minute;
}
