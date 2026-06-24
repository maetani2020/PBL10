// calendar-state.js
// Global state and shared utility functions

export let currentDate = new Date();
export let currentView = "month";
export let selectedEventId = null;
export let currentAttachments = [];
export const apiKey = ""; // Fill in your Gemini API key if required

export const STORAGE_KEY = "shared_calendar_events";

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

// LocalStorage helpers
export function getEvents() {
  return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
}

export function saveEvents(events) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(events));
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
