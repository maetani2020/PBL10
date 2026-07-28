// calendar-state.js
// Global state and shared utility functions

export let currentDate = new Date();
export let currentView = "month";
export let selectedEventId = null;
export let currentAttachments = [];
export const apiKey = ""; // Fill in your Gemini API key if required

export let currentFilter = "all";
export let eventsCache = [];

export const STORAGE_KEY = "shared_calendar_events";

export function normalizeEvent(event) {
  const start = event?.start || event?.start_time || "";
  const end = event?.end || event?.end_time || "";
  const allDay = event?.allDay ?? event?.allday ?? false;
  const reminderMinutes = Array.isArray(event?.reminderMinutes)
    ? event.reminderMinutes
    : Array.isArray(event?.reminder_minutes)
      ? event.reminder_minutes
      : [];

  return {
    ...event,
    start,
    end,
    date: event?.date || (start ? start.substring(0, 10) : ""),
    allDay: !!allDay,
    allday: !!allDay,
    group_id: event?.group_id ?? event?.calendar_group_id ?? null,
    color: event?.color || "#007AFF",
    visibility: event?.visibility || "public",
    hp_consumption: Number(event?.hp_consumption || 0),
    motivation_consumption: Number(event?.motivation_consumption || 0),
    eventType: event?.eventType || event?.event_type || "event",
    reminderMinutes
  };
}

// Setters for states
export function setCurrentDate(date) {
  currentDate = date;
}

export function setCurrentView(view) {
  currentView = view;
}

export function setSelectedEventId(id) {
  selectedEventId = id;
}

export function setCurrentAttachments(attachments) {
  currentAttachments = attachments;
}

export function setCurrentFilter(filter) {
  currentFilter = filter;
}

export function setEvents(events) {
  eventsCache = Array.isArray(events) ? events.map(normalizeEvent) : [];
}

export function getCurrentFilterVisibility() {
  if (currentFilter === "group" || currentFilter === "private") {
    return currentFilter;
  }
  return "public";
}

function isGroupEvent(event) {
  return event.visibility === "group" || !!event.group_id;
}

function isPrivateEvent(event) {
  return event.visibility === "private";
}

// Memory cache helpers
export function getEvents() {
  if (currentFilter === "group") {
    return eventsCache.filter(isGroupEvent);
  } else if (currentFilter === "private") {
    return eventsCache.filter(isPrivateEvent);
  }
  return eventsCache.filter(e => !isGroupEvent(e) && !isPrivateEvent(e));
}

export function getAllEvents() {
  return eventsCache;
}

export function saveEvents(events) {
  eventsCache = Array.isArray(events) ? events.map(normalizeEvent) : [];
}

// Utilities
export function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function isToday(year, month, day) {
  const now = new Date();
  return (
    year === now.getFullYear() &&
    month === now.getMonth() &&
    day === now.getDate()
  );
}

export function createId() {
  return Date.now() + Math.floor(Math.random() * 10000);
}

export function escapeHTML(str) {
  if (!str) return '';
  return str.replace(/[&<>'"]/g, 
    tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
  );
}

// Toast helper
let toastTimeout;
export function showToast(msg) {
  const toastBox = document.getElementById("toastBox");
  if (!toastBox) return;
  toastBox.innerText = msg;
  toastBox.classList.remove("hidden");
  toastBox.style.opacity = "1";

  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    toastBox.style.opacity = "0";
    setTimeout(() => {
      toastBox.classList.add("hidden");
    }, 300);
  }, 2500);
}

export function clearFieldErrors(root = document) {
  const scope = root || document;
  scope.querySelectorAll?.(".field-invalid").forEach(el => {
    el.classList.remove("field-invalid");
    el.removeAttribute("aria-invalid");
  });
  scope.querySelectorAll?.(".field-error-text").forEach(el => el.remove());
}

export function clearFieldError(field) {
  const el = typeof field === "string" ? document.getElementById(field) : field;
  if (!el) return;
  el.classList.remove("field-invalid");
  el.removeAttribute("aria-invalid");
  const next = el.nextElementSibling;
  if (next?.classList.contains("field-error-text")) next.remove();
}

export function showFieldError(field, message, options = {}) {
  const el = typeof field === "string" ? document.getElementById(field) : field;
  if (!el) {
    showToast(message);
    return false;
  }

  const next = el.nextElementSibling;
  if (next?.classList.contains("field-error-text")) next.remove();

  el.classList.add("field-invalid");
  el.setAttribute("aria-invalid", "true");

  const errorEl = document.createElement("div");
  errorEl.className = "field-error-text";
  errorEl.textContent = message;
  el.insertAdjacentElement("afterend", errorEl);

  if (options.focus !== false) {
    el.focus?.({ preventScroll: true });
    el.scrollIntoView?.({ block: "center", behavior: "smooth" });
  }

  showToast(message);
  return false;
}

export function showFormError(containerId, message, type = "danger") {
  const box = document.getElementById(containerId);
  if (!box) {
    showToast(message);
    return;
  }

  box.textContent = message;
  box.classList.remove("hidden", "alert-warning", "alert-danger");
  box.classList.add(type === "warning" ? "alert-warning" : "alert-danger");
}

export function clearFormError(containerId) {
  const box = document.getElementById(containerId);
  if (!box) return;
  box.textContent = "";
  box.classList.add("hidden");
  box.classList.remove("alert-warning", "alert-danger");
}
