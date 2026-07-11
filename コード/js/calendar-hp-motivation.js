// calendar-hp-motivation.js
// HP and Motivation status bar, statistics rendering, and rest suggestions using PostgreSQL backend

import { apiRequest } from './calendar-auth.js';
import { getAllEvents, showFieldError, clearFieldErrors, showToast } from './calendar-state.js';

let limitsCache = {
  max_hp: 100,
  max_motivation: 100,
  recovery_rate: 1.0,
  warning_threshold: 20
};

let recalculationNoticeTimer = null;

const DEFAULT_EVENT_COST_KEY = "shared_calendar_default_event_costs";

export function getDefaultEventCosts() {
  try {
    const saved = JSON.parse(localStorage.getItem(DEFAULT_EVENT_COST_KEY) || "{}");
    return {
      hp_consumption: Number.isFinite(Number(saved.hp_consumption)) ? Number(saved.hp_consumption) : 0,
      motivation_consumption: Number.isFinite(Number(saved.motivation_consumption)) ? Number(saved.motivation_consumption) : 0
    };
  } catch {
    return { hp_consumption: 0, motivation_consumption: 0 };
  }
}

function saveDefaultEventCosts(hp_consumption, motivation_consumption) {
  const hp = Math.min(100, Math.max(0, parseInt(hp_consumption) || 0));
  const motivation = Math.min(100, Math.max(0, parseInt(motivation_consumption) || 0));
  localStorage.setItem(DEFAULT_EVENT_COST_KEY, JSON.stringify({
    hp_consumption: hp,
    motivation_consumption: motivation
  }));
}

export function getLimits() {
  return limitsCache;
}

async function fetchHpMotivationStatus(dateStr) {
  const date = dateStr || new Date().toISOString().split('T')[0];
  const data = await apiRequest(`/api/hp-motivation/status?date=${date}`);

  if (data.limits) {
    limitsCache = data.limits;
  }

  return data;
}

// Fetch status from backend and update header gauges
export async function syncHpMotivationStatus(dateStr) {
  try {
    const data = await fetchHpMotivationStatus(dateStr);
    updateGaugesUI(data);
    updateNextDayAlertUI(data.nextDayAlert);
    return data;
  } catch (err) {
    console.error('Failed to sync HP/Motivation status:', err);
    return null;
  }
}

// Update the header gauges
function updateGaugesUI(data) {
  const hpBar = document.getElementById("headerHpBar");
  const hpText = document.getElementById("headerHpText");
  const motBar = document.getElementById("headerMotivationBar");
  const motText = document.getElementById("headerMotivationText");

  if (hpBar && hpText) {
    const hpPct = data.percentages.hp;
    hpBar.style.width = `${hpPct}%`;
    hpText.textContent = `${hpPct}%`;
    // Update color classes based on backend statusColors
    hpBar.className = `gauge-fill hp-${data.statusColors.hp}`;
  }

  if (motBar && motText) {
    const motPct = data.percentages.motivation;
    motBar.style.width = `${motPct}%`;
    motText.textContent = `${motPct}%`;
    // Update color classes based on backend statusColors
    motBar.className = `gauge-fill motivation-${data.statusColors.motivation}`;
  }

  updateHpZeroAlertUI(data);
}

function ensureHpZeroAlertElement() {
  let alert = document.getElementById("hpZeroAlert");
  if (alert) return alert;

  const header = document.querySelector(".header");
  if (!header) return null;

  alert = document.createElement("div");
  alert.id = "hpZeroAlert";
  alert.className = "hp-zero-alert hidden";
  alert.setAttribute("role", "status");
  alert.innerHTML = `
    <span class="material-icons">warning</span>
    <div>
      <strong>HPが0%です。</strong>
      <span>これ以上HPを消費する予定は登録できません。休憩予定を入れることをおすすめします。</span>
    </div>
  `;

  header.insertAdjacentElement("afterend", alert);
  return alert;
}

function updateHpZeroAlertUI(data) {
  const alert = ensureHpZeroAlertElement();
  if (!alert) return;

  const hpPct = Number(data?.percentages?.hp ?? 100);
  const remainingHp = Number(data?.remaining?.hp ?? 1);
  const shouldShow = hpPct <= 0 || remainingHp <= 0;

  alert.classList.toggle("hidden", !shouldShow);
}

function formatNoticeDate(dateStr) {
  if (!dateStr) return "";
  const match = String(dateStr).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return dateStr;
  return `${Number(match[2])}月${Number(match[3])}日`;
}

