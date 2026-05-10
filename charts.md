# Chart Types Reference

Dashboard uses **Chart.js** (loaded via CDN `window.Chart`). All chart cards are configured in `config/charts.json`.

---

## Supported Chart Types

### 1. `number` — KPI Card
Large number + label. No canvas.

| Config field | Required | Description |
|-------------|----------|-------------|
| `title` | yes | Card heading |
| `color` | yes | Text color (hex) |
| `filter` | no | Object of `"field": [values]` to pre-filter data |

```json
{
  "id": "total-tickets",
  "type": "number",
  "title": "Total Incidents",
  "color": "#6366f1"
}
```

---

### 2. `gauge` — Half-ring Gauge
Doughnut-based semicircle. Good for progress/targets.

| Config field | Required | Description |
|-------------|----------|-------------|
| `title` | yes | Card heading |
| `color` | yes | Gauge arc color |
| `filter` | no | Data filter |
| `gaugeMax` | yes | Max value (needle endpoint) |

```json
{
  "id": "overdue-gauge",
  "type": "gauge",
  "title": "Overdue",
  "filter": { "Status": ["New", "In Progress"], "overdue": true },
  "color": "#ef4444",
  "gaugeMax": 30
}
```

---

### 3. `bar` — Vertical Bar Chart
One bar per category. Best for comparing discrete groups.

| Config field | Required | Description |
|-------------|----------|-------------|
| `title` | yes | Card heading |
| `groupBy` | yes | Incident field to group by |
| `color` | no | Bar color (default `#6366f1`) |
| `width` | no | `2` for double-width card |

```json
{
  "id": "status-bar",
  "type": "bar",
  "title": "Incidents by Status",
  "groupBy": "Status"
}
```

---

### 4. `horizontalBar` — Horizontal Bar Chart
Same as `bar` but with `indexAxis: 'y'`. Better for long category labels or ranking.

| Config field | Required | Description |
|-------------|----------|-------------|
| `title` | yes | Card heading |
| `groupBy` | yes | Incident field to group by |
| `color` | no | Bar color |

```json
{
  "id": "user-bar",
  "type": "horizontalBar",
  "title": "Incidents by User",
  "groupBy": "Responsible",
  "color": "#8b5cf6"
}
```

---

### 5. `stackedBar` — Stacked Bar Chart
Vertical bars split into colored segments by a second dimension.

| Config field | Required | Description |
|-------------|----------|-------------|
| `title` | yes | Card heading |
| `groupBy` | yes | X-axis grouping |
| `stackBy` | yes | Stack segment grouping |
| `width` | no | `2` for double-width |

```json
{
  "id": "status-priority-stacked",
  "type": "stackedBar",
  "title": "Incidents by Status & Priority",
  "groupBy": "Status",
  "stackBy": "Priority"
}
```

Backend returns `{ labels, datasets: [{ label, data, backgroundColor }] }`.

---

### 6. `doughnut` — Doughnut Chart
Ring chart with center cutout. Good for part-to-whole.

| Config field | Required | Description |
|-------------|----------|-------------|
| `title` | yes | Card heading |
| `groupBy` | yes | Incident field |
| `color` | no | Unused (palette auto-assigned) |

```json
{
  "id": "priority-doughnut",
  "type": "doughnut",
  "title": "By Priority",
  "groupBy": "Priority"
}
```

---

### 7. `pie` — Pie Chart
Full-circle variant of doughnut (cutout = 0). Same data format.

| Config field | Required | Description |
|-------------|----------|-------------|
| `title` | yes | Card heading |
| `groupBy` | yes | Incident field |

```json
{
  "id": "status-pie",
  "type": "pie",
  "title": "Status Distribution",
  "groupBy": "Status"
}
```

---

### 8. `polarArea` — Polar Area Chart
Radial chart where each segment angle is equal, but radius varies by value. Best for comparing magnitude across a small number of categories.

| Config field | Required | Description |
|-------------|----------|-------------|
| `title` | yes | Card heading |
| `groupBy` | yes | Incident field |
| `width` | no | `2` for double-width card |

```json
{
  "id": "group-polar",
  "type": "polarArea",
  "title": "By Group (Polar)",
  "groupBy": "Group",
  "width": 2
}
```

---

### 9. `radar` — Radar / Spider Chart
Multi-axis comparison. Each category is an axis radiating from center. Good for profiles or multi-criteria scoring.

