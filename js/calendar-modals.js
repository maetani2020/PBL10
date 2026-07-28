// calendar-modals.js
// Modal control functions (Open, Close, Reset, Populating inputs)

import {
  setSelectedEventId,
  formatDate,
  clearFieldErrors,
  clearFormError,
  getCurrentFilterVisibility,
  isReadOnlyCalendarMode,
  showToast
} from './calendar-state.js';
import { getLocalSettings } from './calendar-notification.js';
import { populateEventCategorySelect } from './calendar-categories.js';

export const eventModal = document.getElementById("eventModal");
export const listModal = document.getElementById("listModal");
export const dayDetailModal = document.getElementById("dayDetailModal");

let dayDetailDateStr = "";

export function getDayDetailDate() {
  return dayDetailDateStr;
}

function notifyDraftDetached() {
  document.dispatchEvent(new CustomEvent("event-form:draft-detached"));
}

const CALENDAR_READ_ONLY_MESSAGE = "カレンダー画面は閲覧専用です。予定の追加・編集は「個人予定」または「グループ予定」から行ってください。";

function showCalendarReadOnlyToast() {
  showToast(CALENDAR_READ_ONLY_MESSAGE);
}

function setEventFormReadOnly(readOnly) {
  eventModal?.classList.toggle("is-read-only", readOnly);
  eventModal?.querySelectorAll("input, textarea, select").forEach(el => {
    el.disabled = readOnly;
  });
  eventModal?.querySelectorAll(".reminder-chip button, #addCustomReminderBtn").forEach(el => {
    el.disabled = readOnly;
  });

  document.getElementById("saveEventBtn")?.classList.toggle("hidden", readOnly);
  document.getElementById("saveDraftEventBtn")?.classList.toggle("hidden", readOnly);
  if (readOnly) {
    document.getElementById("deleteEventBtn")?.classList.add("hidden");
  }
}

function restoreEventFormEditability() {
  setEventFormReadOnly(false);
}

export function setEventModalStep(step = "basic") {
  const isDetails = step === "details";
  const basicPanel = document.getElementById("eventStepBasic");
  const detailsPanel = document.getElementById("eventStepDetails");
  const basicTab = document.getElementById("eventStepBasicTab");
  const detailsTab = document.getElementById("eventStepDetailsTab");

  if (eventModal) eventModal.dataset.step = isDetails ? "details" : "basic";
  basicPanel?.classList.toggle("hidden", isDetails);
  detailsPanel?.classList.toggle("hidden", !isDetails);
  basicTab?.classList.toggle("active", !isDetails);
  detailsTab?.classList.toggle("active", isDetails);
}

export function openModal() {
  setEventModalStep("basic");
  clearFieldErrors(eventModal);
  clearFormError("preSaveWarning");
  eventModal.style.display = "flex";
}

export function closeModal() {
  clearFieldErrors(eventModal);
  clearFormError("preSaveWarning");
  eventModal.style.display = "none";
}

export function openListModal() {
  listModal.style.display = "flex";
}

export function closeListModal() {
  listModal.style.display = "none";
}

export function openDayDetailModal(dateStr) {
  dayDetailDateStr = dateStr;
  if (dayDetailModal) dayDetailModal.style.display = "flex";
}

export function closeDayDetailModal() {
  dayDetailDateStr = "";
  if (dayDetailModal) dayDetailModal.style.display = "none";
}

export function updateEventOptionVisibility() {
  const eventType = document.getElementById("eventType").value;
  const taskOptions = document.getElementById("taskOptions");
  const mailOptions = document.getElementById("mailOptions");
  
  if (taskOptions) taskOptions.classList.toggle("hidden", eventType !== "task");
  if (mailOptions) mailOptions.classList.toggle("hidden", eventType !== "mail");
}

function normalizeAllDayDateRange() {
  const startInput = document.getElementById("eventStart");
  const endInput = document.getElementById("eventEnd");
  if (!startInput || !endInput) return;

  const baseDate = (startInput.value || endInput.value || formatDate(new Date())).slice(0, 10);
  startInput.value = `${baseDate}T00:00`;
  endInput.value = `${baseDate}T23:59`;
}

