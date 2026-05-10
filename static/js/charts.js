/**
 * charts.js — Renders chart cards. Listens to EventBus for filter changes.
 * Uses global Chart object from Chart.js CDN.
 *
 * First render: builds DOM + creates Chart instances.
 * Subsequent renders: updates existing Chart.data + calls .update() (smooth).
 *
 * Card config supports optional `chartHeight` (number, px) to control canvas size.
 */
import { bus, apiFetch } from './app.js';

const ChartLib = window.Chart;
const chartInstances = {};   // cardId → Chart instance
let cardElements = {};       // cardId → DOM element
let cachedConfig = null;     // charts.json cards array, fetched once
let renderActive = false;
let pendingRender = null;
let abortController = null;  // cancel stale chart fetches on dataset switch

const PALETTE = [
  '#6366f1', '#8b5cf6', '#a78bfa', '#c4b5fd',
  '#10b981', '#34d399', '#6ee7b7',
  '#f59e0b', '#fbbf24', '#fcd34d',
  '#3b82f6', '#60a5fa', '#93c5fd',
  '#ef4444', '#f87171',
  '#64748b', '#94a3b8',
];

/** Build responsive options merged with card sizing */
function sizing(card) {
  if (card.chartHeight) {
    return { responsive: true, maintainAspectRatio: false };
  }
  return { responsive: true, maintainAspectRatio: true };
}

/**
 * Register bus listener. Called once from app.js bootstrap.
 */
export function initCharts() {
  if (!ChartLib) {
    console.error('[Charts] Chart.js not loaded — charts disabled');
    return;
  }
  ChartLib.defaults.color = '#94a3b8';
  ChartLib.defaults.borderColor = 'rgba(51, 65, 85, 0.3)';
  ChartLib.defaults.font.family = 'system-ui, -apple-system, sans-serif';

  bus.on('filters-changed', (filters) => {
    if (renderActive) {
      pendingRender = filters;
      return;
    }
    doRender(filters);
  });

  // Dataset switch: abort pending fetches, destroy old charts, show skeletons
  bus.on('dataset-changed', () => {
    // Abort any in-flight chart requests
    if (abortController) {
      abortController.abort();
      abortController = null;
    }
    // Destroy existing chart instances
    for (const id of Object.keys(chartInstances)) {
      try { chartInstances[id].destroy(); } catch (e) { /* ignore */ }
      delete chartInstances[id];
    }
    // Show skeleton placeholders
    const grid = document.getElementById('chartGrid');
    if (grid) {
      grid.innerHTML = Array(6).fill('<div class="chart-card skeleton" style="height:200px"></div>').join('');
    }
    cardElements = {};
    cachedConfig = null;
    renderActive = false;
    pendingRender = null;
    // Will be re-triggered by filters-changed from filters.js
  });

  // Sidebar toggle → resize all chart instances
  document.getElementById('sidebarToggle')?.addEventListener('click', () => {
    // Wait for CSS transition (280ms)
    setTimeout(() => {
      for (const id of Object.keys(chartInstances)) {
        try { chartInstances[id].resize(); } catch (e) { /* ignore */ }
      }
    }, 300);
  });
}

