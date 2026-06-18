/* ==========================================
   Shared Calendar v2
   calendar.js
   Part1
========================================== */

// ==========================================
// グローバル変数
// ==========================================

let currentDate = new Date();
let currentView = "month";
let selectedEventId = null;

// ==========================================
// LocalStorageキー
// ==========================================

const STORAGE_KEY = "shared_calendar_events";

// ==========================================
// DOM取得
// ==========================================

const monthView = document.getElementById("monthView");

const weekView = document.getElementById("weekView");

const dayView = document.getElementById("dayView");

const currentTitle = document.getElementById("currentTitle");

const eventModal = document.getElementById("eventModal");

const listModal = document.getElementById("listModal");

// ==========================================
// イベント取得
// ==========================================

function getEvents() {
  return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
}

// ==========================================
// イベント保存
// ==========================================

function saveEvents(events) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(events));
}

// ==========================================
// 日付文字列生成
// YYYY-MM-DD
// ==========================================

function formatDate(date) {
  const y = date.getFullYear();

  const m = String(date.getMonth() + 1).padStart(2, "0");

  const d = String(date.getDate()).padStart(2, "0");

  return `${y}-${m}-${d}`;
}

// ==========================================
// タイトル更新
// ==========================================

function updateTitle() {
  const year = currentDate.getFullYear();

  const month = currentDate.getMonth() + 1;

  if (currentView === "month") {
    currentTitle.textContent = `${year}年${month}月`;
  } else if (currentView === "week") {
    currentTitle.textContent = "週表示";
  } else {
    currentTitle.textContent = formatDate(currentDate);
  }
}

// ==========================================
// 今日判定
// ==========================================

function isToday(year, month, day) {
  const now = new Date();

  return (
    year === now.getFullYear() &&
    month === now.getMonth() &&
    day === now.getDate()
  );
}

// ==========================================
// UUID生成
// ==========================================

function createId() {
  return Date.now() + Math.floor(Math.random() * 10000);
}

// ==========================================
// モーダルを開く
// ==========================================

function openModal() {
  eventModal.style.display = "flex";
}

// ==========================================
// モーダルを閉じる
// ==========================================

function closeModal() {
  eventModal.style.display = "none";
}

// ==========================================
// 一覧モーダル
// ==========================================

function openListModal() {
  listModal.style.display = "flex";
}

function closeListModal() {
  listModal.style.display = "none";
}

// ==========================================
// 入力リセット
// ==========================================

function resetForm() {
  selectedEventId = null;

  document.getElementById("eventTitle").value = "";

  document.getElementById("eventMemo").value = "";

  document.getElementById("eventVisibility").value = "public";

  document.getElementById("allDay").checked = false;
}

// ==========================================
// 新規予定登録
// ==========================================

function openCreateEvent(dateStr) {
  resetForm();

  document.getElementById("eventStart").value = dateStr + "T09:00";

  document.getElementById("eventEnd").value = dateStr + "T10:00";

  openModal();
}

function openCreateEventWithTime(dateStr, hour) {
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

// ==========================================
// 編集モード
// ==========================================

function openEditEvent(event) {
  selectedEventId = event.id;

  document.getElementById("eventTitle").value = event.title;

  document.getElementById("eventMemo").value = event.memo || "";

  document.getElementById("eventStart").value = event.start;

  document.getElementById("eventEnd").value = event.end;

  document.getElementById("eventVisibility").value = event.visibility;

  document.getElementById("allDay").checked = event.allDay;

  openModal();
}
/* ==========================================
   Part2
   月表示描画
========================================== */

// ==========================================
// 月表示描画
// ==========================================

function renderMonthView() {
  monthView.innerHTML = "";

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);

  const startWeek = firstDay.getDay();
  const totalDays = lastDay.getDate();

  const prevMonthLastDay = new Date(year, month, 0).getDate();

  const events = getEvents();

  // 前月
  for (let i = startWeek - 1; i >= 0; i--) {
    const cell = document.createElement("div");

    cell.className = "day-cell other-month";

    cell.innerHTML = `
  <div class="day-number">
    ${prevMonthLastDay - i}
  </div>
`;

    monthView.appendChild(cell);
  }

  // 当月
  for (let day = 1; day <= totalDays; day++) {
    const cell = document.createElement("div");

    cell.classList.add("day-cell");

    const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

    const weekday = new Date(year, month, day).getDay();

    if (weekday === 0) cell.classList.add("sunday");
    if (weekday === 6) cell.classList.add("saturday");

    if (isToday(year, month, day)) {
      cell.classList.add("today");
    }

    const dayNumber = document.createElement("div");
    dayNumber.className = "day-number";
    dayNumber.textContent = day;

    cell.appendChild(dayNumber);

    const dayEvents = events.filter((event) => event.date === dateStr);

    dayEvents.forEach((event) => {
      const eventDiv = document.createElement("div");

      eventDiv.className = `event ${event.visibility}`;

      eventDiv.textContent = event.allDay ? "📌 " + event.title : event.title;

      eventDiv.addEventListener("click", (e) => {
        e.stopPropagation();
        openEditEvent(event);
      });

      cell.appendChild(eventDiv);
    });

    cell.addEventListener("click", () => {
      openCreateEvent(dateStr);
    });

    monthView.appendChild(cell);
  }

  // 翌月（必要な週だけ）
  const totalCells = startWeek + totalDays;
  const weekRows = Math.ceil(totalCells / 7);
  const targetCells = weekRows * 7;

  const nextDays = targetCells - totalCells;

  for (let i = 1; i <= nextDays; i++) {
    const cell = document.createElement("div");

    cell.className = "day-cell other-month";

    cell.innerHTML = `
  <div class="day-number">${i}</div>
`;

    monthView.appendChild(cell);
  }
}

// ==========================================
// カレンダー再描画
// ==========================================

function refreshCalendar() {
  updateTitle();

  if (currentView === "month") {
    renderMonthView();
  } else if (currentView === "week") {
    renderWeekView();
  } else if (currentView === "day") {
    renderDayView();
  }
}

// ==========================================
// 初期描画用
// ==========================================

refreshCalendar();
/* ==========================================
   Part3
   CRUD（追加・編集・削除）
========================================== */

// ==========================================
// 保存ボタン
// ==========================================

document.getElementById("saveEventBtn").addEventListener("click", saveEvent);

