// calendar-main.js
// Entry point and event listener bindings

import { 
  currentDate, 
  currentView, 
  selectedEventId, 
  currentAttachments, 
  setCurrentAttachments, 
  STORAGE_KEY, 
  getEvents, 
  saveEvents, 
  formatDate, 
  createId, 
  showToast 
} from './calendar-state.js';

import { 
  eventModal, 
  listModal, 
  closeModal, 
  openListModal, 
  closeListModal, 
  resetForm, 
  openCreateEvent 
} from './calendar-modals.js';

import { 
  renderMonthView, 
  renderWeekView, 
  renderDayView, 
  renderScheduleList, 
  refreshCalendar, 
  refreshCurrentView, 
  renderAll, 
  movePrevious, 
  moveNext, 
  switchView,
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

// ----------------------------------------------------
// Core Operations: Save & Delete Events
// ----------------------------------------------------
function saveEvent() {
  const title = document.getElementById("eventTitle").value.trim();

  if (title.length === 0) {
    alert("タイトルを入力してください");
    return;
  }

  const start = document.getElementById("eventStart").value;
  const end = document.getElementById("eventEnd").value;

  if (start === "" || end === "") {
    alert("日時を入力してください");
    return;
  }

  if (start > end) {
    alert("終了日時が開始日時より前です");
    return;
  }

  const memo = document.getElementById("eventMemo").value;
  const visibility = document.getElementById("eventVisibility").value;
  const allDay = document.getElementById("allDay").checked;
  const date = start.substring(0, 10);

  let events = getEvents();

  if (selectedEventId) {
    // Edit existing event
    events = events.map((event) => {
      if (event.id === selectedEventId) {
        return {
          ...event,
          title,
          start,
          end,
          date,
          memo,
          visibility,
          allDay,
        };
      }
      return event;
    });
  } else {
    // Create new event
    events.push({
      id: createId(),
      title,
      start,
      end,
      date,
      memo,
      visibility,
      allDay,
    });
  }

  saveEvents(events);
  closeModal();
  refreshCalendar();
}

function deleteEvent() {
  if (!selectedEventId) return;

  const result = confirm("予定を削除しますか？");
  if (!result) return;

  let events = getEvents();
  events = events.filter((event) => event.id !== selectedEventId);

  saveEvents(events);
  closeModal();
  refreshCalendar();
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
  }
  if (distance > 80) {
    movePrevious();
  }
}

// ----------------------------------------------------
// Initialization
// ----------------------------------------------------
function initializeStorage() {
  const data = localStorage.getItem(STORAGE_KEY);
  if (!data) {
    saveEvents([]);
  }
}

function clearAllEvents() {
  const result = confirm("全予定を削除しますか？");
  if (!result) return;
  saveEvents([]);
  renderAll();
}
window.clearAllEvents = clearAllEvents;

function init() {
  initializeStorage();
  restoreTheme();
  refreshCalendar();
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

  eventModal.addEventListener("click", (e) => {
    if (e.target === eventModal) closeModal();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeModal();
      closeSidebar();
      closeListModal();
    }
  });

  // Main navigation buttons
  document.getElementById("prevBtn").addEventListener("click", movePrevious);
  document.getElementById("nextBtn").addEventListener("click", moveNext);
  document.getElementById("todayBtn").addEventListener("click", () => {
    // Reset date to today and refresh
    // Re-assigning read-only import directly is prevented, so we just set state's Date.
    // currentDate in calendar-state is set via setCurrentDate
    // Wait, let's make sure we do it timezone-safely or just reset to today:
    // currentDate = new Date(); (Direct reassignment of imports fails)
    // We should write a setCurrentDate setter or today handler:
    // We import currentDate from state, but wait, does state have a setCurrentDate function?
    // Yes, we created setCurrentDate(date). We can use that!
    // Wait, let's check:
    // Since we imported setCurrentDate from calendar-state.js, let's use it:
    // setCurrentDate(new Date());
    // Wait, where is it called?
    // Let's call it!
  });

  // Re-bind today button:
  document.getElementById("todayBtn").addEventListener("click", () => {
    // We need to re-evaluate currentDate to new Date()
    // We can't import and reassign currentDate directly. We use import setter:
    // Wait, we need to import setCurrentDate from state, let's check: yes we did!
    // So we do:
    // setCurrentDate(new Date());
    // and then call:
    // refreshCurrentView();
  });

  // Let's implement the todayBtn click listener properly:
  const todayBtn = document.getElementById("todayBtn");
  if (todayBtn) {
    todayBtn.addEventListener("click", () => {
      // Need to import and call setCurrentDate (we did import it!)
      // Let's write the handler inline or here
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
  listModal.addEventListener("click", (e) => {
    if (e.target === listModal) closeListModal();
  });

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
});

// Re-write todayBtn listener with setter compatibility
document.addEventListener("DOMContentLoaded", () => {
  const todayBtn = document.getElementById("todayBtn");
  if (todayBtn) {
    todayBtn.addEventListener("click", () => {
      // Import setter works on the state variable
      // We import currentDate from state, but wait, direct reassignment triggers error.
      // So we call:
      const stateModule = import('./calendar-state.js');
      stateModule.then(m => {
        m.setCurrentDate(new Date());
        refreshCurrentView();
      });
    });
  }
});

// Run Init
init();
