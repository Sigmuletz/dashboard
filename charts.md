# Dashboard Reference

## Architecture Overview

```
app.py          — Flask server, dataset registry, static serving
src/
  api.py        — All REST endpoints (columns, data, charts, notifications, views, highlighting)
  data_loader.py— CSV parsing + per-dataset config file loading
  models.py     — Date parsing, overdue detection, column type guessing
config/
  {dataset}_charts.json       — Per-dataset chart card definitions
  {dataset}_highlighting.json — Per-dataset row/cell highlighting rules
  views.json                  — Saved dashboard presets (full state snapshots)
static/js/
  app.js          — EventBus, shared utilities, dataset switcher
  charts.js       — Chart rendering (Chart.js), chart card grid
  chart-editor.js — Chart configuration panel (add/remove/reorder cards)
  table.js        — Data table rendering, sorting, search
  columns.js      — Column visibility picker for the table
  filters.js      — Left sidebar filter panel
  notifications.js— Right sidebar notification cards with field mapping
  views.js        — Save/apply/delete dashboard view presets
  highlighting-editor.js — Row/cell highlighting rule editor
templates/
  index.html      — Single-page layout (header, sidebar, main, notifications)
```

---

## Data Flow

1. **CSV files** in `data/` (e.g. `incidents.csv`, `requests.csv`, `changes.csv`) are loaded by `data_loader.py`
2. **Config JSON files** in `config/` are loaded per-dataset:
   - `{dataset}_charts.json` — chart card definitions
   - `{dataset}_highlighting.json` — highlighting rules
3. **REST API** (`src/api.py`) serves filtered/sorted data as JSON
4. **Frontend** fetches data via `apiFetch()` and renders with Chart.js + vanilla DOM

---

## Supported Chart Types

Dashboard uses **Chart.js** (loaded via CDN `window.Chart`). Chart cards are configured in `config/{dataset}_charts.json`.

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
| `groupBy` | yes | Field to group by |
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
Same as `bar` but with `indexAxis: 'y'`. Better for long category labels.

| Config field | Required | Description |
|-------------|----------|-------------|
| `title` | yes | Card heading |
| `groupBy` | yes | Field to group by |
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
| `groupBy` | yes | Field to group by |

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
| `groupBy` | yes | Field to group by |

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
Radial chart where each segment angle is equal, but radius varies by value.

| Config field | Required | Description |
|-------------|----------|-------------|
| `title` | yes | Card heading |
| `groupBy` | yes | Field to group by |
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
Multi-axis comparison. Each category is an axis radiating from center.

| Config field | Required | Description |
|-------------|----------|-------------|
| `title` | yes | Card heading |
| `groupBy` | yes | Field to group by |
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
Time-series line with points.

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
Same as `line` but with gradient fill below the curve.

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
Time-series scatter with points connected by line. One dataset per group. X = date, Y = count.

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
Scatter with a third dimension (bubble size). X = date, Y = avg priority (1-4), radius = count.

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

## Chart Config Reference

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

## Chart Editor UI

Accessed via the **Charts** button in the header toolbar. Opens a slide-out panel that allows:

- **Add Chart** — Create a new chart card with type, title, groupBy, color, width, filter
- **Remove Chart** — Delete a card (× button on each card row)
- **Reorder** — Drag cards to change display order (persisted on save)
- **Save & Apply** — Writes updated config to `config/{dataset}_charts.json` via `POST /api/charts-config`

Changes take effect immediately after save — no page reload needed.

---

## Notification System

The right sidebar shows a configurable list of recent items (up to 50).

### Notification Card Layout
Each card displays exactly **5 fields**:

| Field | Description | Default column source |
|-------|-------------|----------------------|
| **Ticket ID** | Item identifier | Auto-detected: `Number`, `ID`, `Ref`, `Ticket` |
| **Priority** | Priority badge | Auto-detected: column containing "priority"/"severity"/"urgency" |
| **Description** | Description text (2-line clamp) | Auto-detected: `Description`, `Title`, `Subject`, `Summary` |
| **Status** | Status badge with dot | Auto-detected: column containing "status"/"state"/"phase" |
| **Age** | Relative time (e.g. "2h ago") | Auto-detected: `Creation Date`, `Created Date`, `Submitted Date` |

### Field Mapping
Each of the 5 fields can be manually mapped to a specific CSV column via the **gear icon** (⚙) button in the notification config bar. The popup shows 5 dropdowns, each with:

- **Auto** — Server auto-detection heuristics (default)
- **Any column name** — Explicit column mapping

Mappings are persisted per dataset in `localStorage` key `dashboard-notif-fields-{dataset}` and are included in saved **Views** (presets).

### Sort & Limit
- **Sort column** — Dropdown of all columns, default "Auto (date)" uses server's date-column detection
- **Sort direction** — Ascending/descending toggle button
- **Limit** — 5, 10, 20, or 50 items
- These settings are in-memory only (reset on reload), not persisted

---

## Views / Presets

The **Views** dropdown in the header saves and restores complete dashboard state:

**Captured state:**
- Current dataset
- Table column visibility & order (`dashboard-columns-{dataset}`)
- Active filters (`dashboard-filters-{dataset}`)
- Table sort (`dashboard-sort-{dataset}`)
- Search text (`dashboard-search-{dataset}`)
- Notification field mapping (`dashboard-notif-fields-{dataset}`)
- Chart card configuration (from `config/{dataset}_charts.json`)

