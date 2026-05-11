/**
 * notifications.js — Right sidebar showing recent activity.
 *
 * Displays exactly 5 fields per item: ticket-id, priority, description,
 * status, and age.  Each field is configurable — the user can map it to
 * any CSV column (or keep the "Auto" default which uses server-provided
 * computed keys like _id, _description, _date).
 *
 * Sort column, direction, limit, and field mappings are persisted per
 * dataset in localStorage.
 */
import { bus, apiFetch, relativeTime, statusClass, priorityClass, getDataset } from './app.js';

let pollInterval;
let sortCol = '';       // empty = auto-detect date
let sortOrder = 'desc';
let limit = 10;
let allColumns = [];    // all column metadata from API

/* ------------------------------------------------------------------ */
/*  Field-mapping storage (per dataset)                               */
/* ------------------------------------------------------------------ */

const FIELD_KEYS = ['ticketId', 'priority', 'description', 'status', 'age'];
const FIELD_LABELS = { ticketId: 'Ticket ID', priority: 'Priority', description: 'Description', status: 'Status', age: 'Age' };
const STORAGE_KEY_PREFIX = 'dashboard-notif-fields-';

function storageKey() { return STORAGE_KEY_PREFIX + getDataset(); }

/** Default mapping: all "auto" (use server _id/_description/_date or column heuristics). */
function defaultMapping() {
  return { ticketId: 'auto', priority: 'auto', description: 'auto', status: 'auto', age: 'auto' };
}

function loadFieldMapping() {
  try {
    const raw = localStorage.getItem(storageKey());
    if (raw) {
      const saved = JSON.parse(raw);
      // Validate keys
      const valid = {};
      for (const k of FIELD_KEYS) valid[k] = FIELD_KEYS.includes(k) ? (saved[k] || 'auto') : 'auto';
      return valid;
    }
  } catch (e) { /* ignore */ }
  return null;
}

function saveFieldMapping(mapping) {
  try { localStorage.setItem(storageKey(), JSON.stringify(mapping)); } catch (e) { /* ignore */ }
}

/** Return current field mapping (loaded or defaults). */
function getFieldMapping() {
  const saved = loadFieldMapping();
  if (saved) return saved;
  return defaultMapping();
}

/* ------------------------------------------------------------------ */
/*  Resolve a field value for one notification item                    */
/* ------------------------------------------------------------------ */

/**
 * Given an item (from /api/notifications) and a field mapping entry
 * (either "auto" or a column key), return { raw, display }.
 *
 * raw   — the underlying value (string or null)
 * display — formatted HTML-safe string
 */
function resolveField(item, mappingVal) {
  let val = null;

  if (mappingVal === 'auto') {
    // Use server-computed keys or column-name heuristics
    val = item._id || item._description || item._date || null;
  } else if (mappingVal && item[mappingVal] !== undefined) {
    val = item[mappingVal];
  }

  if (val === null || val === undefined || val === '' || val === 'None') return { raw: null, display: '' };

  return { raw: String(val), display: escHtml(String(val)) };
}

/**
 * Fully resolve all 5 fields for an item.
 * Uses per-field mapping so each slot can target a different column.
 */
function resolveAllFields(item, mapping) {
  // ticket-id
  let tidRaw = null, tidDisplay = '';
  if (mapping.ticketId === 'auto') {
    tidRaw = item._id || '';
    tidDisplay = escHtml(tidRaw || '—');
  } else if (mapping.ticketId && item[mapping.ticketId] !== undefined) {
    const v = item[mapping.ticketId];
    tidRaw = v !== null && v !== undefined ? String(v) : '';
    tidDisplay = escHtml(tidRaw || '—');
  } else {
    tidDisplay = '—';
  }

  // priority
  const priMapping = mapping.priority === 'auto' ? findAutoColumn(item, ['priority', 'severity', 'urgency']) : mapping.priority;
  let priRaw = null, priDisplay = '';
  if (priMapping && item[priMapping] !== undefined) {
    priRaw = item[priMapping];
    if (priRaw !== null && priRaw !== undefined && String(priRaw) !== '') {
      priDisplay = `<span class="badge ${priorityClass(priRaw)}">${escHtml(String(priRaw))}</span>`;
    }
  }

  // description
  let descRaw = null, descDisplay = '';
  if (mapping.description === 'auto') {
    descRaw = item._description || '';
    descDisplay = escHtml(descRaw);
  } else if (mapping.description && item[mapping.description] !== undefined) {
    const v = item[mapping.description];
    descRaw = v !== null && v !== undefined ? String(v) : '';
    descDisplay = escHtml(descRaw);
  }

  // status
  const stMapping = mapping.status === 'auto' ? findAutoColumn(item, ['status', 'state', 'phase']) : mapping.status;
  let stRaw = null, stDisplay = '';
  if (stMapping && item[stMapping] !== undefined) {
    stRaw = item[stMapping];
    if (stRaw !== null && stRaw !== undefined && String(stRaw) !== '') {
      stDisplay = `<span class="status-badge ${statusClass(stRaw)}" style="font-size:0.65rem;padding:0 0.375rem;"><span class="dot"></span>${escHtml(String(stRaw))}</span>`;
    }
  }

  // age
  let ageDisplay = '';
  if (mapping.age === 'auto') {
    ageDisplay = item._date ? relativeTime(item._date) : '';
  } else if (mapping.age && item[mapping.age] !== undefined) {
    const v = item[mapping.age];
    if (v && typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) {
      ageDisplay = relativeTime(v);
    } else if (v) {
      ageDisplay = escHtml(String(v));
    }
  }

  return {
    ticketId: { raw: tidRaw, display: tidDisplay },
    priority: { raw: priRaw, display: priDisplay },
    description: { raw: descRaw, display: descDisplay },
    status: { raw: stRaw, display: stDisplay },
    age: { raw: null, display: ageDisplay }
  };
}