// ==========================================
// 予定保存
// ==========================================

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

  // ----------------------
  // 編集
  // ----------------------

  if (selectedEventId) {
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
  }

  // ----------------------
  // 新規
  // ----------------------
  else {
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

// ==========================================
// 削除
// ==========================================

document
  .getElementById("deleteEventBtn")
  .addEventListener("click", deleteEvent);

function deleteEvent() {
  if (!selectedEventId) {
    return;
  }

  const result = confirm("予定を削除しますか？");

  if (!result) {
    return;
  }

  let events = getEvents();

  events = events.filter((event) => event.id !== selectedEventId);

  saveEvents(events);

  closeModal();

  refreshCalendar();
}

// ==========================================
// モーダル閉じる
// ==========================================

document.getElementById("closeModalBtn").addEventListener("click", closeModal);

// ==========================================
// モーダル外クリック
// ==========================================

eventModal.addEventListener("click", (e) => {
  if (e.target === eventModal) {
    closeModal();
  }
});

// ==========================================
// ESCキー
// ==========================================

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    closeModal();
  }
});

// ==========================================
// イベント件数取得
// ==========================================

function countEventsByDate(date) {
  const events = getEvents();

  return events.filter((event) => event.date === date).length;
}

// ==========================================
// 日付イベント取得
// ==========================================

function getEventsByDate(date) {
  const events = getEvents();

  return events.filter((event) => event.date === date);
}
/* ==========================================
   Part4
   月・週・日表示切替
========================================== */

// ==========================================
// 表示切替
// ==========================================

function switchView(view) {
  currentView = view;

  monthView.classList.add("hidden");

  weekView.classList.add("hidden");

  dayView.classList.add("hidden");

  document.querySelectorAll(".view-btn").forEach((btn) => {
    btn.classList.remove("active");
  });

  // --------------------
  // 月表示
  // --------------------

  if (view === "month") {
    monthView.classList.remove("hidden");

    document.getElementById("monthViewBtn").classList.add("active");

    renderMonthView();
  }

  // --------------------
  // 週表示
  // --------------------

  if (view === "week") {
    weekView.classList.remove("hidden");

    document.getElementById("weekViewBtn").classList.add("active");

    renderWeekView();
  }

  // --------------------
  // 日表示
  // --------------------

  if (view === "day") {
    dayView.classList.remove("hidden");

    document.getElementById("dayViewBtn").classList.add("active");

    renderDayView();
  }

  updateTitle();
}

// ==========================================
// 週表示描画
// ==========================================

function renderWeekView() {
  weekView.innerHTML = "";

  const start = new Date(currentDate);

  const day = start.getDay();

  start.setDate(start.getDate() - day);

  const events = getEvents();

  // ヘッダー

  const header = document.createElement("div");

  header.className = "week-header";

  const spacer = document.createElement("div");
  spacer.className = "week-header-spacer";
  header.appendChild(spacer);

  for (let i = 0; i < 7; i++) {
    const date = new Date(start);

    date.setDate(start.getDate() + i);

    const div = document.createElement("div");

    div.innerHTML = `
            ${date.getMonth() + 1}/${date.getDate()}
        `;

    const weekday = date.getDay();
    if (weekday === 0) div.classList.add("sun");
    if (weekday === 6) div.classList.add("sat");

    header.appendChild(div);
  }

  weekView.appendChild(header);

  // 時間軸

  for (let hour = 0; hour < 24; hour++) {
    const row = document.createElement("div");

    row.className = "week-hour";

    const timeDiv = document.createElement("div");
    timeDiv.className = "week-time";
    timeDiv.textContent = `${String(hour).padStart(2, "0")}:00`;
    row.appendChild(timeDiv);

    const contentDiv = document.createElement("div");
    contentDiv.className = "week-content";

    // 7日分の列を作成
    for (let i = 0; i < 7; i++) {
      const date = new Date(start);
      date.setDate(start.getDate() + i);
      const dateStr = formatDate(date);

      const dayColumn = document.createElement("div");
      dayColumn.className = "week-day-column";

      // この日付と時間に対応するイベントをフィルタ
      const dayHourEvents = events.filter((event) => {
        if (event.date !== dateStr) return false;
        if (event.allDay) {
          return hour === 0; // 終日予定は00:00スロットに表示
        }
        const eventStartHour = new Date(event.start).getHours();
        return eventStartHour === hour;
      });

      dayHourEvents.forEach((event) => {
        const eventDiv = document.createElement("div");
        eventDiv.className = `event ${event.visibility}`;
        eventDiv.textContent = event.allDay ? "📌 " + event.title : event.title;
        eventDiv.title = `${event.title} (${event.start.substring(11, 16)} - ${event.end.substring(11, 16)})`;

        eventDiv.addEventListener("click", (e) => {
          e.stopPropagation();
          openEditEvent(event);
        });

        dayColumn.appendChild(eventDiv);
      });

      dayColumn.addEventListener("click", () => {
        openCreateEventWithTime(dateStr, hour);
      });

      contentDiv.appendChild(dayColumn);
    }

    row.appendChild(contentDiv);
    weekView.appendChild(row);
  }
}

// ==========================================
// 日表示描画
// ==========================================

function renderDayView() {
  dayView.innerHTML = "";

  const title = document.createElement("h3");

  title.style.padding = "15px";

  title.textContent = formatDate(currentDate);

  dayView.appendChild(title);

  const targetDate = formatDate(currentDate);

  const events = getEventsByDate(targetDate);

  // AIデイリープランナーボタン
  if (events.length > 0) {
    const plannerBtn = document.createElement("button");
    plannerBtn.id = "aiDailyPlannerBtn";
    plannerBtn.className = "ai-daily-planner-btn";
    plannerBtn.innerHTML = '<span class="material-icons">auto_awesome</span> AIに今日の相談をする';
    plannerBtn.addEventListener("click", triggerAIDailyAdvice);
    dayView.appendChild(plannerBtn);
  }

  // イベント表示

  events.forEach((event) => {
    const card = document.createElement("div");

    card.className = "event-card";

    card.innerHTML = `
            <h4>
                ${event.title}
            </h4>

            <p>
                ${event.start}
            </p>

            <p>
                ${event.visibility}
            </p>
        `;

    // AIイベント準備アドバイス
    const adviceBlock = document.createElement("div");
    adviceBlock.className = "ai-advice-block";
    adviceBlock.innerHTML = `
      <button class="ai-advice-btn" onclick="event.stopPropagation(); getAIAdvice('${event.id}', this)">
        <span class="material-icons">auto_awesome</span> AI準備アドバイスを生成
      </button>
      <div id="ai-advice-display-${event.id}" class="ai-advice-display hidden"></div>
    `;
    card.appendChild(adviceBlock);

    card.addEventListener("click", () => {
      openEditEvent(event);
    });

    dayView.appendChild(card);
  });

  // イベントなし

  if (events.length === 0) {
    const empty = document.createElement("p");

    empty.style.padding = "20px";

    empty.textContent = "予定がありません";

    dayView.appendChild(empty);
  }
}