async function doRender(filters) {
  renderActive = true;
  const grid = document.getElementById('chartGrid');
  if (!grid) { renderActive = false; return; }

  // Create new abort controller for this render cycle
  abortController = new AbortController();
  const signal = abortController.signal;

  try {
    // Fetch config once, cache it
    if (!cachedConfig) {
      // Show skeleton on very first load
      grid.innerHTML = Array(6).fill('<div class="chart-card skeleton" style="height:200px"></div>').join('');
      const raw = await apiFetch('/api/charts-config');
      if (signal.aborted) return;
      cachedConfig = raw.cards || [];
      grid.innerHTML = '';
    }

    const isFirstRender = Object.keys(cardElements).length === 0;

    for (const card of cachedConfig) {
      try {
        const data = await apiFetch(`/api/chart-data/${card.id}`, filters);
        if (signal.aborted) return;

        if (isFirstRender) {
          // Build DOM + create chart
          const cardEl = createCardElement(card);
          grid.appendChild(cardEl);
          cardElements[card.id] = cardEl;

          switch (card.type) {
            case 'number':   renderNumberCard(cardEl, data); break;
            case 'gauge':    renderGaugeCard(cardEl, data, card); break;
            case 'bar':      renderBarChart(cardEl, data, card); break;
            case 'horizontalBar': renderHorizontalBarChart(cardEl, data, card); break;
            case 'stackedBar':   renderStackedBarChart(cardEl, data, card); break;
            case 'doughnut':     renderDoughnutChart(cardEl, data, card); break;
            case 'pie':          renderPieChart(cardEl, data, card); break;
            case 'polarArea':    renderPolarAreaChart(cardEl, data, card); break;
            case 'radar':        renderRadarChart(cardEl, data, card); break;
            case 'line':         renderLineChart(cardEl, data, card); break;
            case 'area':         renderAreaChart(cardEl, data, card); break;
            case 'scatter':      renderScatterChart(cardEl, data, card); break;
            case 'bubble':       renderBubbleChart(cardEl, data, card); break;
            default:             cardEl.querySelector('.chart-content').innerHTML = '<p class="text-slate-600 text-sm">Unknown chart type</p>';
          }
        } else {
          // Update existing chart in-place (smooth)
          updateCard(card, data);
        }
      } catch (err) {
        if (signal.aborted) return;
        console.error(`[Charts] Card ${card.id} failed:`, err);
        const el = cardElements[card.id];
        if (el) {
          el.querySelector('.chart-content').innerHTML = `
            <div class="text-center py-4">
              <p class="text-red-400 text-xs mb-2">Failed to load</p>
              <button class="chart-retry-btn" data-card="${card.id}">Retry</button>
            </div>`;
        }
      }
    }
    // Attach retry handlers (delegated)
    grid.querySelectorAll('.chart-retry-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        // Force re-render by clearing cached config and re-emitting
        cachedConfig = null;
        doRender(filters);
      });
    });
  } catch (err) {
    console.error('[Charts] Failed to load config:', err);
    const grid = document.getElementById('chartGrid');
    if (grid) grid.innerHTML = '<div class="chart-card span-2"><p class="text-red-400 text-sm">Failed to load charts</p></div>';
  }

  renderActive = false;

  // If a render was queued while we were busy, run it now
  if (pendingRender !== null) {
    const queued = pendingRender;
    pendingRender = null;
    doRender(queued);
  }
}

/* ── In-place update (called on subsequent filter changes) ────────── */

function updateCard(card, data) {
  const el = cardElements[card.id];
  if (!el) return;

  switch (card.type) {
    case 'number':
      if (data.numbers) {
        const items = data.numbers.map(n =>
          `<div class="number-item">
            <div class="number-value" style="color:${n.color || '#fff'}">${n.value}</div>
            <div class="number-label">${n.label}</div>
          </div>`
        ).join('');
        el.querySelector('.chart-content').innerHTML = `<div class="number-grid">${items}</div>`;
      } else {
        el.querySelector('.chart-content').innerHTML = `
          <div class="number-value" style="color:${data.color || '#fff'}">${data.value}</div>
          <div class="number-label">total</div>
        `;
      }
      break;

    case 'gauge': {
      const chart = chartInstances[card.id];
      const pct = Math.min(Math.max(data.percentage || 0, 0), 100);
      if (chart) {
        chart.data.datasets[0].data = [pct, 100 - pct];
        chart.data.datasets[0].backgroundColor = [data.color || '#ef4444', 'rgba(51,65,85,0.4)'];
        chart.update('none');  // 'none' = no animation (faster)
      }
      // Update text overlay
      const valEl = el.querySelector('.number-value');
      const lblEl = el.querySelector('.number-label');
      if (valEl) valEl.textContent = data.value;
      if (lblEl) lblEl.textContent = `of ${data.max} overdue`;
      break;
    }

    default: {
      // All Canvas-based charts
      const chart = chartInstances[card.id];
      if (!chart) return;

      if (chart.config.type === 'scatter' || chart.config.type === 'bubble') {
        // Multi-dataset charts: scatter, bubble, stackedBar
        if (data.datasets) {
          chart.data.datasets = data.datasets.map((ds, i) => ({
            ...chart.data.datasets[i] || {},
            label: ds.label,
            data: ds.data || [],
            backgroundColor: ds.backgroundColor || chart.data.datasets[i]?.backgroundColor,
            borderColor: ds.borderColor || chart.data.datasets[i]?.borderColor,
          }));
        }
      } else if (card.type === 'stackedBar') {
        // stackedBar also has datasets array
        if (data.datasets) {
          chart.data.labels = data.labels || [];
          chart.data.datasets = data.datasets.map((ds, i) => ({
            label: ds.label,
            data: ds.data,
            backgroundColor: ds.backgroundColor || PALETTE[i % PALETTE.length],
            borderRadius: i === (data.datasets || []).length - 1 ? 4 : 0,
            borderSkipped: false,
          }));
        }
      } else {
        // Single-dataset charts: bar, line, area, doughnut, pie, polarArea, radar, horizontalBar
        chart.data.labels = data.labels || [];
        if (chart.data.datasets && chart.data.datasets[0]) {
          chart.data.datasets[0].data = data.values || [];
          chart.data.datasets[0].backgroundColor =
            card.type === 'doughnut' || card.type === 'pie' || card.type === 'polarArea'
              ? PALETTE.slice(0, (data.labels || []).length)
              : chart.data.datasets[0].backgroundColor;
        }
      }

      chart.update('none');
      break;
    }
  }
}

