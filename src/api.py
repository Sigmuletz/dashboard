"""
API blueprint — serves incidents, filter options, column metadata, charts.
All endpoints accept ?dataset=<name> to switch between data sources.
"""
from collections import defaultdict
from datetime import date, datetime
import json
import os
from typing import Optional

from flask import Blueprint, jsonify, request

from .data_loader import ChartConfigLoader, DataLoader, HighlightingLoader
from .models import is_overdue, parse_date

PALETTE = [
    '#6366f1', '#8b5cf6', '#a78bfa', '#c4b5fd',
    '#10b981', '#34d399', '#6ee7b7',
    '#f59e0b', '#fbbf24', '#fcd34d',
    '#3b82f6', '#60a5fa', '#93c5fd',
    '#ef4444', '#f87171',
    '#64748b', '#94a3b8',
]

api_bp = Blueprint("api", __name__, url_prefix="/api")

# {dataset_name: (DataLoader, ChartConfigLoader)}
loaders: dict[str, tuple[DataLoader, ChartConfigLoader, HighlightingLoader]] = {}
registry: list[dict] = []

# Map chart groupBy field names → CSV column headers (only non-identity mappings)
FIELD_MAP: dict[str, str] = {}


def init_api(dataset_loaders: dict, ds_registry: dict) -> None:
    global loaders, registry
    loaders = dataset_loaders
    registry = ds_registry["datasets"]


def _get_loaders() -> tuple[DataLoader, ChartConfigLoader, HighlightingLoader]:
    """Get the active dataset's loaders based on ?dataset= query param."""
    dataset = request.args.get("dataset", "incidents")
    if dataset not in loaders:
        dataset = "incidents"
    return loaders[dataset]


def _parse_filter_params() -> dict:
    """Parse filter params from query string. Returns {field: [values]}.
    Excludes 'dataset' key."""
    filters = {}
    for param in request.args:
        if param == "dataset":
            continue
        values = request.args.getlist(param)
        if len(values) == 1 and "," in values[0]:
            values = [v.strip() for v in values[0].split(",") if v.strip()]
        filters[param] = values
    return filters


def _id_key(row: dict) -> Optional[str]:
    """Find the row's identifier column."""
    for candidate in ("Number", "ID", "Id", "Ref", "Ticket"):
        if candidate in row and row[candidate]:
            return candidate
    # Fallback: first column that looks like an ID
    for k, v in row.items():
        kl = k.lower()
        if ("id" in kl or "number" in kl or "ref" in kl) and v:
            return k
    return None


def _description_key(row: dict) -> Optional[str]:
    """Find the column that serves as the row's human-readable description."""
    for candidate in ("Description", "Title", "Subject", "Summary"):
        if candidate in row and row[candidate]:
            return candidate
    for k, v in row.items():
        if v and isinstance(v, str) and len(v) > 3:
            return k
    return None


def _date_key(row: dict) -> Optional[str]:
    """Find the most relevant date column for display (creation > submitted > any date)."""
    for kw in ("Creation Date", "Created Date", "Submitted Date", "Creation", "Created"):
        if kw in row and isinstance(row[kw], date):
            return kw
    for k, v in row.items():
        if isinstance(v, date):
            return k
    return None


def _serialize_row(row: dict) -> dict:
    """Convert a row dict for JSON: dates → ISO strings, add computed fields."""
    out = {}
    for k, v in row.items():
        if isinstance(v, date):
            out[k] = v.isoformat()
        elif v is None:
            out[k] = None
        else:
            out[k] = v
    out["is_overdue"] = is_overdue(row)
    out["_id"] = str(row[_id_key(row)]) if _id_key(row) else ""
    out["_description"] = str(row[_description_key(row)]) if _description_key(row) else ""
    date_k = _date_key(row)
    out["_date"] = row[date_k].isoformat() if date_k and isinstance(row.get(date_k), date) else None
    return out


def _find_date_col(rows: list[dict], keyword: str) -> Optional[str]:
    """Find a date column in rows whose key contains keyword."""
    if not rows:
        return None
    for key in rows[0]:
        if keyword in key.lower() and isinstance(rows[0][key], date):
            return key
    return None


def _find_col(columns: list[dict], keyword: str) -> Optional[str]:
    """Find a column key whose name contains keyword (case-insensitive)."""
    for col in columns:
        if keyword in col["key"].lower():
            return col["key"]
    return None