// ==========================================
// ボタン切替
// ==========================================

document.getElementById("monthViewBtn").addEventListener("click", () => {
  switchView("month");
});

document.getElementById("weekViewBtn").addEventListener("click", () => {
  switchView("week");
});

document.getElementById("dayViewBtn").addEventListener("click", () => {
  switchView("day");
});
/* ==========================================
   Part5
   ナビゲーション・スワイプ・テーマ
========================================== */

// ==========================================
// 前月へ
// ==========================================

document.getElementById("prevBtn").addEventListener("click", movePrevious);

function movePrevious() {
  if (currentView === "month") {
    currentDate.setMonth(currentDate.getMonth() - 1);
  } else if (currentView === "week") {
    currentDate.setDate(currentDate.getDate() - 7);
  } else {
    currentDate.setDate(currentDate.getDate() - 1);
  }

  refreshCurrentView();
}

// ==========================================
// 次へ
// ==========================================

document.getElementById("nextBtn").addEventListener("click", moveNext);

function moveNext() {
  if (currentView === "month") {
    currentDate.setMonth(currentDate.getMonth() + 1);
  } else if (currentView === "week") {
    currentDate.setDate(currentDate.getDate() + 7);
  } else {
    currentDate.setDate(currentDate.getDate() + 1);
  }

  refreshCurrentView();
}

// ==========================================
// 今日へ
// ==========================================

document.getElementById("todayBtn").addEventListener("click", () => {
  currentDate = new Date();

  refreshCurrentView();
});

// ==========================================
// 現在表示更新
// ==========================================

function refreshCurrentView() {
  updateTitle();

  if (currentView === "month") {
    renderMonthView();
  } else if (currentView === "week") {
    renderWeekView();
  } else {
    renderDayView();
  }
}

// ==========================================
// スワイプ
// ==========================================

let touchStartX = 0;
let touchEndX = 0;

// 月表示対象

monthView.addEventListener("touchstart", (e) => {
  touchStartX = e.changedTouches[0].screenX;
});

monthView.addEventListener("touchend", (e) => {
  touchEndX = e.changedTouches[0].screenX;

  handleSwipe();
});

// 週表示対象

weekView.addEventListener("touchstart", (e) => {
  touchStartX = e.changedTouches[0].screenX;
});

weekView.addEventListener("touchend", (e) => {
  touchEndX = e.changedTouches[0].screenX;

  handleSwipe();
});

// 日表示対象

dayView.addEventListener("touchstart", (e) => {
  touchStartX = e.changedTouches[0].screenX;
});

dayView.addEventListener("touchend", (e) => {
  touchEndX = e.changedTouches[0].screenX;

  handleSwipe();
});

// ==========================================
// スワイプ判定
// ==========================================

function handleSwipe() {
  const distance = touchEndX - touchStartX;

  // 左

  if (distance < -80) {
    moveNext();
  }

  // 右

  if (distance > 80) {
    movePrevious();
  }
}

// ==========================================
// ダークモード
// ==========================================

document.getElementById("themeBtn").addEventListener("click", toggleTheme);

function toggleTheme() {
  document.body.classList.toggle("dark");

  localStorage.setItem(
    "theme",

    document.body.classList.contains("dark"),
  );
}

// ==========================================
// テーマ復元
// ==========================================

function restoreTheme() {
  const theme = localStorage.getItem("theme");

  if (theme === "true") {
    document.body.classList.add("dark");
  }
}

// ==========================================
// サイドバー
// ==========================================

const sidebar = document.getElementById("sidebar");

const sidebarOverlay = document.getElementById("sidebarOverlay");

// 開く

document.getElementById("menuBtn").addEventListener("click", () => {
  sidebar.classList.add("open");

  sidebarOverlay.classList.add("show");
});

// 閉じる

sidebarOverlay.addEventListener("click", closeSidebar);

function closeSidebar() {
  sidebar.classList.remove("open");

  sidebarOverlay.classList.remove("show");
}

// ESCでも閉じる

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    closeSidebar();
  }
});

// ==========================================
// 初回テーマ復元
// ==========================================

restoreTheme();
/* ==========================================
   Part6
   予定一覧
========================================== */

// ==========================================
// 一覧ボタン
// ==========================================

document.getElementById("scheduleListBtn").addEventListener("click", () => {
  openListModal();

  renderScheduleList("month");
});

// ==========================================
// 一覧閉じる
// ==========================================

document
  .getElementById("closeListBtn")
  .addEventListener("click", closeListModal);

// ==========================================
// モーダル外クリック
// ==========================================

listModal.addEventListener("click", (e) => {
  if (e.target === listModal) {
    closeListModal();
  }
});

// ==========================================
// フィルタボタン
// ==========================================

document.querySelectorAll(".list-mode button").forEach((btn) => {
  btn.addEventListener("click", () => {
    const mode = btn.dataset.filter;

    renderScheduleList(mode);
  });
});

// ==========================================
// 一覧描画
// ==========================================

function renderScheduleList(mode) {
  const container = document.getElementById("scheduleList");

  container.innerHTML = "";

  let events = getEvents();

  // ----------------------
  // 日
  // ----------------------

  if (mode === "day") {
    const target = formatDate(currentDate);

    events = events.filter((event) => event.date === target);
  }

  // ----------------------
  // 週
  // ----------------------
  else if (mode === "week") {
    const start = new Date(currentDate);

    start.setDate(start.getDate() - start.getDay());

    const end = new Date(start);

    end.setDate(start.getDate() + 6);

    events = events.filter((event) => {
      const d = new Date(event.date);

      return d >= start && d <= end;
    });
  }

  // ----------------------
  // 月
  // ----------------------
  else {
    const year = currentDate.getFullYear();

    const month = currentDate.getMonth();

    events = events.filter((event) => {
      const d = new Date(event.date);

      return d.getFullYear() === year && d.getMonth() === month;
    });
  }

  // ----------------------
  // 並び替え
  // ----------------------

  events.sort((a, b) => a.start.localeCompare(b.start));

  // ----------------------
  // データなし
  // ----------------------

  if (events.length === 0) {
    container.innerHTML = `
        <p style="
            padding:20px;
            text-align:center;
        ">
            予定がありません
        </p>
        `;

    return;
  }

  // ----------------------
  // 描画
  // ----------------------

  events.forEach((event) => {
    const card = document.createElement("div");

    card.className = "event-card";

    let visibility = "";

    if (event.visibility === "public") {
      visibility = "全体公開";
    } else if (event.visibility === "group") {
      visibility = "グループ";
    } else {
      visibility = "自分のみ";
    }

    card.innerHTML = `
        <div
            style="
            padding:12px;
            border-bottom:
            1px solid #ddd;
            cursor:pointer;
        ">

            <h4>
                ${event.title}
            </h4>

            <p>
                📅
                ${event.date}
            </p>

            <p>
                👥
                ${visibility}
            </p>

            <p>
                ${
                  event.allDay
                    ? "終日予定"
                    : event.start.substring(11, 16) +
                      " ～ " +
                      event.end.substring(11, 16)
                }
            </p>

        </div>
        `;

    card.addEventListener("click", () => {
      closeListModal();

      openEditEvent(event);
    });

    container.appendChild(card);
  });
}
/* ==========================================
   Part7
   初期化・最終処理
========================================== */

