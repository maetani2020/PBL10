// calendar-main.js
// Entry point and event listener bindings

import {
  currentDate,
  currentView,
  selectedEventId,
  currentAttachments,
  setCurrentAttachments,
  setCurrentFilter,
  formatDate,
  showToast,
  showFieldError,
  clearFieldError,
  clearFieldErrors,
  showFormError,
  clearFormError,
  getAllEvents,
  getCurrentFilterVisibility,
  isReadOnlyCalendarMode,
  saveEvents,
  normalizeEvent
} from './calendar-state.js';

import {
  checkAuth,
  initAuthForm,
  initAccountPanel,
  isLoggedIn,
  initPasswordResetModal,
  initAccountSettings,
  apiRequest
} from './calendar-auth.js';

import {
  eventModal,
  listModal,
  openModal,
  closeModal,
  openListModal,
  closeListModal,
  resetForm,
  openCreateEvent,
  collectEventReminderMinutes,
  addEventCustomReminderFromInput,
  renderEventReminderList,
  setEventReminderControls,
  updateEventOptionVisibility,
  updateAllDayDateTimeVisibility,
  setEventModalStep
} from './calendar-modals.js';

import {
  renderScheduleList,
  refreshCalendar,
  refreshCurrentView,
  renderAll,
  movePrevious,
  moveNext,
  switchView,
  openYearJumpModal,
  closeYearJumpModal,
  applyYearJump,
  monthView,
  weekView,
  dayView
} from './calendar-views.js';

import {
  openCameraModal,
  closeCameraModal,
  capturePhotoFromCamera
} from './calendar-camera.js';

import {
  openScannerSheet,
  closeScannerSheet,
  showActionSheet,
  hideActionSheet,
  validateSendButton,
  renderAttachmentsCarousel,
  sendChatToGemini,
  handleFileAttachment
} from './calendar-ai.js';

import {
  openGroupModal,
  closeGroupModal,
  createGroup,
  inviteMember,
  dissolveGroup,
  leaveGroup,
  syncGroups
} from './calendar-group.js';

import {
  openNotificationHistoryModal,
  closeNotificationHistoryModal,
  clearNotificationHistory,
  openAdminAnnouncementsModal,
  closeAdminAnnouncementsModal,
  syncAdminAnnouncements,
  openNotificationSettingsModal,
  closeNotificationSettingsModal,
  saveNotificationSettingsFromForm,
  addSettingsCustomReminderFromInput,
  renderSettingsReminderList,
  startNotificationWatcher,
  startAdminAnnouncementWatcher,
  startAdminAdWatcher,
  syncNotificationSettings
} from './calendar-notification.js';

import {
  syncHpMotivationStatus,
  updatePreSavePreview,
  showRestSuggestions,
  preSaveCheck,
  showHpMotivationRecalculation
} from './calendar-hp-motivation.js';



import {
  initAdminUI,
  updateAdminNavVisibility,
  closeAdminPanel
} from './calendar-admin.js';

// ----------------------------------------------------
// Database Synchronizer
// ----------------------------------------------------
export async function syncEvents() {
  try {
    const events = await apiRequest('/api/events');
    const stateModule = await import('./calendar-state.js');
    stateModule.setEvents(events);
    refreshCalendar();

    // Also sync HP/Motivation status
    const targetDate = formatDate(currentDate);
    await syncHpMotivationStatus(targetDate);
  } catch (err) {
    console.error('Failed to sync events:', err);
  }
}

// ----------------------------------------------------
// Core Operations: Save & Delete Events
// ----------------------------------------------------

const EVENT_DRAFT_STORAGE_KEY = "shared_calendar_event_draft";
const EVENT_DRAFTS_STORAGE_KEY = "shared_calendar_event_drafts";
const MAX_EVENT_DRAFTS = 30;
let draftListMode = "load";
let activeDraftId = null;

function setValue(id, value) {
  const el = document.getElementById(id);
  if (el) el.value = value ?? "";
}

function setChecked(id, value) {
  const el = document.getElementById(id);
  if (el) el.checked = !!value;
}

function getChecked(id, fallback = false) {
  const el = document.getElementById(id);
  return el ? el.checked : fallback;
}

