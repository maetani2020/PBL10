// calendar-views.js
// Calendar Views rendering (Month, Week, Day, List) and view refresh functions

import { 
  currentDate, 
  currentView, 
  setCurrentDate, 
  setCurrentView,
  getEvents, 
  formatDate, 
  isToday, 
  showToast,
  escapeHTML
} from './calendar-state.js';

import { 
  openCreateEvent, 
  openCreateEventWithTime, 
  openEditEvent, 
  openListModal, 
  closeListModal 
} from './calendar-modals.js';

// We import triggerAIDailyAdvice from calendar-ai.js for the Day View banner action
import { triggerAIDailyAdvice } from './calendar-ai.js';

export const monthView = document.getElementById("monthView");
export const weekView = document.getElementById("weekView");
export const dayView = document.getElementById("dayView");
export const currentTitle = document.getElementById("currentTitle");

function applyEventColor(element, event) {
  const color = event.color || "#007AFF";
  element.style.backgroundColor = color;
  element.style.borderColor = color;
}

export function openYearJumpModal() {
  const modal = document.getElementById("yearJumpModal");
  const yearInput = document.getElementById("jumpYearInput");
  const monthSelect = document.getElementById("jumpMonthSelect");
  if (!modal || !yearInput || !monthSelect) return;

  yearInput.value = currentDate.getFullYear();
  monthSelect.value = String(currentDate.getMonth() + 1);
  modal.style.display = "flex";
  yearInput.focus();
}

export function closeYearJumpModal() {
  const modal = document.getElementById("yearJumpModal");
  if (modal) modal.style.display = "none";
}

export function applyYearJump() {
  const year = parseInt(document.getElementById("jumpYearInput")?.value, 10);
  const month = parseInt(document.getElementById("jumpMonthSelect")?.value, 10);

  if (!Number.isFinite(year) || year < 1970 || year > 2100 || !Number.isFinite(month) || month < 1 || month > 12) {
    showToast("1970年から2100年までの年月を指定してください");
    return false;
  }

  setCurrentDate(new Date(year, month - 1, 1));
  closeYearJumpModal();
  refreshCurrentView();
  return true;
}



