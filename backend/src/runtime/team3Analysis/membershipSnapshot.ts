/**
 * runtime/team3Analysis/membershipSnapshot.ts
 *
 * Stage 4a candidate pool: S&P 500 + Nasdaq-100 membership as of 2026-08-31 (no survivorship
 * from today's lists). Source: English Wikipedia, the last revision of each list page at or
 * before the cutoff, fetched once and committed as docs/team3/stage4/membership-2026-08-31.json.
 * selectUniverse.ts reads only that file, so reruns never depend on Wikipedia.
 *
 *   S&P 500     "List of S&P 500 companies"     GICS sector + CIK.
 *   Nasdaq-100  "List of NASDAQ-100 companies"  ICB industry only (no GICS on the page).
 *
 * Sector: the S&P table's GICS sector wins. A Nasdaq-only name gets its ICB industry mapped to
 * the nearest GICS sector (ICB_TO_GICS) and is flagged sectorSource "icb".
 *
 * Usage (from backend/): npx ts-node --transpile-only src/runtime/team3Analysis/membershipSnapshot.ts
 */

import { mkdirSync, writeFileSync } from "fs";
import path from "path";

export const CUTOFF = "2026-08-31T23:59:59Z";
export const PAGES = { sp500: "List of S&P 500 companies", ndx100: "List of NASDAQ-100 companies" } as const;
export const SNAPSHOT_PATH = path.resolve(__dirname, "../../../../docs/team3/stage4/membership-2026-08-31.json");

const UA = "team3-research-membership-snapshot/1.0";
const API = "https://en.wikipedia.org/w/api.php";

/** ICB industry -> nearest GICS sector, for Nasdaq-100 names not in the S&P 500. */
export const ICB_TO_GICS: Record<string, string> = {
  "Technology": "Information Technology",
  "Telecommunications": "Communication Services",
  "Health Care": "Health Care",
  "Financials": "Financials",
  "Real Estate": "Real Estate",
  "Consumer Discretionary": "Consumer Discretionary",
  "Consumer Staples": "Consumer Staples",
  "Industrials": "Industrials",
  "Basic Materials": "Materials",
  "Energy": "Energy",
  "Utilities": "Utilities",
};

export interface Member {
  ticker: string;
  name: string;
  sector: string;
  sectorSource: "gics" | "icb";
  cik: string | null;
  indices: ("sp500" | "ndx100")[];
}

export interface Snapshot {
  cutoff: string;
  sources: Record<keyof typeof PAGES, { title: string; revid: number; timestamp: string }>;
  members: Member[];
}

/** Rows (arrays of cell text) of the wikitable with id="constituents". */
export function constituentRows(wikitext: string): string[][] {
  const start = wikitext.indexOf('id="constituents"');
  if (start < 0) throw new Error('no id="constituents" table');
  const end = wikitext.indexOf("\n|}", start);
  const body = wikitext.slice(wikitext.indexOf("\n", start) + 1, end);
  const rows: string[][] = [];
  let cur: string[] = [];
  for (const raw of body.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("|-")) { if (cur.length) rows.push(cur); cur = []; continue; }
    if (!line.startsWith("|")) continue; // header lines start with "!"
    cur.push(...line.replace(/^\|\|?/, "").split("||").map(clean));
  }
  if (cur.length) rows.push(cur);
  return rows;
}

/** Wikitext cell -> plain text: refs, symbol templates and links removed. */
export function clean(cell: string): string {
  return cell
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<ref[^>]*\/>/g, "")
    .replace(/\{\{BZX link\|([^}|]+)[^}]*\}\}/gi, "$1")
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, "")
    .replace(/\{\{(?:Nyse|Nasdaq|Cboe|Bats)?Symbol\|([^}|]+)[^}]*\}\}/gi, "$1")
    .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, "$1")
    .replace(/\{\{[^}]*\}\}/g, "")
    .trim();
}

/** Alpaca spells class shares with a dot (BRK.B); Wikipedia sometimes uses BRK-B. */
export const normTicker = (t: string): string => t.trim().toUpperCase().replace(/-/g, ".");

