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

  renderMonthView();
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

  for (let i = 0; i < 7; i++) {
    const date = new Date(start);

    date.setDate(start.getDate() + i);

    const div = document.createElement("div");

    div.innerHTML = `
            ${date.getMonth() + 1}/${date.getDate()}
        `;

    header.appendChild(div);
  }

  weekView.appendChild(header);

  // 時間軸

  for (let hour = 0; hour < 24; hour++) {
    const row = document.createElement("div");

    row.className = "week-hour";

    row.innerHTML = `
            <div class="week-time">
                ${String(hour).padStart(2, "0")}
                :00
            </div>
            <div class="week-content"></div>
        `;

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
