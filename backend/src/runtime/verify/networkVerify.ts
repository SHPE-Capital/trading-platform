/**
 * runtime/verify/networkVerify.ts
 *
 * Read-only connectivity check for every external service the platform talks
 * to: the Alpaca trading REST API, the Alpaca historical data API, the Alpaca
 * market-data WebSocket, and Supabase. It goes through the real adapters, so a
 * pass means the shipped code paths reach the service and parse its response —
 * not merely that a host resolves.
 *
 * Nothing here mutates anything: only GETs, plus a WebSocket that authenticates,
 * subscribes and disconnects. It never submits, replaces or cancels an order,
 * and it refuses to run against a live-money account.
 *
 * Checks that need credentials the environment does not hold are reported
 * SKIP, not FAIL, so the script is usable on a machine with partial config.
 *
 * Usage: npx ts-node src/runtime/verify/networkVerify.ts
 * Exit code: 0 when nothing failed (skips are fine), 1 on any failure.
 */

import "dotenv/config";
import { env } from "../../config/env";
import { alpacaGet, alpacaTradingBaseUrl } from "../../adapters/alpaca/rest";
import { AlpacaBroker } from "../../adapters/alpaca/alpacaBroker";
import { AlpacaHistoricalClient } from "../../adapters/alpaca/historicalData";
import { AlpacaMarketDataAdapter } from "../../adapters/alpaca/marketData";
import { EventBus } from "../../core/engine/eventBus";

/** How long the WebSocket check waits for connect + authenticate. */
const WS_TIMEOUT_MS = 15_000;
/** How long a single REST check may take before it is called a failure. */
const REST_TIMEOUT_MS = 20_000;

type Status = "PASS" | "FAIL" | "SKIP";

interface Result {
  name: string;
  status: Status;
  detail: string;
}

const results: Result[] = [];

