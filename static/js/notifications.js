/**
 * notifications.js — Right sidebar showing recent activity.
 * Supports user-configurable sort column, direction, limit, and
 * selectable display columns (persisted in localStorage per dataset).
 */
import { bus, apiFetch, relativeTime, statusClass, priorityClass, getDataset } from './app.js';

let pollInterval;
let sortCol = '';       // empty = auto-detect date
let sortOrder = 'desc';
let limit = 10;
let allColumns = [];    // all column metadata from API

// Default visible columns per dataset — key field names that look good in a card
const DEFAULT_VISIBLE = ['Number','ID','Status','Priority','Description','Title','Subject','Summary'];
const STORAGE_KEY_PREFIX = 'dashboard-notif-cols-';

function storageKey() { return STORAGE_KEY_PREFIX + getDataset(); }

function loadVisibleColumns() {
  try {
    const raw = localStorage.getItem(storageKey());
    if (raw) return JSON.parse(raw);
  } catch (e) { /* ignore */ }
  return null;
}

function saveVisibleColumns(visible) {
  try {
    localStorage.setItem(storageKey(), JSON.stringify(visible));
  } catch (e) { /* ignore */ }
}

/** Return list of column keys currently selected for display. */
function getVisibleCols() {
  const saved = loadVisibleColumns();
  if (saved && saved.length > 0) {
    // Filter against known columns
    const known = new Set(allColumns.map(c => c.key));
    return saved.filter(k => known.has(k));
  }
  // Default: pick columns whose keys match common field names
  const defaults = allColumns
    .filter(c => DEFAULT_VISIBLE.some(d => c.key.toLowerCase().includes(d.toLowerCase())))
    .map(c => c.key);
  // Add a few fallback columns if nothing matched
  if (defaults.length === 0 && allColumns.length > 0) {
    defaults.push(...allColumns.slice(0, 4).map(c => c.key));
  }
  return defaults;
}

export function initNotifications() {
  const sortSelect = document.getElementById('notifSortCol');
  const dirBtn = document.getElementById('notifSortDir');
  const limitSelect = document.getElementById('notifLimit');

  // Build sort column dropdown when columns are loaded
  bus.on('columns-changed', (visibleCols) => {
    // columns-changed gives us visible table columns — we need ALL columns
    // Fetch all columns on first load
    if (allColumns.length === 0) {
      apiFetch('/api/columns').then(data => {
        allColumns = data.columns || [];
        populateSortDropdown(sortSelect);
        buildColumnsMenu();
        // Re-render with current visible cols
        fetchNotifications({});
      }).catch(() => {});
    }
  });

  // Sort field change
  sortSelect?.addEventListener('change', () => {
    sortCol = sortSelect.value;
    fetchNotifications({});
  });

  // Sort direction toggle
  dirBtn?.addEventListener('click', () => {
    sortOrder = sortOrder === 'desc' ? 'asc' : 'desc';
    updateDirIcon(dirBtn);
    fetchNotifications({});
  });

  // Limit change
  limitSelect?.addEventListener('click', (e) => {
    // Don't trigger on every click — handled by change
  });
  limitSelect?.addEventListener('change', () => {
    limit = parseInt(limitSelect.value) || 10;
    fetchNotifications({});
  });

  // Notif columns picker toggle
  const colsBtn = document.getElementById('notifColumnsBtn');
  const colsPicker = document.getElementById('notifColumnsPicker');
  const colsMenu = document.getElementById('notifColumnsMenu');

  colsBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    colsPicker.classList.toggle('open');
  });

  document.addEventListener('click', (e) => {
    if (colsPicker && !colsPicker.contains(e.target)) {
      colsPicker.classList.remove('open');
    }
  });

  // Select All / Deselect All for notif columns
  document.getElementById('notifColSelectAll')?.addEventListener('click', () => {
    const visible = allColumns.map(c => c.key);
    saveVisibleColumns(visible);
    buildColumnsMenu();
    fetchNotifications({});
  });
  document.getElementById('notifColDeselectAll')?.addEventListener('click', () => {
    // Keep at least one
    const visible = allColumns.length > 0 ? [allColumns[0].key] : [];
    saveVisibleColumns(visible);
    buildColumnsMenu();
    fetchNotifications({});
  });

  // Delegate clicks inside notif columns menu
  colsMenu?.addEventListener('click', (e) => {
    const cb = e.target.closest('input[type="checkbox"]');
    if (!cb) return;
    const key = cb.value;
    const visible = getVisibleCols();
    if (cb.checked && !visible.includes(key)) {
      visible.push(key);
    } else if (!cb.checked && visible.length > 1) {
      const idx = visible.indexOf(key);
      if (idx !== -1) visible.splice(idx, 1);
    }
    saveVisibleColumns(visible);
    buildColumnsMenu();
    fetchNotifications({});
  });

  bus.on('filters-changed', (filters) => {
    fetchNotifications(filters);
  });

  bus.on('dataset-changed', () => {
    sortCol = '';
    sortOrder = 'desc';
    limit = 10;
    allColumns = [];
    if (sortSelect) sortSelect.value = '';
    if (limitSelect) limitSelect.value = '10';
    updateDirIcon(dirBtn);
    // Re-fetch columns on dataset change
    apiFetch('/api/columns').then(data => {
      allColumns = data.columns || [];
      populateSortDropdown(sortSelect);
      buildColumnsMenu();
      fetchNotifications({});
    }).catch(() => {});
  });

  // Poll every 60 seconds
  pollInterval = setInterval(() => {
    fetchNotifications({});
  }, 60000);
}

