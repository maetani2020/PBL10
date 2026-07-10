// calendar-ai.js
// AI Assistant Panel and Gemini API integration logic

import { 
  currentDate, 
  currentView, 
  setCurrentDate, 
  currentAttachments, 
  setCurrentAttachments, 
  getAllEvents,
  getEvents, 
  getCurrentFilterVisibility,
  saveEvents, 
  formatDate, 
  escapeHTML, 
  showToast 
} from './calendar-state.js';

import { apiRequest } from './calendar-auth.js';

import { 
  openCreateEvent, 
  openEditEvent, 
  resetForm, 
  closeListModal 
} from './calendar-modals.js';

// Circular imports are resolved correctly in ES modules
import { refreshCalendar, switchView } from './calendar-views.js';

export const scannerSheet = document.getElementById("scannerSheet");
export const scannerBackdrop = document.getElementById("scannerBackdrop");
export const actionSheet = document.getElementById("actionSheet");
export const actionSheetBackdrop = document.getElementById("actionSheetBackdrop");
export const aiChatInput = document.getElementById("aiChatInput");
export const aiSendBtn = document.getElementById("aiSendBtn");
export const attachmentCarousel = document.getElementById("attachmentCarousel");
export const chatMessagesContainer = document.getElementById("chatMessagesContainer");
export const aiChatHistory = document.getElementById("aiChatHistory");
export const aiSummaryContainer = document.getElementById("aiSummaryContainer");
export const aiSummaryText = document.getElementById("aiSummaryText");

// ----------------------------------------------------
// UI Sheet Controls
// ----------------------------------------------------
export function openScannerSheet() {
  scannerBackdrop.classList.remove("hidden");
  scannerSheet.classList.remove("sheet-hidden");
  if (typeof lucide !== 'undefined') {
    lucide.createIcons();
  }
}

export function closeScannerSheet() {
  scannerBackdrop.classList.add("hidden");
  scannerSheet.classList.add("sheet-hidden");
}

export function showActionSheet() {
  actionSheetBackdrop.classList.remove("hidden");
  actionSheet.classList.remove("sheet-hidden");
}

export function hideActionSheet() {
  actionSheetBackdrop.classList.add("hidden");
  actionSheet.classList.add("sheet-hidden");
}

export function validateSendButton() {
  const textLength = aiChatInput.value.trim().length;
  const hasFiles = currentAttachments.length > 0;
  aiSendBtn.disabled = !(textLength > 0 || hasFiles);
}

// ----------------------------------------------------
// API retry helper
// ----------------------------------------------------
export async function fetchWithRetry(url, options, retries = 5, backoff = 1000) {
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

async function requestGemini(payload, options = {}) {
  let lastError;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await apiRequest('/api/ai/gemini', {
        method: 'POST',
        body: JSON.stringify({
          payload,
          model: options.model
        })
      });
    } catch (err) {
      lastError = err;
      const message = String(err?.message || "");
      if (/BAN/i.test(message)) {
        break;
      }
      if (attempt < 2) {
        await new Promise(resolve => setTimeout(resolve, 800 * (attempt + 1)));
      }
    }
  }

  throw lastError;
}

// ----------------------------------------------------
// Attachment handling
// ----------------------------------------------------
export function handleFileAttachment(e) {
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
        
        const attachments = [...currentAttachments];
        attachments.push({
          id: id,
          name: file.name,
          base64Payload: compressedBase64.split(',')[1],
          fullBase64: compressedBase64,
          description: ""
        });
        setCurrentAttachments(attachments);

        renderAttachmentsCarousel();
        validateSendButton();
      };
      img.src = event.target.result;
    };
    reader.readAsDataURL(file);
  });

  const cameraInput = document.getElementById("cameraInput");
  const galleryInput = document.getElementById("galleryInput");
  if (cameraInput) cameraInput.value = '';
  if (galleryInput) galleryInput.value = '';
}