export function updateAllDayDateTimeVisibility({ normalize = false } = {}) {
  const allDayInput = document.getElementById("allDay");
  const startInput = document.getElementById("eventStart");
  const endInput = document.getElementById("eventEnd");
  if (!allDayInput || !startInput || !endInput) return;

  if (allDayInput.checked && normalize) {
    normalizeAllDayDateRange();
  }

  const startLabel = startInput.previousElementSibling;
  const endLabel = endInput.previousElementSibling;
  [startLabel, startInput, endLabel, endInput].forEach(el => {
    el?.classList.toggle("hidden", allDayInput.checked);
  });
}

function normalizeReminderMinute(value) {
  const minute = Number(value);
  if (!Number.isFinite(minute) || minute < 1 || minute > 10080) return null;
  return Math.floor(minute);
}

function uniqueReminderMinutes(minutes) {
  const seen = new Set();
  return minutes
    .map(normalizeReminderMinute)
    .filter(minute => minute !== null)
    .filter(minute => {
      if (seen.has(minute)) return false;
      seen.add(minute);
      return true;
    });
}

function getEventCustomReminderInput() {
  return document.getElementById("customReminderMinutes");
}

function getEventCustomReminderMinutes() {
  const input = getEventCustomReminderInput();
  if (!input) return [];
  try {
    const parsed = JSON.parse(input.dataset.customReminderMinutes || "[]");
    return uniqueReminderMinutes(Array.isArray(parsed) ? parsed : []);
  } catch {
    return [];
  }
}

function setEventCustomReminderMinutes(minutes) {
  const input = getEventCustomReminderInput();
  if (!input) return;
  input.dataset.customReminderMinutes = JSON.stringify(uniqueReminderMinutes(minutes));
}

export function addEventCustomReminderFromInput() {
  const input = getEventCustomReminderInput();
  const minute = normalizeReminderMinute(input?.value);
  if (minute === null) {
    showToast("カスタム通知は1から10080分の範囲で入力してください");
    return;
  }

  if (minute === 30) {
    document.getElementById("remind30").checked = true;
  } else if (minute === 5) {
    document.getElementById("remind5").checked = true;
  } else {
    setEventCustomReminderMinutes([...getEventCustomReminderMinutes(), minute]);
  }

  input.value = "";
  renderEventReminderList();
}

export function collectEventReminderMinutes() {
  const minutes = [];
  if (document.getElementById("remind30")?.checked) minutes.push(30);
  if (document.getElementById("remind5")?.checked) minutes.push(5);

  minutes.push(...getEventCustomReminderMinutes());

  const custom = normalizeReminderMinute(getEventCustomReminderInput()?.value);
  if (custom !== null) minutes.push(custom);

  return uniqueReminderMinutes(minutes);
}

function addReminderChip(list, label, onDelete) {
  const chip = document.createElement("span");
  chip.className = "reminder-chip";
  chip.style.marginRight = "6px";
  chip.style.marginBottom = "6px";
  chip.style.display = "inline-flex";
  chip.style.alignItems = "center";
  chip.style.padding = "4px 8px";
  chip.style.borderRadius = "12px";
  chip.style.background = "rgba(0, 122, 255, 0.1)";
  chip.style.color = "#007aff";
  chip.style.fontSize = "11px";
  chip.style.fontWeight = "600";

  const text = document.createElement("span");
  text.textContent = label;

  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "✕";
  button.style.border = "none";
  button.style.background = "none";
  button.style.color = "#007aff";
  button.style.marginLeft = "4px";
  button.style.cursor = "pointer";
  button.style.fontWeight = "bold";
  button.addEventListener("click", onDelete);

  chip.appendChild(text);
  chip.appendChild(button);
  list.appendChild(chip);
}

