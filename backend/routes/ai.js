const express = require('express');
const router = express.Router();
const Anthropic = require('@anthropic-ai/sdk');
const authenticateToken = require('../middleware/auth');

// POST /api/ai/parse-shift - Parse shift text using Claude API
router.post('/parse-shift', authenticateToken, async (req, res) => {
    const { text } = req.body;

    if (!text || !text.trim()) {
        return res.status(400).json({ error: '解析対象のテキストを入力してください' });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    
    // Check if Anthropic API Key is default or missing
    if (!apiKey || apiKey === 'your_claude_api_key_here') {
        console.warn('Anthropic API Key is not set or is using placeholder. Falling back to Mock Parse Mode.');
        const mockEvents = generateMockShiftEvents(text);
        return res.json({
            message: '【デモモード】APIキーが未設定のため、ローカルでの簡易解析を行いました。APIキーを設定するとClaudeによる高度な解析が有効になります。',
            isMock: true,
            events: mockEvents
        });
    }

    try {
        const anthropic = new Anthropic({
            apiKey: apiKey
        });

        const currentYear = new Date().getFullYear();
        const currentMonth = new Date().getMonth() + 1;

        const systemPrompt = `あなたは優秀なカレンダー管理アシスタントです。
ユーザーから提供された「シフト表」や「予定のメモ」のテキストから、カレンダー登録用のイベントを抽出してください。

以下のルールを厳密に守ってください：
1. 抽出したイベントは、必ず以下のJSON配列形式のみで出力してください。説明文やマークダウンの\`\`\`jsonのような囲みは一切含めないでください。
[
  {
    "title": "イベントのタイトル (例: バイト、早番、ミーティングなど)",
    "start": "開始日時。フォーマットは 'YYYY-MM-DDTHH:mm' (例: '2026-06-12T09:00')",
    "end": "終了日時。フォーマットは 'YYYY-MM-DDTHH:mm' (例: '2026-06-12T18:00')",
    "location": "場所 (ある場合のみ、なければ空文字)",
    "memo": "シフト情報の詳細や補足メモ (元テキストの該当箇所など)",
    "allday": false (終日の場合はtrue)
  }
]
2. 年の指定がない場合は、現在の年「${currentYear}」と仮定してください。
3. 月の指定がない場合は、現在の月「${currentMonth}」と仮定してください。
4. 日時の解釈漏れがないように、テキスト内のすべてのシフト予定を抽出してください。`;

        const response = await anthropic.messages.create({
            model: 'claude-3-5-sonnet-20241022',
            max_tokens: 1500,
            system: systemPrompt,
            messages: [
                { role: 'user', content: `以下のシフトテキストを解析してください：\n\n${text}` }
            ]
        });

        let rawResult = response.content[0].text.trim();
        
        // Remove markdown wrappers if Claude returned them
        if (rawResult.startsWith('```')) {
            rawResult = rawResult.replace(/^```(json)?/, '').replace(/```$/, '').trim();
        }

        const events = JSON.parse(rawResult);
        res.json({
            message: 'Claude APIによるシフト解析が完了しました',
            isMock: false,
            events: events
        });

    } catch (err) {
        console.error('Claude API call error:', err);
        res.status(500).json({ error: 'Claude APIによる解析中にエラーが発生しました' });
    }
});

// Simple regex fallback to generate mock/simple calendar events for presentation and easy grading
function generateMockShiftEvents(text) {
    const events = [];
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');

    // Look for lines containing numbers like "6/15 9-18" or "15日 10:00~15:00"
    const lines = text.split('\n');
    let index = 1;

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        // Try to match date (e.g. 6/15 or 15日) and times (e.g. 9-18 or 10:00-15:00)
        // Regex to check date: (\d{1,2})[/\-月日]
        const dateMatch = trimmed.match(/(\d{1,2})[/\-月日]/);
        // Regex to check time: (\d{1,2})[:：]?(\d{2})?\s*[\-〜~~]\s*(\d{1,2})[:：]?(\d{2})?
        const timeMatch = trimmed.match(/(\d{1,2})[:：]?(\d{2})?\s*[\-〜~]\s*(\d{1,2})[:：]?(\d{2})?/);

        if (dateMatch) {
            let dayVal = parseInt(dateMatch[1]);
            // Limit day range
            if (dayVal < 1 || dayVal > 31) dayVal = now.getDate();

            const dayStr = String(dayVal).padStart(2, '0');
            let startHour = 9;
            let startMin = 0;
            let endHour = 18;
            let endMin = 0;

            if (timeMatch) {
                startHour = parseInt(timeMatch[1]);
                startMin = timeMatch[2] ? parseInt(timeMatch[2]) : 0;
                endHour = parseInt(timeMatch[3]);
                endMin = timeMatch[4] ? parseInt(timeMatch[4]) : 0;
            }

            // Determine if title is "シフト" or based on text keywords
            let title = 'シフト勤務';
            if (trimmed.includes('バイト')) title = 'アルバイト';
            else if (trimmed.includes('会議') || trimmed.includes('MTG')) title = '会議/ミーティング';
            else if (trimmed.includes('休み')) title = '休日';

            const startStr = `${year}-${month}-${dayStr}T${String(startHour).padStart(2, '0')}:${String(startMin).padStart(2, '0')}`;
            const endStr = `${year}-${month}-${dayStr}T${String(endHour).padStart(2, '0')}:${String(endMin).padStart(2, '0')}`;

            events.push({
                id: 'ai_' + Date.now() + '_' + index++,
                title: title,
                start: startStr,
                end: endStr,
                location: '',
                memo: `元テキスト: "${trimmed}"`,
                allday: title === '休日'
            });
        }
    }

    // Default fallback if regex didn't extract any date
    if (events.length === 0) {
        events.push({
            id: 'ai_' + Date.now() + '_default',
            title: 'シフト解析テスト (解析失敗時のモック)',
            start: `${year}-${month}-${String(now.getDate()).padStart(2, '0')}T09:00`,
            end: `${year}-${month}-${String(now.getDate()).padStart(2, '0')}T17:00`,
            location: 'オフィス',
            memo: `入力テキスト:\n${text}`,
            allday: false
        });
    }

    return events;
}

module.exports = router;
