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
  escapeHTML,
  isReadOnlyCalendarMode
} from './calendar-state.js';

import { 
  openCreateEventWithTime, 
  openEditEvent, 
  closeListModal,
  openDayDetailModal,
  closeDayDetailModal
} from './calendar-modals.js';
import { findCategoryForEvent } from './calendar-categories.js';

// We import triggerAIDailyAdvice from calendar-ai.js for the Day View banner action
import { triggerAIDailyAdvice } from './calendar-ai.js';
import { getJapaneseHoliday } from './calendar-holidays.js';

export const monthView = document.getElementById("monthView");
export const weekView = document.getElementById("weekView");
export const dayView = document.getElementById("dayView");
export const currentTitle = document.getElementById("currentTitle");

function applyEventColor(element, event) {
  const color = event.color || "#007AFF";
  element.style.backgroundColor = color;
  element.style.borderColor = color;
}

function appendHolidayLabel(parent, holiday, className = "holiday-name") {
  if (!holiday) return;
  const label = document.createElement(className === "day-holiday-name" ? "span" : "div");
  label.className = className;
  label.textContent = holiday.name;
  label.title = holiday.name;
  parent.appendChild(label);
}

function applyHolidayClass(element, holiday) {
  if (!holiday) return;
  element.classList.add("holiday");
  element.title = holiday.name;
}

function getEventStartDate(event) {
  return String(event.start || event.date || "").slice(0, 10);
}

function getEventEndDate(event) {
  return String(event.end || event.start || event.date || "").slice(0, 10);
}

function toLocalDate(dateStr) {
  const [year, month, day] = String(dateStr).split("-").map(Number);
  return new Date(year, month - 1, day);
}

function isMultiDayEvent(event) {
  const start = getEventStartDate(event);
  const end = getEventEndDate(event);
  return Boolean(start && end && start !== end);
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function minDate(a, b) {
  return a <= b ? a : b;
}

function maxDate(a, b) {
  return a >= b ? a : b;
}

function allocateMonthEventLane(rowLanes, row, startCol, endCol) {
  const lanes = rowLanes.get(row) || [];

  for (let lane = 0; lane < lanes.length; lane += 1) {
    const overlaps = lanes[lane].some(span => (
      startCol < span.endCol && endCol > span.startCol
    ));
    if (!overlaps) {
      lanes[lane].push({ startCol, endCol });
      rowLanes.set(row, lanes);
      return lane;
    }
  }

  lanes.push([{ startCol, endCol }]);
  rowLanes.set(row, lanes);
  return lanes.length - 1;
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

  const events = getEvents();
  const totalCells = startWeek + totalDays;
  const weekRows = Math.ceil(totalCells / 7);
  const targetCells = weekRows * 7;
  const firstVisibleDate = addDays(firstDay, -startWeek);
  const lastVisibleDate = addDays(firstVisibleDate, targetCells - 1);
  const cellInfoByDate = new Map();
  const cellInfos = [];

  for (let index = 0; index < targetCells; index += 1) {
    const row = Math.floor(index / 7) + 1;
    const col = (index % 7) + 1;
    const cellDate = addDays(firstVisibleDate, index);
    const dateStr = formatDate(cellDate);
    const isCurrentMonth = cellDate.getMonth() === month;
    const cell = document.createElement("div");
    cell.className = isCurrentMonth ? "day-cell" : "day-cell other-month";
    cell.style.gridColumn = String(col);
    cell.style.gridRow = String(row);

    const weekday = cellDate.getDay();
    const holiday = getJapaneseHoliday(cellDate);

    if (weekday === 0) cell.classList.add("sunday");
    if (weekday === 6) cell.classList.add("saturday");
    applyHolidayClass(cell, holiday);

    if (isToday(cellDate.getFullYear(), cellDate.getMonth(), cellDate.getDate())) {
      cell.classList.add("today");
    }

    const dayNumber = document.createElement("div");
    dayNumber.className = "day-number";
    dayNumber.textContent = cellDate.getDate();
    cell.appendChild(dayNumber);
    appendHolidayLabel(cell, holiday);

    const eventContainer = document.createElement("div");
    eventContainer.className = "month-cell-events";
    cell.appendChild(eventContainer);

    const info = { cell, eventContainer, date: cellDate, dateStr, row, col, index };
    cellInfos.push(info);
    cellInfoByDate.set(dateStr, info);

    cell.addEventListener("click", () => {
      openDayDetail(dateStr);
    });

    monthView.appendChild(cell);
  }

  const multiDayEvents = events.filter(isMultiDayEvent);
  const rowLanes = new Map();

  multiDayEvents.forEach((event) => {
    const eventStartDate = toLocalDate(getEventStartDate(event));
    const eventEndDate = toLocalDate(getEventEndDate(event));
    if (Number.isNaN(eventStartDate.getTime()) || Number.isNaN(eventEndDate.getTime())) return;
    if (eventEndDate < firstVisibleDate || eventStartDate > lastVisibleDate) return;

    let segmentStart = maxDate(eventStartDate, firstVisibleDate);
    const visibleEnd = minDate(eventEndDate, lastVisibleDate);

    while (segmentStart <= visibleEnd) {
      const startInfo = cellInfoByDate.get(formatDate(segmentStart));
      if (!startInfo) {
        segmentStart = addDays(segmentStart, 1);
        continue;
      }

      const rowEndIndex = (startInfo.row * 7) - 1;
      const rowEndDate = cellInfos[rowEndIndex]?.date || visibleEnd;
      const segmentEnd = minDate(visibleEnd, rowEndDate);
      const endInfo = cellInfoByDate.get(formatDate(segmentEnd));
      if (!endInfo) break;

      const gridEndCol = endInfo.col + 1;
      const lane = allocateMonthEventLane(rowLanes, startInfo.row, startInfo.col, gridEndCol);
      const span = document.createElement("div");
      span.className = `event month-event-span ${event.visibility}`;
      span.style.gridColumn = `${startInfo.col} / ${gridEndCol}`;
      span.style.gridRow = String(startInfo.row);
      span.style.setProperty("--month-event-lane", String(lane));
      applyEventColor(span, event);
      span.textContent = `${event.allDay ? "📌 " : ""}${event.title}`;
      span.title = `${event.title} (${getEventStartDate(event)} - ${getEventEndDate(event)})`;

      span.addEventListener("click", (e) => {
        e.stopPropagation();
        openEditEvent(event);
      });

      monthView.appendChild(span);
      segmentStart = addDays(segmentEnd, 1);
    }
  });

  cellInfos.forEach((info) => {
    const laneCount = rowLanes.get(info.row)?.length || 0;
    if (laneCount > 0) {
      info.cell.classList.add("has-multiday");
      info.eventContainer.style.marginTop = `${laneCount * 22 + 4}px`;
    }

    const dayEvents = events.filter((event) => {
      if (isMultiDayEvent(event)) return false;
      return event.date === info.dateStr || getEventStartDate(event) === info.dateStr;
    });

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

      info.eventContainer.appendChild(eventDiv);
    });
  });
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
    const holiday = getJapaneseHoliday(date);
    div.innerHTML = `
      <span>${date.getMonth() + 1}/${date.getDate()}</span>
    `;
    appendHolidayLabel(div, holiday, "week-holiday-name");

    const weekday = date.getDay();
    if (weekday === 0) div.classList.add("sun");
    if (weekday === 6) div.classList.add("sat");
    applyHolidayClass(div, holiday);

    const dateStr = formatDate(date);
    div.style.cursor = "pointer";
    div.addEventListener("click", () => {
      openDayDetail(dateStr);
    });

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
  const holiday = getJapaneseHoliday(currentDate);
  title.textContent = formatDate(currentDate);
  appendHolidayLabel(title, holiday, "day-holiday-name");
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
// Day Detail Modal (date tap → event list + create)
// ----------------------------------------------------
function eventOccursOnDate(event, dateStr) {
  const start = getEventStartDate(event);
  const end = getEventEndDate(event);
  if (start && end) {
    return start <= dateStr && end >= dateStr;
  }
  return event.date === dateStr;
}

