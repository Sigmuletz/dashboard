/**
 * views.js — Dashboard presets / saved views.
 * Captures full dashboard state (dataset, filters, columns, sort,
 * search, card layout) into named presets. Views persist server-side
 * in config/views.json.
 */
import { bus, apiFetch, getDataset, setDataset } from './app.js';

let views = [];

/* ── Capture current dashboard state ─────────────────────────────── */

async function captureState() {
  const dataset = getDataset();
  const state = { dataset };

  // Read localStorage for per-dataset settings
  const keys = [
    ['columns', `dashboard-columns-${dataset}`],
    ['filters', `dashboard-filters-${dataset}`],
    ['sort', `dashboard-sort-${dataset}`],
    ['search', `dashboard-search-${dataset}`],
    ['notifFields', `dashboard-notif-fields-${dataset}`],
  ];
  for (const [field, key] of keys) {
    const raw = localStorage.getItem(key);
    if (raw) state[field] = raw;
  }

  // Capture card layout from backend
  try {
    const cfg = await apiFetch('/api/charts-config');
    if (cfg && cfg.cards) state.cardConfig = cfg.cards;
  } catch (e) { /* ignore */ }

  return state;
}

/* ── Apply a saved view ──────────────────────────────────────────── */

async function applyView(view) {
  if (!view || !view.state) return;
  const s = view.state;

  // Write per-dataset localStorage keys
  if (s.columns) localStorage.setItem(`dashboard-columns-${s.dataset}`, s.columns);
  if (s.filters) localStorage.setItem(`dashboard-filters-${s.dataset}`, s.filters);
  if (s.sort) localStorage.setItem(`dashboard-sort-${s.dataset}`, s.sort);
  if (s.search) localStorage.setItem(`dashboard-search-${s.dataset}`, s.search);
  if (s.notifFields) localStorage.setItem(`dashboard-notif-fields-${s.dataset}`, s.notifFields);

  // Save card config to the view's own dataset (bypass apiFetch so we
  // control the dataset param directly, not the current one)
  if (s.cardConfig && s.cardConfig.length > 0) {
    try {
      await fetch(`/api/charts-config?dataset=${encodeURIComponent(s.dataset)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cards: s.cardConfig }),
      });
    } catch (e) { /* ignore */ }
  }

  // Set dataset (persists to localStorage internally)
  if (s.dataset) {
    localStorage.setItem('dashboard-dataset', s.dataset);
  }

  // Full reload for guaranteed correct state application
  location.reload();
}

/* ── API helpers ─────────────────────────────────────────────────── */

async function loadViews() {
  try {
    views = await apiFetch('/api/views');
  } catch (e) {
    console.error('[Views] Failed to load:', e);
    views = [];
  }
}

async function saveView(name) {
  const state = await captureState();
  try {
    await apiFetch('/api/views', {
      method: 'POST',
      body: JSON.stringify({ name, state }),
    });
    await loadViews();
    buildDropdown();
  } catch (e) {
    console.error('[Views] Failed to save:', e);
    alert('Failed to save view');
  }
}

async function deleteView(name) {
  if (!confirm(`Delete view "${name}"?`)) return;
  try {
    await apiFetch('/api/views/delete', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
    await loadViews();
    buildDropdown();
  } catch (e) {
    console.error('[Views] Failed to delete:', e);
  }
}

/* ── Dropdown UI ─────────────────────────────────────────────────── */

function buildDropdown() {
  const menu = document.getElementById('viewMenu');
  if (!menu) return;

  if (views.length === 0) {
    menu.innerHTML = '<div class="view-menu-empty">No saved views yet</div>';
  } else {
    menu.innerHTML = views.map(v => `
      <div class="view-menu-item" data-view="${escapeHtml(v.name)}" title="${escapeHtml(v.name)}">
        <span class="view-name">${escapeHtml(v.name)}</span>
        <span class="view-dataset-badge">${escapeHtml(v.state?.dataset || '—')}</span>
        <button class="view-delete-btn" data-action="delete" data-name="${escapeHtml(v.name)}" title="Delete view">&times;</button>
      </div>
    `).join('');
  }

  // Save button at bottom
  const saveBtn = menu.querySelector('.view-save-btn');
  if (!saveBtn) {
    const div = document.createElement('div');
    div.className = 'view-menu-footer';
    div.innerHTML = '<button class="view-save-btn">+ Save current view</button>';
    menu.appendChild(div);
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

/* ── Init ─────────────────────────────────────────────────────────── */

export async function initViews() {
  await loadViews();

  const container = document.getElementById('viewSelector');
  if (!container) return;

  const toggle = document.getElementById('viewToggle');
  const label = document.getElementById('viewLabel');
  const menu = document.getElementById('viewMenu');
  if (!toggle || !menu) return;

  buildDropdown();

  // Toggle dropdown
  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    container.classList.toggle('open');
  });

  // Close on outside click
  document.addEventListener('click', () => {
    container.classList.remove('open');
  });

  // Delegate clicks inside menu
  menu.addEventListener('click', async (e) => {
    e.stopPropagation();

    // Delete button
    const delBtn = e.target.closest('[data-action="delete"]');
    if (delBtn) {
      await deleteView(delBtn.dataset.name);
      return;
    }

    // Save button
    if (e.target.closest('.view-save-btn')) {
      container.classList.remove('open');
      const name = prompt('View name:');
      if (name && name.trim()) {
        await saveView(name.trim());
      }
      return;
    }

    // View item click → apply
    const item = e.target.closest('.view-menu-item');
    if (item) {
      const viewName = item.dataset.view;
      const view = views.find(v => v.name === viewName);
      if (view) {
        container.classList.remove('open');
        await applyView(view);
      }
    }
  });

  // Listen for dataset changes to update label (optional)
  bus.on('dataset-changed', () => {
    if (label) label.textContent = 'Views';
  });
}
