// calendar-notification.js
// Client-side Web Notification Watcher and settings sync with PostgreSQL backend

import { apiRequest } from './calendar-auth.js';
import { getEvents, showToast, showFieldError, clearFieldErrors } from './calendar-state.js';

let notificationTimer = null;
let lastCheckTime = new Date();
let serviceWorkerRegistrationPromise = null;
let pushSubscriptionPromise = null;
let adminAnnouncementTimer = null;
let adminAnnouncementInitialCheckDone = false;
let latestAdminAnnouncementLogs = [];
const NOTIFIED_KEY = "shared_calendar_notified_flags";
const LOCAL_SETTINGS_KEY = "shared_calendar_notification_settings_local";
const ADMIN_ANNOUNCEMENT_LAST_KEY = "shared_calendar_last_admin_announcement";
const ADMIN_ANNOUNCEMENT_CHECK_MS = 30000;

// Default settings if not in LocalStorage
const DEFAULT_LOCAL_SETTINGS = {
  eventBeforeMinutes: [30, 5],
  eventAtStart: true,
  historyRetentionDays: 30
};

// Global notification toggles synced from backend
let backendSettings = {
  events: true,
  tasks: true,
  game: true,
  email: true
};

export function getBackendSettings() {
  return backendSettings;
}

// Get client-side settings
export function getLocalSettings() {
  try {
    const raw = localStorage.getItem(LOCAL_SETTINGS_KEY);
    return raw ? JSON.parse(raw) : DEFAULT_LOCAL_SETTINGS;
  } catch {
    return DEFAULT_LOCAL_SETTINGS;
  }
}

export function saveLocalSettings(settings) {
  localStorage.setItem(LOCAL_SETTINGS_KEY, JSON.stringify(settings));
}

// Request permissions
export async function ensureNotificationPermission() {
  if (!("Notification" in window)) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;

  const permission = await Notification.requestPermission();
  return permission === "granted";
}

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    return null;
  }

  if (!serviceWorkerRegistrationPromise) {
    serviceWorkerRegistrationPromise = navigator.serviceWorker.register("/sw.js")
      .then(() => navigator.serviceWorker.ready);
  }

  return serviceWorkerRegistrationPromise;
}

export async function subscribeToPwaPush({ requestPermission = false } = {}) {
  if (pushSubscriptionPromise) return pushSubscriptionPromise;

  pushSubscriptionPromise = (async () => {
    if (!("Notification" in window)) return false;
    if (Notification.permission === "denied") return false;
    if (Notification.permission !== "granted") {
      if (!requestPermission) return false;
      const permitted = await ensureNotificationPermission();
      if (!permitted) return false;
    }

    const registration = await registerServiceWorker();
    if (!registration) return false;

    const keyResponse = await apiRequest("/api/notifications/vapid-public-key");
    if (!keyResponse.publicKey) {
      console.info("VAPID public key is not configured. Web Push subscription skipped.");
      return false;
    }

    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(keyResponse.publicKey)
      });
    }

    await apiRequest("/api/notifications/subscribe", {
      method: "POST",
      body: JSON.stringify({ subscription })
    });

    return true;
  })();

  try {
    const result = await pushSubscriptionPromise;
    if (!result) pushSubscriptionPromise = null;
    return result;
  } catch (err) {
    pushSubscriptionPromise = null;
    console.error("Failed to subscribe to PWA push:", err);
    return false;
  }
}

// Sync settings from backend
export async function syncNotificationSettings() {
  try {
    backendSettings = await apiRequest('/api/notifications/settings');
    updateSettingsUI();
  } catch (err) {
    console.error('Failed to sync notification settings:', err);
  }
}

