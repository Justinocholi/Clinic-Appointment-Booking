#!/usr/bin/env python3
"""Payment Reconciliation System.

Reads payments.jsonl and computes the total amount collected from successful
payment transactions, adhering to financial audit rules.

Rules and Logic:
1. Stream processing: Reads payments.jsonl line by line for memory efficiency.
2. Malformed JSON handling: Safely catches parsing errors and skips corrupted lines.
3. Event validation: Ignores events missing a valid, non-empty transaction ID (txn_id).
4. Attempt grouping: Groups multiple attempts belonging to the same transaction (txn_id).
5. Latest attempt tracking: Determines the latest attempt using the UTC timestamp (ts).
6. Final state determination: Only the latest attempt for each transaction determines its outcome.
7. Success condition: A transaction is counted as collected if and only if its latest status is 'success'.
8. Decimal precision: Sums collected amounts using Python's Decimal to avoid floating-point drift.
9. Verification: Compares the successful count with expected.txt and produces the KOYA verification code.

Run:
    python3 reconcile.py
"""

import json
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any, Dict, Optional, Tuple


def parse_timestamp(ts_raw: Any) -> Optional[datetime]:
    """Safely parse a UTC timestamp into a timezone-aware datetime object.

    Handles ISO-8601 strings (e.g. '2026-09-21T15:30:26Z').
    Returns None if the timestamp is missing, malformed, or of an unexpected type.
    """
    if not isinstance(ts_raw, str):
        return None
    try:
        ts_str = ts_raw.strip()
        # Normalize trailing 'Z' / 'z' to '+00:00' for broad ISO-8601 compatibility
        if ts_str.endswith("Z") or ts_str.endswith("z"):
            ts_str = ts_str[:-1] + "+00:00"
        dt = datetime.fromisoformat(ts_str)

        # Ensure the datetime object is timezone-aware and normalized to UTC
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        else:
            dt = dt.astimezone(timezone.utc)
        return dt
    except (ValueError, TypeError):
        # Ignore any lines with invalid or unparseable timestamps
        return None


def parse_amount(amount_raw: Any) -> Optional[Decimal]:
    """Safely convert a monetary amount to a Decimal for high financial accuracy.

    Handles:
    - Floats/ints: Converted via their string representations to prevent IEEE-754 precision artifacts.
    - Strings: Strips formatting such as commas used as thousands separators (e.g. '55,707.77').

    Returns None if the amount cannot be safely converted.
    """
    if amount_raw is None:
        return None
    try:
        if isinstance(amount_raw, (int, float)):
            # Convert float to str first so Decimal does not inherit binary floating-point inaccuracy
            return Decimal(str(amount_raw))
        if isinstance(amount_raw, str):
            # Clean thousands separators (commas) and surrounding whitespace
            cleaned = amount_raw.replace(",", "").strip()
            return Decimal(cleaned)
        return Decimal(str(amount_raw))
    except (InvalidOperation, ValueError, TypeError):
        # Ignore unparseable amounts safely
        return None


def reconcile(payments_path: Path) -> Tuple[int, Decimal]:
    """Process payment events from payments.jsonl and calculate reconciliation totals.

    Returns:
        Tuple[int, Decimal]: (successful_transaction_count, total_collected_amount)
    """
    # Dictionary mapping txn_id -> latest attempt event data:
    # { "ts": datetime, "status": str, "amount": Decimal }
    latest_attempts: Dict[str, Dict[str, Any]] = {}

    with open(payments_path, "r", encoding="utf-8") as f:
        for line in f:
            line_str = line.strip()
            # Skip empty lines
            if not line_str:
                continue

            # Safely parse JSON line; ignore malformed/corrupted lines instead of crashing
            try:
                event = json.loads(line_str)
            except Exception:
                continue

            # Ensure event is a valid dictionary structure
            if not isinstance(event, dict):
                continue

            # Validate txn_id: must be a non-empty string
            txn_id = event.get("txn_id")
            if not isinstance(txn_id, str):
                continue
            txn_id = txn_id.strip()
            if not txn_id:
                continue

            # Parse and validate the event timestamp (ts)
            ts = parse_timestamp(event.get("ts"))
            if ts is None:
                continue

            # Safely extract and normalize status (e.g., lowercase 'success')
            status = event.get("status")
            if isinstance(status, str):
                status = status.strip().lower()
            else:
                status = None

            # Safely parse monetary amount into Decimal
            amount = parse_amount(event.get("amount"))

            # Group attempts by txn_id and keep only the latest attempt based on UTC timestamp
            existing = latest_attempts.get(txn_id)
            if existing is None or ts > existing["ts"]:
                latest_attempts[txn_id] = {
                    "ts": ts,
                    "status": status,
                    "amount": amount,
                }

    # Aggregate collected payments from the latest attempt of each unique transaction
    success_count = 0
    total_amount = Decimal("0")

    for attempt in latest_attempts.values():
        # Only the latest attempt counts: collected if and only if latest status is 'success'
        if attempt["status"] == "success":
            success_count += 1
            if attempt["amount"] is not None:
                total_amount += attempt["amount"]

    return success_count, total_amount


def main() -> None:
    # Resolve file paths relative to script directory, with fallback to current directory
    base_dir = Path(__file__).resolve().parent
    payments_path = base_dir / "payments.jsonl"
    if not payments_path.exists():
        payments_path = Path("payments.jsonl")

    expected_path = base_dir / "expected.txt"
    if not expected_path.exists():
        expected_path = Path("expected.txt")

    # Read expected count of successful payments determined by the finance team
    with open(expected_path, "r", encoding="utf-8") as f:
        expected = int(f.read().strip())

    # Perform reconciliation
    count, total = reconcile(payments_path)

    # Compare calculated count against expected count and print the appropriate assessment message
    if count != expected:
        print(f"Check failed: counted {count} successful payments, expected {expected}.")
        print("Something in the data isn't being handled the way the README describes.")
    else:
        print(f"Check passed: {count} successful payments.")
        print(f"Your code: KOYA-{round(total)}")


if __name__ == "__main__":
    main()