/* ── DOM helpers ──────────────────────────────────────────────────── */

function createCardElement(card) {
  const div = document.createElement('div');
  div.className = 'chart-card';
  if (card.width && card.width > 1) div.classList.add(`span-${card.width}`);
  div.innerHTML = `<h3>${card.title}</h3><div class="chart-content"></div>`;
  return div;
}

function applyCanvasHeight(canvas, card) {
  if (card.chartHeight) {
    canvas.style.height = card.chartHeight + 'px';
    canvas.style.maxHeight = 'none';
  }
}

/* ═══════════════════════════════════════════════════════════════════
   RENDER FUNCTIONS (first render only)
   ═══════════════════════════════════════════════════════════════════ */

function renderNumberCard(el, data) {
  if (data.numbers) {
    const items = data.numbers.map(n =>
      `<div class="number-item">
        <div class="number-value" style="color:${n.color || '#fff'}">${n.value}</div>
        <div class="number-label">${n.label}</div>
      </div>`
    ).join('');
    el.querySelector('.chart-content').innerHTML = `<div class="number-grid">${items}</div>`;
  } else {
    el.querySelector('.chart-content').innerHTML = `
      <div class="number-value" style="color:${data.color || '#fff'}">${data.value}</div>
      <div class="number-label">total</div>
    `;
  }
}

function renderGaugeCard(el, data, card) {
  const pct = Math.min(Math.max(data.percentage || 0, 0), 100);
  const gaugeH = card.chartHeight || 140;
  el.querySelector('.chart-content').innerHTML = `
    <div style="position:relative; height:${gaugeH}px;">
      <canvas id="gauge-${card.id}" style="max-height:${gaugeH}px;"></canvas>
      <div style="position:absolute; bottom:4px; left:0; right:0; text-align:center;">
        <div class="number-value" style="font-size:1.5rem; color:${data.color || '#ef4444'}">${data.value}</div>
        <div class="number-label">of ${data.max} overdue</div>
      </div>
    </div>
  `;

  const canvas = document.getElementById(`gauge-${card.id}`);
  if (!canvas || !ChartLib) return;

  chartInstances[card.id] = new ChartLib(canvas.getContext('2d'), {
    type: 'doughnut',
    data: {
      datasets: [{
        data: [pct, 100 - pct],
        backgroundColor: [data.color || '#ef4444', 'rgba(51,65,85,0.4)'],
        borderWidth: 0,
        circumference: 270,
        rotation: 225,
      }],
    },
    options: {
      cutout: '75%',
      responsive: true,
      maintainAspectRatio: true,
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
    },
  });
}