export function renderAttachmentsCarousel() {
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

// ----------------------------------------------------
// Chat & Gemini communication
// ----------------------------------------------------
export async function sendChatToGemini() {
  const userPromptText = aiChatInput.value.trim();
  const attachedImages = [...currentAttachments];

  if (!userPromptText && attachedImages.length === 0) return;

  aiChatInput.value = '';
  aiChatInput.style.height = 'auto';
  setCurrentAttachments([]);
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
    memo: e.memo || "",
    visibility: e.visibility || "public",
    eventType: e.eventType || "event",
    hp_consumption: Number(e.hp_consumption || 0),
    motivation_consumption: Number(e.motivation_consumption || 0),
    reminderMinutes: Array.isArray(e.reminderMinutes) ? e.reminderMinutes : [],
    notifyAtStart: e.notifyAtStart !== false,
    taskDeadlineNotify: e.taskDeadlineNotify !== false,
    mailReminderEnabled: !!e.mailReminderEnabled,
    mailTo: e.mailTo || "",
    mailSubject: e.mailSubject || "",
    mailRemindAt: e.mailRemindAt || ""
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

  promptText += `

[Additional rules for event details]
When action is ADD_EVENTS, include detailed event settings when the user mentions them.
Use these exact JSON keys inside each event object:
- start and end must be zero-padded local datetime strings: "YYYY-MM-DDTHH:mm". Example: "2026-07-12T13:00"
- visibility: "public", "group", or "private"
- eventType: "event", "task", or "mail"
- hp_consumption: integer 0-100
- motivation_consumption: integer 0-100
- reminderMinutes: array of integers, minutes before start. Examples: [30], [5], [30,5]
- notifyAtStart: boolean. true means notify at the start/end time.
- taskDeadlineNotify: boolean. true means task deadline notification is enabled.
- mailReminderEnabled: boolean
- mailTo: email string, optional
- mailSubject: string, optional
- mailRemindAt: "YYYY-MM-DDTHH:mm", optional. If the user asks for an email reminder but does not give a specific mail reminder time, set this to 30 minutes before the event start.

Default values when the user does not specify details:
- visibility: use the current calendar mode. public for main calendar, group for group calendar, private for personal calendar.
- eventType: "event"
- hp_consumption: 0
- motivation_consumption: 0
- reminderMinutes: []
- notifyAtStart: true
- taskDeadlineNotify: true
- mailReminderEnabled: false
- mailTo, mailSubject, mailRemindAt: empty string
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
                color: { type: "STRING" },
                visibility: { type: "STRING" },
                eventType: { type: "STRING" },
                hp_consumption: { type: "INTEGER" },
                motivation_consumption: { type: "INTEGER" },
                reminderMinutes: {
                  type: "ARRAY",
                  items: { type: "INTEGER" }
                },
                notifyAtStart: { type: "BOOLEAN" },
                taskDeadlineNotify: { type: "BOOLEAN" },
                mailReminderEnabled: { type: "BOOLEAN" },
                mailTo: { type: "STRING" },
                mailSubject: { type: "STRING" },
                mailRemindAt: { type: "STRING" },
                mailSent: { type: "BOOLEAN" }
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
    const data = await requestGemini(payload);
    const textResult = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!textResult) throw new Error("応答データが異常です。");

    const resultJson = JSON.parse(textResult);
    handleAIResponseAction(botBubbleId, resultJson, userPromptText);

  } catch (err) {
    console.error("Gemini API Error: ", err);
    renderBotError(botBubbleId);
  }
}

export function renderUserMessage(text, attachments) {
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

export function renderBotLoader(id) {
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

export function renderBotError(id) {
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

export function handleAIResponseAction(botBubbleId, aiResponse, sourcePromptText = "") {
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
      const proposalEvent = {
        ...p,
        __sourcePromptText: sourcePromptText
      };
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
          <button onclick="registerProposalEvent('${encodeURIComponent(JSON.stringify(proposalEvent))}', '${uniquePropId}')" 
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

export function scrollToBottom() {
  setTimeout(() => {
    aiChatHistory.scrollTo({
      top: aiChatHistory.scrollHeight,
      behavior: 'smooth'
    });
  }, 50);
}

// ----------------------------------------------------
// AI DAILY PLANNER ADVICE
// ----------------------------------------------------
export async function triggerAIDailyAdvice() {
  const targetDateStr = formatDate(currentDate);
  const dayEvents = getEvents().filter(e => e.date === targetDateStr);
  
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
    const data = await requestGemini({
      contents: [{ parts: [{ text: prompt }] }]
    });
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!text) throw new Error("応答がありません");

    aiSummaryText.innerHTML = text.replace(/\n/g, '<br>');
  } catch (err) {
    console.error("AI Daily Planner error: ", err);
    aiSummaryText.innerText = "アドバイスの生成に失敗しました。時間をおいてもう一度お試しください。";
  }
}

// ----------------------------------------------------
// Global Window Functions for AI Inline Event Handlers
// ----------------------------------------------------
function clampInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  const number = Number.isFinite(parsed) ? parsed : fallback;
  return Math.min(max, Math.max(min, number));
}

function normalizeAiReminderMinutes(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map(item => Number.parseInt(item, 10))
    .filter(item => Number.isInteger(item) && item >= 1 && item <= 10080)
    .filter((item, index, array) => array.indexOf(item) === index)
    .slice(0, 10);
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function formatAiLocalDateTime(year, month, day, hour, minute) {
  return `${year}-${pad2(month)}-${pad2(day)}T${pad2(hour)}:${pad2(minute)}`;
}

function normalizeAiLocalDateTime(value, fallbackDate, fallbackTime) {
  const raw = String(value || "").trim();
  const fallback = `${fallbackDate}T${fallbackTime}`;
  if (!raw) return fallback;

  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(raw)) return raw;

  const normalized = raw
    .replace(/[\u5e74\u6708]/g, "-")
    .replace(/\u65e5/g, " ")
    .replace(/\u6642/g, ":")
    .replace(/\u5206/g, "")
    .replace(/\//g, "-")
    .replace(/\s+/g, " ")
    .replace(/(\d{1,2}):$/g, "$1:00")
    .trim();

  let match = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2})(?::(\d{1,2}))?)?$/);
  if (match) {
    return formatAiLocalDateTime(
      match[1],
      match[2],
      match[3],
      match[4] || fallbackTime.substring(0, 2),
      match[5] || fallbackTime.substring(3, 5)
    );
  }

  match = normalized.match(/^(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2})(?::(\d{1,2}))?)?$/);
  if (match) {
    return formatAiLocalDateTime(
      fallbackDate.substring(0, 4),
      match[1],
      match[2],
      match[3] || fallbackTime.substring(0, 2),
      match[4] || fallbackTime.substring(3, 5)
    );
  }

  match = normalized.match(/^(\d{1,2}):(\d{1,2})$/);
  if (match) {
    return `${fallbackDate}T${pad2(match[1])}:${pad2(match[2])}`;
  }

  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    return formatAiLocalDateTime(
      parsed.getFullYear(),
      parsed.getMonth() + 1,
      parsed.getDate(),
      parsed.getHours(),
      parsed.getMinutes()
    );
  }

  return fallback;
}

function shiftLocalDateTime(value, minutes) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  date.setMinutes(date.getMinutes() + minutes);
  const pad = (num) => String(num).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function normalizeAiVisibility(value) {
  const currentVisibility = getCurrentFilterVisibility();
  const visibility = String(value || currentVisibility || "public").toLowerCase();
  if (["public", "group", "private"].includes(visibility)) return visibility;
  return currentVisibility || "public";
}

function normalizeAiEventType(value) {
  const eventType = String(value || "event").toLowerCase();
  if (["event", "task", "mail"].includes(eventType)) return eventType;
  return "event";
}

async function resolveAiCalendarId(visibility) {
  if (visibility !== "group") return undefined;

  const selectedGroupId = document.getElementById("eventGroupId")?.value || "";
  const calendars = await apiRequest('/api/calendars');
  const groupCalendars = calendars.filter(calendar => calendar.group_id);
  const matchedCalendar = selectedGroupId
    ? groupCalendars.find(calendar => String(calendar.group_id) === String(selectedGroupId))
    : groupCalendars[0];

  if (!matchedCalendar) {
    throw new Error("Group calendar is not available");
  }
  return matchedCalendar.id;
}

function extractAiDetailsFromPrompt(promptText) {
  const text = String(promptText || "");
  const details = {};

  const hpMatch = text.match(/HP\s*(?:\u6d88\u8cbb(?:\u7387)?)?\s*[:：]?\s*(\d{1,3})/i);
  if (hpMatch) {
    details.hp_consumption = clampInteger(hpMatch[1], 0, 0, 100);
  }

  const motivationMatch = text.match(/(?:\u3084\u308b\u6c17|\u30e2\u30c1\u30d9(?:\u30fc\u30b7\u30e7\u30f3)?|motivation)\s*(?:\u6d88\u8cbb(?:\u7387)?)?\s*[:：]?\s*(\d{1,3})/i);
  if (motivationMatch) {
    details.motivation_consumption = clampInteger(motivationMatch[1], 0, 0, 100);
  }

  const reminderMinutes = [];
  const minuteRegex = /(\d{1,4})\s*\u5206\u524d/g;
  let minuteMatch;
  while ((minuteMatch = minuteRegex.exec(text)) !== null) {
    const minute = Number.parseInt(minuteMatch[1], 10);
    if (Number.isInteger(minute) && minute >= 1 && minute <= 10080 && !reminderMinutes.includes(minute)) {
      reminderMinutes.push(minute);
    }
  }
  if (reminderMinutes.length > 0) {
    details.reminderMinutes = reminderMinutes.slice(0, 10);
  }

  const hasMail = /(?:\u30e1\u30fc\u30eb|mail|email)/i.test(text);
  const hasReminder = /(?:\u30ea\u30de\u30a4\u30f3\u30c9|\u901a\u77e5|\u9001\u4fe1)/i.test(text);
  if (hasMail && hasReminder) {
    details.mailReminderEnabled = true;
  }

  if (/(?:\u958b\u59cb|\u671f\u9650)/.test(text)) {
    details.notifyAtStart = true;
    details.taskDeadlineNotify = true;
  }

  if (/\u30bf\u30b9\u30af|\u8ab2\u984c|\u671f\u9650/.test(text)) {
    details.eventType = "task";
  } else if (hasMail && /\u9001\u4fe1/.test(text)) {
    details.eventType = "mail";
  }

  if (/\u500b\u4eba/.test(text)) {
    details.visibility = "private";
  } else if (/\u30b0\u30eb\u30fc\u30d7/.test(text)) {
    details.visibility = "group";
  }

  return details;
}

async function buildAiEventPayload(eventData) {
  const promptDetails = extractAiDetailsFromPrompt(eventData.__sourcePromptText);
  const mergedEventData = {
    ...eventData,
    ...Object.fromEntries(Object.entries(promptDetails).filter(([, value]) => value !== undefined && value !== null))
  };
  const today = formatDate(new Date());
  const allDay = !!(mergedEventData.allday ?? mergedEventData.allDay);
  let start = normalizeAiLocalDateTime(mergedEventData.start, today, allDay ? "00:00" : "09:00");
  let end = normalizeAiLocalDateTime(mergedEventData.end, start.substring(0, 10), allDay ? "23:59" : "10:00");

  if (allDay) {
    start = `${start.substring(0, 10)}T00:00`;
    end = `${end.substring(0, 10)}T23:59`;
  }

  if (start > end) {
    end = shiftLocalDateTime(start, allDay ? 1439 : 60);
  }

  const visibility = normalizeAiVisibility(mergedEventData.visibility);
  const eventType = normalizeAiEventType(mergedEventData.eventType || mergedEventData.type);
  const reminderMinutes = normalizeAiReminderMinutes(mergedEventData.reminderMinutes);
  const mailReminderEnabled = !!mergedEventData.mailReminderEnabled;
  const mailOffset = reminderMinutes.length > 0 ? reminderMinutes[0] : 30;
  const mailRemindAt = mailReminderEnabled
    ? (mergedEventData.mailRemindAt
      ? normalizeAiLocalDateTime(mergedEventData.mailRemindAt, start.substring(0, 10), start.substring(11, 16))
      : shiftLocalDateTime(start, -mailOffset))
    : "";

  return {
    calendar_id: await resolveAiCalendarId(visibility),
    title: String(mergedEventData.title || "Untitled event").trim().slice(0, 100),
    location: String(mergedEventData.location || "").trim().slice(0, 100),
    allday: allDay,
    start,
    end,
    color: /^#[0-9A-Fa-f]{6}$/.test(String(mergedEventData.color || "")) ? mergedEventData.color : "#007AFF",
    memo: String(mergedEventData.memo || "").trim().slice(0, 1000),
    visibility,
    hp_consumption: clampInteger(mergedEventData.hp_consumption, 0, 0, 100),
    motivation_consumption: clampInteger(mergedEventData.motivation_consumption, 0, 0, 100),
    eventType,
    reminderMinutes,
    notifyAtStart: mergedEventData.notifyAtStart !== false,
    taskDeadlineNotify: mergedEventData.taskDeadlineNotify !== false,
    mailReminderEnabled,
    mailTo: String(mergedEventData.mailTo || "").trim(),
    mailSubject: String(mergedEventData.mailSubject || "").trim().slice(0, 120),
    mailRemindAt,
    mailSent: !!mergedEventData.mailSent
  };
}

function saveAiEventToCache(savedEvent) {
  const allEvents = getAllEvents();
  const normalizedEvent = {
    ...savedEvent,
    allDay: !!(savedEvent.allDay ?? savedEvent.allday),
    date: (savedEvent.start || "").substring(0, 10)
  };
  saveEvents([...allEvents, normalizedEvent]);
}

window.registerProposalEvent = async function(encodedEvent, uniquePropId) {
  const btn = document.getElementById(`${uniquePropId}-btn`);
  const card = document.getElementById(`${uniquePropId}-card`);

  try {
    const eventData = JSON.parse(decodeURIComponent(encodedEvent));
    const payload = await buildAiEventPayload(eventData);

    if (btn) {
      btn.disabled = true;
      btn.innerHTML = "追加中...";
    }

    const data = await apiRequest('/api/events', {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    const newEvent = {
      ...payload,
      ...(data.event || {}),
      allDay: payload.allday,
      date: payload.start.substring(0, 10)
    };

    saveAiEventToCache(newEvent);

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
      setCurrentDate(startObj);
    }
    refreshCalendar();

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
  refreshCalendar();
};

window.focusOnCalendarDate = function(dateStr, uniquePropId) {
  const targetDate = new Date(dateStr);
  if (!isNaN(targetDate.getTime())) {
    setCurrentDate(targetDate);
    switchView("day");
    closeScannerSheet();
    showToast(`${formatDate(targetDate)}を表示しました`);
  }
};

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
    const data = await requestGemini({
      contents: [{ parts: [{ text: prompt }] }]
    });
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
