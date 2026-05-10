/**
 * table.js — Incident table with sorting, search, and overdue highlighting.
 * Column visibility + ordering driven by columns.js (metadata from API).
 * Rendering is type-based — no hardcoded column names.
 */
import { bus, apiFetch, relativeTime, statusClass, priorityClass, getDataset } from './app.js';
import { getVisibleColumns } from './columns.js';

let incidents = [];
let sortField = null;
let sortDir = 'desc';
let visibleColumns = [];

function sortKey() { return `dashboard-sort-${getDataset()}`; }
function searchKey() { return `dashboard-search-${getDataset()}`; }

function saveSort() {
  if (sortField) {
    try { localStorage.setItem(sortKey(), JSON.stringify({ field: sortField, dir: sortDir })); } catch (e) { /* ignore */ }
  }
}

function loadSort() {
  try {
    const raw = localStorage.getItem(sortKey());
    if (raw) {
      const s = JSON.parse(raw);
      sortField = s.field || null;
      sortDir = s.dir || 'desc';
      return;
    }
  } catch (e) { /* ignore */ }
  sortField = null;
  sortDir = 'desc';
}

function saveSearch(query) {
  try { localStorage.setItem(searchKey(), query); } catch (e) { /* ignore */ }
}

function loadSearch() {
  try { return localStorage.getItem(searchKey()) || ''; } catch (e) { return ''; }
}

/* ── Cell renderers by type ──────────────────────────────────────── */
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

function renderCell(value, col) {
  const type = col.type;
  const raw = value != null ? String(value) : '\u2014';

  switch (type) {
    case 'status':
      return `<span class="status-badge ${statusClass(raw)}"><span class="dot"></span>${escapeHtml(raw)}</span>`;
    case 'priority':
      return `<span class="badge ${priorityClass(raw)}">${escapeHtml(raw)}</span>`;
    case 'date':
      return `<span class="text-slate-500 text-xs">${value ? relativeTime(raw) : '\u2014'}</span>`;
    case 'id':
      return `<span class="font-mono text-xs text-indigo-400 font-semibold">${escapeHtml(raw)}</span>`;
    default: {
      // Truncate long text
      const escaped = escapeHtml(raw);
      if (raw.length > 60) {
        return `<span class="max-w-[200px] truncate block" title="${escaped}">${escaped}</span>`;
      }
      return escaped;
    }
  }
}

/* ── Render helpers ───────────────────────────────────────────────── */
function renderHead() {
  const thead = document.getElementById('incidentTableHead');
  if (!thead) return;

  thead.innerHTML = `
    <tr class="bg-slate-800/50 text-slate-400 text-xs uppercase tracking-wider">
      ${visibleColumns.map(col => {
        const sortClass = col.sortable ? 'sortable' : '';
        return `<th class="text-left py-3 px-4 font-medium ${sortClass}" data-sort="${col.key}">${col.label}</th>`;
      }).join('')}
    </tr>`;

  // Re-attach sort listeners
  thead.querySelectorAll('th.sortable').forEach(th => {
    th.addEventListener('click', () => {
      const field = th.dataset.sort;
      if (sortField === field) {
        sortDir = sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        sortField = field;
        sortDir = 'asc';
      }
      updateSortHeaders();
      saveSort();
      const q = document.getElementById('tableSearch')?.value.toLowerCase() || '';
      sortAndRender(q);
    });
  });
}

function renderBody(filtered) {
  const tbody = document.getElementById('incidentTableBody');
  if (!tbody) return;

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="${visibleColumns.length}" class="py-8 text-center text-slate-600">No incidents match the current filters</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(row => {
    const overdueClass = row.is_overdue ? 'overdue' : '';
    const cells = visibleColumns.map(col => {
      return `<td>${renderCell(row[col.key], col)}</td>`;
    }).join('');
    return `<tr class="${overdueClass}">${cells}</tr>`;
  }).join('');
}

function updateSortHeaders() {
  document.querySelectorAll('#incidentTableHead th.sortable').forEach(th => {
    th.classList.remove('sorted-asc', 'sorted-desc');
    if (th.dataset.sort === sortField) {
      th.classList.add(sortDir === 'asc' ? 'sorted-asc' : 'sorted-desc');
    }
  });
}

function sortAndRender(searchQuery = '') {
  let filtered = [...incidents];

  // Search across all visible column values
  if (searchQuery) {
    filtered = filtered.filter(row => {
      return visibleColumns.some(col => {
        const v = row[col.key];
        return v != null && String(v).toLowerCase().includes(searchQuery);
      });
    });
  }

  // Sort
  if (sortField) {
    const sortCol = visibleColumns.find(c => c.key === sortField);
    const isDate = sortCol && sortCol.type === 'date';
    filtered.sort((a, b) => {
      let aVal = a[sortField] ?? '';
      let bVal = b[sortField] ?? '';
      if (isDate) {
        aVal = aVal || '';
        bVal = bVal || '';
      }
      const cmp = String(aVal).localeCompare(String(bVal), undefined, { numeric: true });
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }

  const countEl = document.getElementById('tableCount');
  if (countEl) {
    const label = getDataset() || 'items';
    countEl.textContent = `Showing ${filtered.length} of ${incidents.length} ${label}`;
  }

  renderBody(filtered);
  updateSortHeaders();
}

/* ── Init ─────────────────────────────────────────────────────────── */
export function initTable() {
  bus.on('filters-changed', async (filters) => {
    incidents = await apiFetch('/api/incidents', filters);
    sortAndRender();
  });

  bus.on('columns-changed', (cols) => {
    visibleColumns = cols;
    // Validate sortField against new columns, fall back to first sortable
    const inColumns = visibleColumns.find(c => c.key === sortField);
    if (!sortField || !inColumns) {
      const firstSortable = visibleColumns.find(c => c.sortable);
      if (firstSortable) sortField = firstSortable.key;
    }
    renderHead();
    updateSortHeaders();
    // Re-apply search from input
    const searchEl = document.getElementById('tableSearch');
    const q = searchEl ? searchEl.value.toLowerCase() : '';
    sortAndRender(q);
  });

  // Dataset switch: clear stale data, restore saved sort/search, show skeletons
  bus.on('dataset-changed', () => {
    incidents = [];
    loadSort();
    const savedSearch = loadSearch();
    const searchEl = document.getElementById('tableSearch');
    if (searchEl) searchEl.value = savedSearch;
    const countEl = document.getElementById('tableCount');
    if (countEl) countEl.textContent = 'Loading…';
    const titleEl = document.getElementById('tableSectionTitle');
    if (titleEl) titleEl.textContent = getDataset();
    const tbody = document.getElementById('incidentTableBody');
    if (tbody) {
      const cols = visibleColumns.length || 5;
      tbody.innerHTML = Array(5).fill(`<tr>${Array(cols).fill('<td><div class="skeleton h-4 w-full"></div></td>').join('')}</tr>`).join('');
    }
  });

  // Search input
  const searchEl = document.getElementById('tableSearch');
  if (searchEl) {
    // Restore saved search on initial load
    searchEl.value = loadSearch();
    searchEl.addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase();
      saveSearch(q);
      sortAndRender(q);
    });
  }

  // Restore saved sort on initial load
  loadSort();
}