function ensureRecalculationNoticeElement() {
  let notice = document.getElementById("hpRecalculationNotice");
  if (notice) return notice;

  const header = document.querySelector(".header");
  if (!header) return null;

  notice = document.createElement("div");
  notice.id = "hpRecalculationNotice";
  notice.className = "hp-recalculation-notice hidden";
  notice.setAttribute("role", "status");

  const hpAlert = document.getElementById("hpZeroAlert");
  (hpAlert || header).insertAdjacentElement("afterend", notice);
  return notice;
}

export async function showHpMotivationRecalculation(dateStr, actionLabel = "予定変更") {
  try {
    const data = await fetchHpMotivationStatus(dateStr);
    const notice = ensureRecalculationNoticeElement();
    if (!notice || !data?.percentages) return data;

    const hpPct = Number(data.percentages.hp ?? 0);
    const motPct = Number(data.percentages.motivation ?? 0);
    const hpConsumed = Number(data.consumed?.hp ?? 0);
    const motConsumed = Number(data.consumed?.motivation ?? 0);
    const labelDate = formatNoticeDate(data.date || dateStr);

    notice.innerHTML = `
      <span class="material-icons">calculate</span>
      <div>
        <strong>${actionLabel}後のHP・やる気を再計算しました</strong>
        <span>${labelDate}：残りHP ${hpPct}% / 残りやる気 ${motPct}%（消費 HP ${hpConsumed}%・やる気 ${motConsumed}%）</span>
      </div>
    `;
    notice.classList.remove("hidden");

    clearTimeout(recalculationNoticeTimer);
    recalculationNoticeTimer = setTimeout(() => {
      notice.classList.add("hidden");
    }, 5500);

    return data;
  } catch (err) {
    console.error('Failed to show HP/Motivation recalculation:', err);
    return null;
  }
}

// Update warning alerts in event edit modal if today's fatigue is too high
function updateNextDayAlertUI(alert) {
  const warningEl = document.getElementById("preSaveWarning");
  if (!warningEl) return;

  if (alert) {
    warningEl.textContent = alert.message;
    warningEl.className = "alert-box alert-warning";
    warningEl.classList.remove("hidden");
  } else {
    warningEl.classList.add("hidden");
  }
}

// Fetch and render the stats chart panel
export async function renderStatsPanel(range = 'week') {
  const chart = document.getElementById("statsChart");
  const historyPanel = document.getElementById("historyPanel");
  if (!chart) return;

  try {
    const res = await apiRequest(`/api/hp-motivation/statistics?range=${range}`);
    
    // Render bar chart
    chart.innerHTML = res.data.map(p => {
      // Scale height to fit 160px container
      const hpHeight = Math.round((p.remaining_hp / res.max_hp) * 140);
      const motHeight = Math.round((p.remaining_motivation / res.max_motivation) * 140);
      
      return `
        <div class="stat-bar-group">
          <div class="stat-bars">
            <div class="stat-bar hp" style="height:${hpHeight}px" title="HP: ${p.remaining_hp}/${res.max_hp} (${p.hp_percentage}%)"></div>
            <div class="stat-bar motivation" style="height:${motHeight}px" title="やる気: ${p.remaining_motivation}/${res.max_motivation} (${p.motivation_percentage}%)"></div>
          </div>
          <span class="stat-date">${p.date.substring(5)}</span>
        </div>
      `;
    }).join("");

    // Render selected day's summary
    const todayStr = new Date().toISOString().split('T')[0];
    const status = await apiRequest(`/api/hp-motivation/status?date=${todayStr}`);
    
    if (historyPanel) {
      historyPanel.innerHTML = `
        <div class="history-item"><strong>本日 (${status.date})</strong></div>
        <div class="history-item">HP消費: ${status.consumed.hp}% / やる気消費: ${status.consumed.motivation}%</div>
        <div class="history-item">残りHP: ${status.remaining.hp} / 残りやる気: ${status.remaining.motivation}</div>
      `;
    }
  } catch (err) {
    console.error('Failed to render stats panel:', err);
    chart.innerHTML = '<p style="color:var(--ios-red); padding:20px;">統計情報の読み込みに失敗しました</p>';
  }
}

