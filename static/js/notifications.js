/**
 * notifications.js — Right sidebar showing recent activity.
 * Supports user-configurable sort column, direction, and limit.
 */
import { bus, apiFetch, relativeTime, statusClass, priorityClass } from './app.js';

let pollInterval;
let sortCol = '';       // empty = auto-detect date
let sortOrder = 'desc';
let limit = 10;
let columns = [];       // populated for sort dropdown

export function initNotifications() {
  const sortSelect = document.getElementById('notifSortCol');
  const dirBtn = document.getElementById('notifSortDir');
  const limitSelect = document.getElementById('notifLimit');

  // Build sort column dropdown when columns are loaded
  bus.on('columns-changed', (visibleCols) => {
    columns = visibleCols || [];
    populateSortDropdown(sortSelect);
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

  bus.on('filters-changed', (filters) => {
    fetchNotifications(filters);
  });

  // Apply initial sort direction (happens after columns load)
  bus.on('dataset-changed', () => {
    sortCol = '';
    sortOrder = 'desc';
    limit = 10;
    if (sortSelect) sortSelect.value = '';
    if (limitSelect) limitSelect.value = '10';
    updateDirIcon(dirBtn);
  });

  // Poll every 60 seconds
  pollInterval = setInterval(() => {
    fetchNotifications({});
  }, 60000);
}

function populateSortDropdown(select) {
  if (!select) return;
  // Preserve current selection
  const current = select.value;
  select.innerHTML = '<option value="">Auto (date)</option>';
  for (const col of columns) {
    const sel = col.key === current ? ' selected' : '';
    select.innerHTML += `<option value="${escAttr(col.key)}"${sel}>${escHtml(col.label || col.key)}</option>`;
  }
  select.value = current || '';
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

  list.innerHTML = items.map(i => `
    <div class="notification-item">
      <div class="flex items-center justify-between">
        <span class="ticket-id">${i._id || i["Number"] || i["ID"] || '—'}</span>
        <span class="badge ${priorityClass(i["Priority"])}">${i["Priority"] || '—'}</span>
      </div>
      <div class="desc">${i._description || '—'}</div>
      <div class="meta">
        <span class="status-badge ${statusClass(i["Status"])}" style="font-size:0.65rem; padding:0 0.375rem;">
          <span class="dot"></span>${i["Status"] || '—'}
        </span>
        <span>${relativeTime(i._date || i["Creation Date"] || i["Created Date"] || i["Submitted Date"])}</span>
      </div>
    </div>
  `).join('');
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