// Update UI checkboxes in Settings Modal
function updateSettingsUI() {
  const enabledCheckbox = document.getElementById("settingsNotificationEnabled");
  const taskCheckbox = document.getElementById("settingsTaskDeadlineEnabled");
  const emailCheckbox = document.getElementById("settingsMailReminderEnabled");
  
  if (enabledCheckbox) enabledCheckbox.checked = backendSettings.events;
  if (taskCheckbox) taskCheckbox.checked = backendSettings.tasks;
  if (emailCheckbox) emailCheckbox.checked = backendSettings.email;

  const local = getLocalSettings();
  const remind30 = document.getElementById("settingsRemind30");
  const remind5 = document.getElementById("settingsRemind5");
  const remindStart = document.getElementById("settingsRemindStart");
  
  if (remind30) remind30.checked = local.eventBeforeMinutes.includes(30);
  if (remind5) remind5.checked = local.eventBeforeMinutes.includes(5);
  if (remindStart) remindStart.checked = !!local.eventAtStart;

  const custom = local.eventBeforeMinutes.find(m => m !== 30 && m !== 5);
  const customInput = document.getElementById("settingsCustomReminderMinutes");
  if (customInput) customInput.value = custom || "";

  const retention = document.getElementById("settingsHistoryRetentionDays");
  if (retention) retention.value = local.historyRetentionDays || 30;

  renderSettingsReminderList();
}

// Open notification settings modal
export function openNotificationSettingsModal() {
  syncNotificationSettings();
  const modal = document.getElementById("notificationSettingsModal");
  if (modal) modal.style.display = "flex";
}

export function closeNotificationSettingsModal() {
  const modal = document.getElementById("notificationSettingsModal");
  if (modal) modal.style.display = "none";
}

// Save notification settings
export async function saveNotificationSettingsFromForm() {
  clearFieldErrors(document.getElementById("notificationSettingsModal"));
  const enabled = document.getElementById("settingsNotificationEnabled")?.checked ?? true;
  const tasks = document.getElementById("settingsTaskDeadlineEnabled")?.checked ?? true;
  const email = document.getElementById("settingsMailReminderEnabled")?.checked ?? true;
  const customRaw = document.getElementById("settingsCustomReminderMinutes")?.value;
  const customValue = Number(customRaw);
  if (customRaw && (!Number.isFinite(customValue) || customValue < 1 || customValue > 10080)) {
    return showFieldError("settingsCustomReminderMinutes", "カスタム通知は1から10080分の範囲で入力してください");
  }

  const retentionRaw = document.getElementById("settingsHistoryRetentionDays")?.value;
  const retentionValue = Number(retentionRaw);
  if (retentionRaw && (!Number.isFinite(retentionValue) || retentionValue < 1 || retentionValue > 365)) {
    return showFieldError("settingsHistoryRetentionDays", "通知履歴の保持日数は1から365日の範囲で入力してください");
  }

  try {
    await apiRequest('/api/notifications/settings', {
      method: 'POST',
      body: JSON.stringify({
        events: enabled,
        tasks: tasks,
        game: true,
        email: email
      })
    });

    // Save local settings
    const eventBeforeMinutes = [];
    if (document.getElementById("settingsRemind30")?.checked) eventBeforeMinutes.push(30);
    if (document.getElementById("settingsRemind5")?.checked) eventBeforeMinutes.push(5);
    
    const custom = parseInt(document.getElementById("settingsCustomReminderMinutes")?.value);
    if (!isNaN(custom) && custom > 0) eventBeforeMinutes.push(custom);

    const eventAtStart = document.getElementById("settingsRemindStart")?.checked ?? true;
    const historyRetentionDays = parseInt(document.getElementById("settingsHistoryRetentionDays")?.value) || 30;

    saveLocalSettings({
      eventBeforeMinutes,
      eventAtStart,
      historyRetentionDays
    });

    backendSettings = { events: enabled, tasks, game: true, email };

    if (enabled || tasks || email) {
      await subscribeToPwaPush({ requestPermission: true });
    }

    closeNotificationSettingsModal();
    showToast("通知設定を保存しました ⚙️");
  } catch (err) {
    console.error('Failed to save settings:', err);
    showToast(err.message || "通知設定の保存に失敗しました");
  }
}

// Local notified flags
function getNotifiedFlags() {
  try {
    return JSON.parse(localStorage.getItem(NOTIFIED_KEY)) || {};
  } catch {
    return {};
  }
}

function saveNotifiedFlags(flags) {
  localStorage.setItem(NOTIFIED_KEY, JSON.stringify(flags));
}