function formatDayDetailTitle(dateStr) {
  const date = toLocalDate(dateStr);
  if (Number.isNaN(date.getTime())) return dateStr;
  const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日（${weekdays[date.getDay()]}）`;
}

export function openDayDetail(dateStr) {
  openDayDetailModal(dateStr);
  renderDayDetailList(dateStr);
}

export function renderDayDetailList(dateStr = formatDate(currentDate)) {
  const titleEl = document.getElementById("dayDetailTitle");
  const subtitleEl = document.getElementById("dayDetailSubtitle");
  const container = document.getElementById("dayDetailList");
  const createBtn = document.getElementById("dayDetailCreateBtn");
  if (!container) return;

  if (titleEl) titleEl.textContent = formatDayDetailTitle(dateStr);

  const holiday = getJapaneseHoliday(toLocalDate(dateStr));
  if (subtitleEl) {
    subtitleEl.textContent = holiday ? `祝日: ${holiday.name}` : "";
    subtitleEl.classList.toggle("hidden", !holiday);
  }

  if (createBtn) {
    createBtn.classList.toggle("hidden", isReadOnlyCalendarMode());
  }

  const events = getEvents()
    .filter((event) => eventOccursOnDate(event, dateStr))
    .sort((a, b) => {
      if (a.allDay && !b.allDay) return -1;
      if (!a.allDay && b.allDay) return 1;
      return String(a.start || "").localeCompare(String(b.start || ""));
    });

  container.innerHTML = "";

  if (events.length === 0) {
    const empty = document.createElement("p");
    empty.className = "day-detail-empty";
    empty.textContent = "この日の予定はありません";
    container.appendChild(empty);
    return;
  }

  events.forEach((event) => {
    const card = document.createElement("div");
    card.className = "event-card";
    card.style.borderLeft = `5px solid ${event.color || "#007AFF"}`;

    let visibilityLabel = "自分のみ";
    if (event.visibility === "public") visibilityLabel = "全体公開";
    else if (event.visibility === "group") visibilityLabel = "グループ公開";

    let typeLabel = "📅 通常予定";
    if (event.eventType === "task") typeLabel = "📋 タスク";
    else if (event.eventType === "mail") typeLabel = "✉️ メール";

    const timeLabel = event.allDay
      ? "終日予定"
      : `${String(event.start || "").substring(11, 16)} 〜 ${String(event.end || "").substring(11, 16)}`;

    const category = findCategoryForEvent(event);
    const categoryLabel = category
      ? `<p><span class="day-detail-category-dot" style="background:${category.color}"></span>${escapeHTML(category.name)}</p>`
      : "";

    const rangeNote = isMultiDayEvent(event)
      ? `<p>🗓 ${getEventStartDate(event)} 〜 ${getEventEndDate(event)}</p>`
      : "";

    card.innerHTML = `
      <h4 style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
        <span>${escapeHTML(event.title)}</span>
        <span style="font-size:11px; opacity:0.7; font-weight:normal; white-space:nowrap;">${typeLabel}</span>
      </h4>
      <p>🕒 ${timeLabel}</p>
      ${categoryLabel}
      <p>👥 ${visibilityLabel}</p>
      ${rangeNote}
    `;

    card.addEventListener("click", () => {
      closeDayDetailModal();
      openEditEvent(event);
    });

    container.appendChild(card);
  });
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