function renderBarChart(el, data, card) {
  el.querySelector('.chart-content').innerHTML = `<canvas id="chart-${card.id}"></canvas>`;
  const canvas = document.getElementById(`chart-${card.id}`);
  if (!canvas || !ChartLib) return;
  applyCanvasHeight(canvas, card);

  chartInstances[card.id] = new ChartLib(canvas.getContext('2d'), {
    type: 'bar',
    data: {
      labels: data.labels || [],
      datasets: [{
        label: data.title,
        data: data.values || [],
        backgroundColor: data.color || '#6366f1',
        borderRadius: 4,
        borderSkipped: false,
      }],
    },
    options: {
      ...sizing(card),
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display: false }, ticks: { color: '#64748b' } },
        y: { grid: { color: 'rgba(51,65,85,0.2)' }, ticks: { color: '#64748b', stepSize: 1 } },
      },
    },
  });
}

function renderDoughnutChart(el, data, card) {
  el.querySelector('.chart-content').innerHTML = `<canvas id="chart-${card.id}"></canvas>`;
  const canvas = document.getElementById(`chart-${card.id}`);
  if (!canvas || !ChartLib) return;
  applyCanvasHeight(canvas, card);

  chartInstances[card.id] = new ChartLib(canvas.getContext('2d'), {
    type: 'doughnut',
    data: {
      labels: data.labels || [],
      datasets: [{
        data: data.values || [],
        backgroundColor: PALETTE.slice(0, (data.labels || []).length),
        borderWidth: 2,
        borderColor: '#1a2236',
      }],
    },
    options: {
      ...sizing(card),
      cutout: '55%',
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            color: '#94a3b8',
            padding: 12,
            font: { size: 11 },
            usePointStyle: true,
            pointStyleWidth: 8,
          },
        },
      },
    },
  });
}

function renderLineChart(el, data, card) {
  el.querySelector('.chart-content').innerHTML = `<canvas id="chart-${card.id}"></canvas>`;
  const canvas = document.getElementById(`chart-${card.id}`);
  if (!canvas || !ChartLib) return;
  applyCanvasHeight(canvas, card);

  chartInstances[card.id] = new ChartLib(canvas.getContext('2d'), {
    type: 'line',
    data: {
      labels: data.labels || [],
      datasets: [{
        label: 'Created',
        data: data.values || [],
        borderColor: data.color || '#10b981',
        backgroundColor: (data.color || '#10b981') + '20',
        fill: true,
        tension: 0.3,
        pointRadius: 3,
        pointBackgroundColor: data.color || '#10b981',
        borderWidth: 2,
      }],
    },
    options: {
      ...sizing(card),
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display: false }, ticks: { color: '#64748b', maxTicksLimit: 8, maxRotation: 45 } },
        y: { grid: { color: 'rgba(51,65,85,0.2)' }, ticks: { color: '#64748b', stepSize: 1 } },
      },
    },
  });
}

function renderAreaChart(el, data, card) {
  el.querySelector('.chart-content').innerHTML = `<canvas id="chart-${card.id}"></canvas>`;
  const canvas = document.getElementById(`chart-${card.id}`);
  if (!canvas || !ChartLib) return;
  applyCanvasHeight(canvas, card);

  const color = data.color || '#10b981';
  const ctx = canvas.getContext('2d');
  const gradientH = card.chartHeight || 200;
  const gradient = ctx.createLinearGradient(0, 0, 0, gradientH);
  gradient.addColorStop(0, color + '50');
  gradient.addColorStop(1, color + '05');

  chartInstances[card.id] = new ChartLib(ctx, {
    type: 'line',
    data: {
      labels: data.labels || [],
      datasets: [{
        label: data.title || 'Count',
        data: data.values || [],
        borderColor: color,
        backgroundColor: gradient,
        fill: true,
        tension: 0.4,
        pointRadius: 3,
        pointBackgroundColor: color,
        pointBorderColor: '#fff',
        pointBorderWidth: 1,
        borderWidth: 2,
      }],
    },
    options: {
      ...sizing(card),
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display: false }, ticks: { color: '#64748b', maxTicksLimit: 8, maxRotation: 45 } },
        y: { grid: { color: 'rgba(51,65,85,0.2)' }, ticks: { color: '#64748b', stepSize: 1 } },
      },
    },
  });
}