# ═══════════════════════════════════════════════════════════════════
# Endpoints
# ═══════════════════════════════════════════════════════════════════

@api_bp.route("/datasets")
def get_datasets():
    """Return dataset registry for dynamic frontend switcher."""
    return jsonify(registry)


@api_bp.route("/columns")
def get_columns():
    data_loader, _, _ = _get_loaders()
    return jsonify({"columns": data_loader.columns})


@api_bp.route("/incidents")
def get_incidents():
    data_loader, _, _ = _get_loaders()
    filters = _parse_filter_params()
    rows = data_loader.filter(**filters)
    return jsonify([_serialize_row(r) for r in rows])


@api_bp.route("/filters")
def get_filter_options():
    data_loader, _, _ = _get_loaders()
    # Discover available filter fields from column metadata
    filter_fields = []
    for col in data_loader.columns:
        key = col["key"]
        # Use columns that are likely categorical (status, priority, group, etc.)
        # Skip ID-like and date columns
        if col["type"] not in ("id", "date"):
            filter_fields.append(key)
    result = {}
    for field in filter_fields:
        vals = data_loader.distinct_values(field)
        if vals:
            result[field] = vals
    return jsonify(result)


@api_bp.route("/notifications")
def get_notifications():
    data_loader, _, _ = _get_loaders()
    rows = data_loader.all()

    # Determine sort column (from query param, or auto-detect date)
    sort_col = request.args.get("sort", "")
    sort_order = request.args.get("order", "desc").lower()
    limit = min(int(request.args.get("limit", "10") or 10), 100)

    if sort_col and sort_col in (rows[0] if rows else {}):
        reverse = sort_order != "asc"
        rows = sorted(rows, key=lambda r: r.get(sort_col) or date.min if isinstance(r.get(sort_col), date) else (r.get(sort_col) or ""), reverse=reverse)
    else:
        # Fallback: auto-detect a date column for sorting
        creation_col = _find_date_col(rows, "creat") or _find_date_col(rows, "submitt") or _find_date_col(rows, "date")
        if creation_col:
            rows = sorted(rows, key=lambda r: r.get(creation_col) or date.min, reverse=True)

    return jsonify([_serialize_row(r) for r in rows[:limit]])


@api_bp.route("/charts-config")
def get_charts_config():
    _, chart_cfg, _ = _get_loaders()
    return jsonify(chart_cfg.load())


@api_bp.route("/charts-config", methods=["POST"])
def save_charts_config():
    """Save updated chart card configuration (order, width) back to JSON file."""
    _, chart_cfg, _ = _get_loaders()
    data = request.get_json(silent=True) or {}
    cards = data.get("cards")
    if not isinstance(cards, list):
        return jsonify({"error": "Expected {cards: [...]}"}), 400
    try:
        chart_cfg.save(cards)
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@api_bp.route("/reload", methods=["POST"])
def reload_data():
    """Reload all CSV data. Called by file watcher or frontend refresh button."""
    reloaded = []
    for ds_id, (dl, _) in loaders.items():
        dl.reload()
        reloaded.append(ds_id)
    return jsonify({"ok": True, "reloaded": reloaded})


@api_bp.route("/views")
def get_views():
    """List all saved dashboard views."""
    config_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "config")
    views_path = os.path.join(config_dir, "views.json")
    try:
        with open(views_path) as f:
            data = json.load(f)
        return jsonify(data.get("views", []))
    except (FileNotFoundError, json.JSONDecodeError):
        return jsonify([])


@api_bp.route("/views", methods=["POST"])
def save_view():
    """Save a named dashboard view. Body: {name, state}"""
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    state = data.get("state")
    if not name:
        return jsonify({"error": "name required"}), 400
    if not isinstance(state, dict):
        return jsonify({"error": "state must be an object"}), 400

    config_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "config")
    views_path = os.path.join(config_dir, "views.json")
    try:
        with open(views_path) as f:
            all_views = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        all_views = {"views": []}

    # Upsert: replace if name exists, otherwise append
    existing = next((v for v in all_views["views"] if v["name"] == name), None)
    if existing:
        existing["state"] = state
        existing["updated"] = datetime.now().isoformat()
    else:
        all_views["views"].append({
            "name": name,
            "state": state,
            "created": datetime.now().isoformat(),
            "updated": datetime.now().isoformat(),
        })

    with open(views_path, 'w') as f:
        json.dump(all_views, f, indent=2)
    return jsonify({"ok": True, "name": name})


