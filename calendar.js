/* ==========================================
   Shared Calendar v3
   group_share + motivation 統合版
========================================== */

// ==========================================
// グローバル変数
// ==========================================

let currentDate = new Date();
let currentView = "month";
let currentPanel = "calendar";
let currentFilter = "all";
let selectedEventId = null;
let selectedGroupId = null;
let selectedDetailGroupId = null;

// ==========================================
// LocalStorageキー
// ==========================================

const STORAGE_KEY = "shared_calendar_events";
const STORAGE_KEY_GROUPS = "shared_calendar_groups";
const STORAGE_KEY_SETTINGS = "shared_calendar_motivation_settings";
const STORAGE_KEY_SHOW_HP = "show_hp_motivation";
const CURRENT_USER_KEY = "shared_calendar_current_user";

let currentUserId = localStorage.getItem(CURRENT_USER_KEY) || "user001";
let showHpMotivation = localStorage.getItem(STORAGE_KEY_SHOW_HP) === "true";

// ==========================================
// DOM取得
// ==========================================

const monthView = document.getElementById("monthView");
const weekView = document.getElementById("weekView");
const dayView = document.getElementById("dayView");
const statsPanel = document.getElementById("statsPanel");
const currentTitle = document.getElementById("currentTitle");
const eventModal = document.getElementById("eventModal");
const listModal = document.getElementById("listModal");
const groupModal = document.getElementById("groupModal");
const settingsModal = document.getElementById("settingsModal");
const filterBanner = document.getElementById("filterBanner");

// ==========================================
// group_share ロジック（group_share.java 移植）
// ==========================================

const ROLES = { ADMIN: "ADMIN", EDITOR: "EDITOR", VIEWER: "VIEWER" };

const GroupShareManager = {
  getGroups() {
    return JSON.parse(localStorage.getItem(STORAGE_KEY_GROUPS)) || [];
  },

  saveGroups(groups) {
    localStorage.setItem(STORAGE_KEY_GROUPS, JSON.stringify(groups));
  },

  findGroup(groupId) {
    return this.getGroups().find((g) => g.groupId === groupId) || null;
  },

  getUserGroups(userId) {
    return this.getGroups().filter((g) => g.memberIds.includes(userId));
  },

  createGroup(groupId, groupName, creatorId) {
    const groups = this.getGroups();
    if (groups.some((g) => g.groupId === groupId)) {
      return { success: false, message: "同じIDのグループが既に存在します。" };
    }
    const newGroup = {
      groupId,
      groupName,
      creatorId,
      memberIds: [creatorId],
      memberRoles: { [creatorId]: ROLES.ADMIN },
    };
    groups.push(newGroup);
    this.saveGroups(groups);
    this.broadcastToGroup(groupId, "GROUP_CREATED", groupName);
    return { success: true, group: newGroup };
  },

  dissolveGroup(groupId, requesterId, confirmed) {
    const group = this.findGroup(groupId);
    if (!group) return { success: false, message: "グループが見つかりません。" };
    if (group.creatorId !== requesterId) {
      return { success: false, message: "グループ解散権限がありません。" };
    }
    if (!confirmed) return { success: false, message: "キャンセルされました。" };
    const groups = this.getGroups().filter((g) => g.groupId !== groupId);
    this.saveGroups(groups);
    this.broadcastToGroup(groupId, "GROUP_DISSOLVED", group.groupName);
    return { success: true, message: "グループを解散しました。" };
  },

  leaveGroup(groupId, userId, confirmed) {
    const group = this.findGroup(groupId);
    if (!group || !group.memberIds.includes(userId)) {
      return { success: false, message: "グループが見つかりません。" };
    }
    if (group.creatorId === userId) {
      return { success: false, message: "管理者は脱退できません。解散を行ってください。" };
    }
    if (!confirmed) return { success: false, message: "キャンセルされました。" };
    group.memberIds = group.memberIds.filter((id) => id !== userId);
    delete group.memberRoles[userId];
    const groups = this.getGroups().map((g) => (g.groupId === groupId ? group : g));
    this.saveGroups(groups);
    return { success: true, message: "グループから脱退しました。" };
  },

  inviteMember(groupId, requesterId, targetUserId) {
    const group = this.findGroup(groupId);
    if (!group) return { success: false, message: "グループが見つかりません。" };
    if (group.memberIds.length >= 20) {
      return { success: false, message: "グループの定員（20名）に達しています。" };
    }
    const role = group.memberRoles[requesterId];
    if (role !== ROLES.ADMIN && role !== ROLES.EDITOR) {
      return { success: false, message: "メンバー招待の権限がありません。" };
    }
    if (group.memberIds.includes(targetUserId)) {
      return { success: false, message: "既にメンバーです。" };
    }
    group.memberIds.push(targetUserId);
    group.memberRoles[targetUserId] = ROLES.VIEWER;
    const groups = this.getGroups().map((g) => (g.groupId === groupId ? group : g));
    this.saveGroups(groups);
    this.broadcastToGroup(groupId, "MEMBER_INVITED", targetUserId);
    return { success: true, message: "メンバーを招待しました。" };
  },

  removeMember(groupId, requesterId, targetUserId) {
    const group = this.findGroup(groupId);
    if (!group) return { success: false, message: "グループが見つかりません。" };
    if (group.memberRoles[requesterId] !== ROLES.ADMIN) {
      return { success: false, message: "メンバー削除権限がありません。" };
    }
    if (targetUserId === group.creatorId) {
      return { success: false, message: "作成者は削除できません。" };
    }
    group.memberIds = group.memberIds.filter((id) => id !== targetUserId);
    delete group.memberRoles[targetUserId];
    const groups = this.getGroups().map((g) => (g.groupId === groupId ? group : g));
    this.saveGroups(groups);
    return { success: true, message: "メンバーを削除しました。" };
  },

  updateRole(groupId, requesterId, targetUserId, newRole) {
    const group = this.findGroup(groupId);
    if (!group) return { success: false, message: "グループが見つかりません。" };
    if (group.memberRoles[requesterId] !== ROLES.ADMIN) {
      return { success: false, message: "権限変更の権利がありません。" };
    }
    if (!group.memberIds.includes(targetUserId)) {
      return { success: false, message: "メンバーが見つかりません。" };
    }
    group.memberRoles[targetUserId] = newRole;
    const groups = this.getGroups().map((g) => (g.groupId === groupId ? group : g));
    this.saveGroups(groups);
    return { success: true, message: "権限を変更しました。" };
  },

  canEditInGroup(groupId, userId) {
    const group = this.findGroup(groupId);
    if (!group) return false;
    const role = group.memberRoles[userId];
    return role === ROLES.ADMIN || role === ROLES.EDITOR;
  },

  broadcastToGroup(groupId, action, message) {
    const group = this.findGroup(groupId);
    if (!group) return;
    console.log(`[WebSocket] ${action}: ${message} → グループ「${group.groupName}」`);
    renderAll();
  },
};

