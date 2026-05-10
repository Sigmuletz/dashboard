/**
 * notifications.js — Right sidebar showing 10 most recently created incidents.
 */
import { bus, apiFetch, relativeTime, statusClass, priorityClass } from './app.js';

let pollInterval;

export function initNotifications() {
  bus.on('filters-changed', (filters) => {
    fetchNotifications(filters);
  });

  // Poll every 60 seconds (uses current filter state by re-emitting)
  pollInterval = setInterval(() => {
    // Just re-fetch with no filters for activity feed
    fetchNotifications({});
  }, 60000);
}

async function fetchNotifications(filters) {
  try {
    const notifications = await apiFetch('/api/notifications', filters);
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
