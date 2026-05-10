/**
 * columns.js — Column visibility & ordering with localStorage persistence.
 * Column metadata fetched from /api/columns (discovered from CSV headers).
 * Emits 'columns-changed' on the EventBus whenever user toggles/reorders columns.
 */
import { bus, apiFetch, getDataset } from './app.js';

function storageKey() { return `dashboard-columns-${getDataset()}`; }

let ALL_COLUMNS = [];       // populated from API
let state = { visible: [], order: [] };

/* ── Persistence ─────────────────────────────────────────────────── */
function loadState() {
  try {
    const raw = localStorage.getItem(storageKey());
    if (raw) {
      const parsed = JSON.parse(raw);
      // Validate against known column keys
      const known = new Set(ALL_COLUMNS.map(c => c.key));
      parsed.visible = (parsed.visible || []).filter(k => known.has(k));
      parsed.order = (parsed.order || []).filter(k => known.has(k));
      // Ensure all known keys are present
      for (const k of known) {
        if (!parsed.order.includes(k)) parsed.order.push(k);
      }
      if (parsed.visible.length === 0) {
        parsed.visible = ALL_COLUMNS.map(c => c.key);
      }
      return parsed;
    }
  } catch (e) { /* ignore */ }
  return {
    visible: ALL_COLUMNS.map(c => c.key),
    order: ALL_COLUMNS.map(c => c.key),
  };
}

function saveState() {
  try {
    localStorage.setItem(storageKey(), JSON.stringify(state));
  } catch (e) { /* quota exceeded */ }
}

/* ── Public API ──────────────────────────────────────────────────── */

/** Returns visible columns in stored order, each with full metadata. */
export function getVisibleColumns() {
  const visibleSet = new Set(state.visible);
  return state.order
    .filter(key => visibleSet.has(key))
    .map(key => ALL_COLUMNS.find(c => c.key === key))
    .filter(Boolean);
}

/** Returns all columns in stored order (for config UI). Each includes
  * an extra `visible` boolean field for checkbox state. */
export function getAllColumns() {
  const visibleSet = new Set(state.visible);
  return state.order
    .map(key => ALL_COLUMNS.find(c => c.key === key))
    .filter(Boolean)
    .map(col => ({ ...col, visible: visibleSet.has(col.key) }));
}

/** Toggle a column's visibility. At least one column must remain visible. */
function toggleColumn(key) {
  if (state.visible.includes(key)) {
    if (state.visible.length <= 1) return; // refuse to hide last column
    state.visible = state.visible.filter(k => k !== key);
  } else {
    const idx = state.order.indexOf(key);
    state.visible = [...state.visible];
    state.visible.splice(idx, 0, key);
  }
  emitChange();
}

/** Replace the full column order (drag-drop result). */
function reorderColumns(newOrder) {
  state.order = newOrder;
  emitChange();
}

function emitChange() {
  saveState();
  bus.emit('columns-changed', getVisibleColumns());
}

/* ── Dropdown UI ─────────────────────────────────────────────────── */

let draggedIndex = null;

export async function initColumns() {
  // Fetch column metadata from API
  try {
    const data = await apiFetch('/api/columns');
    ALL_COLUMNS = data.columns || [];
  } catch (err) {
    console.error('[Columns] Failed to load column metadata:', err);
    return;
  }

  if (ALL_COLUMNS.length === 0) {
    console.warn('[Columns] No columns found from API');
    return;
  }

  // Load persisted state (or default: all visible)
  state = loadState();

  const container = document.getElementById('columnPickerContainer');
  if (!container) {
    console.warn('[Columns] container #columnPickerContainer not found');
    return;
  }

  const button = document.getElementById('columnPickerBtn');
  const menu = document.getElementById('columnPickerMenu');
  const list = document.getElementById('columnPickerList');
  if (!button || !menu || !list) return;

  /* ── Build list ── */
  function renderList() {
    const cols = getAllColumns();
    list.innerHTML = '';

    cols.forEach((col, index) => {
      const item = document.createElement('div');
      item.className = 'column-picker-item';
      item.draggable = true;
      item.dataset.key = col.key;
      item.dataset.index = String(index);

      /* drag handle */
      const handle = document.createElement('span');
      handle.className = 'column-picker-handle';
      handle.innerHTML = '<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><circle cx="4" cy="2" r="1.2" fill="currentColor"/><circle cx="8" cy="2" r="1.2" fill="currentColor"/><circle cx="4" cy="6" r="1.2" fill="currentColor"/><circle cx="8" cy="6" r="1.2" fill="currentColor"/><circle cx="4" cy="10" r="1.2" fill="currentColor"/><circle cx="8" cy="10" r="1.2" fill="currentColor"/></svg>';

      /* checkbox */
      const label = document.createElement('label');
      label.className = 'column-picker-label';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = col.visible;
      cb.addEventListener('change', () => toggleColumn(col.key));
      label.appendChild(cb);
      label.appendChild(document.createTextNode(col.label));

      item.appendChild(handle);
      item.appendChild(label);

      /* ── Drag & Drop ── */
      item.addEventListener('dragstart', (e) => {
        draggedIndex = index;
        item.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', col.key);
      });

      item.addEventListener('dragend', () => {
        item.classList.remove('dragging');
        document.querySelectorAll('.column-picker-item').forEach(el => el.classList.remove('drag-over'));
        draggedIndex = null;
      });

      item.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (draggedIndex !== null && draggedIndex !== index) {
          item.classList.add('drag-over');
        }
      });

      item.addEventListener('dragleave', () => {
        item.classList.remove('drag-over');
      });

      item.addEventListener('drop', (e) => {
        e.preventDefault();
        item.classList.remove('drag-over');
        if (draggedIndex === null || draggedIndex === index) return;

        const newOrder = cols.map(c => c.key);
        const [moved] = newOrder.splice(draggedIndex, 1);
        const dropIndex = index;
        newOrder.splice(dropIndex, 0, moved);
        reorderColumns(newOrder);
        // re-render happens via bus.on('columns-changed') → renderList()
      });

      list.appendChild(item);
    });
  }

  renderList();

  /* ── Toggle menu ── */
  button.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const isOpen = menu.classList.toggle('open');
    if (isOpen) {
      renderList();
    }
  });

  /* ── Close on outside click ── */
  document.addEventListener('click', (e) => {
    if (!container.contains(e.target)) {
      menu.classList.remove('open');
    }
  });

  /* ── Listen for external changes to re-render list ── */
  bus.on('columns-changed', () => {
    renderList();
  });

  /* ── Dataset switch: re-fetch metadata, reset state ── */
  bus.on('dataset-changed', async () => {
    try {
      const data = await apiFetch('/api/columns');
      ALL_COLUMNS = data.columns || [];
      state = loadState();
      // emitChange renders list + notifies table
      emitChange();
    } catch (err) {
      console.error('[Columns] Failed to reload on dataset change:', err);
    }
  });

  // Emit initial column set
  bus.emit('columns-changed', getVisibleColumns());
}