function renderPieChart(el, data, card) {
  el.querySelector('.chart-content').innerHTML = `<canvas id="chart-${card.id}"></canvas>`;
  const canvas = document.getElementById(`chart-${card.id}`);
  if (!canvas || !ChartLib) return;
  applyCanvasHeight(canvas, card);

  chartInstances[card.id] = new ChartLib(canvas.getContext('2d'), {
    type: 'pie',
    data: {
      labels: data.labels || [],
      datasets: [{
        data: data.values || [],
        backgroundColor: PALETTE.slice(0, (data.labels || []).length),
        borderWidth: 2,
        borderColor: '#1a2236',
      }],
    },
    options: {
      ...sizing(card),
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            color: '#94a3b8',
            padding: 12,
            font: { size: 11 },
            usePointStyle: true,
            pointStyleWidth: 8,
          },
        },
      },
    },
  });
}

function renderPolarAreaChart(el, data, card) {
  el.querySelector('.chart-content').innerHTML = `<canvas id="chart-${card.id}"></canvas>`;
  const canvas = document.getElementById(`chart-${card.id}`);
  if (!canvas || !ChartLib) return;
  applyCanvasHeight(canvas, card);

  chartInstances[card.id] = new ChartLib(canvas.getContext('2d'), {
    type: 'polarArea',
    data: {
      labels: data.labels || [],
      datasets: [{
        data: data.values || [],
        backgroundColor: PALETTE.slice(0, (data.labels || []).length).map(c => c + '80'),
        borderColor: PALETTE.slice(0, (data.labels || []).length),
        borderWidth: 2,
      }],
    },
    options: {
      ...sizing(card),
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            color: '#94a3b8',
            padding: 12,
            font: { size: 11 },
            usePointStyle: true,
            pointStyleWidth: 8,
          },
        },
      },
      scales: {
        r: {
          grid: { color: 'rgba(51,65,85,0.3)' },
          ticks: { color: '#64748b', backdropColor: 'transparent', stepSize: 1 },
        },
      },
    },
  });
}

function renderRadarChart(el, data, card) {
  el.querySelector('.chart-content').innerHTML = `<canvas id="chart-${card.id}"></canvas>`;
  const canvas = document.getElementById(`chart-${card.id}`);
  if (!canvas || !ChartLib) return;
  applyCanvasHeight(canvas, card);

  chartInstances[card.id] = new ChartLib(canvas.getContext('2d'), {
    type: 'radar',
    data: {
      labels: data.labels || [],
      datasets: [{
        label: data.title || 'Incidents',
        data: data.values || [],
        backgroundColor: (data.color || '#6366f1') + '30',
        borderColor: data.color || '#6366f1',
        borderWidth: 2,
        pointBackgroundColor: data.color || '#6366f1',
        pointRadius: 4,
        pointHoverRadius: 6,
      }],
    },
    options: {
      ...sizing(card),
      plugins: { legend: { display: false } },
      scales: {
        r: {
          grid: { color: 'rgba(51,65,85,0.3)' },
          angleLines: { color: 'rgba(51,65,85,0.3)' },
          pointLabels: { color: '#94a3b8', font: { size: 11 } },
          ticks: { color: '#64748b', backdropColor: 'transparent', stepSize: 1 },
        },
      },
    },
  });
}

function renderHorizontalBarChart(el, data, card) {
  el.querySelector('.chart-content').innerHTML = `<canvas id="chart-${card.id}"></canvas>`;
  const canvas = document.getElementById(`chart-${card.id}`);
  if (!canvas || !ChartLib) return;
  applyCanvasHeight(canvas, card);

  chartInstances[card.id] = new ChartLib(canvas.getContext('2d'), {
    type: 'bar',
    data: {
      labels: data.labels || [],
      datasets: [{
        label: data.title,
        data: data.values || [],
        backgroundColor: data.color || '#6366f1',
        borderRadius: 4,
        borderSkipped: false,
      }],
    },
    options: {
      ...sizing(card),
      indexAxis: 'y',
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { color: 'rgba(51,65,85,0.2)' }, ticks: { color: '#64748b', stepSize: 1 } },
        y: { grid: { display: false }, ticks: { color: '#94a3b8' } },
      },
    },
  });
}

