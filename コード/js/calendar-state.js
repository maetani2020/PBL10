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

// Memory cache helpers
export function getEvents() {
  if (currentFilter === "group") {
    return eventsCache.filter(e => e.visibility === "group");
  } else if (currentFilter === "private") {
    return eventsCache.filter(e => e.visibility === "private");
  }
  return eventsCache;
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