export function renderEventReminderList() {
  const list = document.getElementById("eventReminderList");
  if (!list) return;

  list.innerHTML = "";
  const minutes = collectEventReminderMinutes();
  const atStart = document.getElementById("remindStart")?.checked;

  minutes.forEach(m => {
    let label = `${m}分前`;
    if (m % 1440 === 0) label = `${m / 1440}日前`;
    else if (m % 60 === 0) label = `${m / 60}時間前`;

    addReminderChip(list, label, () => {
      if (m === 30) document.getElementById("remind30").checked = false;
      else if (m === 5) document.getElementById("remind5").checked = false;
      else {
        setEventCustomReminderMinutes(getEventCustomReminderMinutes().filter(minute => minute !== m));
        const input = getEventCustomReminderInput();
        if (Number(input?.value) === m) input.value = "";
      }
      renderEventReminderList();
    });
  });

  if (atStart) {
    addReminderChip(list, "開始/期限時刻", () => {
      document.getElementById("remindStart").checked = false;
      renderEventReminderList();
    });
  }

  if (list.children.length === 0) {
    list.innerHTML = `<span class="reminder-empty" style="opacity:0.5; font-size:11px;">通知なし</span>`;
  }
}

export function setEventReminderControls(minutes, atStart) {
  const norm = Array.isArray(minutes) ? minutes : [];
  document.getElementById("remind30").checked = norm.includes(30);
  document.getElementById("remind5").checked = norm.includes(5);
  document.getElementById("remindStart").checked = !!atStart;

  setEventCustomReminderMinutes(norm.filter(m => m !== 30 && m !== 5));
  document.getElementById("customReminderMinutes").value = "";
  renderEventReminderList();

}

function applyCurrentCalendarModeToEventForm() {
  const visibility = getCurrentFilterVisibility();
  const visibilityEl = document.getElementById("eventVisibility");
  const groupWrap = document.getElementById("groupSelectWrap");
  const groupSelect = document.getElementById("eventGroupId");

  if (visibilityEl) visibilityEl.value = visibility;
  groupWrap?.classList.toggle("hidden", visibility !== "group");

  if (visibility === "group" && groupSelect && !groupSelect.value) {
    const firstGroupOption = Array.from(groupSelect.options).find(option => option.value);
    if (firstGroupOption) groupSelect.value = firstGroupOption.value;
  }
}

export function resetForm() {
  notifyDraftDetached();
  restoreEventFormEditability();
  const settings = getLocalSettings();

  setSelectedEventId(null);
  window.editingEventId = null;
  eventModal?.classList.add("is-create");
  eventModal?.classList.remove("is-edit");
  document.getElementById("deleteEventBtn")?.classList.add("hidden");
  
  document.getElementById("eventTitle").value = "";
  document.getElementById("eventMemo").value = "";
  document.getElementById("eventVisibility").value = "public";
  document.getElementById("allDay").checked = false;
  document.getElementById("eventType").value = "event";
  updateAllDayDateTimeVisibility();

  if (document.getElementById("taskDeadlineNotify")) {
    document.getElementById("taskDeadlineNotify").checked = true;
  }

  if (document.getElementById("mailReminderEnabled")) {
    document.getElementById("mailReminderEnabled").checked = false;
    document.getElementById("mailTo").value = "";
    document.getElementById("mailSubject").value = "";
    document.getElementById("mailRemindAt").value = "";
    document.getElementById("mailSent").checked = false;
  }

  setEventReminderControls(settings.eventBeforeMinutes, settings.eventAtStart);

  document.getElementById("hpCost").value = "0";
  document.getElementById("motivationCost").value = "0";
  document.getElementById("preSaveWarning").classList.add("hidden");
  document.getElementById("restSuggestions").classList.add("hidden");
  document.getElementById("groupSelectWrap").classList.add("hidden");
  document.getElementById("eventGroupId").value = "";

  applyCurrentCalendarModeToEventForm();

  populateEventCategorySelect();
  updateEventOptionVisibility();
}

export function openCreateEvent(dateStr) {
  if (isReadOnlyCalendarMode()) {
    showCalendarReadOnlyToast();
    return;
  }

  resetForm();
  document.getElementById("eventStart").value = dateStr + "T09:00";
  document.getElementById("eventEnd").value = dateStr + "T10:00";
  updateAllDayDateTimeVisibility();
  
  if (document.getElementById("mailRemindAt")) {
    document.getElementById("mailRemindAt").value = dateStr + "T09:00";
  }

  import('./calendar-hp-motivation.js').then(m => {
    m.updatePreSavePreview();
    m.showRestSuggestions(dateStr);
  });

  openModal();
}