// Fetch and render Rest Suggestions inside Event Modal
export async function showRestSuggestions(dateStr) {
  const container = document.getElementById("restSuggestions");
  if (!container) return;

  try {
    const data = await apiRequest('/api/hp-motivation/suggest-rest', {
      method: 'POST',
      body: JSON.stringify({ date: dateStr })
    });

    if (data.lowFatigue) {
      container.classList.add("hidden");
      return;
    }

    container.classList.remove("hidden");

    if (!data.suggestions || data.suggestions.length === 0) {
      container.innerHTML = `
        <div class="rest-suggestion-card rest-suggestion-empty">
          <div class="rest-suggestion-title">
            <span class="material-icons">hotel</span>
            <strong>HPが少なくなっています</strong>
          </div>
          <p>休憩をおすすめしますが、9:00〜20:00の間に空き時間が見つかりませんでした。</p>
        </div>
      `;
      return;
    }

    container.innerHTML = `
      <div class="rest-suggestion-card">
        <div class="rest-suggestion-title">
          <span class="material-icons">hotel</span>
          <strong>HP不足のため休憩候補があります</strong>
        </div>
        <p>${data.message || "空き時間に休憩予定を入れることをおすすめします。"}</p>
        <div class="rest-suggestion-list">
          ${data.suggestions.map(s => {
      const startTime = s.start.substring(11, 16);
      const endTime = s.end.substring(11, 16);
      return `
        <div class="rest-item" data-start="${s.start}" data-end="${s.end}">
          <span class="material-icons">add_circle</span>
          <div>
            <strong>${startTime}〜${endTime}</strong>
            <span>${s.hp_recovery} HP回復 / ${s.memo}</span>
          </div>
        </div>
      `;
    }).join("")}
        </div>
      </div>
    `;

    // Bind suggestion click listeners to autofill the form
    container.querySelectorAll(".rest-item").forEach(item => {
      item.addEventListener("click", () => {
        document.getElementById("eventTitle").value = "リフレッシュ休息";
        document.getElementById("eventStart").value = item.dataset.start;
        document.getElementById("eventEnd").value = item.dataset.end;
        document.getElementById("hpCost").value = "0";
        document.getElementById("motivationCost").value = "0";
        document.getElementById("eventVisibility").value = "private";
        showToast("休憩予定を入力しました");
        updatePreSavePreview();
      });
    });
  } catch (err) {
    console.error('Failed to load rest suggestions:', err);
    container.classList.add("hidden");
  }
}

// Check capacity constraints locally before saving
export function preSaveCheck(dateStr, hpCost, motivationCost, excludeId) {
  const events = getAllEvents();
  
  // Filter events of the same date, excluding current editing event
  const sameDateEvents = events.filter(e => {
    return e.start.startsWith(dateStr) && e.id !== excludeId;
  });

  let currentHpSum = 0;
  let currentMotivationSum = 0;
  sameDateEvents.forEach(e => {
    currentHpSum += e.hp_consumption || 0;
    currentMotivationSum += e.motivation_consumption || 0;
  });

  const projectedHp = currentHpSum + hpCost;
  const projectedMotivation = currentMotivationSum + motivationCost;

  const hpOverflow = projectedHp - limitsCache.max_hp;
  const motivationOverflow = projectedMotivation - limitsCache.max_motivation;
  if (hpOverflow > 0 || motivationOverflow > 0) {
    const details = [];
    if (hpOverflow > 0) {
      details.push(`HPは残り${Math.max(0, limitsCache.max_hp - currentHpSum)}%に対して${hpCost}%必要です（${hpOverflow}%超過）`);
    }
    if (motivationOverflow > 0) {
      details.push(`やる気は残り${Math.max(0, limitsCache.max_motivation - currentMotivationSum)}%に対して${motivationCost}%必要です（${motivationOverflow}%超過）`);
    }
    return {
      canSave: false,
      message: `上限を超えるため保存できません。${details.join(" / ")}。消費率を下げるか、別日に移動してください。`
    };
  }

  // Warning thresholds check (remaining percentage below threshold)
  const remainingHpPct = Math.round(((limitsCache.max_hp - projectedHp) / limitsCache.max_hp) * 100);
  const remainingMotPct = Math.round(((limitsCache.max_motivation - projectedMotivation) / limitsCache.max_motivation) * 100);

  if (remainingHpPct <= 0) {
    return {
      canSave: true,
      isWarning: true,
      message: "保存後HPが0%になります。休憩予定を入れることをおすすめします。"
    };
  }

  if (remainingHpPct < limitsCache.warning_threshold || remainingMotPct < limitsCache.warning_threshold) {
    return {
      canSave: true,
      isWarning: true,
      message: `警告: 保存は可能ですが、消費量が警告閾値（残${limitsCache.warning_threshold}%）を下回ります。`
    };
  }

  return {
    canSave: true,
    isWarning: false,
    message: `保存可能。保存後残り HP: ${limitsCache.max_hp - projectedHp}% / やる気: ${limitsCache.max_motivation - projectedMotivation}%`
  };
}

