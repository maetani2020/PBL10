// calendar-main.js
// Entry point and event listener bindings

import {
  currentDate,
  currentView,
  selectedEventId,
  currentAttachments,
  setCurrentAttachments,
  formatDate,
  showToast
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
  closeModal,
  openListModal,
  closeListModal,
  resetForm,
  openCreateEvent,
  collectEventReminderMinutes,
  renderEventReminderList,
  updateEventOptionVisibility
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
  openNotificationSettingsModal,
  closeNotificationSettingsModal,
  saveNotificationSettingsFromForm,
  renderSettingsReminderList,
  startNotificationWatcher,
  syncNotificationSettings
} from './calendar-notification.js';

import {
  syncHpMotivationStatus,
  updatePreSavePreview,
  openCalendarSettingsModal,
  closeCalendarSettingsModal,
  saveCalendarSettings
} from './calendar-hp-motivation.js';



import {
  initAdminUI,
  updateAdminNavVisibility,
  openAdminPanel,
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
    customReminderMinutes: document.getElementById("customReminderMinutes")?.value || "",
    taskDeadlineNotify: getChecked("taskDeadlineNotify", true),
    mailReminderEnabled: getChecked("mailReminderEnabled"),
    mailTo: document.getElementById("mailTo")?.value || "",
    mailSubject: document.getElementById("mailSubject")?.value || "",
    mailRemindAt: document.getElementById("mailRemindAt")?.value || "",
    mailSent: getChecked("mailSent")
  };
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
  setChecked("remind30", draft.remind30 ?? true);
  setChecked("remind5", draft.remind5 ?? true);
  setChecked("remindStart", draft.remindStart ?? true);
  setValue("customReminderMinutes", draft.customReminderMinutes);
  setChecked("taskDeadlineNotify", draft.taskDeadlineNotify ?? true);
  setChecked("mailReminderEnabled", draft.mailReminderEnabled);
  setValue("mailTo", draft.mailTo);
  setValue("mailSubject", draft.mailSubject);
  setValue("mailRemindAt", draft.mailRemindAt);
  setChecked("mailSent", draft.mailSent);

  updateEventOptionVisibility();
  renderEventReminderList();
  const isGroup = (draft.visibility || "public") === "group";
  document.getElementById("groupSelectWrap")?.classList.toggle("hidden", !isGroup);
  updatePreSavePreview();
}

function saveEventDraft() {
  localStorage.setItem(EVENT_DRAFT_STORAGE_KEY, JSON.stringify(collectEventDraftData()));
  showToast("下書きを保存しました");
}

function loadEventDraft() {
  const raw = localStorage.getItem(EVENT_DRAFT_STORAGE_KEY);
  if (!raw) {
    showToast("保存されている下書きはありません");
    return;
  }

  try {
    applyEventDraftData(JSON.parse(raw));
    showToast("下書きを読み込みました");
  } catch (err) {
    console.error("Failed to load event draft:", err);
    showToast("下書きの読み込みに失敗しました");
  }
}

function clearEventDraft() {
  localStorage.removeItem(EVENT_DRAFT_STORAGE_KEY);
  showToast("下書きを削除しました");
}

    async function saveEvent() {
  const title = document.getElementById("eventTitle").value.trim();

  if (title.length === 0) {
    showToast("タイトルを入力してください ⚠️");
    return;
  }

  const start = document.getElementById("eventStart").value;
  const end = document.getElementById("eventEnd").value;

  if (start === "" || end === "") {
    showToast("日時を入力してください ⚠️");
    return;
  }

  if (start > end) {
    showToast("終了日時が開始日時より前です ⚠️");
    return;
  }

  const memo = document.getElementById("eventMemo").value;
  const visibility = document.getElementById("eventVisibility").value;
  const allDay = document.getElementById("allDay").checked;
  const hp_consumption = readPercentInput("hpCost");
  const motivation_consumption = readPercentInput("motivationCost");
  const eventType = document.getElementById("eventType").value;

  const reminderMinutes = collectEventReminderMinutes();
  const notifyAtStart = document.getElementById("remindStart")?.checked ?? true;
  const taskDeadlineNotify = document.getElementById("taskDeadlineNotify")?.checked ?? true;

  const mailReminderEnabled = document.getElementById("mailReminderEnabled")?.checked ?? false;
  const mailTo = document.getElementById("mailTo")?.value.trim() || "";
  const mailSubject = document.getElementById("mailSubject")?.value.trim() || "";
  const mailRemindAt = document.getElementById("mailRemindAt")?.value || "";
  const mailSent = document.getElementById("mailSent")?.checked ?? false;

  const eventGroupId = document.getElementById("eventGroupId").value;

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
    if (selectedEventId) {
      await apiRequest(`/api/events/${selectedEventId}`, {
        method: 'PUT',
        body: JSON.stringify(eventData)
      });
      showToast("予定を更新しました ✅");
    } else {
      await apiRequest('/api/events', {
        method: 'POST',
        body: JSON.stringify(eventData)
      });
      showToast("予定を追加しました ✨");
    }

    closeModal();
    await syncEvents();
  } catch (err) {
    console.error('Failed to save event:', err);
  }
}