// ==========================================
// 全画面再描画
// ==========================================

function renderAll() {
  updateTitle();

  if (currentView === "month") {
    renderMonthView();
  } else if (currentView === "week") {
    renderWeekView();
  } else {
    renderDayView();
  }
}

// ==========================================
// 予定追加ボタン
// ==========================================

document.getElementById("addEventBtn").addEventListener("click", () => {
  const today = formatDate(currentDate);

  openCreateEvent(today);
});

// ==========================================
// 週表示再描画
// ==========================================

function refreshWeekView() {
  if (currentView === "week") {
    renderWeekView();
  }
}

// ==========================================
// 日表示再描画
// ==========================================

function refreshDayView() {
  if (currentView === "day") {
    renderDayView();
  }
}

// ==========================================
// 保存後更新
// ==========================================

function refreshAfterSave() {
  renderAll();

  refreshWeekView();

  refreshDayView();
}

// ==========================================
// LocalStorage存在確認
// ==========================================

function initializeStorage() {
  const data = localStorage.getItem(STORAGE_KEY);

  if (!data) {
    saveEvents([]);
  }
}

// ==========================================
// デバッグ用
// ==========================================

function clearAllEvents() {
  const result = confirm("全予定を削除しますか？");

  if (!result) {
    return;
  }

  saveEvents([]);

  renderAll();
}

// ==========================================
// window公開
// 開発用
// ==========================================

window.clearAllEvents = clearAllEvents;

// ==========================================
// 初回起動
// ==========================================

function init() {
  initializeStorage();

  restoreTheme();

  updateTitle();

  renderMonthView();

  renderWeekView();

  renderDayView();

  switchView("month");
}

// ==========================================
// 起動
// ==========================================

init();

// ==========================================
// AI Assistant Feature Implementation
// ==========================================

// Global state and key mapping for AI
let currentAttachments = [];
const apiKey = ""; // Fill in your Gemini API key if required

// DOM references for AI features
const aiScannerTrigger = document.getElementById("aiScannerTrigger");
const scannerSheet = document.getElementById("scannerSheet");
const closeScannerBtn = document.getElementById("closeScannerBtn");
const clearChatBtn = document.getElementById("clearChatBtn");
const aiPlusBtn = document.getElementById("aiPlusBtn");
const aiChatInput = document.getElementById("aiChatInput");
const aiSendBtn = document.getElementById("aiSendBtn");
const cameraInput = document.getElementById("cameraInput");
const galleryInput = document.getElementById("galleryInput");
const cameraTriggerBtn = document.getElementById("cameraTriggerBtn");
const cameraModal = document.getElementById("cameraModal");
const cameraVideo = document.getElementById("cameraVideo");
const shutterBtn = document.getElementById("shutterBtn");
const closeCameraModalBtn = document.getElementById("closeCameraModalBtn");
const attachmentCarousel = document.getElementById("attachmentCarousel");
const chatMessagesContainer = document.getElementById("chatMessagesContainer");
const aiChatHistory = document.getElementById("aiChatHistory");
const actionSheetBackdrop = document.getElementById("actionSheetBackdrop");
const actionSheet = document.getElementById("actionSheet");
const actionCancelBtn = document.getElementById("actionCancelBtn");
const aiSummaryContainer = document.getElementById("aiSummaryContainer");
const aiSummaryText = document.getElementById("aiSummaryText");
const closeAiSummary = document.getElementById("closeAiSummary");
const scannerBackdrop = document.getElementById("scannerBackdrop");
const toastBox = document.getElementById("toastBox");

// AI UI Event Listeners
if (aiScannerTrigger) aiScannerTrigger.addEventListener("click", openScannerSheet);
if (closeScannerBtn) closeScannerBtn.addEventListener("click", closeScannerSheet);
if (scannerBackdrop) scannerBackdrop.addEventListener("click", closeScannerSheet);

if (clearChatBtn) {
  clearChatBtn.addEventListener("click", () => {
    chatMessagesContainer.innerHTML = "";
    currentAttachments = [];
    renderAttachmentsCarousel();
    aiChatInput.value = "";
    aiChatInput.style.height = "auto";
    validateSendButton();
    showToast("会話履歴をクリアしました 🧹");
  });
}

if (aiChatInput) {
  aiChatInput.addEventListener("input", () => {
    aiChatInput.style.height = "auto";
    aiChatInput.style.height = aiChatInput.scrollHeight + "px";
    validateSendButton();
  });
}

if (aiPlusBtn) aiPlusBtn.addEventListener("click", showActionSheet);
if (actionSheetBackdrop) actionSheetBackdrop.addEventListener("click", hideActionSheet);
if (actionCancelBtn) actionCancelBtn.addEventListener("click", hideActionSheet);

if (cameraTriggerBtn) {
  cameraTriggerBtn.addEventListener("click", () => {
    hideActionSheet();
    openCameraModal();
  });
}
if (closeCameraModalBtn) {
  closeCameraModalBtn.addEventListener("click", closeCameraModal);
}
if (shutterBtn) {
  shutterBtn.addEventListener("click", capturePhotoFromCamera);
}
if (galleryInput) {
  galleryInput.addEventListener("change", (e) => {
    hideActionSheet();
    handleFileAttachment(e);
  });
}

if (aiSendBtn) aiSendBtn.addEventListener("click", sendChatToGemini);
if (closeAiSummary) {
  closeAiSummary.addEventListener("click", () => {
    aiSummaryContainer.classList.add("hidden");
  });
}

