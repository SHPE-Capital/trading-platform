/**
 * runtime/verify/httpSmoke.ts
 *
 * Automated HTTP smoke test for the backtest API endpoints.
 * Exercises POST /api/backtests/run, GET /api/backtests/:id,
 * and GET /api/backtests, then verifies Supabase persistence.
 *
 * Assumes the dev server is already running on PORT (default 8080).
 * Usage: npx ts-node src/runtime/verify/httpSmoke.ts
 * Exit code: 0 on success, 1 on any failure.
 */

import "dotenv/config";

const BASE_URL = `http://localhost:${process.env.PORT || 8080}`;
const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 120_000; // 2 minutes — short backtests may take time for data loading

interface TestResult {
  name: string;
  status: "PASS" | "FAIL" | "SKIPPED";
  detail?: string;
}

const results: TestResult[] = [];

function pass(name: string, detail?: string): void {
  results.push({ name, status: "PASS", detail });
  console.log(`  ✅ PASS: ${name}${detail ? ` — ${detail}` : ""}`);
}

function fail(name: string, detail: string): void {
  results.push({ name, status: "FAIL", detail });
  console.log(`  ❌ FAIL: ${name} — ${detail}`);
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  console.log("\n=== HTTP Smoke Test ===\n");

  // ----------------------------------------------------------------
  // 1) Health check
  // ----------------------------------------------------------------
  console.log("Step 1: Health check");
  try {
    const healthRes = await fetch(`${BASE_URL}/health`);
    if (healthRes.ok) {
      pass("Health check", `HTTP ${healthRes.status}`);
    } else {
      fail("Health check", `HTTP ${healthRes.status}`);
      printSummary();
      process.exit(1);
    }
  } catch (err: any) {
    fail("Health check", `Server unreachable at ${BASE_URL}: ${err.message}`);
    console.log("\n⚠️  Is the dev server running? Start it with: npm run dev\n");
    printSummary();
    process.exit(1);
  }

  // ----------------------------------------------------------------
  // 2) POST /api/backtests/run
  // ----------------------------------------------------------------
  console.log("\nStep 2: POST /api/backtests/run");
  let backtestId: string | null = null;
  try {
    const runRes = await fetch(`${BASE_URL}/api/backtests/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "SPY/QQQ HTTP smoke test",
        strategyConfig: {
          type: "pairs_trading",
          symbols: ["SPY", "QQQ"],
        },
        startDate: "2023-01-03T00:00:00Z",
        endDate: "2023-01-06T23:59:59Z",
        initialCapital: 100_000,
      }),
    });

    if (runRes.status === 202) {
      const body = await runRes.json() as any;
      backtestId = body.backtestId;
      pass("POST /api/backtests/run", `HTTP 202, backtestId=${backtestId}`);
    } else {
      const text = await runRes.text();
      fail("POST /api/backtests/run", `HTTP ${runRes.status}: ${text}`);
    }
  } catch (err: any) {
    fail("POST /api/backtests/run", err.message);
  }

  if (!backtestId) {
    console.log("\nCannot continue without backtestId.");
    printSummary();
    process.exit(1);
  }

  // ----------------------------------------------------------------
  // 3) Poll GET /api/backtests/:id until completed
  // ----------------------------------------------------------------
  console.log(`\nStep 3: Poll GET /api/backtests/${backtestId}`);
  let backtestRow: any = null;
  const startPoll = Date.now();

  while (Date.now() - startPoll < POLL_TIMEOUT_MS) {
    await sleep(POLL_INTERVAL_MS);
    try {
      const getRes = await fetch(`${BASE_URL}/api/backtests/${backtestId}`);
      if (getRes.status === 404) {
        // Not persisted yet — keep polling
        continue;
      }
      if (!getRes.ok) {
        continue;
      }
      const row = await getRes.json() as any;
      if (row.status === "completed" || row.status === "failed") {
        backtestRow = row;
        break;
      }
      // status could be "pending" / "running" — keep polling
    } catch {
      // Transient error — keep polling
    }
  }

  if (backtestRow && backtestRow.status === "completed") {
    pass("GET /api/backtests/:id — status", `status=completed after ${((Date.now() - startPoll) / 1000).toFixed(1)}s`);
  } else if (backtestRow && backtestRow.status === "failed") {
    fail("GET /api/backtests/:id — status", `status=failed: ${backtestRow.error_message || "unknown"}`);
  } else {
    fail("GET /api/backtests/:id — status", `Timed out after ${POLL_TIMEOUT_MS / 1000}s`);
    printSummary();
    process.exit(1);
  }

  // Validate the row shape
  if (backtestRow) {
    if (backtestRow.metrics && typeof backtestRow.metrics === "object") {
      pass("GET /api/backtests/:id — metrics present");
    } else {
      fail("GET /api/backtests/:id — metrics present", "metrics missing or not an object");
    }

    if (backtestRow.started_at) {
      pass("GET /api/backtests/:id — started_at", backtestRow.started_at);
    } else {
      fail("GET /api/backtests/:id — started_at", "null or missing");
    }

    if (backtestRow.completed_at) {
      pass("GET /api/backtests/:id — completed_at", backtestRow.completed_at);
    } else {
      fail("GET /api/backtests/:id — completed_at", "null or missing");
    }

    const ecLen = Array.isArray(backtestRow.equity_curve) ? backtestRow.equity_curve.length : 0;
    if (ecLen > 0) {
      pass("GET /api/backtests/:id — equity_curve", `length=${ecLen}`);
    } else {
      fail("GET /api/backtests/:id — equity_curve", "empty or missing");
    }
  }

  // ----------------------------------------------------------------
  // 4) GET /api/backtests — list
  // ----------------------------------------------------------------
  console.log("\nStep 4: GET /api/backtests");
  try {
    const listRes = await fetch(`${BASE_URL}/api/backtests`);
    if (listRes.ok) {
      const list = await listRes.json();
      if (Array.isArray(list)) {
        const found = list.find((r: any) => r.id === backtestId);
        if (found) {
          pass("GET /api/backtests — list contains run", `found id=${backtestId}`);
        } else {
          fail("GET /api/backtests — list contains run", `id ${backtestId} not found in ${list.length} results`);
        }
      } else {
        fail("GET /api/backtests — list shape", "Response is not an array");
      }
    } else {
      fail("GET /api/backtests — HTTP status", `HTTP ${listRes.status}`);
    }
  } catch (err: any) {
    fail("GET /api/backtests — request", err.message);
  }

  // ----------------------------------------------------------------
  // 5) Summary
  // ----------------------------------------------------------------
  printSummary();
  const failures = results.filter((r) => r.status === "FAIL");
  process.exit(failures.length > 0 ? 1 : 0);
}

function printSummary(): void {
  console.log("\n=== Summary ===");
  const passed = results.filter((r) => r.status === "PASS").length;
  const failed = results.filter((r) => r.status === "FAIL").length;
  const skipped = results.filter((r) => r.status === "SKIPPED").length;
  console.log(`  Total: ${results.length} | PASS: ${passed} | FAIL: ${failed} | SKIPPED: ${skipped}`);
  if (failed > 0) {
    console.log("  Failures:");
    for (const r of results.filter((r) => r.status === "FAIL")) {
      console.log(`    ❌ ${r.name}: ${r.detail}`);
    }
  }
  console.log();
}

main().catch((err) => {
  console.error("httpSmoke fatal:", err);
  process.exit(1);
});
