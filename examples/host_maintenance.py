"""Finite host scheduler example. No daemon or automatic model retry."""
from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
import sched

from openclaw_memory_bridge import BridgeConfig, MaintenanceJob, MemoryClient, MemoryScope


def schedule_runs(job, *, count=1, interval_seconds=3600, scheduler=None):
    if not isinstance(count, int) or count < 1 or count > 24:
        raise ValueError("count must be between 1 and 24")
    if not math.isfinite(interval_seconds) or interval_seconds < 1:
        raise ValueError("interval_seconds must be positive")
    scheduler = scheduler or sched.scheduler()
    receipts = []

    def run():
        receipts.append(job())  # Failure stops this schedule. Host decides recovery.
        if len(receipts) < count:
            scheduler.enter(interval_seconds, 1, run)

    scheduler.enter(0, 1, run)
    scheduler.run()
    return receipts


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--foundation", type=Path, required=True)
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--user", required=True)
    parser.add_argument("--runs", type=int, default=1)
    parser.add_argument("--interval-seconds", type=float, default=3600)
    parser.add_argument("--host-reserve-usd", type=float, required=True)
    args = parser.parse_args()
    scope = MemoryScope(args.workspace, args.user, "host-maintenance")
    with MemoryClient(BridgeConfig(args.foundation, args.root)) as memory:
        memory.configure_maintenance(scope, cumulative_limit_usd=50,
                                     host_reserve_usd=args.host_reserve_usd)
        receipts = schedule_runs(MaintenanceJob(memory, scope), count=args.runs,
                                 interval_seconds=args.interval_seconds)
        print(json.dumps({"runs": len(receipts), "receipts": receipts}))


if __name__ == "__main__":
    main()