// ----------------------------------------------------
// UI control functions
// ----------------------------------------------------
function openScannerSheet() {
  scannerBackdrop.classList.remove("hidden");
  scannerSheet.classList.remove("sheet-hidden");
  if (typeof lucide !== 'undefined') {
    lucide.createIcons();
  }
}

function closeScannerSheet() {
  scannerBackdrop.classList.add("hidden");
  scannerSheet.classList.add("sheet-hidden");
}

function showActionSheet() {
  actionSheetBackdrop.classList.remove("hidden");
  actionSheet.classList.remove("sheet-hidden");
}

function hideActionSheet() {
  actionSheetBackdrop.classList.add("hidden");
  actionSheet.classList.add("sheet-hidden");
}

function validateSendButton() {
  const textLength = aiChatInput.value.trim().length;
  const hasFiles = currentAttachments.length > 0;
  aiSendBtn.disabled = !(textLength > 0 || hasFiles);
}

// ----------------------------------------------------
// Toast helper
// ----------------------------------------------------
let toastTimeout;
function showToast(msg) {
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

// ----------------------------------------------------
// Exponential Backoff API request helper
// ----------------------------------------------------
async function fetchWithRetry(url, options, retries = 5, backoff = 1000) {
  try {
    const response = await fetch(url, options);
    if (!response.ok) {
      throw new Error(`HTTP Error Status: ${response.status}`);
    }
    return response;
  } catch (error) {
    if (retries > 0) {
      await new Promise(resolve => setTimeout(resolve, backoff));
      return fetchWithRetry(url, options, retries - 1, backoff * 2);
    }
    throw error;
  }
}

// ----------------------------------------------------
// Attachment handling
// ----------------------------------------------------
function handleFileAttachment(e) {
  const files = e.target.files;
  if (!files || files.length === 0) return;

  Array.from(files).forEach(file => {
    if (!file.type.startsWith('image/')) {
      showToast("画像のみ添付可能です 📸");
      return;
    }

    const reader = new FileReader();
    reader.onload = function(event) {
      const img = new Image();
      img.onload = function() {
        const maxDim = 1024;
        let width = img.width;
        let height = img.height;
        
        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        const compressedBase64 = canvas.toDataURL('image/jpeg', 0.75);
        const id = 'attach_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
        
        currentAttachments.push({
          id: id,
          name: file.name,
          base64Payload: compressedBase64.split(',')[1],
          fullBase64: compressedBase64,
          description: ""
        });

        renderAttachmentsCarousel();
        validateSendButton();
      };
      img.src = event.target.result;
    };
    reader.readAsDataURL(file);
  });

  if (cameraInput) cameraInput.value = '';
  if (galleryInput) galleryInput.value = '';
}

function renderAttachmentsCarousel() {
  if (currentAttachments.length === 0) {
    attachmentCarousel.classList.add('hidden');
    attachmentCarousel.innerHTML = '';
    return;
  }

  attachmentCarousel.classList.remove('hidden');
  attachmentCarousel.innerHTML = '';

  currentAttachments.forEach((attach) => {
    const card = document.createElement('div');
    card.className = 'attachment-card';
    card.innerHTML = `
      <div class="attachment-preview">
        <img src="${attach.fullBase64}">
        <button class="attachment-delete-btn" onclick="removeAttachment('${attach.id}')">
          <span class="material-icons">close</span>
        </button>
      </div>
      <input type="text" 
        placeholder="画像の説明を追加..." 
        value="${escapeHTML(attach.description)}"
        class="attachment-desc-input" 
        oninput="updateAttachmentDesc('${attach.id}', this.value)">
    `;
    attachmentCarousel.appendChild(card);
  });

  attachmentCarousel.scrollLeft = attachmentCarousel.scrollWidth;
}

window.removeAttachment = function(id) {
  currentAttachments = currentAttachments.filter(item => item.id !== id);
  renderAttachmentsCarousel();
  validateSendButton();
};

window.updateAttachmentDesc = function(id, text) {
  const item = currentAttachments.find(attach => attach.id === id);
  if (item) {
    item.description = text;
  }
};

function escapeHTML(str) {
  if (!str) return '';
  return str.replace(/[&<>'"]/g, 
    tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
  );
}

// ----------------------------------------------------
// Chat & Gemini communication
// ----------------------------------------------------
async function sendChatToGemini() {
  const userPromptText = aiChatInput.value.trim();
  const attachedImages = [...currentAttachments];

  if (!userPromptText && attachedImages.length === 0) return;

  aiChatInput.value = '';
  aiChatInput.style.height = 'auto';
  currentAttachments = [];
  renderAttachmentsCarousel();
  validateSendButton();

  renderUserMessage(userPromptText, attachedImages);

  const botBubbleId = 'bot_' + Date.now();
  renderBotLoader(botBubbleId);

  const serializedCurrentEvents = getEvents().map(e => ({
    id: e.id,
    title: e.title,
    start: e.start,
    end: e.end,
    allday: !!e.allDay,
    memo: e.memo || ""
  }));

  let promptText = `
あなたはカレンダーアプリの極めて優秀なスケジュール管理AIアシスタント「予定追加太郎」です。ユーザーから届いた要望（テキスト、あるいは添付された画像）を解析し、次の4つのアクションのうち「最も適切なもの」を判別して、適切なデータ構造で回答してください。

【実行アクション (action) の判別基準】
1. "ADD_EVENTS":
   - 新しい予定をカレンダーに登録（作成）しようとしている場合。
   - 例: 「明日の14時に打合せを入れて」「シフトの画像から予定を登録して」

2. "DELETE_EVENTS":
   - 既存の予定をカレンダーから削除（取り消し、キャンセル、消去）しようとしている場合。
   - 例: 「明日の打合せの予定を消して」「美容院の予約をキャンセルしたい」

3. "LIST_EVENTS":
   - 登録されている予定を確認、照会、一覧表示、検索しようとしている場合。
   - 例: 「今週の予定を教えて」「明日は何時に予定がある？」「美容室っていつだっけ？」

4. "CHAT":
   - 単なる雑談、予定の立て方の相談、カレンダーに関係ない質問などの場合。
   - 例: 「ありがとう！」「こんにちは！」「忙しい日の過ごし方のコツは？」

---

【現在のカレンダー上の登録予定データ】
以下は、現時点でユーザーのカレンダーに登録されているすべての予定の一覧です。削除や確認、変更は、必ずこのデータに基づいて判断してください。
${JSON.stringify(serializedCurrentEvents, null, 2)}

【前提基準日付】
- 現在日時: ${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}
- 相対的な日時指定（例：「明日」「今週水曜」「来週」など）は、上記現在日時から正確な日付(YYYY-MM-DD)に読み替えてください。

---

【出力フォーマット】
必ず以下のJSONスキーマに従ってJSONオブジェクトを出力してください。追加の文章や、マークダウン等の装飾をJSONの外側に書くのは絶対にやめてください（パースエラーの原因になります）。
- action: "ADD_EVENTS" | "DELETE_EVENTS" | "LIST_EVENTS" | "CHAT"
- aiMessage: 予定追加太郎としてのユーザーへのフレンドリーで親切な返答メッセージ（文章）。予定の確認や削除の実行前に、ユーザーへ意図を確認したり案内したりする文章。
- events: 作成、あるいは確認や削除の対象に合致する予定データの配列。
  ※ ADD_EVENTS の場合は、新しく生成した予定データの配列を設定します（idは不要）。
- targetEventIds:
  ※ DELETE_EVENTS または LIST_EVENTS の場合、対象となる「既存の予定データ」の "id" の配列を正確に設定してください（複数ある場合は複数指定）。カレンダーの予定データとマッチさせるために必要です。
`;

  if (userPromptText) {
    promptText += `\n\n【ユーザーからのメッセージ】\n${userPromptText}`;
  }

  if (attachedImages.length > 0) {
    promptText += `\n\n【添付された画像についての追加情報】\n`;
    attachedImages.forEach((img, index) => {
      promptText += `画像 ${index + 1} (${img.name}):\n`;
      promptText += `- 画像の説明: "${img.description || '特になし'}"\n`;
    });
  }

  const parts = [{ text: promptText }];
  attachedImages.forEach(img => {
    parts.push({
      inlineData: {
        mimeType: "image/jpeg",
        data: img.base64Payload
      }
    });
  });

  const payload = {
    contents: [{ parts: parts }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: {
          action: { type: "STRING" },
          aiMessage: { type: "STRING" },
          events: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                title: { type: "STRING" },
                start: { type: "STRING" },
                end: { type: "STRING" },
                allday: { type: "BOOLEAN" },
                location: { type: "STRING" },
                memo: { type: "STRING" },
                color: { type: "STRING" }
              },
              required: ["title", "start", "end", "allday"]
            }
          },
          targetEventIds: {
            type: "ARRAY",
            items: { type: "STRING" }
          }
        },
        required: ["action", "aiMessage"]
      }
    }
  };

  try {
    const response = await fetchWithRetry(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    const textResult = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!textResult) throw new Error("応答データが異常です。");

    const resultJson = JSON.parse(textResult);
    handleAIResponseAction(botBubbleId, resultJson);

  } catch (err) {
    console.error("Gemini API Error: ", err);
    renderBotError(botBubbleId);
  }
}

