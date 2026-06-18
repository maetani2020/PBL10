/* ==========================================
   Shared Calendar v2
   calendar.js
========================================== */

// ==========================================
// グローバル変数
// ==========================================
let currentDate = new Date();
let currentView = "month";
let selectedEventId = null;

// 通知監視タイマー
let notificationTimer = null;
let lastCheckTime = new Date(); // 前回チェック時刻（取りこぼし防止）

// 通知済み管理キー
const NOTIFIED_KEY = "shared_calendar_notified_flags";

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

// 現在ページURL（通知クリック復帰先）
const CURRENT_PAGE_URL = window.location.href;

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
// 通知済みフラグ取得/保存
// ==========================================
function getNotifiedFlags() {
  return JSON.parse(localStorage.getItem(NOTIFIED_KEY)) || {};
}

function saveNotifiedFlags(flags) {
  localStorage.setItem(NOTIFIED_KEY, JSON.stringify(flags));
}

// ==========================================
// 日付文字列生成 YYYY-MM-DD
// ==========================================
function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// datetime-local用 YYYY-MM-DDTHH:mm
function formatDateTimeLocal(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${d}T${hh}:${mm}`;
}

// 分を5分単位で切り上げ
function ceilToNext5Minutes(date) {
  const d = new Date(date);
  d.setSeconds(0, 0);
  const m = d.getMinutes();
  const add = (5 - (m % 5)) % 5;
  d.setMinutes(m + add);
  return d;
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
// ID生成
// ==========================================
function createId() {
  return Date.now() + Math.floor(Math.random() * 10000);
}

// ==========================================
// モーダル制御
// ==========================================
function openModal() {
  eventModal.style.display = "flex";
}
function closeModal() {
  eventModal.style.display = "none";
}
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
// 要件:
// - 開始日時 = 現在の年月日時分
// - 終了日時 = 開始日時より後（+1時間）
// ==========================================
function openCreateEvent() {
  resetForm();

  const now = new Date();
  const start = ceilToNext5Minutes(now);
  const end = new Date(start.getTime() + 60 * 60 * 1000); // +1時間

  document.getElementById("eventStart").value = formatDateTimeLocal(start);
  document.getElementById("eventEnd").value = formatDateTimeLocal(end);

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

// ==========================================
// Windows通知許可
// ==========================================
async function ensureNotificationPermission() {
  if (!("Notification" in window)) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;

  const permission = await Notification.requestPermission();
  return permission === "granted";
}

// ==========================================
// Windows通知表示
// ==========================================
function showWindowsNotification(title, body, tag) {
  if (!("Notification" in window)) return;
  if (Notification.permission !== "granted") return;

  const n = new Notification(title, {
    body,
    tag: tag || "shared-calendar",
    icon: "https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f4c5.png",
  });

  n.onclick = () => {
    // ここを明示遷移にしてルート飛びを防止
    window.location.href = CURRENT_PAGE_URL;
    window.focus();
    n.close();
  };

  setTimeout(() => n.close(), 6000);
}

// ==========================================
// 予定通知チェック
// 30分前 / 5分前 / 開始時刻
// ==========================================
function checkEventNotifications() {
  const events = getEvents();
  const now = new Date();
  const prev = lastCheckTime || new Date(now.getTime() - 5000);
  const flags = getNotifiedFlags();

  events.forEach((event) => {
    if (event.allDay) return;
    if (!event.start) return;

    const startTime = new Date(event.start);
    if (isNaN(startTime.getTime())) return;

    const diffMs = startTime.getTime() - now.getTime();
    const diffMin = diffMs / 60000;

    const baseKey = `${event.id}_${event.start}`;
    const key30 = `${baseKey}_30`;
    const key5 = `${baseKey}_5`;
    const keyStart = `${baseKey}_start`;

    if (diffMin <= 30 && diffMin > 29 && !flags[key30]) {
      showWindowsNotification("予定通知", `「${event.title}」の30分前です`, key30);
      flags[key30] = true;
    }

    if (diffMin <= 5 && diffMin > 4 && !flags[key5]) {
      showWindowsNotification("予定通知", `「${event.title}」の5分前です`, key5);
      flags[key5] = true;
    }

    if (!flags[keyStart] && startTime > prev && startTime <= now) {
      showWindowsNotification("予定通知", `「${event.title}」の開始時刻になりました`, keyStart);
      flags[keyStart] = true;
    }
  });

  const eventKeys = new Set(events.map((e) => `${e.id}_${e.start}`));
  Object.keys(flags).forEach((k) => {
    const prefix = k.replace(/_(30|5|start)$/, "");
    if (!eventKeys.has(prefix)) delete flags[k];
  });

  saveNotifiedFlags(flags);
  lastCheckTime = now;
}

// ==========================================
// 通知監視開始（5秒ごと）
// ==========================================
function startNotificationWatcher() {
  if (notificationTimer) clearInterval(notificationTimer);

  lastCheckTime = new Date();
  checkEventNotifications();

  notificationTimer = setInterval(() => {
    checkEventNotifications();
  }, 5000);
}

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

  for (let i = startWeek - 1; i >= 0; i--) {
    const cell = document.createElement("div");
    cell.className = "day-cell other-month";
    cell.innerHTML = `<div class="day-number">${prevMonthLastDay - i}</div>`;
    monthView.appendChild(cell);
  }

  for (let day = 1; day <= totalDays; day++) {
    const cell = document.createElement("div");
    cell.classList.add("day-cell");

    const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const weekday = new Date(year, month, day).getDay();

    if (weekday === 0) cell.classList.add("sunday");
    if (weekday === 6) cell.classList.add("saturday");
    if (isToday(year, month, day)) cell.classList.add("today");

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
      openCreateEvent();
    });

    monthView.appendChild(cell);
  }

  const totalCells = startWeek + totalDays;
  const weekRows = Math.ceil(totalCells / 7);
  const targetCells = weekRows * 7;
  const nextDays = targetCells - totalCells;

  for (let i = 1; i <= nextDays; i++) {
    const cell = document.createElement("div");
    cell.className = "day-cell other-month";
    cell.innerHTML = `<div class="day-number">${i}</div>`;
    monthView.appendChild(cell);
  }
}

// ==========================================
// 週表示描画
// ==========================================
function renderWeekView() {
  weekView.innerHTML = "";

  const start = new Date(currentDate);
  const day = start.getDay();
  start.setDate(start.getDate() - day);

  const header = document.createElement("div");
  header.className = "week-header";

  for (let i = 0; i < 7; i++) {
    const date = new Date(start);
    date.setDate(start.getDate() + i);

    const div = document.createElement("div");
    div.innerHTML = `${date.getMonth() + 1}/${date.getDate()}`;
    header.appendChild(div);
  }

  weekView.appendChild(header);

  for (let hour = 0; hour < 24; hour++) {
    const row = document.createElement("div");
    row.className = "week-hour";
    row.innerHTML = `
      <div class="week-time">${String(hour).padStart(2, "0")}:00</div>
      <div class="week-content"></div>
    `;
    weekView.appendChild(row);
  }
}

// ==========================================
// 日表示描画
// ==========================================
function getEventsByDate(date) {
  const events = getEvents();
  return events.filter((event) => event.date === date);
}

function renderDayView() {
  dayView.innerHTML = "";

  const title = document.createElement("h3");
  title.style.padding = "15px";
  title.textContent = formatDate(currentDate);
  dayView.appendChild(title);

  const targetDate = formatDate(currentDate);
  const events = getEventsByDate(targetDate);

  events.forEach((event) => {
    const card = document.createElement("div");
    card.className = "event-card";
    card.innerHTML = `
      <div style="padding:12px;">
        <h4>${event.title}</h4>
        <p>${event.allDay ? "終日予定" : event.start.substring(11, 16) + " ～ " + event.end.substring(11, 16)}</p>
        <p>${event.visibility}</p>
      </div>
    `;
    card.addEventListener("click", () => openEditEvent(event));
    dayView.appendChild(card);
  });

  if (events.length === 0) {
    const empty = document.createElement("p");
    empty.style.padding = "20px";
    empty.textContent = "予定がありません";
    dayView.appendChild(empty);
  }
}

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

  if (view === "month") {
    monthView.classList.remove("hidden");
    document.getElementById("monthViewBtn").classList.add("active");
    renderMonthView();
  }

  if (view === "week") {
    weekView.classList.remove("hidden");
    document.getElementById("weekViewBtn").classList.add("active");
    renderWeekView();
  }

  if (view === "day") {
    dayView.classList.remove("hidden");
    document.getElementById("dayViewBtn").classList.add("active");
    renderDayView();
  }

  updateTitle();
}

// ==========================================
// ナビゲーション
// ==========================================
function refreshCurrentView() {
  updateTitle();
  if (currentView === "month") renderMonthView();
  else if (currentView === "week") renderWeekView();
  else renderDayView();
}

function movePrevious() {
  if (currentView === "month") currentDate.setMonth(currentDate.getMonth() - 1);
  else if (currentView === "week") currentDate.setDate(currentDate.getDate() - 7);
  else currentDate.setDate(currentDate.getDate() - 1);

  refreshCurrentView();
}

function moveNext() {
  if (currentView === "month") currentDate.setMonth(currentDate.getMonth() + 1);
  else if (currentView === "week") currentDate.setDate(currentDate.getDate() + 7);
  else currentDate.setDate(currentDate.getDate() + 1);

  refreshCurrentView();
}

// ==========================================
// スワイプ
// ==========================================
let touchStartX = 0;
let touchEndX = 0;

function handleSwipe() {
  const distance = touchEndX - touchStartX;
  if (distance < -80) moveNext();
  if (distance > 80) movePrevious();
}

monthView.addEventListener("touchstart", (e) => {
  touchStartX = e.changedTouches[0].screenX;
});
monthView.addEventListener("touchend", (e) => {
  touchEndX = e.changedTouches[0].screenX;
  handleSwipe();
});

weekView.addEventListener("touchstart", (e) => {
  touchStartX = e.changedTouches[0].screenX;
});
weekView.addEventListener("touchend", (e) => {
  touchEndX = e.changedTouches[0].screenX;
  handleSwipe();
});

dayView.addEventListener("touchstart", (e) => {
  touchStartX = e.changedTouches[0].screenX;
});
dayView.addEventListener("touchend", (e) => {
  touchEndX = e.changedTouches[0].screenX;
  handleSwipe();
});

// ==========================================
// テーマ
// ==========================================
function toggleTheme() {
  document.body.classList.toggle("dark");
  localStorage.setItem("theme", document.body.classList.contains("dark"));
}

function restoreTheme() {
  const theme = localStorage.getItem("theme");
  if (theme === "true") document.body.classList.add("dark");
}

// ==========================================
// サイドバー
// ==========================================
const sidebar = document.getElementById("sidebar");
const sidebarOverlay = document.getElementById("sidebarOverlay");

function closeSidebar() {
  sidebar.classList.remove("open");
  sidebarOverlay.classList.remove("show");
}

// ==========================================
// CRUD
// Web側ダイアログは「作成」「削除」のみ
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

  if (start >= end) {
    alert("終了日時は開始日時より後にしてください");
    return;
  }

  const memo = document.getElementById("eventMemo").value;
  const visibility = document.getElementById("eventVisibility").value;
  const allDay = document.getElementById("allDay").checked;
  const date = start.substring(0, 10);

  let events = getEvents();
  const isEdit = !!selectedEventId;

  const data = {
    id: selectedEventId || createId(),
    title,
    start,
    end,
    date,
    memo,
    visibility,
    allDay,
  };

  if (isEdit) {
    events = events.map((event) => (event.id === selectedEventId ? { ...event, ...data } : event));
  } else {
    events.push(data);
  }

  saveEvents(events);
  closeModal();
  refreshCurrentView();

  if (!isEdit) {
    alert(`予定を作成しました：${title}`);
  }

  checkEventNotifications();
}

function deleteEvent() {
  if (!selectedEventId) return;

  const result = confirm("予定を削除しますか？");
  if (!result) return;

  let events = getEvents();
  const target = events.find((event) => event.id === selectedEventId);
  const deletedTitle = target ? target.title : "（タイトル不明）";

  events = events.filter((event) => event.id !== selectedEventId);
  saveEvents(events);

  const flags = getNotifiedFlags();
  Object.keys(flags).forEach((k) => {
    if (String(k).startsWith(String(selectedEventId) + "_")) {
      delete flags[k];
    }
  });
  saveNotifiedFlags(flags);

  closeModal();
  refreshCurrentView();

  alert(`予定を削除しました：${deletedTitle}`);
}

// ==========================================
// 予定一覧
// ==========================================
function renderScheduleList(mode) {
  const container = document.getElementById("scheduleList");
  container.innerHTML = "";

  let events = getEvents();

  if (mode === "day") {
    const target = formatDate(currentDate);
    events = events.filter((event) => event.date === target);
  } else if (mode === "week") {
    const start = new Date(currentDate);
    start.setDate(start.getDate() - start.getDay());

    const end = new Date(start);
    end.setDate(start.getDate() + 6);

    events = events.filter((event) => {
      const d = new Date(event.date);
      return d >= start && d <= end;
    });
  } else {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    events = events.filter((event) => {
      const d = new Date(event.date);
      return d.getFullYear() === year && d.getMonth() === month;
    });
  }

  events.sort((a, b) => a.start.localeCompare(b.start));

  if (events.length === 0) {
    container.innerHTML = `<p style="padding:20px;text-align:center;">予定がありません</p>`;
    return;
  }

  events.forEach((event) => {
    const card = document.createElement("div");
    card.className = "event-card";

    let visibility = "";
    if (event.visibility === "public") visibility = "全体公開";
    else if (event.visibility === "group") visibility = "グループ";
    else visibility = "自分のみ";

    card.innerHTML = `
      <div style="padding:12px;border-bottom:1px solid #ddd;cursor:pointer;">
        <h4>${event.title}</h4>
        <p>📅 ${event.date}</p>
        <p>👥 ${visibility}</p>
        <p>${
          event.allDay
            ? "終日予定"
            : event.start.substring(11, 16) + " ～ " + event.end.substring(11, 16)
        }</p>
      </div>
    `;

    card.addEventListener("click", () => {
      closeListModal();
      openEditEvent(event);
    });

    container.appendChild(card);
  });
}

// ==========================================
// 初期化
// ==========================================
function initializeStorage() {
  const data = localStorage.getItem(STORAGE_KEY);
  if (!data) saveEvents([]);
  if (!localStorage.getItem(NOTIFIED_KEY)) saveNotifiedFlags({});
}

function clearAllEvents() {
  const result = confirm("全予定を削除しますか？");
  if (!result) return;

  saveEvents([]);
  saveNotifiedFlags({});
  refreshCurrentView();
}
window.clearAllEvents = clearAllEvents;

// ==========================================
// イベント登録
// ==========================================
document.getElementById("saveEventBtn").addEventListener("click", saveEvent);
document.getElementById("deleteEventBtn").addEventListener("click", deleteEvent);
document.getElementById("closeModalBtn").addEventListener("click", closeModal);

eventModal.addEventListener("click", (e) => {
  if (e.target === eventModal) closeModal();
});

listModal.addEventListener("click", (e) => {
  if (e.target === listModal) closeListModal();
});

document.getElementById("closeListBtn").addEventListener("click", closeListModal);

document.querySelectorAll(".list-mode button").forEach((btn) => {
  btn.addEventListener("click", () => {
    renderScheduleList(btn.dataset.filter);
  });
});

document.getElementById("scheduleListBtn").addEventListener("click", () => {
  openListModal();
  renderScheduleList("month");
});

document.getElementById("monthViewBtn").addEventListener("click", () => switchView("month"));
document.getElementById("weekViewBtn").addEventListener("click", () => switchView("week"));
document.getElementById("dayViewBtn").addEventListener("click", () => switchView("day"));

document.getElementById("prevBtn").addEventListener("click", movePrevious);
document.getElementById("nextBtn").addEventListener("click", moveNext);

document.getElementById("todayBtn").addEventListener("click", () => {
  currentDate = new Date();
  refreshCurrentView();
});

document.getElementById("themeBtn").addEventListener("click", toggleTheme);

document.getElementById("menuBtn").addEventListener("click", () => {
  sidebar.classList.add("open");
  sidebarOverlay.classList.add("show");
});

sidebarOverlay.addEventListener("click", closeSidebar);

document.getElementById("addEventBtn").addEventListener("click", () => {
  openCreateEvent();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    closeModal();
    closeListModal();
    closeSidebar();
  }
});

// 開始/終了の整合を入力中にも補正
document.getElementById("eventStart").addEventListener("change", (e) => {
  const startVal = e.target.value;
  const endInput = document.getElementById("eventEnd");

  if (!startVal) return;

  const startDate = new Date(startVal);
  const endDate = new Date(endInput.value);

  // 終了が未入力 or 開始以下なら +1時間に補正
  if (!endInput.value || isNaN(endDate.getTime()) || endDate <= startDate) {
    const fixedEnd = new Date(startDate.getTime() + 60 * 60 * 1000);
    endInput.value = formatDateTimeLocal(fixedEnd);
  }
});

// ==========================================
// 起動
// ==========================================
async function init() {
  initializeStorage();
  restoreTheme();

  updateTitle();
  renderMonthView();
  renderWeekView();
  renderDayView();
  switchView("month");

  const asked = localStorage.getItem("notificationAsked");
  if (!asked) {
    const ok = confirm("Windows通知（30分前/5分前/開始時刻）を有効にしますか？");
    if (ok) {
      await ensureNotificationPermission();
    }
    localStorage.setItem("notificationAsked", "true");
  }

  startNotificationWatcher();
}

init();