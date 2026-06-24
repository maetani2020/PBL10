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
const NOTIFICATION_ENABLED_KEY = "shared_calendar_notification_enabled";
const NOTIFICATION_HISTORY_KEY = "shared_calendar_notification_history";
const NOTIFICATION_SETTINGS_KEY = "shared_calendar_notification_settings";

const DEFAULT_NOTIFICATION_SETTINGS = {
  eventBeforeMinutes: [30, 5],
  eventAtStart: true,
  taskDeadlineEnabled: true,
  mailReminderEnabled: true,
  historyRetentionDays: 30,
};

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

// 通知履歴
const notificationHistoryBtn = document.getElementById("notificationHistoryBtn");
const notificationHistoryModal = document.getElementById("notificationHistoryModal");
const notificationHistoryList = document.getElementById("notificationHistoryList");
const closeNotificationHistoryBtn = document.getElementById("closeNotificationHistoryBtn");
const clearNotificationHistoryBtn = document.getElementById("clearNotificationHistoryBtn");

// 通知設定
const notificationSettingsBtn = document.getElementById("notificationSettingsBtn");
const notificationSettingsModal = document.getElementById("notificationSettingsModal");
const closeNotificationSettingsBtn = document.getElementById("closeNotificationSettingsBtn");
const saveNotificationSettingsBtn = document.getElementById("saveNotificationSettingsBtn");

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
// 通知ON/OFF状態
// ==========================================
function isNotificationEnabled() {
  const raw = localStorage.getItem(NOTIFICATION_ENABLED_KEY);
  if (raw === null) return true;
  return raw === "true";
}

function setNotificationEnabled(enabled) {
  localStorage.setItem(NOTIFICATION_ENABLED_KEY, String(enabled));
}

function updateNotificationToggleUI() {}

function normalizeMinutes(values) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map((value) => Number(value)).filter((value) => Number.isFinite(value) && value > 0))]
    .sort((a, b) => b - a);
}

function normalizeNotificationSettings(settings) {
  const merged = { ...DEFAULT_NOTIFICATION_SETTINGS, ...(settings || {}) };
  merged.eventBeforeMinutes = normalizeMinutes(merged.eventBeforeMinutes);
  merged.eventAtStart = merged.eventAtStart !== false;
  merged.taskDeadlineEnabled = merged.taskDeadlineEnabled !== false;
  merged.mailReminderEnabled = merged.mailReminderEnabled !== false;

  const retention = Number(merged.historyRetentionDays);
  merged.historyRetentionDays = Number.isFinite(retention)
    ? Math.min(Math.max(Math.floor(retention), 1), 365)
    : DEFAULT_NOTIFICATION_SETTINGS.historyRetentionDays;

  return merged;
}

function getNotificationSettings() {
  const raw = localStorage.getItem(NOTIFICATION_SETTINGS_KEY);
  if (!raw) return normalizeNotificationSettings(DEFAULT_NOTIFICATION_SETTINGS);

  try {
    return normalizeNotificationSettings(JSON.parse(raw));
  } catch (e) {
    return normalizeNotificationSettings(DEFAULT_NOTIFICATION_SETTINGS);
  }
}

function saveNotificationSettings(settings) {
  localStorage.setItem(
    NOTIFICATION_SETTINGS_KEY,
    JSON.stringify(normalizeNotificationSettings(settings))
  );
}

function getEventReminderMinutes(event) {
  if (Array.isArray(event.reminderMinutes)) {
    return normalizeMinutes(event.reminderMinutes);
  }
  return getNotificationSettings().eventBeforeMinutes;
}

function getEventNotifyAtStart(event) {
  if (typeof event.notifyAtStart === "boolean") return event.notifyAtStart;
  return getNotificationSettings().eventAtStart;
}

function formatReminderLabel(minutes) {
  if (minutes % 1440 === 0) return `${minutes / 1440}日前`;
  if (minutes % 60 === 0) return `${minutes / 60}時間前`;
  return `${minutes}分前`;
}

function makeReminderTarget(baseDate, minutes) {
  return new Date(baseDate.getTime() - minutes * 60 * 1000);
}

// ==========================================
// 通知履歴管理（30日保持）
// ==========================================
function getNotificationHistory() {
  return JSON.parse(localStorage.getItem(NOTIFICATION_HISTORY_KEY)) || [];
}

function saveNotificationHistory(items) {
  localStorage.setItem(NOTIFICATION_HISTORY_KEY, JSON.stringify(items));
}

