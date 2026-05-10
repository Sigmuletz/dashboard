"""
DataLoader — loads CSV into list of dicts. All CSV columns preserved.
Column discovery is dynamic — nothing hardcoded.
"""
import json
import os
from datetime import date
from typing import Optional

import pandas as pd

from .models import parse_date, is_overdue, guess_column_type

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data")
CONFIG_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "config")


class DataLoader:
    """Loads and caches incident data from CSV. Rows are plain dicts."""

    def __init__(self, csv_path: Optional[str] = None):
        self._csv_path = csv_path or os.path.join(DATA_DIR, "incidents.csv")
        self._incidents: list[dict] = []
        self._column_meta: list[dict] = []
        self._reload()

    def _reload(self) -> None:
        df = pd.read_csv(self._csv_path)
        headers = list(df.columns)

        # Build column metadata from CSV headers
        self._column_meta = [
            {
                "key": h,
                "label": h,
                "type": guess_column_type(h),
                "sortable": True,
            }
            for h in headers
        ]

        # Parse rows — all columns kept as-is, dates parsed where detected
        self._incidents = []
        for _, row in df.iterrows():
            d = {}
            for h in headers:
                val = row[h]
                # Parse date columns
                if guess_column_type(h) == 'date':
                    d[h] = parse_date(val)
                else:
                    # Convert numpy types to native Python
                    if pd.isna(val):
                        d[h] = None
                    elif hasattr(val, 'item'):  # numpy scalar
                        d[h] = val.item()
                    else:
                        d[h] = str(val) if not isinstance(val, (int, float, bool)) else val
            self._incidents.append(d)

    @property
    def columns(self) -> list[dict]:
        """Column metadata: [{key, label, type, sortable}, ...]"""
        return self._column_meta

    def all(self) -> list[dict]:
        return self._incidents

    def filter(self, **filters) -> list[dict]:
        """Filter rows by column values. Each filter param value is a list of allowed strings."""
        results = self._incidents
        for field, values in filters.items():
            if field == "overdue":
                want = bool(values) if not isinstance(values, list) else bool(values[0])
                results = [r for r in results if is_overdue(r) == want]
            elif field == "date_from" and values:
                v = values[0] if isinstance(values, list) else values
                cutoff = parse_date(v)
                if cutoff:
                    # Find creation date column
                    results = [r for r in results if _date_col_value(r, 'creation') and _date_col_value(r, 'creation') >= cutoff]
            elif field == "date_to" and values:
                v = values[0] if isinstance(values, list) else values
                cutoff = parse_date(v)
                if cutoff:
                    results = [r for r in results if _date_col_value(r, 'creation') and _date_col_value(r, 'creation') <= cutoff]
            elif values:
                vals = values if isinstance(values, list) else [values]
                results = [
                    r for r in results
                    if str(r.get(field, '')).lower() in [str(v).lower() for v in vals]
                ]
        return results

    def distinct_values(self, field: str) -> list[str]:
        """Get sorted unique string values for a given CSV column."""
        vals = set()
        for r in self._incidents:
            v = r.get(field)
            if v is not None and str(v).strip():
                vals.add(str(v))
        return sorted(vals)

    def count(self, **filters) -> int:
        return len(self.filter(**filters))

    def reload(self) -> None:
        self._reload()


def _date_col_value(row: dict, keyword: str) -> Optional[date]:
    """Find a date column in row containing keyword and return its parsed value."""
    for key in row:
        if keyword in key.lower() and isinstance(row[key], date):
            return row[key]
    return None


class ChartConfigLoader:
    """Loads chart card configuration from charts.json."""

    def __init__(self, config_path: Optional[str] = None):
        self._path = config_path or os.path.join(CONFIG_DIR, "charts.json")
        self._config: dict = {}

    def load(self) -> dict:
        with open(self._path) as f:
            self._config = json.load(f)
        return self._config

    @property
    def cards(self) -> list[dict]:
        if not self._config:
            self.load()
        return self._config.get("cards", [])

    def save(self, cards: list[dict]) -> None:
        """Persist updated card config back to the JSON file."""
        self._config["cards"] = cards
        with open(self._path, 'w') as f:
            json.dump(self._config, f, indent=2)