export function openCreateEventWithTime(dateStr, hour) {
  if (isReadOnlyCalendarMode()) {
    showCalendarReadOnlyToast();
    return;
  }

  resetForm();

  const startHourStr = String(hour).padStart(2, "0") + ":00";
  let endHourStr = String((hour + 1) % 24).padStart(2, "0") + ":00";
  let endDateStr = dateStr;

  if (hour === 23) {
    const nextDate = new Date(dateStr);
    nextDate.setDate(nextDate.getDate() + 1);
    endDateStr = formatDate(nextDate);
  }

  document.getElementById("eventStart").value = dateStr + "T" + startHourStr;
  document.getElementById("eventEnd").value = endDateStr + "T" + endHourStr;
  updateAllDayDateTimeVisibility();
  
  if (document.getElementById("mailRemindAt")) {
    document.getElementById("mailRemindAt").value = dateStr + "T" + startHourStr;
  }

  import('./calendar-hp-motivation.js').then(m => {
    m.updatePreSavePreview();
    m.showRestSuggestions(dateStr);
  });

  openModal();
}

export function openEditEvent(event) {
  notifyDraftDetached();
  restoreEventFormEditability();
  const readOnly = isReadOnlyCalendarMode();
  setSelectedEventId(event.id);
  window.editingEventId = event.id;
  eventModal?.classList.remove("is-create");
  eventModal?.classList.add("is-edit");
  document.getElementById("deleteEventBtn")?.classList.toggle("hidden", readOnly);
  
  document.getElementById("eventTitle").value = event.title;
  document.getElementById("eventMemo").value = event.memo || "";
  document.getElementById("eventStart").value = event.start;
  document.getElementById("eventEnd").value = event.end;
  document.getElementById("eventVisibility").value = event.visibility;
  document.getElementById("allDay").checked = event.allDay;
  updateAllDayDateTimeVisibility();

  document.getElementById("eventType").value = event.eventType || "event";
  document.getElementById("hpCost").value = event.hp_consumption || 0;
  document.getElementById("motivationCost").value = event.motivation_consumption || 0;
  populateEventCategorySelect(event.category_id || "", event.color || "");

  if (document.getElementById("taskDeadlineNotify")) {
    document.getElementById("taskDeadlineNotify").checked = event.taskDeadlineNotify !== false;
  }

  if (document.getElementById("mailReminderEnabled")) {
    document.getElementById("mailReminderEnabled").checked = !!event.mailReminderEnabled;
    document.getElementById("mailTo").value = event.mailTo || "";
    document.getElementById("mailSubject").value = event.mailSubject || "";
    document.getElementById("mailRemindAt").value = event.mailRemindAt || "";
    document.getElementById("mailSent").checked = !!event.mailSent;
  }

  setEventReminderControls(event.reminderMinutes, event.notifyAtStart);

  const groupWrap = document.getElementById("groupSelectWrap");
  if (groupWrap) {
    const isGroup = event.visibility === "group";
    groupWrap.classList.toggle("hidden", !isGroup);
    if (isGroup) {
      import('./calendar-auth.js').then(async (auth) => {
        try {
          const calendars = await auth.apiRequest('/api/calendars');
          const matchedCal = calendars.find(c => c.id == event.calendar_id);
          if (matchedCal && matchedCal.group_id) {
            document.getElementById("eventGroupId").value = matchedCal.group_id;
          } else {
            document.getElementById("eventGroupId").value = "";
          }
        } catch (err) {
          console.error('Failed to map calendar_id to group_id:', err);
          document.getElementById("eventGroupId").value = "";
        }
      });
    }
  }

  const dateStr = event.start.substring(0, 10);
  import('./calendar-hp-motivation.js').then(m => {
    m.updatePreSavePreview();
    m.showRestSuggestions(dateStr);
  });

  updateEventOptionVisibility();
  setEventFormReadOnly(readOnly);
  if (readOnly) showCalendarReadOnlyToast();
  openModal();
}