function renderUserMessage(text, attachments) {
  const userMsg = document.createElement('div');
  userMsg.className = 'chat-bubble-wrapper user';

  let attachmentsHTML = '';
  if (attachments.length > 0) {
    attachmentsHTML = `<div class="chat-message-attachments">`;
    attachments.forEach(att => {
      attachmentsHTML += `<img src="${att.fullBase64}" class="chat-msg-attach-img">`;
    });
    attachmentsHTML += `</div>`;
  }

  userMsg.innerHTML = `
    <div style="flex:1; display:flex; flex-direction:column; align-items:flex-end;">
      ${attachmentsHTML}
      ${text ? `<div class="chat-bubble">${escapeHTML(text).replace(/\n/g, '<br>')}</div>` : ''}
    </div>
  `;

  chatMessagesContainer.appendChild(userMsg);
  scrollToBottom();
}

function renderBotLoader(id) {
  const botMsg = document.createElement('div');
  botMsg.className = 'chat-bubble-wrapper bot';
  botMsg.id = id;

  botMsg.innerHTML = `
    <div class="bot-avatar">
      <span class="material-icons" style="font-size:14px;">auto_awesome</span>
    </div>
    <div class="chat-bubble">
      <p class="bot-name">予定追加太郎</p>
      <div class="ai-loader-dots">
        <span></span>
        <span></span>
        <span></span>
      </div>
    </div>
  `;

  chatMessagesContainer.appendChild(botMsg);
  scrollToBottom();
}

function renderBotError(id) {
  const botMsg = document.getElementById(id);
  if (!botMsg) return;

  botMsg.innerHTML = `
    <div class="bot-avatar">
      <span class="material-icons" style="font-size:14px;">auto_awesome</span>
    </div>
    <div class="chat-bubble">
      <p class="bot-name" style="color:var(--sunday);">通信エラー</p>
      <p>大変申し訳ありません。サーバーとの通信で一時的なエラーが発生しました。時間を置いてもう一度お試しいただくか、入力を簡潔にしてお試しください。</p>
    </div>
  `;
}