function readPercentInput(id) {
  const value = parseInt(document.getElementById(id)?.value, 10);
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

function isNumberInRange(id, min, max) {
  const el = document.getElementById(id);
  const raw = el?.value;
  if (raw === "" || raw == null) return true;
  const value = Number(raw);
  return Number.isFinite(value) && value >= min && value <= max;
}

function collectEventDraftData() {
  return {
    title: document.getElementById("eventTitle")?.value || "",
    start: document.getElementById("eventStart")?.value || "",
    end: document.getElementById("eventEnd")?.value || "",
    allDay: getChecked("allDay"),
    eventType: document.getElementById("eventType")?.value || "event",
    hpCost: document.getElementById("hpCost")?.value || "0",
    motivationCost: document.getElementById("motivationCost")?.value || "0",
    memo: document.getElementById("eventMemo")?.value || "",
    visibility: document.getElementById("eventVisibility")?.value || "public",
    groupId: document.getElementById("eventGroupId")?.value || "",
    remind30: getChecked("remind30", true),
    remind5: getChecked("remind5", true),
    remindStart: getChecked("remindStart", true),
    reminderMinutes: collectEventReminderMinutes(),
    customReminderMinutes: document.getElementById("customReminderMinutes")?.value || "",
    taskDeadlineNotify: getChecked("taskDeadlineNotify", true),
    mailReminderEnabled: getChecked("mailReminderEnabled"),
    mailTo: document.getElementById("mailTo")?.value || "",
    mailSubject: document.getElementById("mailSubject")?.value || "",
    mailRemindAt: document.getElementById("mailRemindAt")?.value || "",
    mailSent: getChecked("mailSent")
  };
}

function createDraftId() {
  return `draft_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function readDraftsFromStorage() {
  let drafts = [];

  try {
    const raw = localStorage.getItem(EVENT_DRAFTS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    drafts = Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error("Failed to read event drafts:", err);
    drafts = [];
  }

  const legacyRaw = localStorage.getItem(EVENT_DRAFT_STORAGE_KEY);
  if (legacyRaw) {
    try {
      const legacyDraft = JSON.parse(legacyRaw);
      const hasLegacy = drafts.some(draft => draft.id === "legacy_event_draft");
      if (legacyDraft && !hasLegacy) {
        drafts.unshift({
          ...legacyDraft,
          id: "legacy_event_draft",
          savedAt: legacyDraft.savedAt || new Date().toISOString()
        });
        writeDraftsToStorage(drafts);
      }
      localStorage.removeItem(EVENT_DRAFT_STORAGE_KEY);
    } catch (err) {
      console.error("Failed to migrate legacy event draft:", err);
    }
  }

  return drafts
    .filter(draft => draft && typeof draft === "object")
    .sort((a, b) => new Date(b.savedAt || 0) - new Date(a.savedAt || 0));
}

function writeDraftsToStorage(drafts) {
  const normalized = drafts
    .filter(draft => draft && typeof draft === "object")
    .slice(0, MAX_EVENT_DRAFTS);
  localStorage.setItem(EVENT_DRAFTS_STORAGE_KEY, JSON.stringify(normalized));
}

function formatDraftDate(value) {
  if (!value) return "保存日時なし";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "保存日時なし";
  return date.toLocaleString("ja-JP", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function getDraftTitle(draft) {
  const title = String(draft.title || "").trim();
  return title || "無題の下書き";
}

function getDraftDateRange(draft) {
  const start = draft.start ? draft.start.replace("T", " ") : "開始未設定";
  const end = draft.end ? draft.end.replace("T", " ") : "終了未設定";
  return `${start} - ${end}`;
}

function applyEventDraftData(draft) {
  setValue("eventTitle", draft.title);
  setValue("eventStart", draft.start);
  setValue("eventEnd", draft.end);
  setChecked("allDay", draft.allDay);
  setValue("eventType", draft.eventType || "event");
  setValue("hpCost", draft.hpCost ?? "0");
  setValue("motivationCost", draft.motivationCost ?? "0");
  setValue("eventMemo", draft.memo);
  setValue("eventVisibility", draft.visibility || "public");
  setValue("eventGroupId", draft.groupId);
  const draftReminderMinutes = Array.isArray(draft.reminderMinutes)
    ? draft.reminderMinutes
    : [
        ...(draft.remind30 ?? true ? [30] : []),
        ...(draft.remind5 ?? true ? [5] : []),
        ...(() => {
          const minute = Number(draft.customReminderMinutes);
          return Number.isFinite(minute) && minute > 0 ? [Math.floor(minute)] : [];
        })()
      ];
  setEventReminderControls(draftReminderMinutes, draft.remindStart ?? true);
  setChecked("taskDeadlineNotify", draft.taskDeadlineNotify ?? true);
  setChecked("mailReminderEnabled", draft.mailReminderEnabled);
  setValue("mailTo", draft.mailTo);
  setValue("mailSubject", draft.mailSubject);
  setValue("mailRemindAt", draft.mailRemindAt);
  setChecked("mailSent", draft.mailSent);

  updateEventOptionVisibility();
  updateAllDayDateTimeVisibility();
  renderEventReminderList();
  const isGroup = (draft.visibility || "public") === "group";
  document.getElementById("groupSelectWrap")?.classList.toggle("hidden", !isGroup);
  updatePreSavePreview();
}

function showReadOnlyCalendarWriteToast() {
  showToast("カレンダー画面は閲覧専用です。予定の追加・編集は「個人予定」または「グループ予定」から行ってください。");
}

function saveEventDraft() {
  if (isReadOnlyCalendarMode()) {
    showReadOnlyCalendarWriteToast();
    return;
  }
  const draftData = {
    ...collectEventDraftData(),
    savedAt: new Date().toISOString()
  };
  const drafts = readDraftsFromStorage();
  const existingIndex = activeDraftId
    ? drafts.findIndex(draft => draft.id === activeDraftId)
    : -1;

  if (existingIndex >= 0) {
    const updatedDraft = {
      ...drafts[existingIndex],
      ...draftData,
      id: activeDraftId
    };
    const nextDrafts = [
      updatedDraft,
      ...drafts.filter(draft => draft.id !== activeDraftId)
    ];
    writeDraftsToStorage(nextDrafts);
    showToast("下書きを上書き保存しました");
  } else {
    const draft = {
      ...draftData,
      id: createDraftId()
    };
    activeDraftId = draft.id;
    drafts.unshift(draft);
    writeDraftsToStorage(drafts);
    showToast(`下書きを保存しました（${Math.min(drafts.length, MAX_EVENT_DRAFTS)}件）`);
  }

  renderDraftList();
  closeModal();
}

function openDraftListModal(mode = "load") {
  draftListMode = mode === "delete" ? "delete" : "load";
  renderDraftList();
  const title = document.getElementById("draftListTitle");
  if (title) title.textContent = draftListMode === "delete" ? "下書き削除" : "下書き読込";
  const clearAllBtn = document.getElementById("clearAllDraftsBtn");
  if (clearAllBtn) clearAllBtn.classList.toggle("hidden", draftListMode !== "delete");
  const modal = document.getElementById("draftListModal");
  if (modal) modal.style.display = "flex";
}

function closeDraftListModal() {
  const modal = document.getElementById("draftListModal");
  if (modal) modal.style.display = "none";
}

function loadEventDraft(draftId) {
  if (isReadOnlyCalendarMode()) {
    showReadOnlyCalendarWriteToast();
    return;
  }
  const drafts = readDraftsFromStorage();
  if (drafts.length === 0) {
    showToast("保存されている下書きはありません");
    return;
  }

  if (!draftId) {
    openDraftListModal("load");
    return;
  }

  const draft = drafts.find(item => item.id === draftId);
  if (!draft) {
    showToast("選択した下書きが見つかりません");
    renderDraftList();
    return;
  }

  resetForm();
  activeDraftId = draft.id;
  applyEventDraftData(draft);
  closeDraftListModal();
  openModal();
  showToast("下書きを読み込みました");
}

function deleteEventDraft(draftId) {
  const drafts = readDraftsFromStorage();
  const nextDrafts = drafts.filter(draft => draft.id !== draftId);
  writeDraftsToStorage(nextDrafts);
  if (activeDraftId === draftId) activeDraftId = null;
  renderDraftList();
  showToast("下書きを削除しました");
}

function removeActiveDraftAfterEventSave() {
  if (!activeDraftId) return;

  const drafts = readDraftsFromStorage();
  const nextDrafts = drafts.filter(draft => draft.id !== activeDraftId);
  if (nextDrafts.length !== drafts.length) {
    writeDraftsToStorage(nextDrafts);
    renderDraftList();
  }
  activeDraftId = null;
}

function clearEventDraft() {
  const drafts = readDraftsFromStorage();
  if (drafts.length === 0) {
    showToast("保存されている下書きはありません");
    return;
  }

  if (!confirm("保存済みの下書きをすべて削除しますか？")) return;

  writeDraftsToStorage([]);
  localStorage.removeItem(EVENT_DRAFT_STORAGE_KEY);
  activeDraftId = null;
  renderDraftList();
  showToast("下書きをすべて削除しました");
}

function renderDraftList() {
  const container = document.getElementById("draftListContainer");
  if (!container) return;

  const drafts = readDraftsFromStorage();
  container.innerHTML = "";

  if (drafts.length === 0) {
    const empty = document.createElement("p");
    empty.className = "draft-empty";
    empty.textContent = "保存されている下書きはありません";
    container.appendChild(empty);
    return;
  }

  drafts.forEach(draft => {
    const item = document.createElement("div");
    item.className = "draft-item";

    const title = document.createElement("div");
    title.className = "draft-item-title";
    title.textContent = getDraftTitle(draft);

    const meta = document.createElement("div");
    meta.className = "draft-item-meta";
    meta.textContent = `${getDraftDateRange(draft)} / 保存: ${formatDraftDate(draft.savedAt)}`;

    const actions = document.createElement("div");
    actions.className = "draft-item-actions";

    if (draftListMode === "delete") {
      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "danger-btn";
      deleteBtn.textContent = "削除";
      deleteBtn.addEventListener("click", () => deleteEventDraft(draft.id));
      actions.append(deleteBtn);
    } else {
      const loadBtn = document.createElement("button");
      loadBtn.type = "button";
      loadBtn.className = "primary-btn";
      loadBtn.textContent = "読込";
      loadBtn.addEventListener("click", () => loadEventDraft(draft.id));
      actions.append(loadBtn);
    }
    item.append(title, meta, actions);
    container.appendChild(item);
  });
}

function updateLocalEventCache(savedEvent) {
  if (!savedEvent) return;

  const normalized = normalizeEvent(savedEvent);
  if (!normalized.id) return;

  const currentEvents = getAllEvents();
  const index = currentEvents.findIndex(event => event.id === normalized.id);
  const nextEvents = [...currentEvents];

  if (index >= 0) {
    nextEvents[index] = { ...nextEvents[index], ...normalized };
  } else {
    nextEvents.push(normalized);
  }

  saveEvents(nextEvents);
  refreshCalendar();
}

async function saveEvent() {
  if (isReadOnlyCalendarMode()) {
    showReadOnlyCalendarWriteToast();
    return;
  }
  clearFieldErrors(eventModal);
  clearFormError("preSaveWarning");

  const title = document.getElementById("eventTitle").value.trim();

  if (title.length === 0) {
    setEventModalStep("basic");
    showFormError("preSaveWarning", "タイトルを入力してください");
    return showFieldError("eventTitle", "タイトルを入力してください");
  }

  const start = document.getElementById("eventStart").value;
  const end = document.getElementById("eventEnd").value;

  if (start === "" || end === "") {
    setEventModalStep("basic");
    showFormError("preSaveWarning", "開始日時と終了日時を入力してください");
    return showFieldError(start === "" ? "eventStart" : "eventEnd", "日時を入力してください");
  }

  if (start > end) {
    setEventModalStep("basic");
    showFormError("preSaveWarning", "終了日時は開始日時より後にしてください");
    return showFieldError("eventEnd", "終了日時が開始日時より前です");
  }

  const memo = document.getElementById("eventMemo").value;
  const visibility = getCurrentFilterVisibility();
  const visibilityEl = document.getElementById("eventVisibility");
  if (visibilityEl) visibilityEl.value = visibility;
  document.getElementById("groupSelectWrap")?.classList.toggle("hidden", visibility !== "group");
  const allDay = document.getElementById("allDay").checked;

  if (!isNumberInRange("hpCost", 0, 100)) {
    setEventModalStep("details");
    showFormError("preSaveWarning", "HP消費率は0から100の範囲で入力してください");
    return showFieldError("hpCost", "0から100の範囲で入力してください");
  }

  if (!isNumberInRange("motivationCost", 0, 100)) {
    setEventModalStep("details");
    showFormError("preSaveWarning", "やる気消費率は0から100の範囲で入力してください");
    return showFieldError("motivationCost", "0から100の範囲で入力してください");
  }

  if (!isNumberInRange("customReminderMinutes", 1, 10080)) {
    setEventModalStep("details");
    showFormError("preSaveWarning", "カスタム通知は1分から10080分の範囲で入力してください");
    return showFieldError("customReminderMinutes", "1から10080分の範囲で入力してください");
  }

  const hp_consumption = readPercentInput("hpCost");
  const motivation_consumption = readPercentInput("motivationCost");
  const eventType = document.getElementById("eventType").value;

  const capacityCheck = preSaveCheck(start.substring(0, 10), hp_consumption, motivation_consumption, selectedEventId);
  if (!capacityCheck.canSave) {
    setEventModalStep("details");
    showFormError("preSaveWarning", capacityCheck.message);
    document.getElementById("preSaveWarning")?.scrollIntoView?.({ block: "center", behavior: "smooth" });
    return;
  }

  const reminderMinutes = collectEventReminderMinutes();
  const notifyAtStart = document.getElementById("remindStart")?.checked ?? true;
  const taskDeadlineNotify = document.getElementById("taskDeadlineNotify")?.checked ?? true;

  const mailReminderEnabled = document.getElementById("mailReminderEnabled")?.checked ?? false;
  const mailTo = document.getElementById("mailTo")?.value.trim() || "";
  const mailSubject = document.getElementById("mailSubject")?.value.trim() || "";
  const mailRemindAt = document.getElementById("mailRemindAt")?.value || "";
  const mailSent = document.getElementById("mailSent")?.checked ?? false;

  const eventGroupId = document.getElementById("eventGroupId").value;

  if (visibility === "group" && !eventGroupId) {
    setEventModalStep("details");
    showFormError("preSaveWarning", "グループ共有にする場合はグループを選択してください");
    return showFieldError("eventGroupId", "グループを選択してください");
  }

  if (eventType === "mail" && mailReminderEnabled && !mailRemindAt) {
    setEventModalStep("details");
    showFormError("preSaveWarning", "メール送信リマインドの通知日時を入力してください");
    return showFieldError("mailRemindAt", "通知日時を入力してください");
  }

  let calendar_id = undefined;
  if (visibility === "group" && eventGroupId) {
    try {
      const calendars = await apiRequest('/api/calendars');
      const matchedCal = calendars.find(c => c.group_id == eventGroupId);
      if (matchedCal) {
        calendar_id = matchedCal.id;
      }
    } catch (err) {
      console.error('Failed to fetch calendar for group:', err);
    }
  }

  const eventData = {
    calendar_id,
    title,
    location: "",
    allday: allDay,
    start,
    end,
    color: "#007AFF",
    memo,
    visibility,
    hp_consumption,
    motivation_consumption,
    eventType,
    reminderMinutes,
    notifyAtStart,
    taskDeadlineNotify,
    mailReminderEnabled,
    mailTo,
    mailSubject,
    mailRemindAt,
    mailSent
  };

  try {
    let savedEvent = null;
    const isEditing = !!selectedEventId;
    if (isEditing) {
      const data = await apiRequest(`/api/events/${selectedEventId}`, {
        method: 'PUT',
        body: JSON.stringify(eventData)
      });
      savedEvent = {
        ...eventData,
        ...(data.event || {}),
        id: selectedEventId,
        allDay,
        date: start.substring(0, 10)
      };
      showToast("予定を更新しました ✅");
    } else {
      const data = await apiRequest('/api/events', {
        method: 'POST',
        body: JSON.stringify(eventData)
      });
      savedEvent = {
        ...eventData,
        ...(data.event || {}),
        allDay,
        date: start.substring(0, 10)
      };
      showToast("予定を追加しました ✨");
    }

    updateLocalEventCache(savedEvent);
    removeActiveDraftAfterEventSave();
    closeModal();
    await syncEvents();
    await showHpMotivationRecalculation(savedEvent.start?.substring(0, 10) || start.substring(0, 10), isEditing ? "予定更新" : "予定追加");
  } catch (err) {
    console.error('Failed to save event:', err);
    showToast(err.message || "予定の保存に失敗しました");
  }
}

async function deleteEvent() {
  if (isReadOnlyCalendarMode()) {
    showReadOnlyCalendarWriteToast();
    return;
  }
  if (!selectedEventId) return;

  const result = confirm("予定を削除しますか？削除後は管理者画面から復元できます。");
  if (!result) return;

  try {
    const deletingEvent = getAllEvents().find(e => String(e.id) === String(selectedEventId));
    const recalculationDate = deletingEvent?.start?.substring(0, 10) || formatDate(currentDate);

    await apiRequest(`/api/events/${selectedEventId}`, {
      method: 'DELETE'
    });
    showToast("予定を削除しました 🗑️");
    closeModal();
    await syncEvents();
    await showHpMotivationRecalculation(recalculationDate, "予定削除");
  } catch (err) {
    console.error('Failed to delete event:', err);
    showToast(err.message || "予定の削除に失敗しました");
  }
}

// ----------------------------------------------------
// UI Navigation / Theme / Sidebar Actions
// ----------------------------------------------------
function toggleTheme() {
  document.body.classList.toggle("dark");
  localStorage.setItem("theme", document.body.classList.contains("dark"));
}

function restoreTheme() {
  const theme = localStorage.getItem("theme");
  if (theme === "true") {
    document.body.classList.add("dark");
  }
}

const sidebar = document.getElementById("sidebar");
const sidebarOverlay = document.getElementById("sidebarOverlay");

function closeSidebar() {
  sidebar.classList.remove("open");
  sidebarOverlay.classList.remove("show");
}

function closeMobileActionMenu() {
  const menu = document.getElementById("mobileActionMenu");
  const button = document.getElementById("mobileActionMenuBtn");
  if (menu) menu.classList.add("hidden");
  if (button) button.setAttribute("aria-expanded", "false");
}

function initMobileActionMenu() {
  const button = document.getElementById("mobileActionMenuBtn");
  const menu = document.getElementById("mobileActionMenu");
  if (!button || !menu) return;

  const actionTargets = {
    today: "todayBtn",
    list: "scheduleListBtn",
    draftList: "draftListBtn",
    clearDrafts: "clearDraftsToolbarBtn",
    group: "groupManageBtn",
    history: "notificationHistoryBtn",
    announcements: "adminAnnouncementsBtn",
    notificationSettings: "notificationSettingsBtn",
    ai: "aiScannerTrigger",
    theme: "themeBtn",
    account: "userAvatarBtn"
  };

  button.addEventListener("click", (event) => {
    event.stopPropagation();
    const willOpen = menu.classList.contains("hidden");
    menu.classList.toggle("hidden", !willOpen);
    button.setAttribute("aria-expanded", String(willOpen));
  });

  menu.querySelectorAll("[data-mobile-action]").forEach(item => {
    item.addEventListener("click", (event) => {
      event.stopPropagation();
      closeMobileActionMenu();
      const targetId = actionTargets[item.dataset.mobileAction];
      const target = targetId ? document.getElementById(targetId) : null;
      if (target) target.click();
    });
  });

  document.addEventListener("click", (event) => {
    if (!menu.classList.contains("hidden") && !event.target.closest(".mobile-action-menu")) {
      closeMobileActionMenu();
    }
  });

  window.addEventListener("resize", () => {
    if (window.innerWidth > 768) closeMobileActionMenu();
  });
}

// Swipe gestures
let touchStartX = 0;
let touchEndX = 0;

function handleSwipe() {
  const distance = touchEndX - touchStartX;
  if (distance < -80) {
    moveNext();
    syncEvents();
  }
  if (distance > 80) {
    movePrevious();
    syncEvents();
  }
}

function initSidebarNavigation() {
  const sidebarItems = document.querySelectorAll(".sidebar-item");
  sidebarItems.forEach(item => {
    item.addEventListener("click", () => {
      const panel = item.dataset.nav;
      switchPanel(panel);
    });
  });
}

function switchPanel(panel) {
  document.querySelectorAll(".sidebar-item").forEach(item => {
    item.classList.toggle("active", item.dataset.nav === panel);
  });

  const viewSwitch = document.querySelector(".view-switch");
  const weekHeader = document.getElementById("weekHeader");
  const filterBanner = document.getElementById("filterBanner");
  const statsPanel = document.getElementById("statsPanel");
  const adminPanel = document.getElementById("adminPanel");

  if (statsPanel) statsPanel.classList.add("hidden");
  if (adminPanel) adminPanel.classList.add("hidden");
  if (viewSwitch) viewSwitch.classList.remove("hidden");
  if (weekHeader) weekHeader.classList.remove("hidden");

  if (panel === "stats") {
    renderStatsPanel('week');
    if (viewSwitch) viewSwitch.classList.add("hidden");
    if (weekHeader) weekHeader.classList.add("hidden");
    if (filterBanner) filterBanner.classList.add("hidden");

    document.getElementById("monthView").classList.add("hidden");
    document.getElementById("weekView").classList.add("hidden");
    document.getElementById("dayView").classList.add("hidden");

    if (statsPanel) statsPanel.classList.remove("hidden");
    closeSidebar();
    return;
  }

  if (panel === "settings") {
    openNotificationSettingsModal();
    closeSidebar();
    return;
  }

  if (panel === "announcements") {
    openAdminAnnouncementsModal();
    closeSidebar();
    return;
  }


  if (panel === "admin") {
    closeSidebar();
    window.location.href = "/admin";
    return;
  }

  import('./calendar-state.js').then(state => {
    if (panel === "calendar") {
      state.setCurrentFilter("all");
      document.getElementById("addEventBtn")?.classList.add("hidden");
      if (filterBanner) filterBanner.classList.add("hidden");
    } else if (panel === "group") {
      state.setCurrentFilter("group");
      document.getElementById("addEventBtn")?.classList.remove("hidden");
      if (filterBanner) {
        filterBanner.textContent = "グループ予定を表示中";
        filterBanner.classList.remove("hidden");
      }
    } else if (panel === "private") {
      state.setCurrentFilter("private");
      document.getElementById("addEventBtn")?.classList.remove("hidden");
      if (filterBanner) {
        filterBanner.textContent = "個人予定を表示中";
        filterBanner.classList.remove("hidden");
      }
    }

    const curView = state.currentView;
    document.getElementById("monthView").classList.toggle("hidden", curView !== "month");
    document.getElementById("weekView").classList.toggle("hidden", curView !== "week");
    document.getElementById("dayView").classList.toggle("hidden", curView !== "day");

    refreshCalendar();
    closeSidebar();
  });
}

function renderStatsPanel(range) {
  import('./calendar-hp-motivation.js').then(m => {
    m.renderStatsPanel(range);
  });
}

// ----------------------------------------------------
// Initialization
// ----------------------------------------------------
async function init() {
  restoreTheme();

  if (isLoggedIn()) {
    await syncEvents();
    await syncGroups();
    await syncNotificationSettings();
    updateAdminNavVisibility();
    startNotificationWatcher();
    startAdminAnnouncementWatcher();
    startAdminAdWatcher();
  }

  switchView("month");
}

// ----------------------------------------------------
// Event Listeners Binding
// ----------------------------------------------------
document.addEventListener("DOMContentLoaded", () => {
  document.addEventListener("input", (event) => {
    if (event.target?.classList?.contains("field-invalid")) {
      clearFieldError(event.target);
    }
  });

  document.addEventListener("change", (event) => {
    if (event.target?.classList?.contains("field-invalid")) {
      clearFieldError(event.target);
    }
  });

  document.addEventListener("event-form:draft-detached", () => {
    activeDraftId = null;
  });

  // Save / Delete / Close Modals
  document.getElementById("saveEventBtn").addEventListener("click", saveEvent);
  document.getElementById("deleteEventBtn").addEventListener("click", deleteEvent);
  document.getElementById("closeModalBtn").addEventListener("click", closeModal);
  document.getElementById("saveDraftEventBtn")?.addEventListener("click", saveEventDraft);
  document.getElementById("draftListBtn")?.addEventListener("click", () => loadEventDraft());
  document.getElementById("clearDraftsToolbarBtn")?.addEventListener("click", () => openDraftListModal("delete"));
  document.getElementById("eventStepBasicTab")?.addEventListener("click", () => setEventModalStep("basic"));
  document.getElementById("eventStepDetailsTab")?.addEventListener("click", () => {
    setEventModalStep("details");
    updatePreSavePreview();
  });
  document.getElementById("closeDraftListBtn")?.addEventListener("click", closeDraftListModal);
  document.getElementById("clearAllDraftsBtn")?.addEventListener("click", clearEventDraft);

  // Outer click to close modals
  [
    { id: "eventModal", close: closeModal },
    { id: "draftListModal", close: closeDraftListModal },
    { id: "listModal", close: closeListModal },
    { id: "groupModal", close: closeGroupModal },
    { id: "notificationHistoryModal", close: closeNotificationHistoryModal },
    { id: "adminAnnouncementsModal", close: closeAdminAnnouncementsModal },
    { id: "notificationSettingsModal", close: closeNotificationSettingsModal },
    { id: "yearJumpModal", close: closeYearJumpModal }
  ].forEach(m => {
    const el = document.getElementById(m.id);
    if (el) {
      el.addEventListener("click", (e) => {
        if (e.target === el) m.close();
      });
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeModal();
      closeDraftListModal();
      closeSidebar();
      closeListModal();
      closeGroupModal();
      closeNotificationHistoryModal();
      closeAdminAnnouncementsModal();
      closeNotificationSettingsModal();
      closeYearJumpModal();
      closeAdminPanel();
      closeMobileActionMenu();
    }
  });

  document.getElementById("currentTitle")?.addEventListener("click", openYearJumpModal);
  document.getElementById("closeYearJumpBtn")?.addEventListener("click", closeYearJumpModal);
  document.getElementById("applyYearJumpBtn")?.addEventListener("click", () => {
    if (applyYearJump()) syncEvents();
  });

  // Main navigation buttons
  document.getElementById("prevBtn").addEventListener("click", () => {
    movePrevious();
    syncEvents();
  });
  document.getElementById("nextBtn").addEventListener("click", () => {
    moveNext();
    syncEvents();
  });

  const todayBtn = document.getElementById("todayBtn");
  if (todayBtn) {
    todayBtn.addEventListener("click", () => {
      import('./calendar-state.js').then(m => {
        m.setCurrentDate(new Date());
        refreshCurrentView();
        syncEvents();
      });
    });
  }

  // Bind view switchers
  document.getElementById("monthViewBtn").addEventListener("click", () => switchView("month"));
  document.getElementById("weekViewBtn").addEventListener("click", () => switchView("week"));
  document.getElementById("dayViewBtn").addEventListener("click", () => switchView("day"));

  // Theme Toggle
  document.getElementById("themeBtn").addEventListener("click", toggleTheme);

  // Sidebar controls
  document.getElementById("menuBtn").addEventListener("click", () => {
    sidebar.classList.add("open");
    sidebarOverlay.classList.add("show");
  });
  sidebarOverlay.addEventListener("click", closeSidebar);

  // Swipe handlers
  const swipeViews = [monthView, weekView, dayView];
  swipeViews.forEach(view => {
    if (view) {
      view.addEventListener("touchstart", (e) => {
        touchStartX = e.changedTouches[0].screenX;
      });
      view.addEventListener("touchend", (e) => {
        touchEndX = e.changedTouches[0].screenX;
        handleSwipe();
      });
    }
  });

  // Add Event Button (FAB)
  document.getElementById("addEventBtn").addEventListener("click", () => {
    const todayStr = formatDate(currentDate);
    openCreateEvent(todayStr);
  });

  // Schedule List Modal triggers
  document.getElementById("scheduleListBtn").addEventListener("click", () => {
    openListModal();
    renderScheduleList("month");
  });
  document.getElementById("closeListBtn").addEventListener("click", closeListModal);


  document.querySelectorAll(".list-mode button").forEach((btn) => {
    btn.addEventListener("click", () => {
      const mode = btn.dataset.filter;
      renderScheduleList(mode);
    });
  });

  // AI Assistant trigger actions
  const aiScannerTrigger = document.getElementById("aiScannerTrigger");
  if (aiScannerTrigger) aiScannerTrigger.addEventListener("click", openScannerSheet);

  const closeScannerBtn = document.getElementById("closeScannerBtn");
  if (closeScannerBtn) closeScannerBtn.addEventListener("click", closeScannerSheet);

  const scannerBackdropEl = document.getElementById("scannerBackdrop");
  if (scannerBackdropEl) scannerBackdropEl.addEventListener("click", closeScannerSheet);

  const clearChatBtn = document.getElementById("clearChatBtn");
  if (clearChatBtn) {
    clearChatBtn.addEventListener("click", () => {
      const chatMessagesContainer = document.getElementById("chatMessagesContainer");
      if (chatMessagesContainer) chatMessagesContainer.innerHTML = "";
      setCurrentAttachments([]);
      renderAttachmentsCarousel();
      const aiChatInput = document.getElementById("aiChatInput");
      if (aiChatInput) {
        aiChatInput.value = "";
        aiChatInput.style.height = "auto";
      }
      validateSendButton();
      showToast("会話履歴をクリアしました 🧹");
    });
  }

  const aiChatInputEl = document.getElementById("aiChatInput");
  if (aiChatInputEl) {
    aiChatInputEl.addEventListener("input", () => {
      aiChatInputEl.style.height = "auto";
      aiChatInputEl.style.height = aiChatInputEl.scrollHeight + "px";
      validateSendButton();
    });
  }

  const aiPlusBtn = document.getElementById("aiPlusBtn");
  if (aiPlusBtn) aiPlusBtn.addEventListener("click", showActionSheet);

  const actionSheetBackdropEl = document.getElementById("actionSheetBackdrop");
  if (actionSheetBackdropEl) actionSheetBackdropEl.addEventListener("click", hideActionSheet);

  const actionCancelBtn = document.getElementById("actionCancelBtn");
  if (actionCancelBtn) actionCancelBtn.addEventListener("click", hideActionSheet);

  const cameraTriggerBtn = document.getElementById("cameraTriggerBtn");
  if (cameraTriggerBtn) {
    cameraTriggerBtn.addEventListener("click", () => {
      hideActionSheet();
      openCameraModal();
    });
  }

  const closeCameraModalBtnEl = document.getElementById("closeCameraModalBtn");
  if (closeCameraModalBtnEl) {
    closeCameraModalBtnEl.addEventListener("click", closeCameraModal);
  }

  const shutterBtnEl = document.getElementById("shutterBtn");
  if (shutterBtnEl) {
    shutterBtnEl.addEventListener("click", capturePhotoFromCamera);
  }

  const galleryInput = document.getElementById("galleryInput");
  if (galleryInput) {
    galleryInput.addEventListener("change", (e) => {
      hideActionSheet();
      handleFileAttachment(e);
    });
  }

  const aiSendBtnEl = document.getElementById("aiSendBtn");
  if (aiSendBtnEl) aiSendBtnEl.addEventListener("click", sendChatToGemini);

  const closeAiSummary = document.getElementById("closeAiSummary");
  if (closeAiSummary) {
    closeAiSummary.addEventListener("click", () => {
      const aiSummaryContainer = document.getElementById("aiSummaryContainer");
      if (aiSummaryContainer) aiSummaryContainer.classList.add("hidden");
    });
  }

  // Group modal triggers
  document.getElementById("groupManageBtn").addEventListener("click", openGroupModal);
  document.getElementById("closeGroupBtn").addEventListener("click", closeGroupModal);
  document.getElementById("createGroupBtn").addEventListener("click", createGroup);
  document.getElementById("inviteMemberBtn").addEventListener("click", inviteMember);
  document.getElementById("dissolveGroupBtn").addEventListener("click", dissolveGroup);
  document.getElementById("leaveGroupBtn").addEventListener("click", leaveGroup);

  // Notification history modal triggers
  document.getElementById("notificationHistoryBtn").addEventListener("click", openNotificationHistoryModal);
  document.getElementById("closeNotificationHistoryBtn").addEventListener("click", closeNotificationHistoryModal);
  document.getElementById("clearNotificationHistoryBtn").addEventListener("click", clearNotificationHistory);

  // Admin announcements modal triggers
  document.getElementById("adminAnnouncementsBtn").addEventListener("click", openAdminAnnouncementsModal);
  document.getElementById("closeAdminAnnouncementsBtn").addEventListener("click", closeAdminAnnouncementsModal);
  document.getElementById("reloadAdminAnnouncementsBtn").addEventListener("click", () => {
    syncAdminAnnouncements({ silent: true });
  });

  // Notification settings modal triggers
  document.getElementById("notificationSettingsBtn").addEventListener("click", openNotificationSettingsModal);
  document.getElementById("closeNotificationSettingsBtn").addEventListener("click", closeNotificationSettingsModal);
  document.getElementById("saveNotificationSettingsBtn").addEventListener("click", saveNotificationSettingsFromForm);

  // Modals features logic
  document.getElementById("eventType").addEventListener("change", updateEventOptionVisibility);
  document.getElementById("allDay")?.addEventListener("change", () => {
    updateAllDayDateTimeVisibility({ normalize: true });
    updatePreSavePreview();
  });

  // HP Cost & Motivation Cost previews
  document.getElementById("hpCost").addEventListener("input", updatePreSavePreview);
  document.getElementById("motivationCost").addEventListener("input", updatePreSavePreview);
  document.getElementById("eventStart").addEventListener("change", (event) => {
    updatePreSavePreview();
    const dateStr = event.target.value.substring(0, 10);
    if (dateStr) showRestSuggestions(dateStr);
  });

  // Visibility select -> show/hide group dropdown
  document.getElementById("eventVisibility").addEventListener("change", (e) => {
    const forcedVisibility = getCurrentFilterVisibility();
    if (e.target.value !== forcedVisibility) {
      e.target.value = forcedVisibility;
    }
    const isGroup = forcedVisibility === "group";
    document.getElementById("groupSelectWrap").classList.toggle("hidden", !isGroup);
  });

  document.getElementById("addSettingsCustomReminderBtn")?.addEventListener("click", addSettingsCustomReminderFromInput);
  document.getElementById("settingsCustomReminderMinutes")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      addSettingsCustomReminderFromInput();
    }
  });

  // Notification Settings Form Events
  ["settingsRemind30", "settingsRemind5", "settingsRemindStart", "settingsCustomReminderMinutes"].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener(id.includes("Custom") ? "input" : "change", renderSettingsReminderList);
    }
  });

  document.getElementById("addCustomReminderBtn")?.addEventListener("click", addEventCustomReminderFromInput);
  document.getElementById("customReminderMinutes")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      addEventCustomReminderFromInput();
    }
  });

  // Event modal reminder list triggers
  ["remind30", "remind5", "remindStart", "customReminderMinutes"].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener(id.includes("custom") ? "input" : "change", renderEventReminderList);
    }
  });

  // Show HP motivation toggle check
  const hpCheckbox = document.getElementById("showHpMotivation");
  if (hpCheckbox) {
    const saved = localStorage.getItem("show_hp_motivation") === "true";
    hpCheckbox.checked = saved;
    const gauges = document.getElementById("headerGauges");
    if (gauges) gauges.classList.toggle("hidden", !saved);

    hpCheckbox.addEventListener("change", (e) => {
      const show = e.target.checked;
      localStorage.setItem("show_hp_motivation", String(show));
      if (gauges) gauges.classList.toggle("hidden", !show);
      refreshCalendar();
    });
  }

  // -- Auth integration --
  initAuthForm();
  initAccountPanel();
  initPasswordResetModal();
  initAccountSettings();
  initAdminUI();
  initSidebarNavigation();
  initMobileActionMenu();

  const userAvatarBtn = document.getElementById("userAvatarBtn");
  if (userAvatarBtn) {
    userAvatarBtn.addEventListener("click", () => {
      sidebar.classList.add("open");
      sidebarOverlay.classList.add("show");
    });
  }

  // Listen for successful login -> sync & start watchers
  document.addEventListener("auth:loggedin", async () => {
    await syncEvents();
    await syncGroups();
    await syncNotificationSettings();
    updateAdminNavVisibility();
    startNotificationWatcher();
    startAdminAnnouncementWatcher();
    startAdminAdWatcher();
  });

  document.addEventListener("auth:user-updated", () => {
    updateAdminNavVisibility();
    const adminNav = document.querySelector('[data-nav="admin"]');
    if (adminNav?.classList.contains("hidden")) {
      closeAdminPanel();
      if (adminNav.classList.contains("active")) {
        switchPanel("calendar");
      }
    }
  });
});

// Run Init (with auth check)
checkAuth().then(ok => {
  init();
});