// Show Windows notification and post log to PostgreSQL history
export async function triggerNotification(title, message, type = 'event') {
  if (!("Notification" in window) || Notification.permission !== "granted") return;

  new Notification(title, {
    body: message,
    icon: "https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f4c5.png",
    tag: "shared-calendar"
  });

  // Save log to PostgreSQL backend
  try {
    await apiRequest('/api/notifications/history', {
      method: 'POST',
      body: JSON.stringify({ title, message, type })
    });
  } catch (err) {
    console.error('Failed to save notification log to backend:', err);
  }
}

function formatDateOnly(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function isScheduleDateBeforeToday(value, now) {
  const datePart = String(value || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return false;
  return datePart < formatDateOnly(now);
}

// Notification watcher core scanning loop
export function checkEventNotifications() {
  // If global notifications are disabled
  if (!backendSettings.events) {
    lastCheckTime = new Date();
    return;
  }

  const events = getEvents();
  const now = new Date();
  const prev = lastCheckTime || new Date(now.getTime() - 5000);
  const flags = getNotifiedFlags();
  const local = getLocalSettings();

  events.forEach(event => {
    const type = event.eventType || 'event';
    const reminderMinutes = event.reminderMinutes || local.eventBeforeMinutes;
    const notifyAtStart = (event.notifyAtStart !== undefined) ? event.notifyAtStart : local.eventAtStart;
    const scheduleDateSource = type === 'task' ? event.end : event.start;

    if (isScheduleDateBeforeToday(scheduleDateSource, now)) {
      return;
    }

    // Standard event alerts
    if (type === 'event' && !event.allday && event.start) {
      const startTime = new Date(event.start);
      if (!isNaN(startTime.getTime())) {
        reminderMinutes.forEach(mins => {
          const key = `${event.id}_${event.start}_start_before_${mins}`;
          const targetTime = new Date(startTime.getTime() - mins * 60 * 1000);
          
          if (!flags[key] && targetTime > prev && targetTime <= now) {
            triggerNotification("予定通知", `「${event.title}」の${mins}分前です`, 'event');
            flags[key] = true;
          }
        });

        if (notifyAtStart) {
          const key = `${event.id}_${event.start}_start_at`;
          if (!flags[key] && startTime > prev && startTime <= now) {
            triggerNotification("予定通知", `「${event.title}」の開始時刻になりました`, 'event');
            flags[key] = true;
          }
        }
      }
    }

    // Task deadline alerts
    if (type === 'task' && backendSettings.tasks && event.taskDeadlineNotify !== false && event.end) {
      const deadlineTime = new Date(event.end);
      if (!isNaN(deadlineTime.getTime())) {
        reminderMinutes.forEach(mins => {
          const key = `${event.id}_${event.end}_task_before_${mins}`;
          const targetTime = new Date(deadlineTime.getTime() - mins * 60 * 1000);

          if (!flags[key] && targetTime > prev && targetTime <= now) {
            triggerNotification("タスク期限通知", `「${event.title}」の期限${mins}分前です`, 'task');
            flags[key] = true;
          }
        });

        if (notifyAtStart) {
          const key = `${event.id}_${event.end}_task_deadline`;
          if (!flags[key] && deadlineTime > prev && deadlineTime <= now) {
            triggerNotification("タスク期限通知", `「${event.title}」の期限時刻です`, 'task');
            flags[key] = true;
          }
        }
      }
    }

    // Email reminder alerts
    if (type === 'mail' && backendSettings.email && event.mailReminderEnabled && !event.mailSent && event.mailRemindAt) {
      const mailTime = new Date(event.mailRemindAt);
      const key = `${event.id}_${event.mailRemindAt}_mail`;
      const subject = event.mailSubject ? ` (件名: ${event.mailSubject})` : "";
      const to = event.mailTo ? ` (宛先: ${event.mailTo})` : "";

      if (!flags[key] && mailTime > prev && mailTime <= now) {
        triggerNotification("メール送信リマインド", `「${event.title}」のメール送信時間です。確認してください。${to}${subject}`, 'email');
        flags[key] = true;
      }
    }
  });

  // Clean obsolete notified flags
  const activeIds = new Set(events.map(e => String(e.id)));
  Object.keys(flags).forEach(k => {
    const id = k.split("_")[0];
    if (!activeIds.has(id)) {
      delete flags[k];
    }
  });

  saveNotifiedFlags(flags);
  lastCheckTime = now;
}

// Start watching notifications
export function startNotificationWatcher() {
  if (notificationTimer) clearInterval(notificationTimer);
  lastCheckTime = new Date();
  subscribeToPwaPush({ requestPermission: false });
  
  // Watcher runs every 5 seconds
  notificationTimer = setInterval(() => {
    checkEventNotifications();
  }, 5000);
}

// Notification history list rendering
export async function syncNotificationHistory() {
  const container = document.getElementById("notificationHistoryList");
  if (!container) return;

  try {
    const logs = await apiRequest('/api/notifications/history');
    container.innerHTML = "";

    if (logs.length === 0) {
      container.innerHTML = '<p style="text-align:center; padding:20px; opacity:0.7;">通知履歴はありません</p>';
      return;
    }

    logs.forEach(log => {
      const card = document.createElement("div");
      card.className = "event-card";
      
      const time = new Date(log.sent_at).toLocaleString();
      const typeLabel = log.type === 'task' ? '📋 タスク' : (log.type === 'email' ? '✉️ メール' : '📅 予定');

      card.innerHTML = `
        <div style="padding:12px; border-bottom:1px solid var(--border);">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
            <h4 style="margin:0; font-size:14px; font-weight:700;">${log.title}</h4>
            <span style="font-size:10px; font-weight:600; opacity:0.7;">${typeLabel}</span>
          </div>
          <p style="margin:4px 0; font-size:13px; line-height:1.4;">${log.message}</p>
          <span style="font-size:10px; opacity:0.6;">${time}</span>
        </div>
      `;
      container.appendChild(card);
    });
  } catch (err) {
    console.error('Failed to sync notification history:', err);
    container.innerHTML = '<p style="color:var(--ios-red); padding:10px;">通知履歴の読み込みに失敗しました</p>';
  }
}

// Clear logs
export async function clearNotificationHistory() {
  const ok = confirm("通知履歴をすべて削除しますか？");
  if (!ok) return;

  try {
    await apiRequest('/api/notifications/history', {
      method: 'DELETE'
    });
    showToast("通知履歴をクリアしました 🧹");
    syncNotificationHistory();
  } catch (err) {
    console.error('Failed to clear history:', err);
  }
}

// Open notification history modal
export function openNotificationHistoryModal() {
  syncNotificationHistory();
  const modal = document.getElementById("notificationHistoryModal");
  if (modal) modal.style.display = "flex";
}

export function closeNotificationHistoryModal() {
  const modal = document.getElementById("notificationHistoryModal");
  if (modal) modal.style.display = "none";
}

function normalizeAnnouncementTitle(title) {
  return String(title || "お知らせ")
    .replace(/^\[(お知らせ|縺顔衍繧峨○)\]\s*/, "")
    .trim() || "お知らせ";
}

function formatAnnouncementTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

async function fetchAdminAnnouncements() {
  const logs = await apiRequest("/api/notifications/history");
  return Array.isArray(logs)
    ? logs.filter(log => log.type === "announcement")
    : [];
}

function isUnreadAnnouncement(log) {
  return log && log.status !== "read";
}

function getAdminAnnouncementUnreadCount(logs = latestAdminAnnouncementLogs) {
  return logs.filter(isUnreadAnnouncement).length;
}

function updateAdminAnnouncementUnreadBadge(logs = latestAdminAnnouncementLogs) {
  const count = getAdminAnnouncementUnreadCount(logs);
  const label = count > 99 ? "99+" : String(count);
  const badgeIds = [
    "adminAnnouncementUnreadBadge",
    "mobileAdminAnnouncementUnreadBadge",
    "sidebarAdminAnnouncementUnreadBadge"
  ];

  badgeIds.forEach(id => {
    const badge = document.getElementById(id);
    if (!badge) return;
    badge.textContent = label;
    badge.classList.toggle("hidden", count <= 0);
  });
}

function isAdminAnnouncementsModalOpen() {
  const modal = document.getElementById("adminAnnouncementsModal");
  return !!modal && modal.style.display === "flex";
}

function markAdminAnnouncementRead(log, selectedButton) {
  if (!isUnreadAnnouncement(log) || !log.id) return;

  log.status = "read";
  selectedButton?.classList.remove("unread");
  updateAdminAnnouncementUnreadBadge();

  apiRequest(`/api/notifications/history/${encodeURIComponent(log.id)}/read`, {
    method: "PATCH"
  }).catch(err => {
    console.error("Failed to mark admin announcement as read:", err);
    log.status = "unread";
    selectedButton?.classList.add("unread");
    updateAdminAnnouncementUnreadBadge();
  });
}

function renderAdminAnnouncements(logs) {
  const container = document.getElementById("adminAnnouncementsList");
  if (!container) return;

  container.innerHTML = "";

  if (!logs.length) {
    const empty = document.createElement("p");
    empty.className = "admin-announcement-empty";
    empty.textContent = "管理者からのお知らせはまだありません";
    container.appendChild(empty);
    return;
  }

  const mailbox = document.createElement("div");
  mailbox.className = "admin-mailbox";

  const list = document.createElement("div");
  list.className = "admin-mailbox-list";

  const detail = document.createElement("article");
  detail.className = "admin-mailbox-detail";

  function showMail(log, selectedButton) {
    list.querySelectorAll(".admin-mailbox-item").forEach(button => {
      button.classList.toggle("active", button === selectedButton);
    });

    detail.innerHTML = "";

    const fromRow = document.createElement("div");
    fromRow.className = "admin-mailbox-from";

    const avatar = document.createElement("div");
    avatar.className = "admin-mailbox-avatar";
    avatar.textContent = "管";

    const sender = document.createElement("div");
    const senderName = document.createElement("strong");
    senderName.textContent = "管理者";
    const senderMeta = document.createElement("span");
    senderMeta.textContent = "管理者からのお知らせ";
    sender.appendChild(senderName);
    sender.appendChild(senderMeta);

    const time = document.createElement("time");
    time.textContent = formatAnnouncementTime(log.sent_at);

    const subject = document.createElement("h3");
    subject.textContent = normalizeAnnouncementTitle(log.title);

    const message = document.createElement("p");
    message.className = "admin-mailbox-message";
    message.textContent = log.message || "";

    fromRow.appendChild(avatar);
    fromRow.appendChild(sender);
    fromRow.appendChild(time);
    detail.appendChild(fromRow);
    detail.appendChild(subject);
    detail.appendChild(message);
    markAdminAnnouncementRead(log, selectedButton);
  }

  logs.forEach((log, index) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "admin-mailbox-item";
    if (isUnreadAnnouncement(log)) item.classList.add("unread");

    const head = document.createElement("span");
    head.className = "admin-mailbox-item-head";

    const title = document.createElement("strong");
    title.textContent = normalizeAnnouncementTitle(log.title);

    const time = document.createElement("time");
    time.textContent = formatAnnouncementTime(log.sent_at);

    const preview = document.createElement("span");
    preview.className = "admin-mailbox-preview";
    preview.textContent = log.message || "";

    head.appendChild(title);
    head.appendChild(time);
    item.appendChild(head);
    item.appendChild(preview);
    item.addEventListener("click", () => showMail(log, item));

    list.appendChild(item);
    if (index === 0) {
      requestAnimationFrame(() => showMail(log, item));
    }
  });

  mailbox.appendChild(list);
  mailbox.appendChild(detail);
  container.appendChild(mailbox);
}

export async function syncAdminAnnouncements({ silent = true } = {}) {
  const logs = await fetchAdminAnnouncements();
  latestAdminAnnouncementLogs = logs;
  updateAdminAnnouncementUnreadBadge(logs);
  if (isAdminAnnouncementsModalOpen()) {
    renderAdminAnnouncements(logs);
  }

  const latestKey = logs[0] ? String(logs[0].id || logs[0].sent_at || "") : "";
  const previousKey = localStorage.getItem(ADMIN_ANNOUNCEMENT_LAST_KEY) || "";

  if (latestKey) {
    if (adminAnnouncementInitialCheckDone && latestKey !== previousKey && !silent) {
      showToast("管理者からのお知らせが届きました");
    }
    localStorage.setItem(ADMIN_ANNOUNCEMENT_LAST_KEY, latestKey);
  }

  adminAnnouncementInitialCheckDone = true;
  return logs;
}

export function openAdminAnnouncementsModal() {
  const modal = document.getElementById("adminAnnouncementsModal");
  if (modal) modal.style.display = "flex";

  syncAdminAnnouncements({ silent: true }).catch(err => {
    console.error("Failed to sync admin announcements:", err);
    const container = document.getElementById("adminAnnouncementsList");
    if (container) {
      container.innerHTML = '<p class="admin-announcement-empty error">管理者からのお知らせの読み込みに失敗しました</p>';
    }
  });

}

export function closeAdminAnnouncementsModal() {
  const modal = document.getElementById("adminAnnouncementsModal");
  if (modal) modal.style.display = "none";
}

export function startAdminAnnouncementWatcher() {
  if (adminAnnouncementTimer) clearInterval(adminAnnouncementTimer);

  syncAdminAnnouncements({ silent: true }).catch(err => {
    console.warn("Initial admin announcement sync failed:", err);
  });

  adminAnnouncementTimer = setInterval(() => {
    syncAdminAnnouncements({ silent: false }).catch(err => {
      console.warn("Admin announcement sync failed:", err);
    });
  }, ADMIN_ANNOUNCEMENT_CHECK_MS);
}

// Reminder Chips UI helper in settings modal
function addReminderChip(list, label, onDelete) {
  const chip = document.createElement("span");
  chip.className = "reminder-chip";
  chip.style.marginRight = "6px";
  chip.style.marginBottom = "6px";
  chip.style.display = "inline-flex";
  chip.style.alignItems = "center";
  chip.style.padding = "4px 8px";
  chip.style.borderRadius = "12px";
  chip.style.background = "var(--primary-light)";
  chip.style.color = "var(--primary)";
  chip.style.fontSize = "11px";
  chip.style.fontWeight = "600";

  const text = document.createElement("span");
  text.textContent = label;

  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "✕";
  button.style.border = "none";
  button.style.background = "none";
  button.style.color = "var(--primary)";
  button.style.marginLeft = "4px";
  button.style.cursor = "pointer";
  button.style.fontWeight = "bold";
  button.addEventListener("click", onDelete);

  chip.appendChild(text);
  chip.appendChild(button);
  list.appendChild(chip);
}

function renderReminderList(listId, minutes, atStart, removeMinute, removeStart) {
  const list = document.getElementById(listId);
  if (!list) return;

  list.innerHTML = "";

  minutes.forEach(minute => {
    let label = `${minute}分前`;
    if (minute % 1440 === 0) label = `${minute / 1440}日前`;
    else if (minute % 60 === 0) label = `${minute / 60}時間前`;

    addReminderChip(list, label, () => removeMinute(minute));
  });

  if (atStart) {
    addReminderChip(list, "開始/期限時刻", removeStart);
  }

  if (list.children.length === 0) {
    list.innerHTML = `<span class="reminder-empty" style="opacity:0.5; font-size:11px;">通知なし</span>`;
  }
}

function removeSettingsReminder(minute) {
  const local = getLocalSettings();
  local.eventBeforeMinutes = local.eventBeforeMinutes.filter(m => m !== minute);
  saveLocalSettings(local);
  updateSettingsUI();
}

function removeSettingsStartReminder() {
  const local = getLocalSettings();
  local.eventAtStart = false;
  saveLocalSettings(local);
  updateSettingsUI();
}

export function renderSettingsReminderList() {
  const local = getLocalSettings();
  const enabledRemind30 = document.getElementById("settingsRemind30")?.checked;
  const enabledRemind5 = document.getElementById("settingsRemind5")?.checked;
  const atStart = document.getElementById("settingsRemindStart")?.checked;

  const list = [];
  if (enabledRemind30) list.push(30);
  if (enabledRemind5) list.push(5);
  
  const custom = parseInt(document.getElementById("settingsCustomReminderMinutes")?.value);
  if (!isNaN(custom) && custom > 0) list.push(custom);

  renderReminderList(
    "settingsReminderList",
    list,
    atStart,
    (minute) => {
      if (minute === 30) document.getElementById("settingsRemind30").checked = false;
      else if (minute === 5) document.getElementById("settingsRemind5").checked = false;
      else document.getElementById("settingsCustomReminderMinutes").value = "";
      renderSettingsReminderList();
    },
    () => {
      document.getElementById("settingsRemindStart").checked = false;
      renderSettingsReminderList();
    }
  );
}
