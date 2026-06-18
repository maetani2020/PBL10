/* ==========================================
   Shared Calendar v2
   notification.js
   Web Notification helper
========================================== */

// 通知権限状態を取得
function getNotificationPermission() {
  if (!("Notification" in window)) return "unsupported";
  return Notification.permission;
}

// 通知許可を要求
async function requestNotificationPermission() {
  if (!("Notification" in window)) {
    alert("このブラウザは通知に対応していません。");
    return false;
  }

  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;

  const permission = await Notification.requestPermission();
  return permission === "granted";
}

// 通知表示
function showCalendarNotification(title, body) {
  if (!("Notification" in window)) return;
  if (Notification.permission !== "granted") return;

  const notification = new Notification(title, {
    body: body,
    icon: "https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f4c5.png",
    tag: "shared-calendar-event",
  });

  notification.onclick = () => {
    window.focus();
    notification.close();
  };

  setTimeout(() => notification.close(), 5000);
}

// 予定保存通知
function notifyEventSaved(eventData, isEdit = false) {
  const action = isEdit ? "予定を更新しました" : "予定を追加しました";
  const timeText = eventData.allDay
    ? "終日予定"
    : `${eventData.start.substring(11, 16)} ～ ${eventData.end.substring(11, 16)}`;

  showCalendarNotification("Shared Calendar", `${action}: ${eventData.title}（${timeText}）`);
}

// 予定削除通知
function notifyEventDeleted(title) {
  showCalendarNotification("Shared Calendar", `予定を削除しました: ${title}`);
}