// ==========================================
// motivation ロジック（motivation.java 移植）
// ==========================================

const MotivationManager = {
  GAUGE_GREEN: 70,
  GAUGE_YELLOW: 40,
  DEFAULT_MAX_HP: 100,
  DEFAULT_MAX_MOTIVATION: 100,
  DEFAULT_RECOVERY_RATE: 0.8,
  DEFAULT_WARNING_THRESHOLD: 80,

  getAllSettings() {
    return JSON.parse(localStorage.getItem(STORAGE_KEY_SETTINGS)) || {};
  },

  saveAllSettings(all) {
    localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify(all));
  },

  getUserSettings(userId) {
    const all = this.getAllSettings();
    if (!all[userId]) {
      all[userId] = {
        userId,
        maxHp: this.DEFAULT_MAX_HP,
        maxMotivation: this.DEFAULT_MAX_MOTIVATION,
        recoveryRate: this.DEFAULT_RECOVERY_RATE,
        warningThreshold: this.DEFAULT_WARNING_THRESHOLD,
      };
      this.saveAllSettings(all);
    }
    return all[userId];
  },

  updateUserSettings(userId, updates) {
    const settings = this.getUserSettings(userId);
    if (updates.maxHp != null) settings.maxHp = clamp(updates.maxHp, 1, 100);
    if (updates.maxMotivation != null) settings.maxMotivation = clamp(updates.maxMotivation, 1, 100);
    if (updates.recoveryRate != null) settings.recoveryRate = clamp(updates.recoveryRate, 0, 1);
    if (updates.warningThreshold != null) settings.warningThreshold = clamp(updates.warningThreshold, 1, 100);
    const all = this.getAllSettings();
    all[userId] = settings;
    this.saveAllSettings(all);
    return settings;
  },

  getEventsByDateAndOwner(userId, date) {
    return getEvents().filter((e) => e.ownerId === userId && e.date === date);
  },

  calculateTotalHpCost(userId, date, excludeId) {
    return this.getEventsByDateAndOwner(userId, date)
      .filter((e) => excludeId == null || e.id !== excludeId)
      .reduce((sum, e) => sum + (e.hpCost || 0), 0);
  },

  calculateTotalMotivationCost(userId, date, excludeId) {
    return this.getEventsByDateAndOwner(userId, date)
      .filter((e) => excludeId == null || e.id !== excludeId)
      .reduce((sum, e) => sum + (e.motivationCost || 0), 0);
  },

  resolveGaugeLevel(remain) {
    if (remain >= this.GAUGE_GREEN) return "green";
    if (remain >= this.GAUGE_YELLOW) return "yellow";
    return "red";
  },

  toCssClass(prefix, level) {
    return `${prefix}-${level}`;
  },

  calculateDayStatus(userId, date) {
    const settings = this.getUserSettings(userId);
    const totalHpCost = this.calculateTotalHpCost(userId, date);
    const totalMotivationCost = this.calculateTotalMotivationCost(userId, date);
    const remainHp = Math.max(0, settings.maxHp - totalHpCost);
    const remainMotivation = Math.max(0, settings.maxMotivation - totalMotivationCost);
    const hpLevel = this.resolveGaugeLevel(remainHp);
    const motivationLevel = this.resolveGaugeLevel(remainMotivation);
    const capacityExceeded = totalHpCost > settings.maxHp || totalMotivationCost > settings.maxMotivation;
    const warningThreshold = Math.floor(settings.maxHp * settings.warningThreshold / 100);
    const warningExceeded = totalHpCost >= warningThreshold || totalMotivationCost >= warningThreshold;

    return {
      date,
      maxHp: settings.maxHp,
      maxMotivation: settings.maxMotivation,
      totalHpCost,
      totalMotivationCost,
      remainHp,
      remainMotivation,
      hpCssClass: this.toCssClass("hp", hpLevel),
      motivationCssClass: this.toCssClass("motivation", motivationLevel),
      capacityExceeded,
      warningExceeded,
      warningMessage: capacityExceeded
        ? `${date} の予定消費が上限を超えています。（HP: ${totalHpCost}%, やる気: ${totalMotivationCost}%）`
        : null,
    };
  },

  preSaveCheck(userId, date, hpCost, motivationCost, excludeId) {
    const settings = this.getUserSettings(userId);
    const currentHp = this.calculateTotalHpCost(userId, date, excludeId);
    const currentMotivation = this.calculateTotalMotivationCost(userId, date, excludeId);
    const projectedHp = currentHp + hpCost;
    const projectedMotivation = currentMotivation + motivationCost;

    if (projectedHp > settings.maxHp) {
      return {
        canSave: false,
        hpInsufficient: true,
        message: `HPが不足します。残り ${Math.max(0, settings.maxHp - currentHp)}% ですが、${hpCost}% の消費が必要です。`,
        projectedRemainHp: Math.max(0, settings.maxHp - projectedHp),
        projectedRemainMotivation: Math.max(0, settings.maxMotivation - projectedMotivation),
      };
    }
    if (projectedMotivation > settings.maxMotivation) {
      return {
        canSave: false,
        motivationInsufficient: true,
        message: `やる気が不足します。残り ${Math.max(0, settings.maxMotivation - currentMotivation)}% ですが、${motivationCost}% の消費が必要です。`,
        projectedRemainHp: Math.max(0, settings.maxHp - projectedHp),
        projectedRemainMotivation: Math.max(0, settings.maxMotivation - projectedMotivation),
      };
    }

    const warningLine = Math.floor(settings.maxHp * settings.warningThreshold / 100);
    const warningMsg = projectedHp >= warningLine || projectedMotivation >= warningLine
      ? `保存は可能ですが、消費量が警告閾値（${settings.warningThreshold}%）を超えます。`
      : "保存可能です。";

    return {
      canSave: true,
      message: warningMsg,
      projectedRemainHp: Math.max(0, settings.maxHp - projectedHp),
      projectedRemainMotivation: Math.max(0, settings.maxMotivation - projectedMotivation),
    };
  },

  evaluateNextDayImpact(userId, date) {
    const settings = this.getUserSettings(userId);
    const today = this.calculateDayStatus(userId, date);
    const nextDate = addDays(date, 1);
    const projectedHp = Math.min(settings.maxHp, today.remainHp + Math.floor(settings.maxHp * settings.recoveryRate));
    const projectedMotivation = Math.min(settings.maxMotivation, today.remainMotivation + Math.floor(settings.maxMotivation * settings.recoveryRate));
    const nextHpCost = this.calculateTotalHpCost(userId, nextDate);
    const nextMotivationCost = this.calculateTotalMotivationCost(userId, nextDate);
    const effectiveHp = projectedHp - nextHpCost;
    const effectiveMotivation = projectedMotivation - nextMotivationCost;
    const needsAttention = today.remainHp < this.GAUGE_YELLOW
      || today.remainMotivation < this.GAUGE_YELLOW
      || effectiveHp < this.GAUGE_YELLOW
      || effectiveMotivation < this.GAUGE_YELLOW;

    return {
      needsAttention,
      nextDate,
      projectedHp,
      projectedMotivation,
      effectiveHp: Math.max(0, effectiveHp),
      effectiveMotivation: Math.max(0, effectiveMotivation),
      alertMessage: needsAttention
        ? `${nextDate} の予定に注意が必要です。回復後HP: ${projectedHp}%（予定消費後: ${Math.max(0, effectiveHp)}%）`
        : null,
    };
  },

  suggestRestBreaks(userId, date) {
    const status = this.calculateDayStatus(userId, date);
    if (status.remainHp >= this.GAUGE_YELLOW && status.remainMotivation >= this.GAUGE_YELLOW) {
      return [];
    }

    const dayEvents = this.getEventsByDateAndOwner(userId, date)
      .filter((e) => !e.allDay)
      .sort((a, b) => a.start.localeCompare(b.start));

    const slots = findFreeTimeSlots(dayEvents, date);
    const suggestions = [];

    for (const slot of slots) {
      if (slot.durationMinutes >= 30) {
        const restMinutes = Math.min(slot.durationMinutes, 60);
        suggestions.push({
          date,
          suggestedStart: slot.start,
          suggestedEnd: addMinutes(slot.start, restMinutes),
          durationMinutes: restMinutes,
          reason: status.remainHp < this.GAUGE_YELLOW
            ? `HPが低下しています（残り ${status.remainHp}%）。休憩をお勧めします。`
            : `やる気が低下しています（残り ${status.remainMotivation}%）。短い休憩で回復を図りましょう。`,
        });
      }
    }

    if (suggestions.length === 0) {
      suggestions.push({
        date,
        suggestedStart: `${date}T12:00`,
        suggestedEnd: `${date}T13:00`,
        durationMinutes: 60,
        reason: "空き時間が見つかりませんでした。昼休みに意識的な休憩を取ることをお勧めします。",
      });
    }

    return suggestions;
  },

  getWeeklyStats(userId, startDate) {
    const points = [];
    for (let i = 0; i < 7; i++) {
      const date = addDays(startDate, i);
      const status = this.calculateDayStatus(userId, date);
      points.push({
        date,
        remainHp: status.remainHp,
        remainMotivation: status.remainMotivation,
        totalHpCost: status.totalHpCost,
        totalMotivationCost: status.totalMotivationCost,
      });
    }
    return points;
  },

  getConsumptionHistory(userId, date) {
    const dayEvents = this.getEventsByDateAndOwner(userId, date);
    return {
      date,
      hpConsumed: dayEvents.reduce((s, e) => s + (e.hpCost || 0), 0),
      motivationConsumed: dayEvents.reduce((s, e) => s + (e.motivationCost || 0), 0),
      eventCount: dayEvents.length,
      eventTitles: dayEvents.map((e) => e.title),
    };
  },
};

