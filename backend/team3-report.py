#!/usr/bin/env python3
"""Print a Team 3 trades dump and optionally plot gross P&L by trade exit."""

import argparse
import json
import math
import sys
from itertools import accumulate
from pathlib import Path
from statistics import mean


def numeric(value):
    return type(value) in (int, float) and math.isfinite(value)


def format_number(value, suffix="", dollars=False):
    if not numeric(value):
        return "Unavailable"
    if dollars:
        sign = "-" if value < 0 else ""
        return f"{sign}${abs(value):,.2f}"
    return f"{value:,.2f}".rstrip("0").rstrip(".") + suffix


def show_settings(settings, indent="  "):
    for key, value in settings.items():
        if isinstance(value, dict):
            print(f"{indent}{key}")
            show_settings(value, indent + "  ")
        else:
            print(f"{indent}{key} = {json.dumps(value, ensure_ascii=False)}")


def report(dump):
    row, config, trips = (dump[key] for key in ("row", "config", "roundTrips"))
    print(f"Backtest {dump.get('backtestId') or row.get('backtestId') or '(unknown ID)'}")
    print("\nSettings")
    show_settings({
        **{key: row.get(key) for key in ("strategy", "version", "window", "group", "universe", "excluded", "diagnostic")},
        "symbols": dump.get("symbols", config.get("symbols")),
    })
    print("  Strategy overrides")
    if row.get("config"):
        show_settings(row["config"], "    ")
    else:
        print("    None")
    print("  Effective strategy configuration")
    show_settings(config, "    ")
    if isinstance(dump.get("engineConfig"), dict):
        print("  Engine configuration")
        show_settings(dump["engineConfig"], "    ")
    else:
        print("  Full engine configuration was not saved in this dump.")

    gross_bps = [trade.get("pnlBpsGross") for trade in trips]
    average_gross = mean(gross_bps) if gross_bps and all(map(numeric, gross_bps)) else None
    metrics = [
        ("Total trades (engine)", format_number(row.get("trades"))),
        ("Completed strategy round trips", format_number(len(trips))),
        ("Total net P&L", format_number(row.get("netPnl"), dollars=True)),
        ("Net P&L / traded notional", format_number(row.get("avgBpsPerTrade"), " bps")),
        ("Mean gross bps per round trip", format_number(average_gross, " bps")),
        ("Win rate", format_number(row.get("winRatePct"), "%")),
        ("Payoff ratio (average win / average loss)", format_number(row.get("payoff"))),
        ("Profit factor", format_number(row.get("profitFactor"))),
        ("Daily Sharpe", format_number(row.get("sharpeDaily"))),
        ("Maximum drawdown", format_number(row.get("maxDdUsd"), dollars=True)),
        ("Maximum drawdown (%)", format_number(row.get("maxDdPct"), "%")),
        ("Commissions", format_number(row.get("commissions"), dollars=True)),
        ("Trading days", format_number(row.get("tradingDays"))),
        ("Profitable days", format_number(row.get("pctDaysProfitable"), "%")),
        ("Worst day", format_number(row.get("worstDay"), dollars=True)),
        ("Median bars to target", format_number(row.get("medianTargetBars"))),
        ("Median entry z-score", format_number(row.get("medianEntryZ"))),
    ]
    print("\nPerformance")
    for label, value in metrics:
        print(f"  {label} = {value}")

    print("\nExit signals")
    exits = row.get("exitReasons") or {}
    for reason, stats in exits.items():
        count = format_number(stats.get("n"))
        gross = format_number(stats.get("avgGrossBps"), " bps")
        hold = format_number(stats.get("avgBars"), " bars")
        print(f"  {reason} = {count}, average gross {gross}, average hold {hold}")
    if not exits:
        print("  No exit breakdown recorded.")

    print("\nEntries blocked by filter")
    counts = dump.get("blockedEntriesByFilter")
    if isinstance(counts, dict) and all(type(count) is int and count >= 0 for count in counts.values()):
        for filter_name, count in counts.items():
            print(f"  {filter_name} = {format_number(count)}")
        if not counts:
            print("  No blocked entries recorded.")
    else:
        print("  Unavailable. This dump does not record rejected entry candidates.")


def save_plot(trips, output):
    if any(not all(numeric(trade.get(key)) for key in ("exitTs", "entryFill", "qty", "pnlBpsGross"))
           for trade in trips):
        raise ValueError("Chart requires exitTs, entryFill, qty, and pnlBpsGross on each round trip.")

    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        from matplotlib.ticker import StrMethodFormatter
    except ModuleNotFoundError as error:
        raise ValueError("Chart output requires Matplotlib. Install it with python3 -m pip install matplotlib.") from error

    # The dump's gross bps use the entry fill as the denominator. Multiply by
    # entry notional to recover signal-level dollars before exit costs.
    ordered = sorted(trips, key=lambda trade: trade["exitTs"])
    gross = [trade["pnlBpsGross"] * trade["entryFill"] * abs(trade["qty"]) / 10_000
             for trade in ordered]
    fig, ax = plt.subplots(figsize=(9, 4.5), layout="constrained")
    try:
        ax.set(title="Cumulative gross trade P&L", xlabel="Completed trades in exit order",
               ylabel="Signal-level gross P&L (USD)")
        ax.yaxis.set_major_formatter(StrMethodFormatter("${x:,.0f}"))
        ax.axhline(0, color="#667085", linewidth=0.8)
        ax.grid(axis="y", alpha=0.25)
        if gross:
            ax.plot(range(len(gross) + 1), [0, *accumulate(gross)], color="#175cd3")
        else:
            ax.text(0.5, 0.5, "No completed trades", ha="center", transform=ax.transAxes)
        fig.savefig(output, dpi=160)
    finally:
        plt.close(fig)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("result", type=Path, help="Team 3 trades JSON file")
    parser.add_argument("--plot", type=Path, metavar="PATH",
                        help="save the chart to a file, such as report.png")
    args = parser.parse_args()
    try:
        dump = json.loads(args.result.read_text(encoding="utf-8"))
        if (not isinstance(dump, dict) or not isinstance(dump.get("row"), dict)
                or not isinstance(dump.get("config"), dict) or not isinstance(dump.get("roundTrips"), list)
                or not all(isinstance(trade, dict) for trade in dump["roundTrips"])):
            raise ValueError("Expected a Team 3 trades dump with row, config, and roundTrips.")
        report(dump)
    except (OSError, ValueError, AttributeError) as error:
        print(f"{args.result}: {error}", file=sys.stderr)
        return 1

    if args.plot:
        try:
            if args.plot.resolve() == args.result.resolve() or args.plot.suffix.lower() == ".json":
                raise ValueError("Use a separate image file for the chart, such as report.png.")
            save_plot(dump["roundTrips"], args.plot)
        except (OSError, ValueError) as error:
            print(f"{args.plot}: {error}", file=sys.stderr)
            return 1
        print(f"\nChart saved to {args.plot}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