function handleAIResponseAction(botBubbleId, aiResponse) {
  const botMsg = document.getElementById(botBubbleId);
  if (!botMsg) return;

  const action = aiResponse.action || 'CHAT';
  const aiMessage = escapeHTML(aiResponse.aiMessage || '').replace(/\n/g, '<br>');
  const responseEvents = aiResponse.events || [];
  const targetIds = aiResponse.targetEventIds || [];

  let interactiveHTML = `
    <p class="bot-name">予定追加太郎</p>
    <p>${aiMessage}</p>
  `;

  if (action === 'ADD_EVENTS' && responseEvents.length > 0) {
    interactiveHTML += `<div class="ai-proposal-section">`;
    interactiveHTML += `<p class="ai-proposal-header add">✨ 提案予定 (${responseEvents.length}件)</p>`;

    responseEvents.forEach((p, idx) => {
      const uniquePropId = `add_${botBubbleId}_${idx}`;
      const startObj = new Date(p.start);
      const displayDate = isNaN(startObj.getTime()) ? '日付不明' : `${startObj.getFullYear()}年${startObj.getMonth() + 1}月${startObj.getDate()}日`;
      const displayTime = isNaN(startObj.getTime()) ? '' : (p.allday ? '終日' : `${String(startObj.getHours()).padStart(2, '0')}:${String(startObj.getMinutes()).padStart(2, '0')}`);

      interactiveHTML += `
        <div class="ai-proposal-card" id="${uniquePropId}-card">
          <div class="ai-proposal-card-info">
            <div class="ai-proposal-color-bar" style="background-color: ${p.color || '#af52de'}"></div>
            <div class="ai-proposal-card-details">
              <span class="ai-proposal-title">${escapeHTML(p.title)}</span>
              <span class="ai-proposal-time">${displayDate} ${displayTime}</span>
            </div>
          </div>
          <button onclick="registerProposalEvent('${encodeURIComponent(JSON.stringify(p))}', '${uniquePropId}')" 
                  id="${uniquePropId}-btn"
                  class="ai-proposal-btn add">
            カレンダーに追加
          </button>
        </div>
      `;
    });
    interactiveHTML += `</div>`;

  } else if (action === 'DELETE_EVENTS' && targetIds.length > 0) {
    const matchedLocalEvents = getEvents().filter(e => targetIds.includes(String(e.id)) || targetIds.includes(Number(e.id)));
    if (matchedLocalEvents.length > 0) {
      interactiveHTML += `<div class="ai-proposal-section">`;
      interactiveHTML += `<p class="ai-proposal-header del">🗑️ 削除予定の一致リスト (${matchedLocalEvents.length}件)</p>`;

      matchedLocalEvents.forEach((e, idx) => {
        const uniquePropId = `del_${botBubbleId}_${idx}`;
        const startObj = new Date(e.start);
        const displayDate = isNaN(startObj.getTime()) ? '日付不明' : `${startObj.getFullYear()}年${startObj.getMonth() + 1}月${startObj.getDate()}日`;
        const displayTime = isNaN(startObj.getTime()) ? '' : (e.allDay ? '終日' : `${String(startObj.getHours()).padStart(2, '0')}:${String(startObj.getMinutes()).padStart(2, '0')}`);

        interactiveHTML += `
          <div class="ai-proposal-card" id="${uniquePropId}-card">
            <div class="ai-proposal-card-info">
              <div class="ai-proposal-color-bar" style="background-color: #ea4335"></div>
              <div class="ai-proposal-card-details">
                <span class="ai-proposal-title">${escapeHTML(e.title)}</span>
                <span class="ai-proposal-time">${displayDate} ${displayTime}</span>
              </div>
            </div>
            <button onclick="deleteLocalEventFromProposal('${e.id}', '${uniquePropId}')" 
                    id="${uniquePropId}-btn"
                    class="ai-proposal-btn del">
              カレンダーから削除
            </button>
          </div>
        `;
      });
      interactiveHTML += `</div>`;
    }

  } else if (action === 'LIST_EVENTS' && targetIds.length > 0) {
    const matchedLocalEvents = getEvents().filter(e => targetIds.includes(String(e.id)) || targetIds.includes(Number(e.id)));
    if (matchedLocalEvents.length > 0) {
      interactiveHTML += `<div class="ai-proposal-section">`;
      interactiveHTML += `<p class="ai-proposal-header list">🔍 検索ヒット (${matchedLocalEvents.length}件)</p>`;

      matchedLocalEvents.forEach((e, idx) => {
        const uniquePropId = `list_${botBubbleId}_${idx}`;
        const startObj = new Date(e.start);
        const displayDate = isNaN(startObj.getTime()) ? '日付不明' : `${startObj.getFullYear()}年${startObj.getMonth() + 1}月${startObj.getDate()}日`;
        const displayTime = isNaN(startObj.getTime()) ? '' : (e.allDay ? '終日' : `${String(startObj.getHours()).padStart(2, '0')}:${String(startObj.getMinutes()).padStart(2, '0')}`);

        interactiveHTML += `
          <div class="ai-proposal-card" id="${uniquePropId}-card">
            <div class="ai-proposal-card-info">
              <div class="ai-proposal-color-bar" style="background-color: #1a73e8"></div>
              <div class="ai-proposal-card-details">
                <span class="ai-proposal-title">${escapeHTML(e.title)}</span>
                <span class="ai-proposal-time">${displayDate} ${displayTime}</span>
              </div>
            </div>
            <button onclick="focusOnCalendarDate('${e.start}', '${uniquePropId}')" 
                    id="${uniquePropId}-btn"
                    class="ai-proposal-btn list">
              カレンダーで確認
            </button>
          </div>
        `;
      });
      interactiveHTML += `</div>`;
    }
  }

  botMsg.innerHTML = `
    <div class="bot-avatar">
      <span class="material-icons" style="font-size:14px;">auto_awesome</span>
    </div>
    <div class="chat-bubble">
      ${interactiveHTML}
    </div>
  `;

  scrollToBottom();
}

window.registerProposalEvent = function(encodedEvent, uniquePropId) {
  try {
    const eventData = JSON.parse(decodeURIComponent(encodedEvent));
    const events = getEvents();

    const newEvent = {
      id: createId(),
      title: eventData.title,
      start: eventData.start,
      end: eventData.end,
      date: eventData.start.substring(0, 10),
      memo: eventData.memo || "",
      visibility: "public",
      allDay: !!eventData.allday
    };

    events.push(newEvent);
    saveEvents(events);

    const btn = document.getElementById(`${uniquePropId}-btn`);
    const card = document.getElementById(`${uniquePropId}-card`);

    if (btn) {
      btn.disabled = true;
      btn.style.backgroundColor = "#34a853";
      btn.innerHTML = "登録しました";
    }
    
    if (card) {
      card.style.borderColor = "#34a853";
      card.style.background = "rgba(52, 168, 83, 0.05)";
    }

    showToast("予定を追加しました ✨");
    
    const startObj = new Date(newEvent.start);
    if (!isNaN(startObj.getTime())) {
      currentDate = startObj;
    }
    refreshAfterSave();

  } catch (err) {
    console.error("Failed to add proposal event", err);
    showToast("追加に失敗しました ❌");
  }
};

window.deleteLocalEventFromProposal = function(eventId, uniquePropId) {
  let events = getEvents();
  events = events.filter(e => e.id != eventId);
  saveEvents(events);

  const btn = document.getElementById(`${uniquePropId}-btn`);
  const card = document.getElementById(`${uniquePropId}-card`);

  if (btn) {
    btn.disabled = true;
    btn.style.backgroundColor = "#9aa0a6";
    btn.innerHTML = "削除しました";
  }

  if (card) {
    card.style.opacity = "0.5";
  }

  showToast("予定を削除しました 🗑️");
  refreshAfterSave();
};

window.focusOnCalendarDate = function(dateStr, uniquePropId) {
  const targetDate = new Date(dateStr);
  if (!isNaN(targetDate.getTime())) {
    currentDate = targetDate;
    switchView("day");
    closeScannerSheet();
    showToast(`${formatDate(targetDate)}を表示しました`);
  }
};

function scrollToBottom() {
  setTimeout(() => {
    aiChatHistory.scrollTo({
      top: aiChatHistory.scrollHeight,
      behavior: 'smooth'
    });
  }, 50);
}