export function buildMembers(spWiki: string, ndxWiki: string): Member[] {
  const byTicker = new Map<string, Member>();
  for (const r of constituentRows(spWiki)) {
    // Symbol, Security, GICS Sector, Sub-Industry, HQ, Date added, CIK, Founded
    if (r.length < 7) throw new Error(`S&P row too short: ${r.join(" | ")}`);
    const ticker = normTicker(r[0]);
    if (!/^[A-Z]+(\.[A-Z])?$/.test(ticker)) throw new Error(`unparsed S&P ticker "${r[0]}" (${r[1]})`);
    byTicker.set(ticker, { ticker, name: r[1], sector: r[2], sectorSource: "gics", cik: r[6] || null, indices: ["sp500"] });
  }
  for (const r of constituentRows(ndxWiki)) {
    // Ticker, Company, ICB Industry, ICB Subsector
    if (r.length < 3) throw new Error(`Nasdaq row too short: ${r.join(" | ")}`);
    const ticker = normTicker(r[0]);
    if (!/^[A-Z]+(\.[A-Z])?$/.test(ticker)) throw new Error(`unparsed Nasdaq ticker "${r[0]}" (${r[1]})`);
    const have = byTicker.get(ticker);
    if (have) { have.indices.push("ndx100"); continue; }
    const sector = ICB_TO_GICS[r[2]];
    if (!sector) throw new Error(`no GICS mapping for ICB industry "${r[2]}" (${ticker})`);
    byTicker.set(ticker, { ticker, name: r[1], sector, sectorSource: "icb", cik: null, indices: ["ndx100"] });
  }
  return [...byTicker.values()].sort((a, b) => (a.ticker < b.ticker ? -1 : 1));
}

async function getJson(params: Record<string, string>): Promise<any> {
  const res = await fetch(`${API}?${new URLSearchParams({ format: "json", formatversion: "2", ...params })}`, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`Wikipedia API ${res.status}`);
  return res.json();
}

async function revisionAtCutoff(title: string): Promise<{ title: string; revid: number; timestamp: string; content: string }> {
  const j = await getJson({
    action: "query", prop: "revisions", titles: title, rvstart: CUTOFF, rvdir: "older", rvlimit: "1",
    rvprop: "ids|timestamp|content", rvslots: "main",
  });
  const rev = j.query.pages[0].revisions?.[0];
  if (!rev) throw new Error(`no revision of "${title}" at or before ${CUTOFF}`);
  if (Date.parse(rev.timestamp) > Date.parse(CUTOFF)) throw new Error(`revision after cutoff: ${rev.timestamp}`);
  return { title, revid: rev.revid, timestamp: rev.timestamp, content: rev.slots.main.content };
}

async function main(): Promise<void> {
  const sp = await revisionAtCutoff(PAGES.sp500);
  const ndx = await revisionAtCutoff(PAGES.ndx100);
  const members = buildMembers(sp.content, ndx.content);
  const snap: Snapshot = {
    cutoff: CUTOFF,
    sources: {
      sp500: { title: sp.title, revid: sp.revid, timestamp: sp.timestamp },
      ndx100: { title: ndx.title, revid: ndx.revid, timestamp: ndx.timestamp },
    },
    members,
  };
  mkdirSync(path.dirname(SNAPSHOT_PATH), { recursive: true });
  writeFileSync(SNAPSHOT_PATH, JSON.stringify(snap, null, 2) + "\n");
  const n = (k: "sp500" | "ndx100") => members.filter((m) => m.indices.includes(k)).length;
  console.log(`members ${members.length} (S&P ${n("sp500")}, Nasdaq-100 ${n("ndx100")}, Nasdaq-only ${members.filter((m) => m.sectorSource === "icb").length})`);
  console.log(`S&P rev ${sp.revid} ${sp.timestamp}; Nasdaq-100 rev ${ndx.revid} ${ndx.timestamp}`);
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