/** Find first column key in item whose name contains any of the given keywords. */
function findAutoColumn(item, keywords) {
  for (const key of Object.keys(item)) {
    if (key.startsWith('_')) continue;
    const kl = key.toLowerCase();
    if (keywords.some(kw => kl.includes(kw))) return key;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/*  Initialisation                                                     */
/* ------------------------------------------------------------------ */

export function initNotifications() {
  const sortSelect = document.getElementById('notifSortCol');
  const dirBtn = document.getElementById('notifSortDir');
  const limitSelect = document.getElementById('notifLimit');

  // Build sort column dropdown when columns are loaded
  bus.on('columns-changed', () => {
    if (allColumns.length === 0) {
      apiFetch('/api/columns').then(data => {
        allColumns = data.columns || [];
        populateSortDropdown(sortSelect);
        buildFieldsMenu();
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
  limitSelect?.addEventListener('change', () => {
    limit = parseInt(limitSelect.value) || 10;
    fetchNotifications({});
  });

  // Fields mapping picker toggle (menu at body level, positioned via fixed coords)
  const fieldsBtn = document.getElementById('notifFieldsBtn');
  const fieldsMenu = document.getElementById('notifFieldsMenu');

  fieldsBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = fieldsMenu.classList.toggle('open');
    if (open) {
      const rect = fieldsBtn.getBoundingClientRect();
      fieldsMenu.style.top = (rect.bottom + 6) + 'px';
      // Align right edge of menu with right edge of button
      fieldsMenu.style.left = (rect.right - fieldsMenu.offsetWidth) + 'px';
    }
  });

  document.addEventListener('click', (e) => {
    if (fieldsMenu && !fieldsMenu.contains(e.target) && e.target !== fieldsBtn) {
      fieldsMenu.classList.remove('open');
    }
  });

  // Delegate changes on field-mapping selects
  const fieldsList = document.getElementById('notifFieldsList');
  fieldsList?.addEventListener('change', (e) => {
    if (!e.target.classList.contains('notif-fields-select')) return;
    const fieldKey = e.target.dataset.field;
    if (!fieldKey) return;
    const mapping = getFieldMapping();
    mapping[fieldKey] = e.target.value;
    saveFieldMapping(mapping);
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
    apiFetch('/api/columns').then(data => {
      allColumns = data.columns || [];
      populateSortDropdown(sortSelect);
      buildFieldsMenu();
      fetchNotifications({});
    }).catch(() => {});
  });

  // Poll every 60 seconds
  pollInterval = setInterval(() => {
    fetchNotifications({});
  }, 60000);
}

/* ------------------------------------------------------------------ */
/*  Sort dropdown                                                      */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/*  Fields mapping menu                                                */
/* ------------------------------------------------------------------ */

function buildFieldsMenu() {
  const list = document.getElementById('notifFieldsList');
  if (!list || allColumns.length === 0) return;
  const mapping = getFieldMapping();

  list.innerHTML = FIELD_KEYS.map(fk => {
    const selVal = mapping[fk] || 'auto';
    let opts = '<option value="auto" selected>Auto</option>';
    for (const col of allColumns) {
      const sel = col.key === selVal ? ' selected' : '';
      opts += `<option value="${escAttr(col.key)}"${sel}>${escHtml(col.label || col.key)}</option>`;
    }
    return `<div class="notif-fields-row">
      <span class="notif-fields-label">${FIELD_LABELS[fk]}</span>
      <select class="notif-fields-select" data-field="${fk}">${opts}</select>
    </div>`;
  }).join('');
}

/* ------------------------------------------------------------------ */
/*  Direction icon                                                     */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/*  Data fetching & rendering                                          */
/* ------------------------------------------------------------------ */

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

  const mapping = getFieldMapping();

  list.innerHTML = items.map(item => {
    const f = resolveAllFields(item, mapping);

    return `
    <div class="notification-item">
      <div class="flex items-center justify-between">
        <span class="ticket-id">${f.ticketId.display || '—'}</span>
        ${f.priority.display || ''}
      </div>
      <div class="desc">${f.description.display || '—'}</div>
      <div class="meta">
        ${f.status.display || '<span></span>'}
        <span>${f.age.display || ''}</span>
      </div>
    </div>`;
  }).join('');
}

function updateLastUpdated() {
  const el = document.getElementById('lastUpdated');
  if (el) {
    el.textContent = `Updated ${new Date().toLocaleTimeString()}`;
  }
}

/* ------------------------------------------------------------------ */
/*  Escape helpers                                                     */
/* ------------------------------------------------------------------ */

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
