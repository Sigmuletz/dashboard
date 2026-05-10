"""
Dynamic row helpers — no hardcoded schema. Columns discovered from CSV.
"""
from datetime import date
from typing import Any, Optional


def parse_date(val: Any) -> Optional[date]:
    """Parse a date value from CSV. Returns None if unparseable."""
    import pandas as pd
    if pd.isna(val):
        return None
    try:
        return pd.to_datetime(str(val)).date()
    except Exception:
        return None


def is_overdue(row: dict) -> bool:
    """Check if row is overdue. Finds the Due Date column heuristically."""
    due_col = _find_column(row, ['due', 'date'])  # e.g. "Due Date"
    status_col = _find_column(row, ['status'])
    if not due_col or not row.get(due_col):
        return False
    due_val = row.get(due_col)
    if isinstance(due_val, date):
        d = due_val
    else:
        d = parse_date(due_val)
    if d is None:
        return False
    status_val = str(row.get(status_col, '')).lower() if status_col else ''
    return d < date.today() and status_val not in ('resolved', 'closed')


def guess_column_type(col_name: str) -> str:
    """Heuristic: guess display type from column name."""
    n = col_name.lower()
    if 'status' in n:
        return 'status'
    if 'priority' in n:
        return 'priority'
    if 'date' in n:
        return 'date'
    if n in ('number', 'id', 'ticket', 'incident', 'ref'):
        return 'id'
    return 'text'


def _find_column(row: dict, keywords: list[str]) -> Optional[str]:
    """Find a column key in row whose name contains all given keywords (case-insensitive)."""
    for key in row:
        kl = key.lower()
        if all(kw in kl for kw in keywords):
            return key
    return None
