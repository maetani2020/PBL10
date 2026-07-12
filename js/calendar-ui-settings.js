// calendar-ui-settings.js
// UI display size settings shared across the calendar screen.

const UI_SIZE_KEY = "shared_calendar_ui_size";
const DEFAULT_UI_SIZE = 5;

function normalizeUiSize(value) {
  const size = parseInt(value, 10);
  if (!Number.isFinite(size)) return DEFAULT_UI_SIZE;
  return Math.min(10, Math.max(1, size));
}

export function getUiSizeSetting() {
  try {
    return normalizeUiSize(localStorage.getItem(UI_SIZE_KEY) || DEFAULT_UI_SIZE);
  } catch {
    return DEFAULT_UI_SIZE;
  }
}

export function updateUiSizeControl(size = getUiSizeSetting()) {
  const normalized = normalizeUiSize(size);
  const input = document.getElementById("settingsUiSize");
  const label = document.getElementById("settingsUiSizeValue");
  if (input) input.value = String(normalized);
  if (label) label.textContent = String(normalized);
}

export function applyUiSize(size = getUiSizeSetting()) {
  const normalized = normalizeUiSize(size);
  document.body.classList.remove(
    "ui-size-1",
    "ui-size-2",
    "ui-size-3",
    "ui-size-4",
    "ui-size-5",
    "ui-size-6",
    "ui-size-7",
    "ui-size-8",
    "ui-size-9",
    "ui-size-10"
  );
  document.body.classList.add(`ui-size-${normalized}`);
  updateUiSizeControl(normalized);
  return normalized;
}

export function saveUiSizeSetting(size) {
  const normalized = normalizeUiSize(size);
  localStorage.setItem(UI_SIZE_KEY, String(normalized));
  applyUiSize(normalized);
  return normalized;
}

export function initUiSizeControl() {
  const input = document.getElementById("settingsUiSize");
  if (!input || input.dataset.uiSizeBound === "true") {
    applyUiSize(getUiSizeSetting());
    return;
  }

  input.dataset.uiSizeBound = "true";
  input.addEventListener("input", (event) => {
    saveUiSizeSetting(event.target.value);
  });
  applyUiSize(getUiSizeSetting());
}

applyUiSize(getUiSizeSetting());
