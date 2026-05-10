/**
 * filters.js — Multi-select dropdowns discovered dynamically from API.
 * Emits 'filters-changed' bus event on Apply / Reset.
 * Persists filter state in URL query params.
 */
import { bus, apiFetch, getDataset } from './app.js';

let currentFilters = {};

function filtersKey() { return `dashboard-filters-${getDataset()}`; }

/* ── URL persistence ──────────────────────────────────────────────── */

function filtersToParams(filters) {
  const p = new URLSearchParams();
  for (const [key, values] of Object.entries(filters)) {
    if (values && values.length > 0) {
      p.set(key, values.join(','));
    }
  }
  return p;
}

function saveFiltersToUrl(filters) {
  const params = filtersToParams(filters);
  const qs = params.toString();
  const url = qs ? `${location.pathname}?${qs}` : location.pathname;
  history.replaceState(null, '', url);
}

function loadFiltersFromUrl() {
  const filters = {};
  for (const [key, val] of new URLSearchParams(location.search).entries()) {
    filters[key] = val.split(',').map(v => v.trim()).filter(Boolean);
  }
  return filters;
}

function clearUrlFilters() {
  history.replaceState(null, '', location.pathname);
}

/* ── Dropdown UI helpers ──────────────────────────────────────────── */

function setDropdownState(menu, trigger, values) {
  const checks = menu.querySelectorAll('input[type="checkbox"]');
  const selected = values || [];
  checks.forEach(cb => {
    cb.checked = selected.includes(cb.value);
  });
  trigger.querySelector('span').textContent = selected.length > 0 ? selected.join(', ') : 'All';
  if (selected.length === 0) trigger.classList.remove('active');
}

/* ── Build / Rebuild ──────────────────────────────────────────────── */

function emitActiveFilters() {
  const active = {};
  for (const [key, values] of Object.entries(currentFilters)) {
    if (values.length > 0) active[key] = values;
  }
  saveFiltersToUrl(active);
  // Persist per-dataset
  try { localStorage.setItem(filtersKey(), JSON.stringify(currentFilters)); } catch (e) { /* ignore */ }
  bus.emit('filters-changed', active);
}

async function buildFilters() {
  const container = document.getElementById('filterContainer');
  if (!container) { console.warn('[Filters] container not found'); return; }

  let filterOptions;
  try {
    filterOptions = await apiFetch('/api/filters');
  } catch (err) {
    console.error('[Filters] Failed to load filter options:', err);
    container.innerHTML = `
      <p class="text-red-400 text-xs mb-2">Failed to load filters</p>
      <button id="retryFilters" class="px-3 py-1 bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs rounded-lg transition-colors">Retry</button>
    `;
    document.getElementById('retryFilters')?.addEventListener('click', () => buildFilters());
    return;
  }

  // Use all keys from the API response as filter fields
  const fields = Object.keys(filterOptions).map(key => ({ key, label: key }));
  if (fields.length === 0) {
    container.innerHTML = '<p class="text-xs text-slate-600">No filterable fields</p>';
    return;
  }

  // Restore filters: localStorage first (per-dataset), then URL
  const savedFilters = (() => {
    try {
      const raw = localStorage.getItem(filtersKey());
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  })();
  const urlFilters = loadFiltersFromUrl();
  const restored = savedFilters || urlFilters;
  currentFilters = {};

  container.innerHTML = '';

  for (const field of fields) {
    const values = filterOptions[field.key] || [];
    if (values.length === 0) continue;

    currentFilters[field.key] = restored[field.key] || [];

    const group = document.createElement('div');
    group.className = 'filter-group';

    const label = document.createElement('label');
    label.textContent = field.label;
    group.appendChild(label);

    const dropdown = document.createElement('div');
    dropdown.className = 'filter-dropdown';

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'filter-dropdown-trigger';
    trigger.innerHTML = `<span>All</span><i data-feather="chevron-down" class="w-4 h-4 text-slate-500" style="width:16px;height:16px;"></i>`;

    const menu = document.createElement('div');
    menu.className = 'filter-dropdown-menu';

    trigger.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      container.querySelectorAll('.filter-dropdown-menu.open').forEach(m => {
        if (m !== menu) {
          m.classList.remove('open');
          m.parentElement?.querySelector('.filter-dropdown-trigger')?.classList.remove('active');
        }
      });
      menu.classList.toggle('open');
      trigger.classList.toggle('active');
    });

    for (const val of values) {
      const item = document.createElement('label');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.value = val;
      cb.addEventListener('change', () => {
        const checked = Array.from(menu.querySelectorAll('input:checked')).map(c => c.value);
        currentFilters[field.key] = checked;
        trigger.querySelector('span').textContent = checked.length > 0 ? checked.join(', ') : 'All';
        if (checked.length === 0) trigger.classList.remove('active');
      });
      item.appendChild(cb);
      item.appendChild(document.createTextNode(val));
      menu.appendChild(item);
    }

    setDropdownState(menu, trigger, currentFilters[field.key]);

    dropdown.appendChild(trigger);
    dropdown.appendChild(menu);
    group.appendChild(dropdown);
    container.appendChild(group);
  }

  // Emit initial filters
  console.log('[Filters] Emitting filters:', currentFilters);
  emitActiveFilters();
}

/* ── Init ─────────────────────────────────────────────────────────── */

export async function initFilters() {
  await buildFilters();

  // Global click handler to close dropdowns (one-time)
  const container = document.getElementById('filterContainer');
  if (container) {
    document.addEventListener('click', (e) => {
      if (!container.contains(e.target)) {
        container.querySelectorAll('.filter-dropdown-menu.open').forEach(menu => {
          menu.classList.remove('open');
          menu.parentElement?.querySelector('.filter-dropdown-trigger')?.classList.remove('active');
        });
      }
    });
  }

  // Apply / Reset buttons (one-time)
  document.getElementById('applyFilters')?.addEventListener('click', emitActiveFilters);

  document.getElementById('resetFilters')?.addEventListener('click', () => {
    for (const key of Object.keys(currentFilters)) {
      currentFilters[key] = [];
    }
    const container = document.getElementById('filterContainer');
    if (container) {
      container.querySelectorAll('.filter-dropdown-menu').forEach(menu => {
        menu.querySelectorAll('input').forEach(c => { c.checked = false; });
        menu.classList.remove('open');
      });
      container.querySelectorAll('.filter-dropdown-trigger').forEach(btn => {
        btn.querySelector('span').textContent = 'All';
        btn.classList.remove('active');
      });
    }
    emitActiveFilters();
  });

  // Sidebar toggle
  document.getElementById('sidebarToggle')?.addEventListener('click', () => {
    document.getElementById('filterSidebar')?.classList.toggle('sidebar-closed');
  });

  // Dataset switch: save current filters, then rebuild for new dataset
  bus.on('dataset-changed', async () => {
    // Save current filters before switching (they're already in localStorage via last emitActiveFilters)
    clearUrlFilters();
    await buildFilters();
  });
}