@api_bp.route("/views/delete", methods=["POST"])
def delete_view():
    """Delete a named dashboard view. Body: {name}"""
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    if not name:
        return jsonify({"error": "name required"}), 400

    config_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "config")
    views_path = os.path.join(config_dir, "views.json")
    try:
        with open(views_path) as f:
            all_views = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return jsonify({"ok": True})

    before = len(all_views.get("views", []))
    all_views["views"] = [v for v in all_views.get("views", []) if v["name"] != name]
    if len(all_views["views"]) == before:
        return jsonify({"error": "view not found"}), 404

    with open(views_path, 'w') as f:
        json.dump(all_views, f, indent=2)
    return jsonify({"ok": True, "name": name})


@api_bp.route("/highlighting")
def get_highlighting():
    """Get the highlighting config for the current dataset."""
    _, _, hl_loader = _get_loaders()
    return jsonify(hl_loader.load())


@api_bp.route("/highlighting", methods=["POST"])
def save_highlighting():
    """Save highlighting config for the current dataset."""
    _, _, hl_loader = _get_loaders()
    data = request.get_json(silent=True) or {}
    if "rowRules" not in data and "cellRules" not in data:
        return jsonify({"error": "Expected {rowRules, cellRules}"}), 400
    try:
        hl_loader.save(data)
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@api_bp.route("/chart-data/<card_id>")
def get_chart_data(card_id: str):
    data_loader, chart_cfg, _ = _get_loaders()
    cards = {c["id"]: c for c in chart_cfg.cards}
    card = cards.get(card_id)
    if not card:
        return jsonify({"error": "Card not found"}), 404

    # Parse global filters
    filters = {}
    for param in request.args:
        if param in ("card_id", "dataset"):
            continue
        values = request.args.getlist(param)
        if len(values) == 1 and "," in values[0]:
            values = [v.strip() for v in values[0].split(",") if v.strip()]
        filters[param] = values

    # Merge card's own static filter
    card_filter = card.get("filter", {})
    merged_filters = {**filters, **card_filter}

    incidents = data_loader.filter(**merged_filters)
    card_type = card.get("type", "number")

    if card_type == "number":
        numbers_config = card.get("numbers")
        if numbers_config:
            results = []
            for num_cfg in numbers_config:
                num_filter = num_cfg.get("filter", {})
                merged = {**filters, **num_filter}
                num_incidents = data_loader.filter(**merged)
                results.append({
                    "label": num_cfg.get("label", "total"),
                    "value": len(num_incidents),
                    "color": num_cfg.get("color", card.get("color"))
                })
            return jsonify({"type": "number", "title": card.get("title"), "numbers": results})
        return jsonify({"type": "number", "value": len(incidents), "title": card.get("title"), "color": card.get("color")})

    if card_type == "gauge":
        total = len(incidents)
        max_val = card.get("gaugeMax", total) or 1
        percentage = round((total / max_val) * 100, 1) if max_val > 0 else 0
        return jsonify({"type": "gauge", "value": total, "max": max_val, "percentage": percentage, "title": card.get("title"), "color": card.get("color")})

    # Chart types that group by a field
    if card_type in ("bar", "doughnut", "pie", "polarArea", "radar", "horizontalBar"):
        group_by = card.get("groupBy", "")
        col_name = FIELD_MAP.get(group_by, group_by)
        buckets = defaultdict(int)
        for i in incidents:
            key = str(i.get(col_name, "Unknown"))
            buckets[key] += 1
        sorted_buckets = dict(sorted(buckets.items(), key=lambda x: x[1], reverse=True))
        return jsonify({
            "type": card_type,
            "title": card.get("title"),
            "labels": list(sorted_buckets.keys()),
            "values": list(sorted_buckets.values()),
            "color": card.get("color"),
        })

    if card_type == "stackedBar":
        group_by = card.get("groupBy", "")
        stack_by = card.get("stackBy", "")
        col_x = FIELD_MAP.get(group_by, group_by)
        col_stack = FIELD_MAP.get(stack_by, stack_by)

        x_buckets: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
        for i in incidents:
            x_key = str(i.get(col_x, "Unknown"))
            s_key = str(i.get(col_stack, "Unknown"))
            x_buckets[x_key][s_key] += 1

        stack_labels = sorted(set(
            s for counts in x_buckets.values() for s in counts
        ))
        labels = list(x_buckets.keys())
        datasets = []
        for idx, s_label in enumerate(stack_labels):
            data = [x_buckets.get(lbl, {}).get(s_label, 0) for lbl in labels]
            datasets.append({
                "label": s_label,
                "data": data,
                "backgroundColor": PALETTE[idx % len(PALETTE)],
            })

        return jsonify({
            "type": "stackedBar",
            "title": card.get("title"),
            "labels": labels,
            "datasets": datasets,
        })

    if card_type == "scatter":
        group_by = card.get("groupBy", "")
        if not group_by:
            return jsonify({"error": "scatter chart requires groupBy"}), 400
        col_group = FIELD_MAP.get(group_by, group_by)
        creation_col = _find_date_col(incidents, "creat") or _find_date_col(incidents, "submitt") or _find_date_col(incidents, "date")
        if not creation_col:
            return jsonify({"error": "No date column found for scatter"}), 400

        buckets: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
        for i in incidents:
            g_key = str(i.get(col_group, "Unknown"))
            d = i.get(creation_col)
            if d:
                ds = d.isoformat() if isinstance(d, date) else str(d)
                buckets[g_key][ds] += 1

        datasets = []
        for idx, g_key in enumerate(sorted(buckets.keys())):
            points = [{"x": d, "y": c} for d, c in sorted(buckets[g_key].items())]
            datasets.append({
                "label": g_key,
                "data": points,
                "backgroundColor": PALETTE[idx % len(PALETTE)],
                "borderColor": PALETTE[idx % len(PALETTE)],
                "pointRadius": 4,
                "pointHoverRadius": 7,
            })

        return jsonify({
            "type": "scatter",
            "title": card.get("title"),
            "datasets": datasets,
        })

    if card_type == "bubble":
        group_by = card.get("groupBy", "")
        if not group_by:
            return jsonify({"error": "bubble chart requires groupBy"}), 400
        col_group = FIELD_MAP.get(group_by, group_by)
        creation_col = _find_date_col(incidents, "creat") or _find_date_col(incidents, "submitt")
        if not creation_col:
            return jsonify({"error": "No date column found for bubble"}), 400
        priority_col = _find_col(data_loader.columns, "prior") or _find_col(data_loader.columns, "risk")
        priority_order = {"Low": 1, "Medium": 2, "High": 3, "Critical": 4}

        datasets = []
        group_incidents: dict[str, list] = defaultdict(list)
        for i in incidents:
            g_key = str(i.get(col_group, "Unknown"))
            if i.get(creation_col):
                group_incidents[g_key].append(i)

        for idx, g_key in enumerate(sorted(group_incidents.keys())):
            date_buckets: dict[str, dict] = defaultdict(lambda: {"count": 0, "priority_sum": 0, "priority_n": 0})
            for i in group_incidents[g_key]:
                d = i.get(creation_col)
                ds = d.isoformat() if isinstance(d, date) else str(d)
                date_buckets[ds]["count"] += 1
                if priority_col:
                    prio_num = priority_order.get(str(i.get(priority_col, "Low")), 1)
                    date_buckets[ds]["priority_sum"] += prio_num
                    date_buckets[ds]["priority_n"] += 1

            points = []
            for d, v in sorted(date_buckets.items()):
                avg_priority = v["priority_sum"] / v["priority_n"] if v["priority_n"] else 1
                points.append({"x": d, "y": round(avg_priority, 1), "r": v["count"] * 5})
            datasets.append({
                "label": g_key,
                "data": points,
                "backgroundColor": PALETTE[idx % len(PALETTE)] + "60",
                "borderColor": PALETTE[idx % len(PALETTE)],
            })

        return jsonify({
            "type": "bubble",
            "title": card.get("title"),
            "datasets": datasets,
        })

    if card_type in ("area", "line"):
        creation_col = _find_date_col(incidents, "creat") or _find_date_col(incidents, "submitt") or _find_date_col(incidents, "date")
        if not creation_col:
            return jsonify({"error": "No date column found"}), 400
        buckets = defaultdict(int)
        for i in incidents:
            d = i.get(creation_col)
            if d:
                ds = d.isoformat() if isinstance(d, date) else str(d)
                buckets[ds] += 1
        sorted_dates = sorted(buckets.items())
        return jsonify({
            "type": card_type,
            "title": card.get("title"),
            "labels": [d for d, _ in sorted_dates],
            "values": [v for _, v in sorted_dates],
            "color": card.get("color"),
        })

    return jsonify({"error": f"Unknown card type: {card_type}"}), 400