| Config field | Required | Description |
|-------------|----------|-------------|
| `title` | yes | Card heading |
| `groupBy` | yes | Incident field |
| `color` | no | Line/fill color |

```json
{
  "id": "priority-radar",
  "type": "radar",
  "title": "Priority Radar",
  "groupBy": "Priority",
  "color": "#f59e0b"
}
```

---

### 10. `line` — Line Chart
Time-series line with points. Uses `creation_date` for x-axis.

| Config field | Required | Description |
|-------------|----------|-------------|
| `title` | yes | Card heading |
| `dateField` | no | Date field (default `"Creation Date"`) |
| `color` | no | Line color (default `#10b981`) |
| `width` | no | `2` for double-width |

```json
{
  "id": "created-timeline",
  "type": "line",
  "title": "Created Over Time",
  "dateField": "Creation Date",
  "color": "#10b981",
  "width": 2
}
```

---

### 11. `area` — Area Chart
Same as `line` but with gradient fill below the curve. Visually emphasizes volume over time.

| Config field | Required | Description |
|-------------|----------|-------------|
| `title` | yes | Card heading |
| `dateField` | no | Date field |
| `color` | no | Line/fill color |
| `width` | no | `2` for double-width |

```json
{
  "id": "created-area",
  "type": "area",
  "title": "Created Over Time (Area)",
  "dateField": "Creation Date",
  "color": "#10b981",
  "width": 2
}
```

---

### 12. `scatter` — Scatter Chart
Time-series scatter with points connected by line. One dataset per group. X = date, Y = count. Good for comparing trends across categories.

| Config field | Required | Description |
|-------------|----------|-------------|
| `title` | yes | Card heading |
| `groupBy` | yes | Creates one dataset per unique value |
| `dateField` | no | Date field (default `"Creation Date"`) |
| `width` | no | `2` for double-width |

```json
{
  "id": "priority-scatter",
  "type": "scatter",
  "title": "Incidents Over Time by Priority",
  "groupBy": "Priority",
  "width": 2
}
```

Backend returns `{ datasets: [{ label, data: [{ x, y }], backgroundColor }] }`.

---

### 13. `bubble` — Bubble Chart
Scatter with a third dimension (bubble size). X = date, Y = avg priority (1-4), radius = incident count. One dataset per group.

| Config field | Required | Description |
|-------------|----------|-------------|
| `title` | yes | Card heading |
| `groupBy` | yes | Creates one dataset per unique value |
| `width` | no | `2` for double-width |

```json
{
  "id": "group-bubble",
  "type": "bubble",
  "title": "Activity Bubble (Group × Priority × Volume)",
  "groupBy": "Group",
  "width": 2
}
```

Backend returns `{ datasets: [{ label, data: [{ x, y, r }], backgroundColor }] }`.

---

## Config Reference

### Common Fields (all types)

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique card ID (used in API routes) |
| `type` | string | Chart type (see above) |
| `title` | string | Card heading text |
| `filter` | object | Static pre-filter: `{ "Field": ["val1", ...], "overdue": true }` |
| `width` | number | Column span in grid (`1` = default, `4` = full row in 4-col grid) |
| `chartHeight` | number | Canvas height in pixels. When set, chart fills exact height. When omitted, Chart.js auto-sizes with aspect ratio. |
| `color` | string | Hex color for monochrome charts (`number`, `gauge`, `bar`, `line`, `area`, `radar`) |

### Groupable Fields
Valid `groupBy` / `stackBy` values (match CSV columns):
- `Status`, `Priority`, `Group`, `Responsible`
- `Creation Date`, `Due Date`

### Palette
Auto-assigned palette (16 colors, cycles):
```
#6366f1  #8b5cf6  #a78bfa  #c4b5fd
#10b981  #34d399  #6ee7b7
#f59e0b  #fbbf24  #fcd34d
#3b82f6  #60a5fa  #93c5fd
#ef4444  #f87171
#64748b  #94a3b8
```

---

## Adding a New Chart Type

1. **Backend** (`src/api.py`): Add handler in `get_chart_data()` route — process incidents, return JSON.
2. **Frontend** (`static/js/charts.js`): Add `renderXxxChart()` function + case in `doRender()` switch.
3. **Config** (`config/charts.json`): Add card entry with `type` matching the new type string.

No other files need changes.
