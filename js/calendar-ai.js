// calendar-ai.js
// AI Assistant Panel and Gemini API integration logic

import { 
  currentDate, 
  currentView, 
  setCurrentDate, 
  currentAttachments, 
  setCurrentAttachments, 
  apiKey, 
  getEvents, 
  saveEvents, 
  formatDate, 
  createId, 
  escapeHTML, 
  showToast 
} from './calendar-state.js';

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
    memo: e.memo || ""
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
                color: { type: "STRING" }
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
    const response = await fetchWithRetry(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    const textResult = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!textResult) throw new Error("応答データが異常です。");

    const resultJson = JSON.parse(textResult);
    handleAIResponseAction(botBubbleId, resultJson);

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

export function handleAIResponseAction(botBubbleId, aiResponse) {
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
          <button onclick="registerProposalEvent('${encodeURIComponent(JSON.stringify(p))}', '${uniquePropId}')" 
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
    const response = await fetchWithRetry(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }]
      })
    });

    const data = await response.json();
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
window.registerProposalEvent = function(encodedEvent, uniquePropId) {
  try {
    const eventData = JSON.parse(decodeURIComponent(encodedEvent));
    const events = getEvents();

    const newEvent = {
      id: createId(),
      title: eventData.title,
      start: eventData.start,
      end: eventData.end,
      date: eventData.start.substring(0, 10),
      memo: eventData.memo || "",
      visibility: "public",
      allDay: !!eventData.allday
    };

    events.push(newEvent);
    saveEvents(events);

    const btn = document.getElementById(`${uniquePropId}-btn`);
    const card = document.getElementById(`${uniquePropId}-card`);

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
    const response = await fetchWithRetry(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }]
      })
    });

    const data = await response.json();
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