function readPercentInput(id) {
  const value = parseInt(document.getElementById(id)?.value, 10);
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

// Live preview inside the event modal
export function updatePreSavePreview() {
  const startInput = document.getElementById("eventStart");
  const warningEl = document.getElementById("preSaveWarning");
  if (!startInput || !warningEl) return;

  const dateStr = startInput.value.substring(0, 10);
  if (!dateStr) return;

  const hpCost = readPercentInput("hpCost");
  const motivationCost = readPercentInput("motivationCost");
  const editEventId = window.editingEventId || null; // Access global editing ID

  const check = preSaveCheck(dateStr, hpCost, motivationCost, editEventId);

  warningEl.classList.remove("hidden", "alert-warning", "alert-danger", "alert-info");
  
  if (!check.canSave) {
    warningEl.classList.add("alert-danger");
    warningEl.textContent = check.message;
    warningEl.classList.remove("hidden");
  } else if (check.isWarning) {
    warningEl.classList.add("alert-warning");
    warningEl.textContent = check.message;
    warningEl.classList.remove("hidden");
  } else {
    warningEl.classList.add("alert-info");
    warningEl.textContent = check.message;
    warningEl.classList.remove("hidden");
  }
}

export function openCalendarSettingsModal() {
  const modal = document.getElementById("calendarSettingsModal");
  if (!modal) return;

  document.getElementById("calendarSettingsMaxHp").value = limitsCache.max_hp;
  document.getElementById("calendarSettingsMaxMotivation").value = limitsCache.max_motivation;
  document.getElementById("calendarSettingsRecoveryRate").value = limitsCache.recovery_rate;
  document.getElementById("calendarSettingsWarningThreshold").value = limitsCache.warning_threshold;
modal.style.display = "flex";
}

export function closeCalendarSettingsModal() {
  const modal = document.getElementById("calendarSettingsModal");
  if (modal) modal.style.display = "none";
}

export async function saveCalendarSettings() {
  clearFieldErrors(document.getElementById("calendarSettingsModal"));
  const maxHpRaw = document.getElementById("calendarSettingsMaxHp").value;
  const maxMotivationRaw = document.getElementById("calendarSettingsMaxMotivation").value;
  const recoveryRaw = document.getElementById("calendarSettingsRecoveryRate").value;
  const warningRaw = document.getElementById("calendarSettingsWarningThreshold").value;

  const maxHpValue = Number(maxHpRaw);
  const maxMotivationValue = Number(maxMotivationRaw);
  const recoveryValue = Number(recoveryRaw);
  const warningValue = Number(warningRaw);

  if (maxHpRaw && (!Number.isFinite(maxHpValue) || maxHpValue < 1 || maxHpValue > 1000)) {
    return showFieldError("calendarSettingsMaxHp", "最大HPは1から1000の範囲で入力してください");
  }
  if (maxMotivationRaw && (!Number.isFinite(maxMotivationValue) || maxMotivationValue < 1 || maxMotivationValue > 1000)) {
    return showFieldError("calendarSettingsMaxMotivation", "最大やる気は1から1000の範囲で入力してください");
  }
  if (recoveryRaw && (!Number.isFinite(recoveryValue) || recoveryValue < 0 || recoveryValue > 2)) {
    return showFieldError("calendarSettingsRecoveryRate", "回復率は0.0から2.0の範囲で入力してください");
  }
  if (warningRaw && (!Number.isFinite(warningValue) || warningValue < 0 || warningValue > 100)) {
    return showFieldError("calendarSettingsWarningThreshold", "警告閾値は0から100の範囲で入力してください");
  }

  const max_hp = parseInt(document.getElementById("calendarSettingsMaxHp").value) || 100;
  const max_motivation = parseInt(document.getElementById("calendarSettingsMaxMotivation").value) || 100;
  const recovery_rate = parseFloat(document.getElementById("calendarSettingsRecoveryRate").value) || 1.0;
  const warning_threshold = parseInt(document.getElementById("calendarSettingsWarningThreshold").value) || 20;
  const btn = document.getElementById("saveCalendarSettingsBtn");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "保存中...";
  }

  try {
    const data = await apiRequest('/api/hp-motivation/settings', {
      method: 'POST',
      body: JSON.stringify({
        max_hp,
        max_motivation,
        recovery_rate,
        warning_threshold
      })
    });

    if (data.settings) {
      limitsCache = data.settings;
    }

    // Refresh gauges and current status on calendar
    const todayStr = new Date().toISOString().split('T')[0];
    await syncHpMotivationStatus(todayStr);

    closeCalendarSettingsModal();
    showToast("カレンダー設定を保存しました ⚙️");
  } catch (err) {
    console.error('Failed to save calendar settings:', err);
    showToast(err.message || "カレンダー設定の保存に失敗しました");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "保存";
    }
  }
}