// ==========================================
// ユーティリティ
// ==========================================

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function addDays(dateStr, days) {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + days);
  return formatDate(d);
}

function addMinutes(dateTimeStr, minutes) {
  const d = new Date(dateTimeStr);
  d.setMinutes(d.getMinutes() + minutes);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const h = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${day}T${h}:${min}`;
}

function findFreeTimeSlots(events, date) {
  const slots = [];
  let cursor = `${date}T09:00`;
  const dayEnd = `${date}T18:00`;

  for (const event of events) {
    if (event.start > cursor) {
      const duration = (new Date(event.start) - new Date(cursor)) / 60000;
      if (duration >= 15) slots.push({ start: cursor, durationMinutes: duration });
    }
    if (event.end > cursor) cursor = event.end;
  }

  if (cursor < dayEnd) {
    const duration = (new Date(dayEnd) - new Date(cursor)) / 60000;
    if (duration >= 15) slots.push({ start: cursor, durationMinutes: duration });
  }

  return slots;
}

function getEvents() {
  return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
}

function saveEvents(events) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(events));
}

function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function createId() {
  return Date.now() + Math.floor(Math.random() * 10000);
}

function isToday(year, month, day) {
  const now = new Date();
  return year === now.getFullYear() && month === now.getMonth() && day === now.getDate();
}

// ==========================================
// イベントフィルタ（グループ・個人）
// ==========================================

function getFilteredEvents() {
  let events = getEvents();
  const userGroups = GroupShareManager.getUserGroups(currentUserId);
  const userGroupIds = userGroups.map((g) => g.groupId);

  if (currentFilter === "group") {
    events = events.filter(
      (e) => e.visibility === "group" && e.groupId && userGroupIds.includes(e.groupId),
    );
  } else if (currentFilter === "private") {
    events = events.filter(
      (e) => e.visibility === "private" && e.ownerId === currentUserId,
    );
  } else {
    events = events.filter((e) => {
      if (e.visibility === "private") return e.ownerId === currentUserId;
      if (e.visibility === "group") return e.groupId && userGroupIds.includes(e.groupId);
      return true;
    });
  }

  return events;
}

// ==========================================
// ゲージ表示ヘルパー
// ==========================================

function getHpClass(hp) {
  return MotivationManager.toCssClass("hp", MotivationManager.resolveGaugeLevel(hp));
}

function getMotivationClass(motivation) {
  return MotivationManager.toCssClass("motivation", MotivationManager.resolveGaugeLevel(motivation));
}

function updateHeaderGauges() {
  const today = formatDate(new Date());
  const status = MotivationManager.calculateDayStatus(currentUserId, today);

  const hpBar = document.getElementById("headerHpBar");
  const motivationBar = document.getElementById("headerMotivationBar");
  const hpText = document.getElementById("headerHpText");
  const motivationText = document.getElementById("headerMotivationText");
  const headerGauges = document.getElementById("headerGauges");

  if (!hpBar) return;

  headerGauges.style.display = showHpMotivation ? "flex" : "none";

  hpBar.style.width = `${status.remainHp}%`;
  hpBar.className = `gauge-fill ${status.hpCssClass}`;
  motivationBar.style.width = `${status.remainMotivation}%`;
  motivationBar.className = `gauge-fill ${status.motivationCssClass}`;
  hpText.textContent = `${status.remainHp}%`;
  motivationText.textContent = `${status.remainMotivation}%`;
}

function setShowHpMotivation(enabled) {
  showHpMotivation = enabled;
  localStorage.setItem(STORAGE_KEY_SHOW_HP, String(enabled));
  const checkbox = document.getElementById("showHpMotivation");
  if (checkbox) checkbox.checked = enabled;
  updateHeaderGauges();
  renderAll();
}

function updateDisplayOptionsVisibility() {
  const displayOptions = document.querySelector(".display-options");
  if (!displayOptions) return;
  displayOptions.classList.toggle("hidden", currentPanel === "stats");
}

// ==========================================
// モーダル操作
// ==========================================

function openModal() {
  eventModal.style.display = "flex";
  const body = eventModal.querySelector(".modal-body");
  if (body) body.scrollTop = 0;
}
function closeModal() { eventModal.style.display = "none"; }
function openListModal() { listModal.style.display = "flex"; }
function closeListModal() { listModal.style.display = "none"; }
function openGroupModal() { groupModal.style.display = "flex"; renderGroupList(); }
function closeGroupModal() { groupModal.style.display = "none"; }
function openSettingsModal() { loadSettingsForm(); settingsModal.style.display = "flex"; }
function closeSettingsModal() { settingsModal.style.display = "none"; }

function resetForm() {
  selectedEventId = null;
  document.getElementById("eventTitle").value = "";
  document.getElementById("eventMemo").value = "";
  document.getElementById("eventVisibility").value = currentFilter === "private" ? "private" : currentFilter === "group" ? "group" : "public";
  document.getElementById("allDay").checked = false;
  document.getElementById("hpCost").value = "0";
  document.getElementById("motivationCost").value = "0";
  document.getElementById("preSaveWarning").classList.add("hidden");
  document.getElementById("restSuggestions").classList.add("hidden");
  updateGroupSelectVisibility();
  updatePreSavePreview();
}

function updateGroupSelectVisibility() {
  const visibility = document.getElementById("eventVisibility").value;
  const wrap = document.getElementById("groupSelectWrap");
  if (visibility === "group") {
    wrap.classList.remove("hidden");
    populateGroupSelect();
  } else {
    wrap.classList.add("hidden");
  }
}

function populateGroupSelect() {
  const select = document.getElementById("eventGroupId");
  const groups = GroupShareManager.getUserGroups(currentUserId);
  select.innerHTML = groups.map((g) =>
    `<option value="${g.groupId}" ${g.groupId === selectedGroupId ? "selected" : ""}>${g.groupName}</option>`,
  ).join("");
  if (groups.length === 0) {
    select.innerHTML = '<option value="">グループがありません</option>';
  }
}

function openCreateEvent(dateStr) {
  resetForm();
  document.getElementById("eventStart").value = dateStr + "T09:00";
  document.getElementById("eventEnd").value = dateStr + "T10:00";
  showRestSuggestions(dateStr);
  openModal();
}

function openEditEvent(event) {
  selectedEventId = event.id;
  document.getElementById("eventTitle").value = event.title;
  document.getElementById("eventMemo").value = event.memo || "";
  document.getElementById("eventStart").value = event.start;
  document.getElementById("eventEnd").value = event.end;
  document.getElementById("eventVisibility").value = event.visibility;
  document.getElementById("allDay").checked = event.allDay;
  document.getElementById("hpCost").value = event.hpCost || 0;
  document.getElementById("motivationCost").value = event.motivationCost || 0;
  selectedGroupId = event.groupId || null;
  updateGroupSelectVisibility();
  if (event.groupId) document.getElementById("eventGroupId").value = event.groupId;
  updatePreSavePreview();
  showRestSuggestions(event.date);
  openModal();
}

function updatePreSavePreview() {
  const date = (document.getElementById("eventStart").value || "").substring(0, 10);
  if (!date) return;

  const hpCost = parseInt(document.getElementById("hpCost").value, 10) || 0;
  const motivationCost = parseInt(document.getElementById("motivationCost").value, 10) || 0;
  const check = MotivationManager.preSaveCheck(currentUserId, date, hpCost, motivationCost, selectedEventId);
  const warningEl = document.getElementById("preSaveWarning");

  warningEl.classList.remove("hidden", "alert-warning", "alert-danger", "alert-info");
  if (!check.canSave) {
    warningEl.classList.add("alert-danger");
    warningEl.textContent = check.message;
  } else if (check.message.includes("警告")) {
    warningEl.classList.add("alert-warning");
    warningEl.textContent = check.message;
  } else {
    warningEl.classList.add("alert-info");
    warningEl.textContent = `保存後の残HP: ${check.projectedRemainHp}% / 残やる気: ${check.projectedRemainMotivation}%`;
  }
}

function showRestSuggestions(date) {
  const suggestions = MotivationManager.suggestRestBreaks(currentUserId, date);
  const container = document.getElementById("restSuggestions");

  if (suggestions.length === 0) {
    container.classList.add("hidden");
    return;
  }

  container.classList.remove("hidden");
  container.innerHTML = "<strong>休息提案:</strong>" + suggestions.map((s) =>
    `<div class="rest-item" data-start="${s.suggestedStart}" data-end="${s.suggestedEnd}">
      ${s.suggestedStart.substring(11, 16)}〜${s.suggestedEnd.substring(11, 16)}（${s.durationMinutes}分）— ${s.reason}
    </div>`,
  ).join("");

  container.querySelectorAll(".rest-item").forEach((item) => {
    item.addEventListener("click", () => {
      document.getElementById("eventTitle").value = "休憩";
      document.getElementById("eventStart").value = item.dataset.start;
      document.getElementById("eventEnd").value = item.dataset.end;
      document.getElementById("hpCost").value = "0";
      document.getElementById("motivationCost").value = "0";
      document.getElementById("eventVisibility").value = "private";
      updatePreSavePreview();
    });
  });
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
  const events = getFilteredEvents();

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

    const dayStatus = MotivationManager.calculateDayStatus(currentUserId, dateStr);

    const dayNumber = document.createElement("div");
    dayNumber.className = "day-number";
    dayNumber.textContent = day;
    cell.appendChild(dayNumber);

    if (dayStatus.capacityExceeded || dayStatus.warningExceeded) {
      const warn = document.createElement("span");
      warn.className = "capacity-warning";
      warn.textContent = "⚠";
      warn.title = dayStatus.warningMessage || "消費量が多い日です";
      cell.appendChild(warn);
    }

    if (showHpMotivation) {
      const hpInfo = document.createElement("div");
      hpInfo.className = `hp-info ${dayStatus.hpCssClass}`;
      hpInfo.textContent = `HP ${dayStatus.remainHp}%`;
      cell.appendChild(hpInfo);

      const motivationInfo = document.createElement("div");
      motivationInfo.className = `motivation-info ${dayStatus.motivationCssClass}`;
      motivationInfo.textContent = `やる気 ${dayStatus.remainMotivation}%`;
      cell.appendChild(motivationInfo);
    }

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

    cell.addEventListener("click", () => openCreateEvent(dateStr));
    monthView.appendChild(cell);
  }

  const totalCells = startWeek + totalDays;
  const targetCells = Math.ceil(totalCells / 7) * 7;
  const nextDays = targetCells - totalCells;

  for (let i = 1; i <= nextDays; i++) {
    const cell = document.createElement("div");
    cell.className = "day-cell other-month";
    cell.innerHTML = `<div class="day-number">${i}</div>`;
    monthView.appendChild(cell);
  }
}

// ==========================================
// 週・日表示
// ==========================================

function renderWeekView() {
  weekView.innerHTML = "";
  const start = new Date(currentDate);
  start.setDate(start.getDate() - start.getDay());

  const header = document.createElement("div");
  header.className = "week-header";
  for (let i = 0; i < 7; i++) {
    const date = new Date(start);
    date.setDate(start.getDate() + i);
    const dateStr = formatDate(date);
    const status = MotivationManager.calculateDayStatus(currentUserId, dateStr);
    const div = document.createElement("div");
    div.innerHTML = showHpMotivation
      ? `${date.getMonth() + 1}/${date.getDate()}<br>
        <span class="${status.hpCssClass}" style="font-size:9px;padding:1px 3px;border-radius:3px;">HP${status.remainHp}</span>`
      : `${date.getMonth() + 1}/${date.getDate()}`;
    header.appendChild(div);
  }
  weekView.appendChild(header);

  const events = getFilteredEvents().filter((e) => {
    const d = new Date(e.date);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    return d >= start && d <= end;
  });

  for (let hour = 0; hour < 24; hour++) {
    const row = document.createElement("div");
    row.className = "week-hour";
    const content = document.createElement("div");
    content.className = "week-content";

    events.filter((e) => !e.allDay && parseInt(e.start.substring(11, 13), 10) === hour).forEach((e) => {
      const ev = document.createElement("div");
      ev.className = `event ${e.visibility}`;
      ev.textContent = e.title;
      ev.style.margin = "2px";
      ev.addEventListener("click", () => openEditEvent(e));
      content.appendChild(ev);
    });

    row.innerHTML = `<div class="week-time">${String(hour).padStart(2, "0")}:00</div>`;
    row.appendChild(content);
    weekView.appendChild(row);
  }
}

function renderDayView() {
  dayView.innerHTML = "";
  const targetDate = formatDate(currentDate);
  const status = MotivationManager.calculateDayStatus(currentUserId, targetDate);
  const nextDay = MotivationManager.evaluateNextDayImpact(currentUserId, targetDate);
  const events = getFilteredEvents().filter((e) => e.date === targetDate);

  const panel = document.createElement("div");
  panel.className = "day-status-panel";
  panel.innerHTML = `
    <h3>${targetDate}</h3>
    <div class="day-gauge-row">
      <span>HP</span>
      <div class="gauge-bar"><div class="gauge-fill ${status.hpCssClass}" style="width:${status.remainHp}%"></div></div>
      <span>${status.remainHp}%</span>
    </div>
    <div class="day-gauge-row">
      <span>やる気</span>
      <div class="gauge-bar"><div class="gauge-fill ${status.motivationCssClass}" style="width:${status.remainMotivation}%"></div></div>
      <span>${status.remainMotivation}%</span>
    </div>
    <p style="font-size:13px;margin-top:8px;">消費: HP ${status.totalHpCost}% / やる気 ${status.totalMotivationCost}%</p>
    ${status.capacityExceeded ? `<div class="alert-box alert-danger">${status.warningMessage}</div>` : ""}
    ${nextDay.needsAttention ? `<div class="next-day-alert">⚠ ${nextDay.alertMessage}</div>` : ""}
  `;
  dayView.appendChild(panel);

  events.forEach((event) => {
    const card = document.createElement("div");
    card.className = "event-card";
    card.innerHTML = `
      <div style="padding:12px;cursor:pointer;">
        <h4>${event.title}</h4>
        <p>${event.allDay ? "終日" : event.start.substring(11, 16) + " ～ " + event.end.substring(11, 16)}</p>
        <p>HP消費: ${event.hpCost || 0}% / やる気消費: ${event.motivationCost || 0}%</p>
        <p>${visibilityLabel(event.visibility)}</p>
      </div>`;
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

function visibilityLabel(v) {
  if (v === "public") return "👥 全体公開";
  if (v === "group") return "👥 グループ公開";
  return "🔒 自分のみ";
}

// ==========================================
// 統計パネル
// ==========================================

function renderStatsPanel() {
  const start = new Date(currentDate);
  start.setDate(start.getDate() - start.getDay());
  const startDate = formatDate(start);
  const stats = MotivationManager.getWeeklyStats(currentUserId, startDate);
  const chart = document.getElementById("statsChart");

  chart.innerHTML = stats.map((p) => `
    <div class="stat-bar-group">
      <div class="stat-bars">
        <div class="stat-bar hp" style="height:${p.remainHp * 1.5}px" title="HP残${p.remainHp}%"></div>
        <div class="stat-bar motivation" style="height:${p.remainMotivation * 1.5}px" title="やる気残${p.remainMotivation}%"></div>
      </div>
      <span class="stat-date">${p.date.substring(5)}</span>
    </div>
  `).join("");

  const history = MotivationManager.getConsumptionHistory(currentUserId, formatDate(currentDate));
  document.getElementById("historyPanel").innerHTML = `
    <div class="history-item"><strong>${history.date}</strong></div>
    <div class="history-item">HP消費: ${history.hpConsumed}% / やる気消費: ${history.motivationConsumed}%</div>
    <div class="history-item">予定数: ${history.eventCount}件</div>
    <div class="history-item">${history.eventTitles.length > 0 ? "予定: " + history.eventTitles.join(", ") : "予定なし"}</div>
  `;
}

// ==========================================
// CRUD
// ==========================================

function saveEvent() {
  const title = document.getElementById("eventTitle").value.trim();
  if (!title) { alert("タイトルを入力してください"); return; }

  const start = document.getElementById("eventStart").value;
  const end = document.getElementById("eventEnd").value;
  if (!start || !end) { alert("日時を入力してください"); return; }
  if (start > end) { alert("終了日時が開始日時より前です"); return; }

  const hpCost = clamp(parseInt(document.getElementById("hpCost").value, 10) || 0, 0, 100);
  const motivationCost = clamp(parseInt(document.getElementById("motivationCost").value, 10) || 0, 0, 100);
  const date = start.substring(0, 10);
  const visibility = document.getElementById("eventVisibility").value;
  const groupId = visibility === "group" ? document.getElementById("eventGroupId").value : null;

  if (visibility === "group") {
    if (!groupId) { alert("グループを選択してください"); return; }
    if (!GroupShareManager.canEditInGroup(groupId, currentUserId)) {
      alert("閲覧者権限ではグループ予定の登録はできません。");
      return;
    }
  }

  const check = MotivationManager.preSaveCheck(currentUserId, date, hpCost, motivationCost, selectedEventId);
  if (!check.canSave) {
    alert(check.message);
    return;
  }
  if (check.message.includes("警告") && !confirm(check.message + "\n保存しますか？")) {
    return;
  }

  const memo = document.getElementById("eventMemo").value;
  const allDay = document.getElementById("allDay").checked;
  let events = getEvents();

  const eventData = {
    title, start, end, date, memo, visibility, allDay,
    hpCost, motivationCost, ownerId: currentUserId, groupId,
  };

  if (selectedEventId) {
    events = events.map((e) => e.id === selectedEventId ? { ...e, ...eventData } : e);
  } else {
    events.push({ id: createId(), ...eventData });
    if (visibility === "group" && groupId) {
      GroupShareManager.broadcastToGroup(groupId, "NEW_EVENT", title);
    }
  }

  saveEvents(events);
  closeModal();
  renderAll();
}

function deleteEvent() {
  if (!selectedEventId) return;
  if (!confirm("予定を削除しますか？")) return;
  let events = getEvents().filter((e) => e.id !== selectedEventId);
  saveEvents(events);
  closeModal();
  renderAll();
}

// ==========================================
// グループ管理UI
// ==========================================

function renderGroupList() {
  const groups = GroupShareManager.getUserGroups(currentUserId);
  const container = document.getElementById("groupList");
  container.innerHTML = groups.length === 0
    ? "<p>所属グループがありません</p>"
    : groups.map((g) => `
      <div class="group-card ${g.groupId === selectedDetailGroupId ? "selected" : ""}" data-group="${g.groupId}">
        <strong>${g.groupName}</strong>
        <span style="font-size:12px;opacity:0.7;">（${g.memberIds.length}名）</span>
        <span style="font-size:11px;">${g.memberRoles[currentUserId]}</span>
      </div>
    `).join("");

  container.querySelectorAll(".group-card").forEach((card) => {
    card.addEventListener("click", () => {
      selectedDetailGroupId = card.dataset.group;
      renderGroupDetail(selectedDetailGroupId);
      renderGroupList();
    });
  });
}

function renderGroupDetail(groupId) {
  const group = GroupShareManager.findGroup(groupId);
  if (!group) return;

  document.getElementById("groupDetail").classList.remove("hidden");
  document.getElementById("groupDetailTitle").textContent = group.groupName;

  const isAdmin = group.memberRoles[currentUserId] === ROLES.ADMIN;
  const memberList = document.getElementById("memberList");
  memberList.innerHTML = group.memberIds.map((id) => {
    const role = group.memberRoles[id];
    const roleSelect = isAdmin && id !== group.creatorId
      ? `<select data-user="${id}" class="role-select">
          <option value="ADMIN" ${role === "ADMIN" ? "selected" : ""}>管理者</option>
          <option value="EDITOR" ${role === "EDITOR" ? "selected" : ""}>編集者</option>
          <option value="VIEWER" ${role === "VIEWER" ? "selected" : ""}>閲覧者</option>
        </select>
        <button class="remove-member-btn" data-user="${id}" style="font-size:11px;padding:2px 6px;">削除</button>`
      : `<span>${roleLabel(role)}</span>`;
    return `<div class="member-row"><span>${id}${id === group.creatorId ? " (作成者)" : ""}</span>${roleSelect}</div>`;
  }).join("");

  memberList.querySelectorAll(".role-select").forEach((sel) => {
    sel.addEventListener("change", () => {
      const result = GroupShareManager.updateRole(groupId, currentUserId, sel.dataset.user, sel.value);
      alert(result.message);
      renderGroupDetail(groupId);
    });
  });

  memberList.querySelectorAll(".remove-member-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const result = GroupShareManager.removeMember(groupId, currentUserId, btn.dataset.user);
      alert(result.message);
      renderGroupDetail(groupId);
      renderGroupList();
    });
  });

  document.getElementById("dissolveGroupBtn").style.display = group.creatorId === currentUserId ? "inline-block" : "none";
  document.getElementById("leaveGroupBtn").style.display = group.creatorId !== currentUserId ? "inline-block" : "none";
}

function roleLabel(role) {
  if (role === "ADMIN") return "管理者";
  if (role === "EDITOR") return "編集者";
  return "閲覧者";
}

// ==========================================
// 設定UI
// ==========================================

function loadSettingsForm() {
  const settings = MotivationManager.getUserSettings(currentUserId);
  document.getElementById("settingsUserId").value = currentUserId;
  document.getElementById("settingsMaxHp").value = settings.maxHp;
  document.getElementById("settingsMaxMotivation").value = settings.maxMotivation;
  document.getElementById("settingsRecoveryRate").value = settings.recoveryRate;
  document.getElementById("settingsWarningThreshold").value = settings.warningThreshold;
}

function saveSettings() {
  const newUserId = document.getElementById("settingsUserId").value.trim() || "user001";
  currentUserId = newUserId;
  localStorage.setItem(CURRENT_USER_KEY, currentUserId);
  MotivationManager.updateUserSettings(currentUserId, {
    maxHp: parseInt(document.getElementById("settingsMaxHp").value, 10),
    maxMotivation: parseInt(document.getElementById("settingsMaxMotivation").value, 10),
    recoveryRate: parseFloat(document.getElementById("settingsRecoveryRate").value),
    warningThreshold: parseInt(document.getElementById("settingsWarningThreshold").value, 10),
  });
  document.getElementById("sidebarUserId").textContent = currentUserId;
  closeSettingsModal();
  renderAll();
  alert("設定を保存しました。");
}

// ==========================================
// 表示切替・ナビゲーション
// ==========================================

function updateTitle() {
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth() + 1;
  if (currentView === "month") currentTitle.textContent = `${year}年${month}月`;
  else if (currentView === "week") currentTitle.textContent = "週表示";
  else currentTitle.textContent = formatDate(currentDate);
}

function switchView(view) {
  currentView = view;
  monthView.classList.add("hidden");
  weekView.classList.add("hidden");
  dayView.classList.add("hidden");
  statsPanel.classList.add("hidden");
  document.querySelectorAll(".view-btn").forEach((btn) => btn.classList.remove("active"));

  if (currentPanel === "stats") {
    statsPanel.classList.remove("hidden");
    renderStatsPanel();
    return;
  }

  if (view === "month") {
    monthView.classList.remove("hidden");
    document.getElementById("monthViewBtn").classList.add("active");
    renderMonthView();
  } else if (view === "week") {
    weekView.classList.remove("hidden");
    document.getElementById("weekViewBtn").classList.add("active");
    renderWeekView();
  } else {
    dayView.classList.remove("hidden");
    document.getElementById("dayViewBtn").classList.add("active");
    renderDayView();
  }
  updateTitle();
}

function switchPanel(panel) {
  currentPanel = panel;
  document.querySelectorAll(".sidebar-item").forEach((li) => {
    li.classList.toggle("active", li.dataset.nav === panel);
  });

  const viewSwitch = document.querySelector(".view-switch");
  const weekHeader = document.getElementById("weekHeader");
  updateDisplayOptionsVisibility();

  if (panel === "stats") {
    currentFilter = "all";
    filterBanner.classList.add("hidden");
    viewSwitch.classList.add("hidden");
    weekHeader.classList.add("hidden");
    monthView.classList.add("hidden");
    weekView.classList.add("hidden");
    dayView.classList.add("hidden");
    statsPanel.classList.remove("hidden");
    renderStatsPanel();
    closeSidebar();
    return;
  }

  if (panel === "settings") {
    openSettingsModal();
    closeSidebar();
    return;
  }

  viewSwitch.classList.remove("hidden");
  weekHeader.classList.remove("hidden");
  statsPanel.classList.add("hidden");

  if (panel === "calendar") {
    currentFilter = "all";
    filterBanner.classList.add("hidden");
  } else if (panel === "group") {
    currentFilter = "group";
    filterBanner.textContent = "グループ予定を表示中";
    filterBanner.classList.remove("hidden");
  } else if (panel === "private") {
    currentFilter = "private";
    filterBanner.textContent = "個人予定を表示中";
    filterBanner.classList.remove("hidden");
  }

  switchView(currentView);
  closeSidebar();
}

function renderAll() {
  updateTitle();
  updateHeaderGauges();
  if (currentPanel === "stats") {
    renderStatsPanel();
    return;
  }
  if (currentView === "month") renderMonthView();
  else if (currentView === "week") renderWeekView();
  else renderDayView();
}

function movePrevious() {
  if (currentView === "month") currentDate.setMonth(currentDate.getMonth() - 1);
  else if (currentView === "week") currentDate.setDate(currentDate.getDate() - 7);
  else currentDate.setDate(currentDate.getDate() - 1);
  renderAll();
}

function moveNext() {
  if (currentView === "month") currentDate.setMonth(currentDate.getMonth() + 1);
  else if (currentView === "week") currentDate.setDate(currentDate.getDate() + 7);
  else currentDate.setDate(currentDate.getDate() + 1);
  renderAll();
}

function renderScheduleList(mode) {
  const container = document.getElementById("scheduleList");
  container.innerHTML = "";
  let events = getFilteredEvents();

  if (mode === "day") {
    events = events.filter((e) => e.date === formatDate(currentDate));
  } else if (mode === "week") {
    const start = new Date(currentDate);
    start.setDate(start.getDate() - start.getDay());
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    events = events.filter((e) => {
      const d = new Date(e.date);
      return d >= start && d <= end;
    });
  } else {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    events = events.filter((e) => {
      const d = new Date(e.date);
      return d.getFullYear() === year && d.getMonth() === month;
    });
  }

  events.sort((a, b) => a.start.localeCompare(b.start));

  if (events.length === 0) {
    container.innerHTML = '<p style="padding:20px;text-align:center;">予定がありません</p>';
    return;
  }

  events.forEach((event) => {
    const card = document.createElement("div");
    card.className = "event-card";
    card.innerHTML = `
      <div style="padding:12px;border-bottom:1px solid #ddd;cursor:pointer;">
        <h4>${event.title}</h4>
        <p>📅 ${event.date}</p>
        <p>👥 ${visibilityLabel(event.visibility)}</p>
        <p>${event.allDay ? "終日予定" : event.start.substring(11, 16) + " ～ " + event.end.substring(11, 16)}</p>
        <p>HP ${event.hpCost || 0}% / やる気 ${event.motivationCost || 0}%</p>
      </div>`;
    card.addEventListener("click", () => { closeListModal(); openEditEvent(event); });
    container.appendChild(card);
  });
}

// ==========================================
// サイドバー・テーマ
// ==========================================

const sidebar = document.getElementById("sidebar");
const sidebarOverlay = document.getElementById("sidebarOverlay");

function closeSidebar() {
  sidebar.classList.remove("open");
  sidebarOverlay.classList.remove("show");
}

function toggleTheme() {
  document.body.classList.toggle("dark");
  localStorage.setItem("theme", document.body.classList.contains("dark"));
}

function restoreTheme() {
  if (localStorage.getItem("theme") === "true") document.body.classList.add("dark");
}

// ==========================================
// イベントリスナー
// ==========================================

document.getElementById("saveEventBtn").addEventListener("click", saveEvent);
document.getElementById("deleteEventBtn").addEventListener("click", deleteEvent);
document.getElementById("closeModalBtn").addEventListener("click", closeModal);
document.getElementById("monthViewBtn").addEventListener("click", () => switchView("month"));
document.getElementById("weekViewBtn").addEventListener("click", () => switchView("week"));
document.getElementById("dayViewBtn").addEventListener("click", () => switchView("day"));
document.getElementById("prevBtn").addEventListener("click", movePrevious);
document.getElementById("nextBtn").addEventListener("click", moveNext);
document.getElementById("todayBtn").addEventListener("click", () => { currentDate = new Date(); renderAll(); });
document.getElementById("addEventBtn").addEventListener("click", () => openCreateEvent(formatDate(currentDate)));
document.getElementById("themeBtn").addEventListener("click", toggleTheme);
document.getElementById("menuBtn").addEventListener("click", () => { sidebar.classList.add("open"); sidebarOverlay.classList.add("show"); });
sidebarOverlay.addEventListener("click", closeSidebar);
document.getElementById("scheduleListBtn").addEventListener("click", () => { openListModal(); renderScheduleList("month"); });
document.getElementById("closeListBtn").addEventListener("click", closeListModal);
document.getElementById("groupManageBtn").addEventListener("click", openGroupModal);
document.getElementById("closeGroupBtn").addEventListener("click", closeGroupModal);

document.querySelectorAll(".sidebar-item").forEach((li) => {
  li.addEventListener("click", () => switchPanel(li.dataset.nav));
});

document.querySelectorAll(".list-mode button").forEach((btn) => {
  btn.addEventListener("click", () => renderScheduleList(btn.dataset.filter));
});

document.getElementById("eventVisibility").addEventListener("change", updateGroupSelectVisibility);
document.getElementById("hpCost").addEventListener("input", updatePreSavePreview);
document.getElementById("motivationCost").addEventListener("input", updatePreSavePreview);
document.getElementById("showHpMotivation").addEventListener("change", (e) => {
  setShowHpMotivation(e.target.checked);
});
document.getElementById("eventStart").addEventListener("change", () => {
  updatePreSavePreview();
  const date = document.getElementById("eventStart").value.substring(0, 10);
  if (date) showRestSuggestions(date);
});

document.getElementById("createGroupBtn").addEventListener("click", () => {
  const name = document.getElementById("newGroupName").value.trim();
  if (!name) { alert("グループ名を入力してください"); return; }
  const groupId = "grp_" + Date.now();
  const result = GroupShareManager.createGroup(groupId, name, currentUserId);
  if (result.success) {
    document.getElementById("newGroupName").value = "";
    renderGroupList();
    alert("グループを作成しました。");
  } else {
    alert(result.message);
  }
});

document.getElementById("inviteMemberBtn").addEventListener("click", () => {
  if (!selectedDetailGroupId) { alert("グループを選択してください"); return; }
  const targetId = document.getElementById("inviteUserId").value.trim();
  if (!targetId) { alert("ユーザーIDを入力してください"); return; }
  const result = GroupShareManager.inviteMember(selectedDetailGroupId, currentUserId, targetId);
  alert(result.message);
  if (result.success) {
    document.getElementById("inviteUserId").value = "";
    renderGroupDetail(selectedDetailGroupId);
    renderGroupList();
  }
});

document.getElementById("dissolveGroupBtn").addEventListener("click", () => {
  if (!selectedDetailGroupId) return;
  if (!confirm("グループを解散しますか？")) return;
  const result = GroupShareManager.dissolveGroup(selectedDetailGroupId, currentUserId, true);
  alert(result.message);
  if (result.success) {
    selectedDetailGroupId = null;
    document.getElementById("groupDetail").classList.add("hidden");
    renderGroupList();
  }
});

document.getElementById("leaveGroupBtn").addEventListener("click", () => {
  if (!selectedDetailGroupId) return;
  if (!confirm("グループから脱退しますか？")) return;
  const result = GroupShareManager.leaveGroup(selectedDetailGroupId, currentUserId, true);
  alert(result.message);
  if (result.success) {
    selectedDetailGroupId = null;
    document.getElementById("groupDetail").classList.add("hidden");
    renderGroupList();
  }
});

document.getElementById("saveSettingsBtn").addEventListener("click", saveSettings);
document.getElementById("closeSettingsBtn").addEventListener("click", closeSettingsModal);

eventModal.addEventListener("click", (e) => { if (e.target === eventModal) closeModal(); });
listModal.addEventListener("click", (e) => { if (e.target === listModal) closeListModal(); });
groupModal.addEventListener("click", (e) => { if (e.target === groupModal) closeGroupModal(); });
settingsModal.addEventListener("click", (e) => { if (e.target === settingsModal) closeSettingsModal(); });

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    closeModal();
    closeListModal();
    closeGroupModal();
    closeSettingsModal();
    closeSidebar();
  }
});

// スワイプ
let touchStartX = 0;
function handleSwipe() {
  const distance = touchEndX - touchStartX;
  if (distance < -80) moveNext();
  if (distance > 80) movePrevious();
}
let touchEndX = 0;
[monthView, weekView, dayView].forEach((el) => {
  el.addEventListener("touchstart", (e) => { touchStartX = e.changedTouches[0].screenX; });
  el.addEventListener("touchend", (e) => { touchEndX = e.changedTouches[0].screenX; handleSwipe(); });
});

// ==========================================
// 初期化
// ==========================================

function initializeStorage() {
  if (!localStorage.getItem(STORAGE_KEY)) saveEvents([]);
  if (!localStorage.getItem(STORAGE_KEY_GROUPS)) GroupShareManager.saveGroups([]);
  MotivationManager.getUserSettings(currentUserId);

  // 既存予定に ownerId / hpCost / motivationCost を補完
  const events = getEvents();
  let migrated = false;
  const updated = events.map((e) => {
    const patch = {};
    if (!e.ownerId) { patch.ownerId = currentUserId; migrated = true; }
    if (e.hpCost == null) { patch.hpCost = 0; migrated = true; }
    if (e.motivationCost == null) { patch.motivationCost = 0; migrated = true; }
    return Object.keys(patch).length > 0 ? { ...e, ...patch } : e;
  });
  if (migrated) saveEvents(updated);
}

function init() {
  initializeStorage();
  restoreTheme();
  document.getElementById("sidebarUserId").textContent = currentUserId;
  document.getElementById("showHpMotivation").checked = showHpMotivation;
  updateDisplayOptionsVisibility();
  updateTitle();
  updateHeaderGauges();
  switchView("month");
}

init();

window.clearAllEvents = function () {
  if (!confirm("全予定を削除しますか？")) return;
  saveEvents([]);
  renderAll();
};