// Update Calendar Title
export function updateTitle() {
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

// ----------------------------------------------------
// Switch Calendar View
// ----------------------------------------------------
export function switchView(view) {
  setCurrentView(view);

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

// ----------------------------------------------------
// Month View Rendering
// ----------------------------------------------------
export function renderMonthView() {
  monthView.innerHTML = "";

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);

  const startWeek = firstDay.getDay();
  const totalDays = lastDay.getDate();

  const prevMonthLastDay = new Date(year, month, 0).getDate();
  const events = getEvents();

  // 前月セル
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

  // 当月セル
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
      applyEventColor(eventDiv, event);
      
      let badgeHtml = "";
      const showHp = document.getElementById("showHpMotivation")?.checked ?? false;
      if (showHp) {
        if (event.hp_consumption > 0) badgeHtml += ` <span class="event-badge badge-hp">H${event.hp_consumption}</span>`;
        if (event.motivation_consumption > 0) badgeHtml += ` <span class="event-badge badge-motivation">M${event.motivation_consumption}</span>`;
      }
      if (event.eventType === "task") badgeHtml += ` <span class="event-badge badge-task">📋</span>`;
      if (event.eventType === "mail") badgeHtml += ` <span class="event-badge badge-mail">✉️</span>`;

      eventDiv.innerHTML = `${event.allDay ? "📌 " : ""}${escapeHTML(event.title)}${badgeHtml}`;

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

  // 翌月セル
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

// ----------------------------------------------------
// Week View Rendering (Fixed to draw 7-day grid and render events)
// ----------------------------------------------------
export function renderWeekView() {
  weekView.innerHTML = "";

  const start = new Date(currentDate);
  const day = start.getDay();
  start.setDate(start.getDate() - day);

  const events = getEvents();

  // ヘッダー作成
  const header = document.createElement("div");
  header.className = "week-header";

  // 左側の時間軸用スペース
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

  // 時間軸と7日分の列を作成
  for (let hour = 0; hour < 24; hour++) {
    const row = document.createElement("div");
    row.className = "week-hour";

    const timeDiv = document.createElement("div");
    timeDiv.className = "week-time";
    timeDiv.textContent = `${String(hour).padStart(2, "0")}:00`;
    row.appendChild(timeDiv);

    const contentDiv = document.createElement("div");
    contentDiv.className = "week-content";

    for (let i = 0; i < 7; i++) {
      const date = new Date(start);
      date.setDate(start.getDate() + i);
      const dateStr = formatDate(date);

      const dayColumn = document.createElement("div");
      dayColumn.className = "week-day-column";

      // 日付と時間が合致するイベント（タイムゾーンに影響されない文字列パースを使用）
      const dayHourEvents = events.filter((event) => {
        if (event.date !== dateStr) return false;
        if (event.allDay) {
          return hour === 0; // 終日予定は00:00スロットに表示
        }
        const eventStartHour = parseInt(event.start.substring(11, 13), 10);
        return eventStartHour === hour;
      });

      dayHourEvents.forEach((event) => {
        const eventDiv = document.createElement("div");
        eventDiv.className = `event ${event.visibility}`;
        applyEventColor(eventDiv, event);
        
        let badgeHtml = "";
        const showHp = document.getElementById("showHpMotivation")?.checked ?? false;
        if (showHp) {
          if (event.hp_consumption > 0) badgeHtml += ` <span class="event-badge badge-hp">H${event.hp_consumption}</span>`;
          if (event.motivation_consumption > 0) badgeHtml += ` <span class="event-badge badge-motivation">M${event.motivation_consumption}</span>`;
        }
        if (event.eventType === "task") badgeHtml += ` <span class="event-badge badge-task">📋</span>`;
        if (event.eventType === "mail") badgeHtml += ` <span class="event-badge badge-mail">✉️</span>`;

        eventDiv.innerHTML = `${event.allDay ? "📌 " : ""}${escapeHTML(event.title)}${badgeHtml}`;
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

// ----------------------------------------------------
// Day View Rendering
// ----------------------------------------------------
export function renderDayView() {
  dayView.innerHTML = "";

  const title = document.createElement("h3");
  title.style.padding = "15px";
  title.textContent = formatDate(currentDate);
  dayView.appendChild(title);

  const targetDate = formatDate(currentDate);
  const events = getEvents().filter(e => e.date === targetDate);

  // AIデイリープランナーアドバイスボタンの設置
  if (events.length > 0) {
    const plannerBtn = document.createElement("button");
    plannerBtn.id = "aiDailyPlannerBtn";
    plannerBtn.className = "ai-daily-planner-btn";
    plannerBtn.innerHTML = '<span class="material-icons">auto_awesome</span> AIに今日の相談をする';
    plannerBtn.addEventListener("click", triggerAIDailyAdvice);
    dayView.appendChild(plannerBtn);
  }

  // イベントカードの生成
    events.forEach((event) => {
      const card = document.createElement("div");
      card.className = "event-card";
      card.style.borderLeft = `5px solid ${event.color || "#007AFF"}`;

      let visibilityLabel = "";
      if (event.visibility === "public") visibilityLabel = "全体公開";
      else if (event.visibility === "group") visibilityLabel = "グループ公開";
      else visibilityLabel = "自分のみ";

      let hpText = "";
      if (event.hp_consumption > 0 || event.motivation_consumption > 0) {
        hpText = `<p>⚡ HP消費: ${event.hp_consumption}% / やる気消費: ${event.motivation_consumption}%</p>`;
      }
      
      let typeLabel = "";
      if (event.eventType === "task") typeLabel = "📋 タスク";
      else if (event.eventType === "mail") typeLabel = "✉️ メール送信リマインド";
      else typeLabel = "📅 通常予定";

      card.innerHTML = `
        <h4 style="display:flex; justify-content:space-between; align-items:center;">
          <span>${escapeHTML(event.title)}</span>
          <span style="font-size:11px; opacity:0.7; font-weight:normal;">${typeLabel}</span>
        </h4>
        <p>📅 ${event.allDay ? "終日予定" : event.start.substring(11, 16) + " 〜 " + event.end.substring(11, 16)}</p>
        <p>👥 ${visibilityLabel}</p>
        ${hpText}
      `;

    // AI準備アドバイスブロックの設置
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

  if (events.length === 0) {
    const empty = document.createElement("p");
    empty.style.padding = "20px";
    empty.textContent = "予定がありません";
    dayView.appendChild(empty);
  }
}

// ----------------------------------------------------
// Schedule List Rendering
// ----------------------------------------------------
export function renderScheduleList(mode) {
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
    container.innerHTML = `
      <p style="padding:20px; text-align:center;">予定がありません</p>
    `;
    return;
  }

  events.forEach((event) => {
    const card = document.createElement("div");
    card.className = "event-card";
    card.style.borderLeft = `5px solid ${event.color || "#007AFF"}`;

    let visibility = "";
    if (event.visibility === "public") {
      visibility = "全体公開";
    } else if (event.visibility === "group") {
      visibility = "グループ";
    } else {
      visibility = "自分のみ";
    }

    card.innerHTML = `
      <div style="padding:12px; border-bottom: 1px solid #ddd; cursor:pointer;">
        <h4>${event.title}</h4>
        <p>📅 ${event.date}</p>
        <p>👥 ${visibility}</p>
        <p>${event.allDay ? "終日予定" : event.start.substring(11, 16) + " ～ " + event.end.substring(11, 16)}</p>
      </div>
    `;

    card.addEventListener("click", () => {
      closeListModal();
      openEditEvent(event);
    });

    container.appendChild(card);
  });
}

// ----------------------------------------------------
// Navigation / Refresh Functions (Fixed to redraw active view dynamically)
// ----------------------------------------------------
export function refreshCalendar() {
  updateTitle();
  if (currentView === "month") {
    renderMonthView();
  } else if (currentView === "week") {
    renderWeekView();
  } else if (currentView === "day") {
    renderDayView();
  }
}

export function refreshCurrentView() {
  refreshCalendar();
}

export function renderAll() {
  refreshCalendar();
}

export function movePrevious() {
  if (currentView === "month") {
    currentDate.setMonth(currentDate.getMonth() - 1);
  } else if (currentView === "week") {
    currentDate.setDate(currentDate.getDate() - 7);
  } else {
    currentDate.setDate(currentDate.getDate() - 1);
  }
  refreshCurrentView();
}

export function moveNext() {
  if (currentView === "month") {
    currentDate.setMonth(currentDate.getMonth() + 1);
  } else if (currentView === "week") {
    currentDate.setDate(currentDate.getDate() + 7);
  } else {
    currentDate.setDate(currentDate.getDate() + 1);
  }
  refreshCurrentView();
}