Views are stored server-side in `config/views.json`. Applying a view writes all localStorage keys, saves chart config, switches dataset, and reloads the page.

---

## Highlighting Rules

Per-dataset row and cell highlighting rules configured via the **Styles** button in the table toolbar. Rules are stored in `config/{dataset}_highlighting.json`.

Each rule specifies:
- **Target** — `row` (entire row background) or `cell` (specific column)
- **Column** — For cell rules, which column to highlight
- **Condition** — Column + operator + value (e.g. `Status = "Overdue"`, `Priority > "Medium"`)
- **Style** — Background color, text color, font weight

---

## Adding a New Dataset

1. Add CSV file to `data/` (e.g. `newdata.csv`)
2. Create chart config: `config/newdata_charts.json` (can be empty array `[]`)
3. Create highlighting config: `config/newdata_highlighting.json` (can be empty object `{}`)
4. Register in `app.py`'s `DATASETS` dict
5. Dataset appears in the header dropdown automatically

---

## Adding a New Chart Type

1. **Backend** (`src/api.py`): Add handler in `get_chart_data()` route — process rows, return JSON
2. **Frontend** (`static/js/charts.js`): Add `renderXxxChart()` function + case in `doRender()` switch
3. **Config** (`config/{dataset}_charts.json`): Add card entry with `type` matching the new type string
4. **Chart Editor** (`static/js/chart-editor.js`): Add the new type to the type dropdown if it needs custom fields

No other files need changes.

---

## Embedding Cards in External Apps

The dashboard exposes a standalone embed endpoint for rendering individual chart cards in iframes or frames within other applications.

### Endpoint

```
GET /embed/<card_id>?dataset=<name>&<filter_params>&height=<px>&width=<px>&title=<override>&theme=<name>
```

### Parameters

| Param | Required | Description |
|-------|----------|-------------|
| `card_id` (path) | yes | Card ID from chart config (e.g. `total-tickets`, `status-bar`) |
| `dataset` | no | Dataset name (default: `incidents`). One of: `incidents`, `changes`, `requests` |
| `height` | no | Fixed card height in pixels. When set, chart fills container; when omitted, chart uses natural aspect ratio |
| `width` | no | Fixed card width in pixels |
| `title` | no | Override the card title displayed in the embed header |
| `theme` | no | Color scheme: `midnight` (default), `charcoal`, `omnitracker` |
| `*` (any) | no | Filter params are forwarded to the data API. Example: `?Status=New&Priority=High` or comma-separated `?Status=New,In+Progress` |

### Response

Returns a complete standalone HTML page (no dependencies on dashboard UI). The page:
- Loads Chart.js from CDN (no CORS issues)
- Fetches data from `/api/chart-data/<card_id>` with all query params forwarded
- Renders the chart inside a themed card with title
- Auto-posts its content height via `window.parent.postMessage` for responsive iframe sizing

### Usage Examples

**Basic embed (default dataset, no filters):**
```html
<iframe src="http://dashboard:5000/embed/total-tickets"></iframe>
```

**With dataset and filters:**
```html
<iframe src="http://dashboard:5000/embed/status-bar?dataset=incidents&Priority=High,Critical"></iframe>
```

**Fixed size + theme:**
```html
<iframe src="http://dashboard:5000/embed/priority-doughnut?height=300&width=400&theme=charcoal"></iframe>
```

**Full-width timeline with custom title:**
```html
<iframe src="http://dashboard:5000/embed/created-area?dataset=changes&title=Changes+Over+Time&height=250" style="width:100%;border:none;"></iframe>
```

### Responsive Iframe Sizing

The embed page sends `postMessage` events with the card's rendered height. To auto-resize the iframe:

```js
window.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'dashboard-card-height') {
    const iframe = document.querySelector(`iframe[src*="${e.data.cardId}"]`);
    if (iframe) iframe.style.height = e.data.height + 'px';
  }
});
```

You can also request a height re-measurement by sending to the iframe's `contentWindow`:

```js
iframe.contentWindow.postMessage({ type: 'request-height' }, '*');
```

### Supported Chart Types

All 13 chart types supported by the dashboard render correctly in embed mode: `number`, `gauge`, `bar`, `horizontalBar`, `stackedBar`, `doughnut`, `pie`, `polarArea`, `radar`, `line`, `area`, `scatter`, `bubble`.

### Styling

The embed card inherits the dashboard's dark theme aesthetic. No external CSS files are required — all styles are inlined. The card has:
- Rounded corners (`0.75rem` border-radius)
- Dark surface card background
- Uppercase title label
- Full chart.js interactivity (tooltips, hover, click)

### Limitations

- Chart animations play on each embed load (no "update in place" mode — embeds are static at render time)
- No lazy loading — the chart renders immediately on page load
- No dashboard interaction (drag, resize, chart editor) — embed is read-only display

```
   <iframe src="http://localhost:5000/embed/status-bar?dataset=incidents&Priority=High,Critical" tyle="border:none; width:100%;"></iframe>   
   <br>
   <iframe src="http://localhost:5000/embed/incident-counts?dataset=incidents" tyle="border:none; width:100%;" style="width:100%;border:none;"></iframe>
   <br>
   <iframe src="http://localhost:5000/embed/change-risk-polar?dataset=changes" tyle="border:none;" style="width: 600;height: 600;"></iframe>
```