function record(status: Status, name: string, detail = ""): void {
  results.push({ name, status, detail });
  const icon = status === "PASS" ? "PASS" : status === "FAIL" ? "FAIL" : "SKIP";
  console.log(`  [${icon}] ${name}${detail ? ` - ${detail}` : ""}`);
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Runs `body` as one named check, turning a throw or a timeout into a FAIL. */
async function check(name: string, body: () => Promise<string>): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  try {
    const detail = await Promise.race([
      body(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out after ${REST_TIMEOUT_MS}ms`)), REST_TIMEOUT_MS);
      }),
    ]);
    record("PASS", name, detail);
  } catch (err) {
    record("FAIL", name, message(err));
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * The most recent window that is certainly in the past, backed off far enough
 * that the free IEX feed's 15-minute delay cannot make it empty.
 */
function recentClosedWindow(): { startMs: number; endMs: number } {
  const endMs = Date.now() - 30 * 60_000;
  return { startMs: endMs - 10 * 60_000, endMs };
}

async function wsCheck(name: string, url: string, creds: { key: string; secret: string }): Promise<void> {
  if (!creds.key || !creds.secret) {
    record("SKIP", name, "no data credentials in the environment");
    return;
  }
  const adapter = new AlpacaMarketDataAdapter(new EventBus(), "paper", { url });
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      adapter.connect(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`no authenticated connection within ${WS_TIMEOUT_MS}ms`)), WS_TIMEOUT_MS);
      }),
    ]);
    adapter.subscribe(["SPY"]);
    record("PASS", name, `authenticated and subscribed on ${url}`);
  } catch (err) {
    record("FAIL", name, message(err));
  } finally {
    if (timer) clearTimeout(timer);
    // Always tear the socket down, or the script cannot exit: disconnect()
    // also cancels the adapter's pending reconnect timer.
    adapter.disconnect();
  }
}

async function main(): Promise<void> {
  console.log("\n=== Network verify (read-only) ===\n");

  if (env.alpacaTradingMode !== "paper") {
    console.error(
      `Refusing to run: ALPACA_TRADING_MODE is "${env.alpacaTradingMode}". ` +
        "This check reads a broker account and is only ever pointed at paper.",
    );
    process.exit(1);
  }

  const tradingCreds = { key: env.alpacaApiKey, secret: env.alpacaApiSecret };
  const dataCreds = { key: env.alpacaDataKey, secret: env.alpacaDataSecret };
  const tradingBase = alpacaTradingBaseUrl("paper");

  console.log("Alpaca trading API");
  if (!tradingCreds.key || !tradingCreds.secret) {
    record("SKIP", "Market clock", "ALPACA_API_KEY/SECRET not set");
    record("SKIP", "Account read", "ALPACA_API_KEY/SECRET not set");
    record("SKIP", "Positions read", "ALPACA_API_KEY/SECRET not set");
    record("SKIP", "Orders read", "ALPACA_API_KEY/SECRET not set");
  } else {
    await check("Market clock", async () => {
      const clock = await alpacaGet<{ is_open: boolean; next_open: string }>(tradingBase, "/v2/clock", tradingCreds);
      return `market ${clock.is_open ? "open" : "closed"}, next open ${clock.next_open}`;
    });

    const broker = new AlpacaBroker("verify", tradingBase, tradingCreds);

    await check("Account read", async () => {
      const account = await broker.getAccount();
      return `account ${account.accountId} ${account.status}, equity ${account.equity}`;
    });

    await check("Positions read", async () => {
      const positions = await broker.getPositions();
      return `${positions.length} open position(s)`;
    });

    await check("Orders read", async () => {
      const orders = await broker.listOrders(Date.now() - 24 * 60 * 60_000);
      return `${orders.length} order(s) in the last 24h`;
    });
  }

  console.log("\nAlpaca historical data API");
  if (!dataCreds.key || !dataCreds.secret) {
    record("SKIP", "Historical quotes (iex)", "ALPACA_DATA_KEY/SECRET not set");
  } else {
    await check("Historical quotes (iex)", async () => {
      const { startMs, endMs } = recentClosedWindow();
      const client = new AlpacaHistoricalClient(dataCreds);
      const quotes = await client.fetch("quotes", "SPY", startMs, endMs, "iex");
      const window = `${new Date(startMs).toISOString()}..${new Date(endMs).toISOString()}`;
      // An empty window is normal outside market hours, so it is not a failure:
      // the request itself round-tripped and parsed, which is what is checked.
      return `${quotes.length} SPY quote(s) over ${window}`;
    });
  }

  console.log("\nAlpaca market-data WebSocket");
  await wsCheck("Data stream connect + subscribe", env.alpacaDataStreamUrl, dataCreds);

  console.log("\nSupabase");
  await check("REST endpoint reachable", async () => {
    const res = await fetch(`${env.supabaseUrl}/rest/v1/`, {
      headers: { apikey: env.supabaseAnonKey, Authorization: `Bearer ${env.supabaseAnonKey}` },
      signal: AbortSignal.timeout(REST_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return `HTTP ${res.status} from ${new URL(env.supabaseUrl).host}`;
  });

  await check("Service-role query", async () => {
    const res = await fetch(`${env.supabaseUrl}/rest/v1/instruments?select=symbol&limit=1`, {
      headers: {
        apikey: env.supabaseServiceRoleKey,
        Authorization: `Bearer ${env.supabaseServiceRoleKey}`,
      },
      signal: AbortSignal.timeout(REST_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    const rows = (await res.json()) as unknown[];
    return `instruments readable (${rows.length} row(s) sampled)`;
  });

  const passed = results.filter((r) => r.status === "PASS").length;
  const failed = results.filter((r) => r.status === "FAIL");
  const skipped = results.filter((r) => r.status === "SKIP").length;

  console.log("\n=== Summary ===");
  console.log(`  Total: ${results.length} | PASS: ${passed} | FAIL: ${failed.length} | SKIP: ${skipped}`);
  for (const r of failed) console.log(`    FAIL ${r.name}: ${r.detail}`);
  console.log();

  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("networkVerify fatal:", message(err));
  process.exit(1);
});