// ----------------------------------------------------
// AI DAILY PLANNER BANNER FUNCTION
// ----------------------------------------------------
async function triggerAIDailyAdvice() {
  const targetDateStr = formatDate(currentDate);
  const dayEvents = getEventsByDate(targetDateStr);
  
  if (dayEvents.length === 0) {
    showToast("予定がありません ❌");
    return;
  }

  aiSummaryContainer.classList.remove('hidden');
  aiSummaryText.innerHTML = `
    <div style="display:flex; align-items:center; gap:6px; color:#af52de;">
      <span class="ai-loader-dots"><span></span><span></span><span></span></span>
      <span>スケジュールを分析中...</span>
    </div>
  `;

  const eventDetailsText = dayEvents.map((e, index) => {
    const start = e.start.substring(11, 16);
    const end = e.end.substring(11, 16);
    return `[予定 ${index + 1}]
・タイトル: ${e.title}
・時間: ${e.allDay ? '終日' : start + ' 〜 ' + end}
・メモ: ${e.memo || 'なし'}`;
  }).join('\n\n');

  const prompt = `
あなたは優秀なコンシェルジュです。ユーザーの「${targetDateStr}」の一日のスケジュールをもとに、過ごし方や移動、持ち物のチェック、リラックスするための素晴らしいデイリーアドバイスプランを親しみやすく端的に作成してください。
【本日のスケジュール】
${eventDetailsText}

【出力要件】
- 日本語で最大200〜250文字程度で、分かりやすく箇条書きや絵文字を交えてまとめてください。
- スマホ画面にフィットするよう、簡潔さを極めてください。`;

  try {
    const response = await fetchWithRetry(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }]
      })
    });

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!text) throw new Error("応答がありません");

    aiSummaryText.innerHTML = text.replace(/\n/g, '<br>');
  } catch (err) {
    console.error("AI Daily Planner error: ", err);
    aiSummaryText.innerText = "アドバイスの生成に失敗しました。時間をおいてもう一度お試しください。";
  }
}

// ----------------------------------------------------
// AI ADVICE FOR EVENT FUNCTION
// ----------------------------------------------------
window.getAIAdvice = async function(eventId, buttonElement) {
  const event = getEvents().find(e => e.id == eventId);
  if (!event) return;

  const displayDiv = document.getElementById(`ai-advice-display-${eventId}`);
  if (!displayDiv) return;
  
  displayDiv.classList.remove('hidden');
  displayDiv.innerHTML = `
    <div style="display:flex; align-items:center; gap:6px; color:#af52de;">
      <span class="ai-loader-dots"><span></span><span></span><span></span></span>
      <span>準備アドバイスを作成中...</span>
    </div>
  `;

  buttonElement.disabled = true;

  const prompt = `
イベント予定「${event.title}」について、パーソナルアシスタントとして、事前にどのような準備（持ち物、ToDo、心構えなど）をしておけば完璧か、実用的で気の利いたアドバイスを提供してください。
【予定の詳細】
・日時: ${event.start}
・メモ: ${event.memo || '登録なし'}

【出力要件】
- 日本語で簡潔に以下のフォーマット（絵文字つき）でまとめてください。
💼 **持ち物:** (1〜2点)
📌 **事前ToDo:** (1〜2点)
💡 **ワンポイント:** (1言)
- 全体で150文字以内の非常に短いテキストにしてください。`;

  try {
    const response = await fetchWithRetry(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }]
      })
    });

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!text) throw new Error("応答がありません");

    const formattedText = text
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\n/g, '<br>');

    displayDiv.innerHTML = formattedText;
  } catch (err) {
    console.error("AI Advice error: ", err);
    displayDiv.innerHTML = `<span style="color:var(--sunday);">アドバイスが読み込めませんでした。もう一度お試しください。</span>`;
  } finally {
    buttonElement.disabled = false;
  }
};

// ----------------------------------------------------
// Custom Video Camera functions
// ----------------------------------------------------
let cameraStream = null;

async function openCameraModal() {
  cameraModal.style.display = "flex";
  
  const videoContainer = document.getElementById("cameraVideoContainer");
  const shutter = document.getElementById("shutterBtn");

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showToast("⚠️ カメラ機能はローカルサーバー（Live Server等）経由が必要です。");
    if (shutter) shutter.style.display = "none";
    if (videoContainer) {
      videoContainer.innerHTML = `
        <div style="padding: 20px; text-align: center; color: white; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; gap: 10px; font-family: sans-serif;">
          <span class="material-icons" style="font-size: 48px; color: #ffcc00;">warning</span>
          <p style="font-size: 13.5px; font-weight: bold; margin: 0; line-height: 1.4;">セキュリティ制限のため、file:// URI ではカメラを起動できません。</p>
          <p style="font-size: 11px; color: #8e8e93; margin: 0; line-height: 1.4;">VSCodeのLive Serverなどのローカルサーバーを使用するか、HTTPS環境下で実行してください。</p>
        </div>
      `;
    }
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" } },
      audio: false
    });
    const video = document.getElementById("cameraVideo");
    if (video) {
      video.srcObject = stream;
      video.play();
    }
    cameraStream = stream;
  } catch (err) {
    console.error("Camera startup failed: ", err);
    showToast("カメラの起動に失敗しました 📷");
    closeCameraModal();
  }
}

function closeCameraModal() {
  if (cameraStream) {
    cameraStream.getTracks().forEach(track => track.stop());
    cameraStream = null;
  }
  
  const videoContainer = document.getElementById("cameraVideoContainer");
  if (videoContainer) {
    videoContainer.innerHTML = `<video id="cameraVideo" autoplay playsinline style="width: 100%; height: 100%; object-fit: cover;"></video>`;
  }
  
  const shutter = document.getElementById("shutterBtn");
  if (shutter) {
    shutter.style.display = "flex";
  }
  
  cameraModal.style.display = "none";
}

function capturePhotoFromCamera() {
  const video = document.getElementById("cameraVideo");
  if (!cameraStream || !video) return;

  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth || 640;
  canvas.height = video.videoHeight || 480;

  const ctx = canvas.getContext("2d");
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  const compressedBase64 = canvas.toDataURL("image/jpeg", 0.75);
  const id = "attach_" + Date.now() + "_" + Math.random().toString(36).substr(2, 5);

  currentAttachments.push({
    id: id,
    name: `camera_capture_${Date.now()}.jpg`,
    base64Payload: compressedBase64.split(",")[1],
    fullBase64: compressedBase64,
    description: ""
  });

  renderAttachmentsCarousel();
  validateSendButton();
  closeCameraModal();
  showToast("写真を撮影しました 📸");
}
