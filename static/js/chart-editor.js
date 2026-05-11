/**
 * chart-editor.js — Right slide-over panel to configure chart cards for
 * the currently active dataset. Supports add, delete, reorder, edit all
 * parameters, and per-chart static filters with column-value dropdowns.
 */
import { bus, apiFetch, getDataset } from './app.js';

let panelEl = null;
let overlayEl = null;
let cards = [];            // current chart config (mutable copy)
let columns = [];          // column metadata: [{key, label, type}, ...]
let columnValues = {};     // {columnKey: [distinct values]} for filter dropdowns
let dirty = false;
let draggedCardIdx = null;
let eventsReady = false;

/* ── Public: init ────────────────────────────────────────────────── */

export function initChartEditor() {
  panelEl = document.getElementById('chartEditorPanel');
  overlayEl = document.getElementById('chartEditorOverlay');
  if (!panelEl) {
    console.warn('[ChartEditor] panel not found');
    return;
  }

  // Open button in header
  const openBtn = document.getElementById('chartEditorToggle');
  if (openBtn) {
    openBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openPanel();
    });
  }

  // Close buttons
  panelEl.querySelector('.chart-editor-close')?.addEventListener('click', closePanel);
  overlayEl?.addEventListener('click', closePanel);

  // Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && panelEl.classList.contains('open')) {
      closePanel();
    }
  });

  // Dataset switch: close panel, reset state
  bus.on('dataset-changed', () => {
    if (panelEl.classList.contains('open')) closePanel();
    cards = [];
    columns = [];
    columnValues = {};
    dirty = false;
    eventsReady = false;
  });
}

/* ── Open / Close ────────────────────────────────────────────────── */

