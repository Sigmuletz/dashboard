/**
 * app.js — Entry point. Creates EventBus, bootstrap all modules in correct order.
 * Manages dataset switching (incidents / changes / requests).
 */
import { initFilters } from './filters.js';
import { initTable } from './table.js';
import { initColumns } from './columns.js';
import { initNotifications } from './notifications.js';
import { initCharts } from './charts.js';
import { initViews } from './views.js';
import { initChartEditor, initChartEditorButtons } from './chart-editor.js';

// ----- EventBus -----
class EventBus {
  constructor() {
    this._listeners = {};
  }
  on(event, callback) {
    if (!this._listeners[event]) this._listeners[event] = [];
    this._listeners[event].push(callback);
  }
  off(event, callback) {
    if (!this._listeners[event]) return;
    this._listeners[event] = this._listeners[event].filter(cb => cb !== callback);
  }
  emit(event, data) {
    (this._listeners[event] || []).forEach(cb => {
      try { cb(data); } catch (e) { console.error(`EventBus [${event}] error:`, e); }
    });
  }
}

export const bus = new EventBus();

// ----- Dataset state -----
const DATASET_KEY = 'dashboard-dataset';
let currentDataset = localStorage.getItem(DATASET_KEY) || 'incidents';
let datasets = [];  // populated from API, used by setDataset for title

export function getDataset() {
  return currentDataset;
}

export function setDataset(name) {
  if (name === currentDataset) return;
  currentDataset = name;
  localStorage.setItem(DATASET_KEY, name);
  // Update page title
  const ds = datasets.find(d => d.id === name);
  document.title = ds ? `${ds.title} Dashboard` : 'Dashboard';
  bus.emit('dataset-changed', name);
}

// ----- Utilities -----
export async function apiFetch(path, params = {}) {
  // Auto-append dataset to all API calls
  const isPost = params.method === 'POST';
  const body = params.body;
  delete params.method;
  delete params.body;
  params = { dataset: currentDataset, ...params };

  const qs = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .flatMap(([k, v]) => {
      if (Array.isArray(v)) return v.map(val => `${encodeURIComponent(k)}=${encodeURIComponent(val)}`);
      return [`${encodeURIComponent(k)}=${encodeURIComponent(v)}`];
    })
    .join('&');
  const url = qs ? `${path}?${qs}` : path;
  const options = {};
  if (isPost) {
    options.method = 'POST';
    options.headers = { 'Content-Type': 'application/json' };
    options.body = body;
  }
  const res = await fetch(url, options);
  if (!res.ok) throw new Error(`API ${path} returned ${res.status}`);
  return res.json();
}

export function relativeTime(dateStr) {
  if (!dateStr) return '';
  const now = new Date();
  const then = new Date(dateStr);
  const diffMs = now - then;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHrs = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHrs < 24) return `${diffHrs}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return then.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function statusClass(status) {
  const map = {
    'New': 'status-new',
    'In Progress': 'status-in-progress',
    'Waiting for Info': 'status-waiting',
    'Resolved': 'status-resolved',
    'Closed': 'status-closed',
    // Changes / Requests statuses
    'Normal': 'status-resolved',
    'Approved': 'status-new',
    'Pending Approval': 'status-waiting',
    'Rejected': 'status-closed',
    'Completed': 'status-resolved',
    'Open': 'status-new',
  };
  return map[status] || 'status-new';
}

export function priorityClass(priority) {
  const map = {
    'Critical': 'badge-critical',
    'High': 'badge-high',
    'Medium': 'badge-medium',
    'Low': 'badge-low',
  };
  return map[priority] || 'badge-medium';
}

// ----- Dataset switcher UI -----
async function initDatasetSwitcher() {
  const selector = document.getElementById('datasetSelector');
  if (!selector) return;

  const toggle = document.getElementById('datasetToggle');
  const label = document.getElementById('datasetLabel');
  const menu = selector.querySelector('.dataset-menu');
  if (!toggle || !label || !menu) return;

  // Fetch dataset list from API
  datasets = [];
  try {
    // Bypass apiFetch to avoid appending dataset param to /api/datasets
    const res = await fetch('/api/datasets');
    datasets = await res.json();
  } catch (err) {
    console.error('[Dataset] Failed to load datasets:', err);
    datasets = [{ id: 'incidents', title: 'Incidents' }];
  }

  // Build dropdown options dynamically
  menu.innerHTML = datasets.map(ds => `
    <button class="dataset-option ${ds.id === currentDataset ? 'active' : ''}" data-dataset="${ds.id}">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>
      ${ds.title}
    </button>
  `).join('');

  function updateUI(name) {
    const ds = datasets.find(d => d.id === name);
    if (label) label.textContent = ds ? ds.title : name;
    menu.querySelectorAll('.dataset-option').forEach(opt => {
      opt.classList.toggle('active', opt.dataset.dataset === name);
    });
  }

  updateUI(currentDataset);

  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    selector.classList.toggle('open');
  });

  menu.addEventListener('click', (e) => {
    const opt = e.target.closest('.dataset-option');
    if (!opt) return;
    e.stopPropagation();
    const name = opt.dataset.dataset;
    setDataset(name);
    updateUI(name);
    selector.classList.remove('open');
  });

  document.addEventListener('click', () => {
    selector.classList.remove('open');
  });
}

// ----- Bootstrap -----
document.addEventListener('DOMContentLoaded', async () => {
  console.log('[Dashboard] Initializing...');

  // Init dataset switcher UI
  await initDatasetSwitcher();

  // Init modules that set up DOM listeners and bus handlers
  initCharts();
  initTable();
  initNotifications();
  initViews();
  initChartEditor();
  initChartEditorButtons();

  await initColumns();
  await initFilters();

  // Render all Feather icons once after dynamic DOM is built
  if (window.feather) window.feather.replace();

  // Re-render icons after dataset switches (filters rebuild DOM)
  bus.on('dataset-changed', () => {
    // Wait for async rebuilds
    setTimeout(() => {
      if (window.feather) window.feather.replace();
    }, 100);
  });

  // Listen for browser back/forward
  window.addEventListener('popstate', () => {
    console.log('[Dashboard] popstate — reloading to apply URL filters');
    location.reload();
  });

  console.log('[Dashboard] Initialization complete');
});