function renderStackedBarChart(el, data, card) {
  el.querySelector('.chart-content').innerHTML = `<canvas id="chart-${card.id}"></canvas>`;
  const canvas = document.getElementById(`chart-${card.id}`);
  if (!canvas || !ChartLib) return;
  applyCanvasHeight(canvas, card);

  chartInstances[card.id] = new ChartLib(canvas.getContext('2d'), {
    type: 'bar',
    data: {
      labels: data.labels || [],
      datasets: (data.datasets || []).map((ds, i) => ({
        label: ds.label,
        data: ds.data,
        backgroundColor: ds.backgroundColor || PALETTE[i % PALETTE.length],
        borderRadius: i === (data.datasets || []).length - 1 ? 4 : 0,
        borderSkipped: false,
      })),
    },
    options: {
      ...sizing(card),
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            color: '#94a3b8',
            padding: 12,
            font: { size: 10 },
            usePointStyle: true,
            pointStyleWidth: 8,
          },
        },
      },
      scales: {
        x: { stacked: true, grid: { display: false }, ticks: { color: '#64748b' } },
        y: { stacked: true, grid: { color: 'rgba(51,65,85,0.2)' }, ticks: { color: '#64748b', stepSize: 1 } },
      },
    },
  });
}

function renderScatterChart(el, data, card) {
  el.querySelector('.chart-content').innerHTML = `<canvas id="chart-${card.id}"></canvas>`;
  const canvas = document.getElementById(`chart-${card.id}`);
  if (!canvas || !ChartLib) return;
  applyCanvasHeight(canvas, card);

  chartInstances[card.id] = new ChartLib(canvas.getContext('2d'), {
    type: 'scatter',
    data: {
      datasets: (data.datasets || []).map((ds) => ({
        label: ds.label,
        data: ds.data || [],
        backgroundColor: ds.backgroundColor || '#6366f1',
        borderColor: ds.borderColor || ds.backgroundColor || '#6366f1',
        pointRadius: ds.pointRadius || 4,
        pointHoverRadius: ds.pointHoverRadius || 7,
        showLine: true,
        tension: 0.2,
      })),
    },
    options: {
      ...sizing(card),
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            color: '#94a3b8',
            padding: 12,
            font: { size: 10 },
            usePointStyle: true,
            pointStyleWidth: 8,
          },
        },
      },
      scales: {
        x: {
          type: 'time',
          time: { unit: 'day', displayFormats: { day: 'MMM d' } },
          grid: { display: false },
          ticks: { color: '#64748b', maxTicksLimit: 8 },
        },
        y: {
          grid: { color: 'rgba(51,65,85,0.2)' },
          ticks: { color: '#64748b', stepSize: 1 },
        },
      },
    },
  });
}

function renderBubbleChart(el, data, card) {
  el.querySelector('.chart-content').innerHTML = `<canvas id="chart-${card.id}"></canvas>`;
  const canvas = document.getElementById(`chart-${card.id}`);
  if (!canvas || !ChartLib) return;
  applyCanvasHeight(canvas, card);

  chartInstances[card.id] = new ChartLib(canvas.getContext('2d'), {
    type: 'bubble',
    data: {
      datasets: (data.datasets || []).map((ds) => ({
        label: ds.label,
        data: ds.data || [],
        backgroundColor: ds.backgroundColor || '#6366f1',
        borderColor: ds.borderColor || ds.backgroundColor || '#6366f1',
        borderWidth: 1,
        hoverBorderWidth: 2,
      })),
    },
    options: {
      ...sizing(card),
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            color: '#94a3b8',
            padding: 12,
            font: { size: 10 },
            usePointStyle: true,
            pointStyleWidth: 8,
          },
        },
      },
      scales: {
        x: {
          type: 'time',
          time: { unit: 'day', displayFormats: { day: 'MMM d' } },
          grid: { display: false },
          ticks: { color: '#64748b', maxTicksLimit: 8 },
        },
        y: {
          title: { display: true, text: 'Avg Priority (1=Low, 4=Critical)', color: '#64748b', font: { size: 10 } },
          grid: { color: 'rgba(51,65,85,0.2)' },
          ticks: { color: '#64748b', stepSize: 1 },
          min: 0.5,
          max: 4.5,
        },
      },
    },
  });
}