async function openPanel() {
  // Load config and column metadata
  try {
    const [cfgRes, colsRes, filterRes] = await Promise.all([
      apiFetch('/api/charts-config'),
      apiFetch('/api/columns'),
      apiFetch('/api/filters'),
    ]);
    cards = JSON.parse(JSON.stringify(cfgRes.cards || []));
    columns = colsRes.columns || [];
    columnValues = filterRes; // {columnKey: [values]}
  } catch (err) {
    console.error('[ChartEditor] Failed to load data:', err);
    return;
  }

  dirty = false;
  renderCards();

  // Attach delegated event listeners once per panel session
  if (!eventsReady) {
    const list = panelEl.querySelector('.chart-editor-list');
    if (list) {
      attachCardEvents(list);
      eventsReady = true;
    }
  }

  panelEl.classList.add('open');
  overlayEl?.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closePanel() {
  if (dirty && !confirm('You have unsaved changes. Discard?')) return;
  panelEl.classList.remove('open');
  overlayEl?.classList.remove('open');
  document.body.style.overflow = '';
  cards = [];
  dirty = false;
  eventsReady = false;
}

/* ── Render ──────────────────────────────────────────────────────── */

function renderCards() {
  const list = panelEl.querySelector('.chart-editor-list');
  if (!list) return;

  const typeOptions = [
    'number','gauge','bar','doughnut','pie','polarArea','radar',
    'horizontalBar','stackedBar','scatter','bubble','line','area'
  ];

  const columnNames = columns.map(c => c.key).sort();

  if (cards.length === 0) {
    list.innerHTML = '<div class="chart-editor-empty">No charts configured. Click "Add Chart" to create one.</div>';
  } else {
    list.innerHTML = cards.map((card, idx) => {
      const isNumber = card.type === 'number';
      const isGauge = card.type === 'gauge';
      const needsGroupBy = ['bar','doughnut','pie','polarArea','radar','horizontalBar','stackedBar','scatter','bubble'].includes(card.type);
      const needsStackBy = card.type === 'stackedBar';
      const needsColor = ['number','gauge','bar','horizontalBar','line','area'].includes(card.type) || isGauge;
      const isCanvasChart = !isNumber && !isGauge;

      const groupByOpts = columnNames.map(k =>
        `<option value="${escAttr(k)}" ${card.groupBy === k ? 'selected' : ''}>${escHtml(k)}</option>`
      ).join('');

      const stackByOpts = columnNames.map(k =>
        `<option value="${escAttr(k)}" ${card.stackBy === k ? 'selected' : ''}>${escHtml(k)}</option>`
      ).join('');

      // Filter rows for this card
      const cardFilter = card.filter || {};
      const filterKeys = Object.keys(cardFilter);

      return `
      <div class="chart-editor-card" data-card-idx="${idx}" draggable="true">
        <div class="chart-editor-card-header">
          <span class="chart-editor-drag-handle" title="Drag to reorder">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><circle cx="4" cy="2" r="1.2" fill="currentColor"/><circle cx="8" cy="2" r="1.2" fill="currentColor"/><circle cx="4" cy="6" r="1.2" fill="currentColor"/><circle cx="8" cy="6" r="1.2" fill="currentColor"/><circle cx="4" cy="10" r="1.2" fill="currentColor"/><circle cx="8" cy="10" r="1.2" fill="currentColor"/></svg>
          </span>
          <span class="chart-editor-card-id">#${idx + 1}</span>
          <button class="chart-editor-delete-btn" data-action="delete" data-idx="${idx}" title="Delete chart">&times;</button>
        </div>
        <div class="chart-editor-card-body">
          <!-- Title -->
          <div class="chart-editor-field">
            <label>Title</label>
            <input type="text" value="${escAttr(card.title || '')}" data-field="title" data-idx="${idx}" class="chart-editor-input">
          </div>

          <!-- Type -->
          <div class="chart-editor-field">
            <label>Type</label>
            <select data-field="type" data-idx="${idx}" class="chart-editor-select">
              ${typeOptions.map(t => `<option value="${t}" ${card.type === t ? 'selected' : ''}>${t}</option>`).join('')}
            </select>
          </div>

          <!-- ID (read-only mostly) -->
          <div class="chart-editor-field">
            <label>ID <span class="chart-editor-hint">(auto)</span></label>
            <input type="text" value="${escAttr(card.id || '')}" data-field="id" data-idx="${idx}" class="chart-editor-input">
          </div>

          <!-- Width -->
          <div class="chart-editor-field">
            <label>Width (cols)</label>
            <select data-field="width" data-idx="${idx}" class="chart-editor-select">
              <option value="1" ${(card.width || 1) === 1 ? 'selected' : ''}>1</option>
              <option value="2" ${(card.width || 1) === 2 ? 'selected' : ''}>2</option>
              <option value="3" ${card.width === 3 ? 'selected' : ''}>3</option>
              <option value="4" ${card.width === 4 ? 'selected' : ''}>4</option>
            </select>
          </div>

          ${isCanvasChart ? `
          <div class="chart-editor-field">
            <label>Chart Height (px, optional)</label>
            <input type="number" value="${card.chartHeight || ''}" data-field="chartHeight" data-idx="${idx}" placeholder="auto" min="100" max="800" class="chart-editor-input">
          </div>
          ` : ''}

          ${needsColor ? `
          <div class="chart-editor-field">
            <label>Color</label>
            <div class="chart-editor-color-row">
              <input type="color" value="${escAttr(card.color || '#6366f1')}" data-field="color" data-idx="${idx}" class="chart-editor-color">
              <input type="text" value="${escAttr(card.color || '')}" data-field="color" data-idx="${idx}" class="chart-editor-input chart-editor-color-text" placeholder="#6366f1">
            </div>
          </div>
          ` : ''}

          ${isGauge ? `
          <div class="chart-editor-field">
            <label>Gauge Max</label>
            <input type="number" value="${card.gaugeMax || ''}" data-field="gaugeMax" data-idx="${idx}" placeholder="auto" min="1" class="chart-editor-input">
          </div>
          ` : ''}

          ${needsGroupBy ? `
          <div class="chart-editor-field">
            <label>Group By</label>
            <select data-field="groupBy" data-idx="${idx}" class="chart-editor-select">
              <option value="">--</option>
              ${groupByOpts}
            </select>
          </div>
          ` : ''}

          ${needsStackBy ? `
          <div class="chart-editor-field">
            <label>Stack By</label>
            <select data-field="stackBy" data-idx="${idx}" class="chart-editor-select">
              <option value="">--</option>
              ${stackByOpts}
            </select>
          </div>
          ` : ''}

          <!-- Per-chart static filter -->
          <div class="chart-editor-field">
            <label>Chart Filter <span class="chart-editor-hint">(applied only to this chart)</span></label>
            <div class="chart-editor-filter-list" data-idx="${idx}">
              ${filterKeys.map(fk => renderFilterRow(idx, fk, cardFilter[fk])).join('')}
            </div>
            <button class="chart-editor-add-filter-btn" data-action="add-filter" data-idx="${idx}">+ Add filter</button>
          </div>

          ${isNumber ? renderNumberSubFilters(idx, card) : ''}
        </div>
      </div>`;
    }).join('');
  }
}

function renderFilterRow(cardIdx, field, values) {
  const columnOpts = columns.map(c =>
    `<option value="${escAttr(c.key)}" ${field === c.key ? 'selected' : ''}>${escHtml(c.key)}</option>`
  ).join('');

  const vals = Array.isArray(values) ? values : (typeof values === 'boolean' ? [String(values)] : [String(values)]);
  const valStr = vals.join(',');

  return `
  <div class="chart-editor-filter-row">
    <select data-action="filter-field" data-idx="${cardIdx}" data-old-field="${escAttr(field)}" class="chart-editor-select chart-editor-filter-field">
      ${columnOpts}
    </select>
    <input type="text" value="${escAttr(valStr)}" data-action="filter-values" data-idx="${cardIdx}" data-field="${escAttr(field)}" placeholder="value1,$EMPTY,..." class="chart-editor-input chart-editor-filter-values">
    <button class="chart-editor-filter-remove" data-action="remove-filter" data-idx="${cardIdx}" data-field="${escAttr(field)}">&times;</button>
  </div>`;
}

function renderNumberSubFilters(idx, card) {
  const numbers = card.numbers || [];
  return `
  <div class="chart-editor-number-filters">
    <label>Number Cards</label>
    <div class="chart-editor-number-list" data-idx="${idx}">
      ${numbers.map((n, ni) => `
        <div class="chart-editor-number-row">
          <div class="chart-editor-number-field">
            <span class="chart-editor-number-label">Label</span>
            <input type="text" value="${escAttr(n.label || '')}" data-action="number-label" data-idx="${idx}" data-ni="${ni}" placeholder="e.g. Total" class="chart-editor-input">
          </div>
          <div class="chart-editor-number-field">
            <span class="chart-editor-number-label">Color</span>
            <input type="text" value="${escAttr(n.color || '')}" data-action="number-color" data-idx="${idx}" data-ni="${ni}" placeholder="#6366f1" class="chart-editor-input">
          </div>
          <div class="chart-editor-number-field chart-editor-number-field-wide">
            <span class="chart-editor-number-label">Filter</span>
            <input type="text" value="${escAttr(filterToString(n.filter || {}))}" data-action="number-filter" data-idx="${idx}" data-ni="${ni}" placeholder="Status:New,$EMPTY" class="chart-editor-input">
          </div>
          <button data-action="remove-number" data-idx="${idx}" data-ni="${ni}" class="chart-editor-filter-remove" style="align-self:flex-end;margin-bottom:1px">&times;</button>
        </div>
      `).join('')}
    </div>
    <button class="chart-editor-add-filter-btn" data-action="add-number" data-idx="${idx}">+ Add number</button>
  </div>`;
}

/** Re-render only the body of a single card (used when chart type changes). */
function renderCardBody(cardEl, idx) {
  const card = cards[idx];
  if (!card) return;
  const body = cardEl.querySelector('.chart-editor-card-body');
  if (!body) return;

  const isNumber = card.type === 'number';
  const isGauge = card.type === 'gauge';
  const needsGroupBy = ['bar','doughnut','pie','polarArea','radar','horizontalBar','stackedBar','scatter','bubble'].includes(card.type);
  const needsStackBy = card.type === 'stackedBar';
  const needsColor = ['number','gauge','bar','horizontalBar','line','area'].includes(card.type);
  const isCanvasChart = !isNumber && !isGauge;

  const columnNames = columns.map(c => c.key).sort();

  const groupByOpts = columnNames.map(k =>
    `<option value="${escAttr(k)}" ${card.groupBy === k ? 'selected' : ''}>${escHtml(k)}</option>`
  ).join('');

  const stackByOpts = columnNames.map(k =>
    `<option value="${escAttr(k)}" ${card.stackBy === k ? 'selected' : ''}>${escHtml(k)}</option>`
  ).join('');

  const filterKeys = Object.keys(card.filter || {});

  const typeOptions = [
    'number','gauge','bar','doughnut','pie','polarArea','radar',
    'horizontalBar','stackedBar','scatter','bubble','line','area'
  ];

  body.innerHTML = `
    <!-- Title -->
    <div class="chart-editor-field">
      <label>Title</label>
      <input type="text" value="${escAttr(card.title || '')}" data-field="title" data-idx="${idx}" class="chart-editor-input">
    </div>

    <!-- Type -->
    <div class="chart-editor-field">
      <label>Type</label>
      <select data-field="type" data-idx="${idx}" class="chart-editor-select">
        ${typeOptions.map(t => `<option value="${t}" ${card.type === t ? 'selected' : ''}>${t}</option>`).join('')}
      </select>
    </div>

    <!-- ID -->
    <div class="chart-editor-field">
      <label>ID <span class="chart-editor-hint">(auto)</span></label>
      <input type="text" value="${escAttr(card.id || '')}" data-field="id" data-idx="${idx}" class="chart-editor-input">
    </div>

    <!-- Width -->
    <div class="chart-editor-field">
      <label>Width (cols)</label>
      <select data-field="width" data-idx="${idx}" class="chart-editor-select">
        <option value="1" ${(card.width || 1) === 1 ? 'selected' : ''}>1</option>
        <option value="2" ${(card.width || 1) === 2 ? 'selected' : ''}>2</option>
        <option value="3" ${card.width === 3 ? 'selected' : ''}>3</option>
        <option value="4" ${card.width === 4 ? 'selected' : ''}>4</option>
      </select>
    </div>

    ${isCanvasChart ? `
    <div class="chart-editor-field">
      <label>Chart Height (px, optional)</label>
      <input type="number" value="${card.chartHeight || ''}" data-field="chartHeight" data-idx="${idx}" placeholder="auto" min="100" max="800" class="chart-editor-input">
    </div>
    ` : ''}

    ${needsColor ? `
    <div class="chart-editor-field">
      <label>Color</label>
      <div class="chart-editor-color-row">
        <input type="color" value="${escAttr(card.color || '#6366f1')}" data-field="color" data-idx="${idx}" class="chart-editor-color">
        <input type="text" value="${escAttr(card.color || '')}" data-field="color" data-idx="${idx}" class="chart-editor-input chart-editor-color-text" placeholder="#6366f1">
      </div>
    </div>
    ` : ''}

    ${isGauge ? `
    <div class="chart-editor-field">
      <label>Gauge Max</label>
      <input type="number" value="${card.gaugeMax || ''}" data-field="gaugeMax" data-idx="${idx}" placeholder="auto" min="1" class="chart-editor-input">
    </div>
    ` : ''}

    ${needsGroupBy ? `
    <div class="chart-editor-field">
      <label>Group By</label>
      <select data-field="groupBy" data-idx="${idx}" class="chart-editor-select">
        <option value="">--</option>
        ${groupByOpts}
      </select>
    </div>
    ` : ''}

    ${needsStackBy ? `
    <div class="chart-editor-field">
      <label>Stack By</label>
      <select data-field="stackBy" data-idx="${idx}" class="chart-editor-select">
        <option value="">--</option>
        ${stackByOpts}
      </select>
    </div>
    ` : ''}

    <!-- Per-chart static filter -->
    <div class="chart-editor-field">
      <label>Chart Filter <span class="chart-editor-hint">(applied only to this chart)</span></label>
      <div class="chart-editor-filter-list" data-idx="${idx}">
        ${filterKeys.map(fk => renderFilterRow(idx, fk, card.filter[fk])).join('')}
      </div>
      <button class="chart-editor-add-filter-btn" data-action="add-filter" data-idx="${idx}">+ Add filter</button>
    </div>

    ${isNumber ? renderNumberSubFilters(idx, card) : ''}
  `;
}

function filterToString(f) {
  return Object.entries(f).map(([k, v]) => {
    const vals = Array.isArray(v) ? v.join(',') : String(v);
    return `${k}:${vals}`;
  }).join('; ');
}

/* ── Event delegation ────────────────────────────────────────────── */

function attachCardEvents(list) {
  // Drag & drop reorder
  list.querySelectorAll('.chart-editor-card').forEach(cardEl => {
    cardEl.addEventListener('dragstart', (e) => {
      draggedCardIdx = parseInt(cardEl.dataset.cardIdx);
      cardEl.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    cardEl.addEventListener('dragend', () => {
      cardEl.classList.remove('dragging');
      list.querySelectorAll('.chart-editor-card').forEach(el => el.classList.remove('drag-over'));
      draggedCardIdx = null;
    });
    cardEl.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (draggedCardIdx !== null && parseInt(cardEl.dataset.cardIdx) !== draggedCardIdx) {
        cardEl.classList.add('drag-over');
      }
    });
    cardEl.addEventListener('dragleave', () => {
      cardEl.classList.remove('drag-over');
    });
    cardEl.addEventListener('drop', (e) => {
      e.preventDefault();
      cardEl.classList.remove('drag-over');
      if (draggedCardIdx === null) return;
      const targetIdx = parseInt(cardEl.dataset.cardIdx);
      if (draggedCardIdx !== targetIdx) {
        const [moved] = cards.splice(draggedCardIdx, 1);
        cards.splice(targetIdx, 0, moved);
        dirty = true;
        renderCards();
      }
      draggedCardIdx = null;
    });
  });

  // Delegated click handlers
  list.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const action = btn.dataset.action;
    const idx = parseInt(btn.dataset.idx);

    if (action === 'delete') {
      if (confirm(`Delete chart "${cards[idx]?.title || 'untitled'}"?`)) {
        cards.splice(idx, 1);
        dirty = true;
        renderCards();
      }
    } else if (action === 'add-filter') {
      if (!cards[idx].filter) cards[idx].filter = {};
      // Pick first available column as default
      const existing = Object.keys(cards[idx].filter);
      const available = columns.map(c => c.key).filter(k => !existing.includes(k));
      const field = available[0] || columns[0]?.key || 'Status';
      cards[idx].filter[field] = [];
      dirty = true;
      renderCards();
    } else if (action === 'remove-filter') {
      const field = btn.dataset.field;
      if (cards[idx]?.filter) {
        delete cards[idx].filter[field];
        if (Object.keys(cards[idx].filter).length === 0) delete cards[idx].filter;
        dirty = true;
        renderCards();
      }
    } else if (action === 'add-number') {
      if (!cards[idx].numbers) cards[idx].numbers = [];
      cards[idx].numbers.push({ label: 'Count', color: '#6366f1', filter: {} });
      dirty = true;
      renderCards();
    } else if (action === 'remove-number') {
      const ni = parseInt(btn.dataset.ni);
      cards[idx].numbers.splice(ni, 1);
      if (cards[idx].numbers.length === 0) delete cards[idx].numbers;
      dirty = true;
      renderCards();
    }
  });

  // Delegated change handlers (inputs, selects)
  list.addEventListener('change', (e) => {
    const el = e.target;
    const action = el.dataset.action;
    const idx = parseInt(el.dataset.idx);

    if (action === 'filter-field') {
      // Rename filter key
      const oldField = el.dataset.oldField;
      const newField = el.value;
      if (oldField && newField && oldField !== newField && cards[idx]?.filter) {
        cards[idx].filter[newField] = cards[idx].filter[oldField];
        delete cards[idx].filter[oldField];
        dirty = true;
        renderCards(); // need full re-render to update data-old-field
      }
      return;
    }

    if (action === 'filter-values') {
      const field = el.dataset.field;
      const raw = el.value.trim();
      if (cards[idx]?.filter) {
        if (raw === 'true' || raw === 'false') {
          cards[idx].filter[field] = raw === 'true';
        } else if (raw) {
          cards[idx].filter[field] = raw.split(',').map(v => v.trim()).filter(Boolean);
        } else {
          delete cards[idx].filter[field];
          if (Object.keys(cards[idx].filter).length === 0) delete cards[idx].filter;
        }
        dirty = true;
      }
      return;
    }

    // Number sub-filters
    if (action === 'number-label') {
      const ni = parseInt(el.dataset.ni);
      if (cards[idx]?.numbers?.[ni]) {
        cards[idx].numbers[ni].label = el.value;
        dirty = true;
      }
      return;
    }
    if (action === 'number-color') {
      const ni = parseInt(el.dataset.ni);
      if (cards[idx]?.numbers?.[ni]) {
        cards[idx].numbers[ni].color = el.value;
        dirty = true;
      }
      return;
    }
    if (action === 'number-filter') {
      const ni = parseInt(el.dataset.ni);
      const raw = el.value.trim();
      if (cards[idx]?.numbers?.[ni]) {
        cards[idx].numbers[ni].filter = parseFilterString(raw);
        dirty = true;
      }
      return;
    }

  });

  // Delegated input handlers for text fields
  list.addEventListener('input', (e) => {
    const el = e.target;
    const field = el.dataset.field;
    const idx = parseInt(el.dataset.idx);
    if (field === undefined || isNaN(idx)) return;
    if (!cards[idx]) return;

    let val = el.value;

    if (field === 'width' || field === 'chartHeight' || field === 'gaugeMax') {
      val = val ? parseInt(val) : undefined;
    }
    if (field === 'width') {
      val = Math.max(1, Math.min(4, val || 1));
    }

    if (field === 'color') {
      // Sync color input with text and vice versa
      if (el.type === 'color') {
        const textInput = el.parentElement?.querySelector('.chart-editor-color-text');
        if (textInput) textInput.value = val;
      } else {
        const colorInput = el.parentElement?.querySelector('.chart-editor-color');
        if (colorInput) colorInput.value = val;
      }
    }

    cards[idx][field] = val;
    dirty = true;

    // Type change → re-render card body to show/hide type-specific fields
    if (field === 'type') {
      const cardEl = list.querySelector(`.chart-editor-card[data-card-idx="${idx}"]`);
      if (cardEl) renderCardBody(cardEl, idx);
    }
  });
}

