/**
 * highlighting-editor.js — Slide-over panel to edit row/cell highlighting
 * rules for the current dataset. Persists to /api/highlighting.
 */
import { bus, apiFetch } from './app.js';

let panelEl = null;
let overlayEl = null;
let config = { rowRules: [], cellRules: [] };
let columns = [];
let dirty = false;
let eventsReady = false;

export function initHighlightingEditor() {
  panelEl = document.getElementById('hlEditorPanel');
  overlayEl = document.getElementById('hlEditorOverlay');
  if (!panelEl) return;

  document.getElementById('hlEditorToggle')?.addEventListener('click', (e) => {
    e.stopPropagation();
    openPanel();
  });

  panelEl.querySelector('.hl-editor-close')?.addEventListener('click', closePanel);
  overlayEl?.addEventListener('click', closePanel);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && panelEl.classList.contains('open')) closePanel();
  });

  bus.on('dataset-changed', () => {
    if (panelEl.classList.contains('open')) closePanel();
    config = { rowRules: [], cellRules: [] };
    columns = [];
    dirty = false;
    eventsReady = false;
  });
}

async function openPanel() {
  try {
    const [hlRes, colsRes] = await Promise.all([
      apiFetch('/api/highlighting'),
      apiFetch('/api/columns'),
    ]);
    config = { rowRules: hlRes.rowRules || [], cellRules: hlRes.cellRules || [] };
    columns = colsRes.columns || [];
  } catch (err) {
    console.error('[HLEditor] Failed to load:', err);
    return;
  }
  dirty = false;
  renderPanel();

  if (!eventsReady) {
    const body = panelEl.querySelector('.hl-editor-body');
    if (body) attachEvents(body);
    eventsReady = true;
  }

  panelEl.classList.add('open');
  overlayEl?.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closePanel() {
  if (dirty && !confirm('Unsaved changes. Discard?')) return;
  panelEl.classList.remove('open');
  overlayEl?.classList.remove('open');
  document.body.style.overflow = '';
  config = { rowRules: [], cellRules: [] };
  dirty = false;
  eventsReady = false;
}

/* ── Render ──────────────────────────────────────────────────────── */

function renderPanel() {
  const body = panelEl.querySelector('.hl-editor-body');
  if (!body) return;

  const colNames = columns.map(c => c.key).sort();

  body.innerHTML = `
    <div class="hl-section">
      <div class="hl-section-header">
        <h3>Row Rules</h3>
        <button class="hl-add-btn" data-action="add-row-rule">+ Add Rule</button>
      </div>
      <div class="hl-rules-list" id="hlRowRules">
        ${config.rowRules.map((rule, i) => renderRowRule(rule, i, colNames)).join('')}
        ${config.rowRules.length === 0 ? '<div class="hl-empty">No row rules defined</div>' : ''}
      </div>
    </div>
    <div class="hl-section">
      <div class="hl-section-header">
        <h3>Cell Rules (Badge Mappings)</h3>
        <button class="hl-add-btn" data-action="add-cell-rule">+ Add Rule</button>
      </div>
      <div class="hl-rules-list" id="hlCellRules">
        ${config.cellRules.map((rule, i) => renderCellRule(rule, i, colNames)).join('')}
        ${config.cellRules.length === 0 ? '<div class="hl-empty">No cell rules defined</div>' : ''}
      </div>
    </div>
    <div class="hl-save-bar">
      <button id="hlEditorSave" class="chart-editor-save-btn">Save & Apply</button>
    </div>
  `;

  document.getElementById('hlEditorSave')?.addEventListener('click', saveConfig);
}

function renderRowRule(rule, idx, colNames) {
  const col = rule.condition?.column || '';
  const val = rule.condition?.value ?? '';
  const isOverdue = rule.condition?.type === 'overdue';
  const cls = rule.style?.rowClass || '';
  return `
  <div class="hl-rule-card">
    <div class="hl-rule-header">
      <span class="hl-rule-id">#${idx + 1}</span>
      <button data-action="remove-row-rule" data-idx="${idx}" class="chart-editor-delete-btn">&times;</button>
    </div>
    <div class="hl-rule-body">
      <div class="hl-rule-row">
        <label class="hl-rule-label">Condition Type</label>
        <select data-action="row-cond-type" data-idx="${idx}" class="chart-editor-select">
          <option value="column" ${!isOverdue ? 'selected' : ''}>Column Match</option>
          <option value="overdue" ${isOverdue ? 'selected' : ''}>Overdue</option>
        </select>
      </div>
      ${!isOverdue ? `
      <div class="hl-rule-row">
        <label class="hl-rule-label">Column</label>
        <select data-action="row-cond-column" data-idx="${idx}" class="chart-editor-select">
          ${colNames.map(c => `<option value="${escAttr(c)}" ${col === c ? 'selected' : ''}>${escHtml(c)}</option>`).join('')}
        </select>
      </div>
      <div class="hl-rule-row">
        <label class="hl-rule-label">Value</label>
        <input type="text" value="${escAttr(val)}" data-action="row-cond-value" data-idx="${idx}" class="chart-editor-input" placeholder="e.g. Critical">
      </div>
      ` : ''}
      <div class="hl-rule-row">
        <label class="hl-rule-label">Row CSS Class</label>
        <input type="text" value="${escAttr(cls)}" data-action="row-style-class" data-idx="${idx}" class="chart-editor-input" placeholder="e.g. overdue">
      </div>
    </div>
  </div>`;
}

function renderCellRule(rule, idx, colNames) {
  const col = rule.column || '';
  const mappings = rule.mappings || {};
  const ruleType = rule.type || '';
  return `
  <div class="hl-rule-card">
    <div class="hl-rule-header">
      <span class="hl-rule-id">#${idx + 1}</span>
      <button data-action="remove-cell-rule" data-idx="${idx}" class="chart-editor-delete-btn">&times;</button>
    </div>
    <div class="hl-rule-body">
      <div class="hl-rule-row">
        <label class="hl-rule-label">ID</label>
        <input type="text" value="${escAttr(rule.id || '')}" data-action="cell-id" data-idx="${idx}" class="chart-editor-input">
      </div>
      <div class="hl-rule-row">
        <label class="hl-rule-label">Column</label>
        <select data-action="cell-column" data-idx="${idx}" class="chart-editor-select">
          ${colNames.map(c => `<option value="${escAttr(c)}" ${col === c ? 'selected' : ''}>${escHtml(c)}</option>`).join('')}
        </select>
      </div>
      <div class="hl-rule-row">
        <label class="hl-rule-label">Type</label>
        <input type="text" value="${escAttr(ruleType)}" data-action="cell-type" data-idx="${idx}" class="chart-editor-input" placeholder="e.g. status">
      </div>
      <div class="hl-rule-row">
        <label class="hl-rule-label">Mappings</label>
        <div class="hl-mappings-list" data-idx="${idx}">
          ${Object.entries(mappings).map(([val, style]) => `
            <div class="hl-mapping-row">
              <input type="text" value="${escAttr(val)}" data-action="mapping-key" data-idx="${idx}" data-old-key="${escAttr(val)}" placeholder="Value" class="chart-editor-input hl-mapping-key">
              <input type="text" value="${escAttr(style.class || '')}" data-action="mapping-class" data-idx="${idx}" data-key="${escAttr(val)}" placeholder="CSS class" class="chart-editor-input hl-mapping-class">
              <label class="hl-mapping-badge-label">
                <input type="checkbox" data-action="mapping-badge" data-idx="${idx}" data-key="${escAttr(val)}" ${style.badge ? 'checked' : ''}> Badge
              </label>
              <button data-action="remove-mapping" data-idx="${idx}" data-key="${escAttr(val)}" class="chart-editor-filter-remove">&times;</button>
            </div>
          `).join('')}
        </div>
        <button class="hl-add-mapping-btn" data-action="add-mapping" data-idx="${idx}">+ Add mapping</button>
      </div>
    </div>
  </div>`;
}

/* ── Event delegation ────────────────────────────────────────────── */

function attachEvents(body) {
  body.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const action = btn.dataset.action;
    const idx = parseInt(btn.dataset.idx);

    if (action === 'add-row-rule') {
      const col = columns[0]?.key || '';
      config.rowRules.push({
        id: 'rule-' + Date.now(),
        condition: { type: 'column', column: col, value: '' },
        style: { rowClass: '' },
      });
      dirty = true;
      renderPanel();
    } else if (action === 'remove-row-rule') {
      config.rowRules.splice(idx, 1);
      dirty = true;
      renderPanel();
    } else if (action === 'add-cell-rule') {
      config.cellRules.push({
        id: 'cell-' + Date.now(),
        column: columns[0]?.key || '',
        type: '',
        mappings: {},
      });
      dirty = true;
      renderPanel();
    } else if (action === 'remove-cell-rule') {
      config.cellRules.splice(idx, 1);
      dirty = true;
      renderPanel();
    } else if (action === 'add-mapping') {
      const rule = config.cellRules[idx];
      if (!rule) return;
      if (!rule.mappings) rule.mappings = {};
      rule.mappings[''] = { class: '', badge: false };
      dirty = true;
      renderPanel();
    } else if (action === 'remove-mapping') {
      const key = btn.dataset.key;
      const rule = config.cellRules[idx];
      if (rule?.mappings) {
        delete rule.mappings[key];
        dirty = true;
        renderPanel();
      }
    }
  });

  body.addEventListener('change', (e) => {
    const el = e.target;
    const action = el.dataset.action;
    const idx = parseInt(el.dataset.idx);
    if (isNaN(idx)) return;

    if (action === 'row-cond-type') {
      const rule = config.rowRules[idx];
      if (!rule) return;
      if (el.value === 'overdue') {
        rule.condition = { type: 'overdue' };
      } else {
        rule.condition = { type: 'column', column: columns[0]?.key || '', value: '' };
      }
      dirty = true;
      renderPanel();
    } else if (action === 'mapping-key') {
      const oldKey = el.dataset.oldKey;
      const newKey = el.value;
      const rule = config.cellRules[idx];
      if (rule?.mappings && oldKey !== newKey && rule.mappings[oldKey]) {
        rule.mappings[newKey] = rule.mappings[oldKey];
        delete rule.mappings[oldKey];
        dirty = true;
        renderPanel();
      }
    } else if (action === 'mapping-badge') {
      const key = el.dataset.key;
      const rule = config.cellRules[idx];
      if (rule?.mappings?.[key]) {
        rule.mappings[key].badge = el.checked;
        dirty = true;
      }
    }
  });

  body.addEventListener('input', (e) => {
    const el = e.target;
    const action = el.dataset.action;
    const idx = parseInt(el.dataset.idx);
    if (isNaN(idx)) return;

    switch (action) {
      case 'row-cond-column': {
        const rule = config.rowRules[idx];
        if (rule?.condition) { rule.condition.column = el.value; dirty = true; }
        break;
      }
      case 'row-cond-value': {
        const rule = config.rowRules[idx];
        if (rule?.condition) { rule.condition.value = el.value; dirty = true; }
        break;
      }
      case 'row-style-class': {
        const rule = config.rowRules[idx];
        if (rule?.style) { rule.style.rowClass = el.value; dirty = true; }
        break;
      }
      case 'cell-id': {
        config.cellRules[idx].id = el.value; dirty = true;
        break;
      }
      case 'cell-column': {
        config.cellRules[idx].column = el.value; dirty = true;
        break;
      }
      case 'cell-type': {
        config.cellRules[idx].type = el.value; dirty = true;
        break;
      }
      case 'mapping-class': {
        const key = el.dataset.key;
        const rule = config.cellRules[idx];
        if (rule?.mappings?.[key]) { rule.mappings[key].class = el.value; dirty = true; }
        break;
      }
    }
  });
}

async function saveConfig() {
  try {
    await apiFetch('/api/highlighting', {
      method: 'POST',
      body: JSON.stringify(config),
    });
    dirty = false;
    bus.emit('highlighting-config-saved', config);
    closePanel();
  } catch (err) {
    console.error('[HLEditor] Save failed:', err);
    alert('Failed to save highlighting config');
  }
}

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
