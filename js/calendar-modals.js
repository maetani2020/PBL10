// calendar-modals.js
// Modal control functions (Open, Close, Reset, Populating inputs)

import { setSelectedEventId, formatDate } from './calendar-state.js';

export const eventModal = document.getElementById("eventModal");
export const listModal = document.getElementById("listModal");

export function openModal() {
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

export function resetForm() {
  setSelectedEventId(null);
  document.getElementById("eventTitle").value = "";
  document.getElementById("eventMemo").value = "";
  document.getElementById("eventVisibility").value = "public";
  document.getElementById("allDay").checked = false;
}

export function openCreateEvent(dateStr) {
  resetForm();
  document.getElementById("eventStart").value = dateStr + "T09:00";
  document.getElementById("eventEnd").value = dateStr + "T10:00";
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

  openModal();
}

export function openEditEvent(event) {
  setSelectedEventId(event.id);
  document.getElementById("eventTitle").value = event.title;
  document.getElementById("eventMemo").value = event.memo || "";
  document.getElementById("eventStart").value = event.start;
  document.getElementById("eventEnd").value = event.end;
  document.getElementById("eventVisibility").value = event.visibility;
  document.getElementById("allDay").checked = event.allDay;
  openModal();
}