function populateSortDropdown(select) {
  if (!select) return;
  const current = select.value;
  select.innerHTML = '<option value="">Auto (date)</option>';
  for (const col of allColumns) {
    const sel = col.key === current ? ' selected' : '';
    select.innerHTML += `<option value="${escAttr(col.key)}"${sel}>${escHtml(col.label || col.key)}</option>`;
  }
  select.value = current || '';
}

/** Build the checkbox list inside the notif columns picker menu. */
function buildColumnsMenu() {
  const list = document.getElementById('notifColumnsList');
  if (!list || allColumns.length === 0) return;
  const visible = getVisibleCols();
  const visibleSet = new Set(visible);

  list.innerHTML = allColumns.map(col => {
    const checked = visibleSet.has(col.key) ? ' checked' : '';
    return `<label class="notif-columns-item">
      <input type="checkbox" value="${escAttr(col.key)}"${checked}>
      <span>${escHtml(col.label || col.key)}</span>
    </label>`;
  }).join('');
}

function updateDirIcon(btn) {
  if (!btn) return;
  if (sortOrder === 'asc') {
    btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 19V5"/><polyline points="5 12 12 5 19 12"/></svg>';
    btn.title = 'Ascending (click for descending)';
  } else {
    btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14"/><polyline points="19 12 12 19 5 12"/></svg>';
    btn.title = 'Descending (click for ascending)';
  }
}

async function fetchNotifications(filters) {
  try {
    const params = { ...filters };
    if (sortCol) params.sort = sortCol;
    params.order = sortOrder;
    params.limit = limit;
    const notifications = await apiFetch('/api/notifications', params);
    renderNotifications(notifications);
    updateLastUpdated();
  } catch (err) {
    console.error('Failed to fetch notifications:', err);
  }
}

function renderNotifications(items) {
  const list = document.getElementById('notificationList');
  if (!list) return;

  if (items.length === 0) {
    list.innerHTML = '<p class="text-xs text-slate-600 text-center py-8">No recent activity</p>';
    return;
  }

  const visibleCols = getVisibleCols();

  list.innerHTML = items.map(i => {
    // Build dynamic fields from visible columns
    const fields = visibleCols.map(key => {
      const val = i[key];
      if (val === null || val === undefined || val === '' || val === 'None') return null;
      let display = String(val);

      // Format priority as badge
      if (key.toLowerCase() === 'priority') {
        return `<span class="badge ${priorityClass(val)}">${escHtml(val)}</span>`;
      }
      // Format status with dot
      if (key.toLowerCase() === 'status') {
        return `<span class="status-badge ${statusClass(val)}" style="font-size:0.65rem; padding:0 0.375rem;">
          <span class="dot"></span>${escHtml(val)}
        </span>`;
      }
      // Format dates as relative
      if (i[key] && typeof i[key] === 'string' && /^\d{4}-\d{2}-\d{2}/.test(i[key])) {
        return `<span>${relativeTime(i[key])}</span>`;
      }
      // Truncate long text
      if (display.length > 60) display = display.slice(0, 57) + '…';
      return `<span>${escHtml(display)}</span>`;
    }).filter(Boolean);

    // Key fields: ID and Description/Title
    const idVal = i._id || i["Number"] || i["ID"] || '—';
    const descVal = i._description || '';

    return `
    <div class="notification-item">
      <div class="flex items-center justify-between">
        <span class="ticket-id">${escHtml(idVal)}</span>
        <span class="badge ${priorityClass(i["Priority"])}">${escHtml(i["Priority"] || '—')}</span>
      </div>
      <div class="desc">${escHtml(descVal)}</div>
      <div class="meta">
        <span class="status-badge ${statusClass(i["Status"])}" style="font-size:0.65rem; padding:0 0.375rem;">
          <span class="dot"></span>${escHtml(i["Status"] || '—')}
        </span>
        <span>${relativeTime(i._date || i["Creation Date"] || i["Created Date"] || i["Submitted Date"])}</span>
      </div>
      ${fields.length > 0 ? `<div class="notif-extra-fields">${fields.map(f => `<div class="notif-field">${f}</div>`).join('')}</div>` : ''}
    </div>`;
  }).join('');
}

function updateLastUpdated() {
  const el = document.getElementById('lastUpdated');
  if (el) {
    el.textContent = `Updated ${new Date().toLocaleTimeString()}`;
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