function parseFilterString(raw) {
  const f = {};
  if (!raw) return f;
  raw.split(';').forEach(part => {
    const colonIdx = part.indexOf(':');
    if (colonIdx === -1) return;
    const key = part.slice(0, colonIdx).trim();
    const vals = part.slice(colonIdx + 1).trim();
    if (!key || !vals) return;
    if (vals === 'true') f[key] = true;
    else if (vals === 'false') f[key] = false;
    else f[key] = vals.split(',').map(v => v.trim()).filter(Boolean);
  });
  return f;
}

/* ── Panel buttons ───────────────────────────────────────────────── */

export function initChartEditorButtons() {
  const addBtn = document.getElementById('chartEditorAdd');
  const saveBtn = document.getElementById('chartEditorSave');

  if (addBtn) {
    addBtn.addEventListener('click', () => {
      const id = 'chart-' + Date.now();
      cards.push({
        id,
        title: 'New Chart',
        type: 'bar',
        groupBy: columns[0]?.key || '',
        color: '#6366f1',
        width: 1,
      });
      dirty = true;
      renderCards();
      // Scroll to bottom
      const list = panelEl?.querySelector('.chart-editor-list');
      if (list) list.scrollTop = list.scrollHeight;
    });
  }

  if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
      // Auto-generate missing IDs
      cards.forEach((c, i) => {
        if (!c.id) c.id = 'chart-' + i;
      });

      try {
        await apiFetch('/api/charts-config', {
          method: 'POST',
          body: JSON.stringify({ cards }),
        });
        dirty = false;
        // Trigger full re-render in charts.js
        bus.emit('charts-config-saved', cards);
        closePanel();
      } catch (err) {
        console.error('[ChartEditor] Save failed:', err);
        alert('Failed to save charts config');
      }
    });
  }
}

/* ── Helpers ─────────────────────────────────────────────────────── */

function escHtml(s) {
  if (!s) return '';
  const d = document.createElement('div');
  d.textContent = String(s);
  return d.innerHTML;
}

function escAttr(s) {
  if (!s) return '';
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