async function deleteEvent() {
  if (!selectedEventId) return;

  const result = confirm("予定を削除しますか？");
  if (!result) return;

  try {
    await apiRequest(`/api/events/${selectedEventId}`, {
      method: 'DELETE'
    });
    showToast("予定を削除しました 🗑️");
    closeModal();
    await syncEvents();
  } catch (err) {
    console.error('Failed to delete event:', err);
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
    openCalendarSettingsModal();
    closeSidebar();
    return;
  }


  if (panel === "admin") {
    const opened = openAdminPanel();
    if (opened) {
      if (viewSwitch) viewSwitch.classList.add("hidden");
      if (weekHeader) weekHeader.classList.add("hidden");
      if (filterBanner) filterBanner.classList.add("hidden");
      document.getElementById("monthView").classList.add("hidden");
      document.getElementById("weekView").classList.add("hidden");
      document.getElementById("dayView").classList.add("hidden");
    }
    closeSidebar();
    return;
  }

  import('./calendar-state.js').then(state => {
    if (panel === "calendar") {
      state.setCurrentFilter("all");
      if (filterBanner) filterBanner.classList.add("hidden");
    } else if (panel === "group") {
      state.setCurrentFilter("group");
      if (filterBanner) {
        filterBanner.textContent = "グループ予定を表示中";
        filterBanner.classList.remove("hidden");
      }
    } else if (panel === "private") {
      state.setCurrentFilter("private");
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
  }

  switchView("month");
}

// ----------------------------------------------------
// Event Listeners Binding
// ----------------------------------------------------
document.addEventListener("DOMContentLoaded", () => {
  // Save / Delete / Close Modals
  document.getElementById("saveEventBtn").addEventListener("click", saveEvent);
  document.getElementById("deleteEventBtn").addEventListener("click", deleteEvent);
  document.getElementById("closeModalBtn").addEventListener("click", closeModal);
  document.getElementById("saveDraftEventBtn")?.addEventListener("click", saveEventDraft);
  document.getElementById("loadDraftEventBtn")?.addEventListener("click", loadEventDraft);
  document.getElementById("clearDraftEventBtn")?.addEventListener("click", clearEventDraft);

  // Outer click to close modals
  [
    { id: "eventModal", close: closeModal },
    { id: "listModal", close: closeListModal },
    { id: "groupModal", close: closeGroupModal },
    { id: "notificationHistoryModal", close: closeNotificationHistoryModal },
    { id: "notificationSettingsModal", close: closeNotificationSettingsModal },
    { id: "calendarSettingsModal", close: closeCalendarSettingsModal },
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
      closeSidebar();
      closeListModal();
      closeGroupModal();
      closeNotificationHistoryModal();
      closeNotificationSettingsModal();
      closeCalendarSettingsModal();
      closeYearJumpModal();
      closeAdminPanel();
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

  // Notification settings modal triggers
  document.getElementById("notificationSettingsBtn").addEventListener("click", openNotificationSettingsModal);
  document.getElementById("closeNotificationSettingsBtn").addEventListener("click", closeNotificationSettingsModal);
  document.getElementById("saveNotificationSettingsBtn").addEventListener("click", saveNotificationSettingsFromForm);

  // Calendar settings modal triggers
  document.getElementById("saveCalendarSettingsBtn").addEventListener("click", saveCalendarSettings);
  document.getElementById("closeCalendarSettingsBtn").addEventListener("click", closeCalendarSettingsModal);

  // Modals features logic
  document.getElementById("eventType").addEventListener("change", updateEventOptionVisibility);

  // HP Cost & Motivation Cost previews
  document.getElementById("hpCost").addEventListener("input", updatePreSavePreview);
  document.getElementById("motivationCost").addEventListener("input", updatePreSavePreview);
  document.getElementById("eventStart").addEventListener("change", updatePreSavePreview);

  // Visibility select -> show/hide group dropdown
  document.getElementById("eventVisibility").addEventListener("change", (e) => {
    const isGroup = e.target.value === "group";
    document.getElementById("groupSelectWrap").classList.toggle("hidden", !isGroup);
  });

  // Notification Settings Form Events
  ["settingsRemind30", "settingsRemind5", "settingsRemindStart", "settingsCustomReminderMinutes"].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener(id.includes("Custom") ? "input" : "change", renderSettingsReminderList);
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
  });
});

// Run Init (with auth check)
checkAuth().then(ok => {
  init();
});