function pruneOldNotificationHistory() {
  const now = Date.now();
  const retentionDays = getNotificationSettings().historyRetentionDays;
  const retentionMs = retentionDays * 24 * 60 * 60 * 1000;
  const items = getNotificationHistory();
  const pruned = items.filter((item) => {
    return now - item.timestamp <= retentionMs;
  });
  saveNotificationHistory(pruned);
}

function addNotificationHistory({ title, body, tag }) {
  pruneOldNotificationHistory();

  const items = getNotificationHistory();
  items.unshift({
    id: Date.now() + "_" + Math.floor(Math.random() * 100000),
    title,
    body,
    tag: tag || "",
    timestamp: Date.now(),
  });

  saveNotificationHistory(items);
}

function formatDateTimeForHistory(ts) {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${y}/${m}/${day} ${hh}:${mm}:${ss}`;
}

function renderNotificationHistory() {
  pruneOldNotificationHistory();

  const items = getNotificationHistory();
  notificationHistoryList.innerHTML = "";

  if (items.length === 0) {
    notificationHistoryList.innerHTML = `
      <p style="padding:20px; text-align:center;">通知履歴はありません</p>
    `;
    return;
  }

  items.forEach((item) => {
    const card = document.createElement("div");
    card.className = "event-card";
    card.innerHTML = `
      <div style="padding:12px; border-bottom:1px solid #ddd;">
        <h4>${item.title}</h4>
        <p>${item.body}</p>
        <p style="opacity:0.8;">${formatDateTimeForHistory(item.timestamp)}</p>
      </div>
    `;
    notificationHistoryList.appendChild(card);
  });
}

function openNotificationHistoryModal() {
  renderNotificationHistory();
  notificationHistoryModal.style.display = "flex";
}

function closeNotificationHistoryModal() {
  notificationHistoryModal.style.display = "none";
}

function addReminderChip(list, label, onDelete) {
  const chip = document.createElement("span");
  chip.className = "reminder-chip";

  const text = document.createElement("span");
  text.textContent = label;

  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "削除";
  button.addEventListener("click", onDelete);

  chip.appendChild(text);
  chip.appendChild(button);
  list.appendChild(chip);
}

function renderReminderList(listId, minutes, atStart, removeMinute, removeStart) {
  const list = document.getElementById(listId);
  if (!list) return;

  list.innerHTML = "";

  minutes.forEach((minute) => {
    addReminderChip(list, formatReminderLabel(minute), () => removeMinute(minute));
  });

  if (atStart) {
    addReminderChip(list, "開始/期限時刻", removeStart);
  }

  if (list.children.length === 0) {
    list.innerHTML = `<span class="reminder-empty">通知なし</span>`;
  }
}

function setEventReminderControls(minutes, atStart) {
  const normalized = normalizeMinutes(minutes);
  document.getElementById("remind30").checked = normalized.includes(30);
  document.getElementById("remind5").checked = normalized.includes(5);
  document.getElementById("remindStart").checked = !!atStart;

  const custom = normalized.find((value) => value !== 30 && value !== 5);
  document.getElementById("customReminderMinutes").value = custom || "";
  renderEventReminderList();
}

function collectEventReminderMinutes() {
  const minutes = [];
  if (document.getElementById("remind30").checked) minutes.push(30);
  if (document.getElementById("remind5").checked) minutes.push(5);

  const custom = Number(document.getElementById("customReminderMinutes").value);
  if (Number.isFinite(custom) && custom > 0) minutes.push(Math.floor(custom));

  return normalizeMinutes(minutes);
}

function removeEventReminder(minutes) {
  if (minutes === 30) document.getElementById("remind30").checked = false;
  else if (minutes === 5) document.getElementById("remind5").checked = false;
  else document.getElementById("customReminderMinutes").value = "";

  renderEventReminderList();
}

function removeEventStartReminder() {
  document.getElementById("remindStart").checked = false;
  renderEventReminderList();
}

function renderEventReminderList() {
  renderReminderList(
    "eventReminderList",
    collectEventReminderMinutes(),
    document.getElementById("remindStart").checked,
    removeEventReminder,
    removeEventStartReminder
  );
}

function updateEventOptionVisibility() {
  const eventType = document.getElementById("eventType").value;
  document.getElementById("taskOptions").classList.toggle("hidden", eventType !== "task");
  document.getElementById("mailOptions").classList.toggle("hidden", eventType !== "mail");
}

function setSettingsReminderControls(settings) {
  const minutes = normalizeMinutes(settings.eventBeforeMinutes);
  document.getElementById("settingsRemind30").checked = minutes.includes(30);
  document.getElementById("settingsRemind5").checked = minutes.includes(5);
  document.getElementById("settingsRemindStart").checked = !!settings.eventAtStart;

  const custom = minutes.find((value) => value !== 30 && value !== 5);
  document.getElementById("settingsCustomReminderMinutes").value = custom || "";
  renderSettingsReminderList();
}

function collectSettingsReminderMinutes() {
  const minutes = [];
  if (document.getElementById("settingsRemind30").checked) minutes.push(30);
  if (document.getElementById("settingsRemind5").checked) minutes.push(5);

  const custom = Number(document.getElementById("settingsCustomReminderMinutes").value);
  if (Number.isFinite(custom) && custom > 0) minutes.push(Math.floor(custom));

  return normalizeMinutes(minutes);
}

function removeSettingsReminder(minutes) {
  if (minutes === 30) document.getElementById("settingsRemind30").checked = false;
  else if (minutes === 5) document.getElementById("settingsRemind5").checked = false;
  else document.getElementById("settingsCustomReminderMinutes").value = "";

  renderSettingsReminderList();
}

function removeSettingsStartReminder() {
  document.getElementById("settingsRemindStart").checked = false;
  renderSettingsReminderList();
}

function renderSettingsReminderList() {
  renderReminderList(
    "settingsReminderList",
    collectSettingsReminderMinutes(),
    document.getElementById("settingsRemindStart").checked,
    removeSettingsReminder,
    removeSettingsStartReminder
  );
}

function openNotificationSettingsModal() {
  const settings = getNotificationSettings();
  document.getElementById("settingsNotificationEnabled").checked = isNotificationEnabled();
  document.getElementById("settingsTaskDeadlineEnabled").checked = settings.taskDeadlineEnabled;
  document.getElementById("settingsMailReminderEnabled").checked = settings.mailReminderEnabled;
  document.getElementById("settingsHistoryRetentionDays").value = settings.historyRetentionDays;
  setSettingsReminderControls(settings);
  notificationSettingsModal.style.display = "flex";
}

function closeNotificationSettingsModal() {
  notificationSettingsModal.style.display = "none";
}

function saveNotificationSettingsFromForm() {
  const settings = getNotificationSettings();
  settings.eventBeforeMinutes = collectSettingsReminderMinutes();
  settings.eventAtStart = document.getElementById("settingsRemindStart").checked;
  settings.taskDeadlineEnabled = document.getElementById("settingsTaskDeadlineEnabled").checked;
  settings.mailReminderEnabled = document.getElementById("settingsMailReminderEnabled").checked;
  settings.historyRetentionDays = document.getElementById("settingsHistoryRetentionDays").value;

  saveNotificationSettings(settings);
  setNotificationEnabled(document.getElementById("settingsNotificationEnabled").checked);
  updateNotificationToggleUI();
  pruneOldNotificationHistory();
  closeNotificationSettingsModal();
  alert("通知設定を保存しました");
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
  const settings = getNotificationSettings();

  selectedEventId = null;
  document.getElementById("eventTitle").value = "";
  document.getElementById("eventMemo").value = "";
  document.getElementById("eventVisibility").value = "public";
  document.getElementById("allDay").checked = false;
  document.getElementById("eventType").value = "event";
  document.getElementById("taskDeadlineNotify").checked = settings.taskDeadlineEnabled;
  document.getElementById("mailReminderEnabled").checked = settings.mailReminderEnabled;
  document.getElementById("mailTo").value = "";
  document.getElementById("mailSubject").value = "";
  document.getElementById("mailRemindAt").value = "";
  document.getElementById("mailSent").checked = false;
  setEventReminderControls(settings.eventBeforeMinutes, settings.eventAtStart);
  updateEventOptionVisibility();
}

// ==========================================
// 新規予定登録
// - 開始日時 = 現在の年月日時分
// - 終了日時 = 開始日時の日付 +1日（同時刻）
// ==========================================
function openCreateEvent() {
  resetForm();

  const now = new Date();
  const start = ceilToNext5Minutes(now);

  const end = new Date(start);
  end.setDate(end.getDate() + 1);

  document.getElementById("eventStart").value = formatDateTimeLocal(start);
  document.getElementById("eventEnd").value = formatDateTimeLocal(end);
  document.getElementById("mailRemindAt").value = formatDateTimeLocal(start);

  openModal();
}

// ==========================================
// 編集モード
// ==========================================
function openEditEvent(event) {
  const settings = getNotificationSettings();

  selectedEventId = event.id;
  document.getElementById("eventTitle").value = event.title;
  document.getElementById("eventMemo").value = event.memo || "";
  document.getElementById("eventStart").value = event.start;
  document.getElementById("eventEnd").value = event.end;
  document.getElementById("eventVisibility").value = event.visibility;
  document.getElementById("allDay").checked = event.allDay;
  document.getElementById("eventType").value = event.eventType || "event";
  document.getElementById("taskDeadlineNotify").checked =
    typeof event.taskDeadlineNotify === "boolean" ? event.taskDeadlineNotify : settings.taskDeadlineEnabled;
  document.getElementById("mailReminderEnabled").checked =
    typeof event.mailReminderEnabled === "boolean" ? event.mailReminderEnabled : settings.mailReminderEnabled;
  document.getElementById("mailTo").value = event.mailTo || "";
  document.getElementById("mailSubject").value = event.mailSubject || "";
  document.getElementById("mailRemindAt").value = event.mailRemindAt || event.start || "";
  document.getElementById("mailSent").checked = !!event.mailSent;
  setEventReminderControls(getEventReminderMinutes(event), getEventNotifyAtStart(event));
  updateEventOptionVisibility();
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
  if (!isNotificationEnabled()) return;
  if (!("Notification" in window)) return;
  if (Notification.permission !== "granted") return;

  const n = new Notification(title, {
    body,
    tag: tag || "shared-calendar",
    icon: "https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f4c5.png",
  });

  // 通知履歴に保存（30日保持）
  addNotificationHistory({ title, body, tag });

  n.onclick = () => {
    window.location.href = CURRENT_PAGE_URL;
    window.focus();
    n.close();
  };

  setTimeout(() => n.close(), 6000);
}

// ==========================================
// 予定通知チェック
// 個別通知 / タスク期限 / メール送信リマインド
// ==========================================
function notifyOnce(flags, key, targetTime, prev, now, title, body) {
  if (!(targetTime instanceof Date) || isNaN(targetTime.getTime())) return;
  if (flags[key]) return;
  if (targetTime > prev && targetTime <= now) {
    showWindowsNotification(title, body, key);
    flags[key] = true;
  }
}

function checkEventNotifications() {
  if (!isNotificationEnabled()) {
    lastCheckTime = new Date();
    return;
  }

  const settings = getNotificationSettings();
  const events = getEvents();
  const now = new Date();
  const prev = lastCheckTime || new Date(now.getTime() - 5000);
  const flags = getNotifiedFlags();

  events.forEach((event) => {
    const eventType = event.eventType || "event";
    const reminderMinutes = getEventReminderMinutes(event);
    const notifyAtStart = getEventNotifyAtStart(event);

    if (!event.allDay && event.start && eventType === "event") {
      const startTime = new Date(event.start);
      if (!isNaN(startTime.getTime())) {
        reminderMinutes.forEach((minutes) => {
          const key = `${event.id}_${event.start}_start_before_${minutes}`;
          const target = makeReminderTarget(startTime, minutes);
          notifyOnce(
            flags,
            key,
            target,
            prev,
            now,
            "予定通知",
            `「${event.title}」の${formatReminderLabel(minutes)}です`
          );
        });

        if (notifyAtStart) {
          const key = `${event.id}_${event.start}_start_at`;
          notifyOnce(
            flags,
            key,
            startTime,
            prev,
            now,
            "予定通知",
            `「${event.title}」の開始時刻になりました`
          );
        }
      }
    }

    if (
      eventType === "task" &&
      settings.taskDeadlineEnabled &&
      event.taskDeadlineNotify !== false &&
      event.end
    ) {
      const deadlineTime = new Date(event.end);
      if (!isNaN(deadlineTime.getTime())) {
        reminderMinutes.forEach((minutes) => {
          const key = `${event.id}_${event.end}_task_before_${minutes}`;
          const target = makeReminderTarget(deadlineTime, minutes);
          notifyOnce(
            flags,
            key,
            target,
            prev,
            now,
            "タスク期限通知",
            `「${event.title}」の期限${formatReminderLabel(minutes)}です`
          );
        });

        if (notifyAtStart) {
          const key = `${event.id}_${event.end}_task_deadline`;
          notifyOnce(
            flags,
            key,
            deadlineTime,
            prev,
            now,
            "タスク期限通知",
            `「${event.title}」の期限時刻です`
          );
        }
      }
    }

    if (
      settings.mailReminderEnabled &&
      event.mailReminderEnabled &&
      !event.mailSent &&
      event.mailRemindAt
    ) {
      const mailTime = new Date(event.mailRemindAt);
      const key = `${event.id}_${event.mailRemindAt}_mail`;
      const subjectText = event.mailSubject ? ` 件名: ${event.mailSubject}` : "";
      const toText = event.mailTo ? ` 宛先: ${event.mailTo}` : "";

      notifyOnce(
        flags,
        key,
        mailTime,
        prev,
        now,
        "メール送信リマインド",
        `「${event.title}」のメール送信を確認してください。${toText}${subjectText}`
      );
    }
  });

  const activeIds = new Set(events.map((event) => String(event.id)));
  Object.keys(flags).forEach((key) => {
    const id = String(key).split("_")[0];
    if (!activeIds.has(id)) delete flags[key];
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
    pruneOldNotificationHistory(); // 自動削除
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
  const eventType = document.getElementById("eventType").value;
  const reminderMinutes = collectEventReminderMinutes();
  const notifyAtStart = document.getElementById("remindStart").checked;
  const taskDeadlineNotify =
    eventType === "task" && document.getElementById("taskDeadlineNotify").checked;
  const mailReminderEnabled =
    eventType === "mail" && document.getElementById("mailReminderEnabled").checked;
  const mailTo = document.getElementById("mailTo").value.trim();
  const mailSubject = document.getElementById("mailSubject").value.trim();
  const mailRemindAt = document.getElementById("mailRemindAt").value;
  const mailSent = document.getElementById("mailSent").checked;
  const date = start.substring(0, 10);

  if (mailReminderEnabled && mailRemindAt === "") {
    alert("メール送信リマインドの通知日時を入力してください");
    return;
  }

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
    eventType,
    reminderMinutes,
    notifyAtStart,
    taskDeadlineNotify,
    mailReminderEnabled,
    mailTo,
    mailSubject,
    mailRemindAt,
    mailSent,
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
  if (!localStorage.getItem(NOTIFICATION_ENABLED_KEY)) {
    setNotificationEnabled(true);
  }
  if (!localStorage.getItem(NOTIFICATION_HISTORY_KEY)) {
    saveNotificationHistory([]);
  }
  saveNotificationSettings(getNotificationSettings());
  pruneOldNotificationHistory();
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
    closeNotificationHistoryModal();
    closeNotificationSettingsModal();
  }
});

// 開始/終了の整合補正（終了は開始+1日が最低）
document.getElementById("eventStart").addEventListener("change", (e) => {
  const startVal = e.target.value;
  const endInput = document.getElementById("eventEnd");

  if (!startVal) return;

  const startDate = new Date(startVal);
  const minEnd = new Date(startDate);
  minEnd.setDate(minEnd.getDate() + 1);

  const endDate = new Date(endInput.value);

  if (!endInput.value || isNaN(endDate.getTime()) || endDate < minEnd) {
    endInput.value = formatDateTimeLocal(minEnd);
  }
});

document.getElementById("eventType").addEventListener("change", updateEventOptionVisibility);

["remind30", "remind5", "remindStart", "customReminderMinutes"].forEach((id) => {
  const element = document.getElementById(id);
  element.addEventListener(id.includes("custom") ? "input" : "change", renderEventReminderList);
});

["settingsRemind30", "settingsRemind5", "settingsRemindStart", "settingsCustomReminderMinutes"].forEach((id) => {
  const element = document.getElementById(id);
  element.addEventListener(id.includes("Custom") ? "input" : "change", renderSettingsReminderList);
});


// 通知履歴ボタン
notificationHistoryBtn.addEventListener("click", () => {
  openNotificationHistoryModal();
});

closeNotificationHistoryBtn.addEventListener("click", () => {
  closeNotificationHistoryModal();
});

clearNotificationHistoryBtn.addEventListener("click", () => {
  const ok = confirm("通知履歴をすべて削除しますか？");
  if (!ok) return;
  saveNotificationHistory([]);
  renderNotificationHistory();
});

notificationHistoryModal.addEventListener("click", (e) => {
  if (e.target === notificationHistoryModal) {
    closeNotificationHistoryModal();
  }
});

notificationSettingsBtn.addEventListener("click", () => {
  openNotificationSettingsModal();
});

closeNotificationSettingsBtn.addEventListener("click", () => {
  closeNotificationSettingsModal();
});

saveNotificationSettingsBtn.addEventListener("click", saveNotificationSettingsFromForm);

notificationSettingsModal.addEventListener("click", (e) => {
  if (e.target === notificationSettingsModal) {
    closeNotificationSettingsModal();
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

  updateNotificationToggleUI();

  const asked = localStorage.getItem("notificationAsked");
  if (!asked) {
    const ok = confirm("Windows通知（30分前/5分前/開始時刻）を有効にしますか？");
    if (ok) {
      const granted = await ensureNotificationPermission();
      setNotificationEnabled(granted);
    } else {
      setNotificationEnabled(false);
    }
    localStorage.setItem("notificationAsked", "true");
    updateNotificationToggleUI();
  }

  startNotificationWatcher();
}

init();