/**
 * runtime/team3Analysis/earnings.ts
 *
 * Stage 4 earnings-day tags. Source: SEC EDGAR, each company's 8-K filings whose items include 2.02
 * ("Results of Operations and Financial Condition"), i.e. its earnings release.
 *
 * Earnings days for one filing:
 *   - the filing's ET date, and
 *   - the next weekday when it was accepted at or after 16:00 ET (an after-close release trades next day).
 * Exchange holidays are not skipped (a release before a holiday tags the holiday, which has no trades).
 *
 * SEC requires a contact in the User-Agent: pass it in SEC_USER_AGENT at run time. It is sent to sec.gov
 * only and is never written to disk.
 *
 * Usage (from backend/): SEC_USER_AGENT="Team3 Research <email>" npx ts-node --transpile-only src/runtime/team3Analysis/earnings.ts
 * Writes docs/team3/stage4/earnings.json: { symbol: { cik, filings: [{ filed, accepted }], days: [YYYY-MM-DD] } }.
 */

import { writeFileSync } from "fs";
import path from "path";
import { TEAM3_GROUPS } from "../../strategies/team3Reversal/contract/protocol";

export const EARNINGS_PATH = path.resolve(__dirname, "../../../../docs/team3/stage4/earnings.json");
export const RANGE = { from: "2025-08-01", to: "2026-11-30" };

/** The symbols Stage 4 trades: Momentum (4b) and the expanded 25 (4a). SPY is never traded. */
export const STAGE4_SYMBOLS = [...new Set([...TEAM3_GROUPS.momentum, ...TEAM3_GROUPS.expanded])].filter((s) => s !== "SPY").sort();

export interface Filing { filed: string; accepted: string }

const nextWeekday = (day: string): string => {
  const d = new Date(`${day}T12:00:00Z`);
  do d.setUTCDate(d.getUTCDate() + 1); while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
  return d.toISOString().slice(0, 10);
};

/**
 * Days a filing tags. EDGAR's acceptanceDateTime carries Eastern clock time (with a literal "Z"),
 * so the clock is read as ET as written.
 */
export function earningsDays(f: Filing): string[] {
  const hour = Number(f.accepted.slice(11, 13));
  const day = f.accepted.slice(0, 10) || f.filed;
  return hour >= 16 ? [day, nextWeekday(day)] : [day];
}

/** 8-K filings with item 2.02 inside RANGE, from EDGAR's submissions "recent" arrays. */
export function earningsFilings(recent: { form: string[]; filingDate: string[]; acceptanceDateTime: string[]; items: string[] }): Filing[] {
  const out: Filing[] = [];
  for (let i = 0; i < recent.form.length; i++) {
    if (recent.form[i] !== "8-K" || !String(recent.items[i] ?? "").split(",").map((s) => s.trim()).includes("2.02")) continue;
    const filed = recent.filingDate[i];
    if (filed < RANGE.from || filed > RANGE.to) continue;
    out.push({ filed, accepted: recent.acceptanceDateTime[i] });
  }
  return out.sort((a, b) => (a.accepted < b.accepted ? -1 : 1));
}

async function getJson(url: string, ua: string): Promise<any> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { headers: { "User-Agent": ua, Accept: "application/json" } });
    if (res.ok) return res.json();
    if (attempt >= 4 || (res.status !== 429 && res.status < 500)) throw new Error(`SEC ${res.status} for ${url}`);
    await new Promise((r) => setTimeout(r, 1000 * attempt));
  }
}

async function main(): Promise<void> {
  const ua = process.env.SEC_USER_AGENT?.trim();
  if (!ua || !ua.includes("@")) throw new Error("set SEC_USER_AGENT to \"<name> <contact email>\" (SEC requires a contact)");
  const tickers = await getJson("https://www.sec.gov/files/company_tickers.json", ua) as Record<string, { cik_str: number; ticker: string }>;
  const cikOf = new Map(Object.values(tickers).map((t) => [t.ticker.toUpperCase(), t.cik_str]));
  const out: Record<string, { cik: string; filings: Filing[]; days: string[] }> = {};
  for (const sym of STAGE4_SYMBOLS) {
    const cikNum = cikOf.get(sym);
    if (!cikNum) throw new Error(`no CIK for ${sym}`);
    const cik = String(cikNum).padStart(10, "0");
    const sub = await getJson(`https://data.sec.gov/submissions/CIK${cik}.json`, ua);
    const filings = earningsFilings(sub.filings.recent);
    const days = [...new Set(filings.flatMap(earningsDays))].sort();
    out[sym] = { cik, filings, days };
    console.log(`${sym} cik ${cik}: ${filings.length} item-2.02 8-Ks, ${days.length} days`);
    await new Promise((r) => setTimeout(r, 150)); // SEC asks for <= 10 requests/s
  }
  writeFileSync(EARNINGS_PATH, JSON.stringify({ source: "SEC EDGAR 8-K item 2.02", range: RANGE, symbols: out }, null, 2) + "\n");
  console.log(`wrote ${EARNINGS_PATH}`);
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
