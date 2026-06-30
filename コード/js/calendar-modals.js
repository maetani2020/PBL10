// calendar-modals.js
// Modal control functions (Open, Close, Reset, Populating inputs)

import { setSelectedEventId, formatDate } from './calendar-state.js';
import { getLocalSettings } from './calendar-notification.js';

export const eventModal = document.getElementById("eventModal");
export const listModal = document.getElementById("listModal");

export function setEventModalStep(step = "basic") {
  const isDetails = step === "details";
  const basicPanel = document.getElementById("eventStepBasic");
  const detailsPanel = document.getElementById("eventStepDetails");
  const basicTab = document.getElementById("eventStepBasicTab");
  const detailsTab = document.getElementById("eventStepDetailsTab");
  const prevBtn = document.getElementById("prevEventStepBtn");
  const nextBtn = document.getElementById("nextEventStepBtn");
  const saveBtn = document.getElementById("saveEventBtn");

  if (eventModal) eventModal.dataset.step = isDetails ? "details" : "basic";
  basicPanel?.classList.toggle("hidden", isDetails);
  detailsPanel?.classList.toggle("hidden", !isDetails);
  basicTab?.classList.toggle("active", !isDetails);
  detailsTab?.classList.toggle("active", isDetails);
  prevBtn?.classList.toggle("hidden", !isDetails);
  nextBtn?.classList.toggle("hidden", isDetails);
  saveBtn?.classList.toggle("hidden", !isDetails);
}

export function openModal() {
  setEventModalStep("basic");
  eventModal.style.display = "flex";
}

export function closeModal() {
  eventModal.style.display = "none";
}

export function openListModal() {
  listModal.style.display = "flex";
}

export function closeListModal() {
  listModal.style.display = "none";
}

export function updateEventOptionVisibility() {
  const eventType = document.getElementById("eventType").value;
  const taskOptions = document.getElementById("taskOptions");
  const mailOptions = document.getElementById("mailOptions");
  
  if (taskOptions) taskOptions.classList.toggle("hidden", eventType !== "task");
  if (mailOptions) mailOptions.classList.toggle("hidden", eventType !== "mail");
}

export function collectEventReminderMinutes() {
  const minutes = [];
  if (document.getElementById("remind30")?.checked) minutes.push(30);
  if (document.getElementById("remind5")?.checked) minutes.push(5);

  const custom = Number(document.getElementById("customReminderMinutes")?.value);
  if (Number.isFinite(custom) && custom > 0) minutes.push(Math.floor(custom));

  return minutes;
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
      else document.getElementById("customReminderMinutes").value = "";
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

  const custom = norm.find(m => m !== 30 && m !== 5);
  document.getElementById("customReminderMinutes").value = custom || "";
  renderEventReminderList();
}

export function resetForm() {
  const settings = getLocalSettings();

  setSelectedEventId(null);
  window.editingEventId = null;
  
  document.getElementById("eventTitle").value = "";
  document.getElementById("eventMemo").value = "";
  document.getElementById("eventVisibility").value = "public";
  document.getElementById("allDay").checked = false;
  document.getElementById("eventType").value = "event";

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

  updateEventOptionVisibility();
}

export function openCreateEvent(dateStr) {
  resetForm();
  document.getElementById("eventStart").value = dateStr + "T09:00";
  document.getElementById("eventEnd").value = dateStr + "T10:00";
  
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
  setSelectedEventId(event.id);
  window.editingEventId = event.id;
  
  document.getElementById("eventTitle").value = event.title;
  document.getElementById("eventMemo").value = event.memo || "";
  document.getElementById("eventStart").value = event.start;
  document.getElementById("eventEnd").value = event.end;
  document.getElementById("eventVisibility").value = event.visibility;
  document.getElementById("allDay").checked = event.allDay;

  document.getElementById("eventType").value = event.eventType || "event";
  document.getElementById("hpCost").value = event.hp_consumption || 0;
  document.getElementById("motivationCost").value = event.motivation_consumption || 0;

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
  openModal();
}
