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

// POST /api/ai/draft-email - AI Assistant to draft job hunting emails (Phase 2 feature)
router.post('/draft-email', authenticateToken, async (req, res) => {
    const { template_type, company_name, user_name, context_details } = req.body;

    if (!template_type || !company_name || !user_name) {
        return res.status(400).json({ error: 'テンプレートの種類、企業名、送信者名は必須項目です' });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;

    if (!apiKey || apiKey === 'your_claude_api_key_here') {
        // Fallback to Template engine when Claude is not connected
        const draft = generateMockEmailDraft(template_type, company_name, user_name, context_details || '');
        return res.json({
            message: '【デモモード】APIキー未設定のため、規定テンプレートから文面を作成しました。',
            isMock: true,
            draft
        });
    }

    try {
        const anthropic = new Anthropic({
            apiKey: apiKey
        });

        const systemPrompt = `あなたは優秀なキャリアアドバイザーおよびビジネス文書の作成者です。
就活生が企業へ送る「ビジネスメール」の下書きを作成してください。
フォーマットは必ず以下のようにお願いします：
・件名
・本文
これら以外の不要な前置きや「了解しました」「お役に立てれば幸いです」といったメタ発言は一切含めないでください。`;

        const prompt = `以下の情報を用いてメールの下書きを作成してください：
- メールの目的: ${template_type} (例: エントリー、面接お礼、日程調整、質問)
- 送信先企業名: ${company_name}
- 送信ユーザー名: ${user_name}
- 補足情報・文脈: ${context_details || 'なし'}`;

        const response = await anthropic.messages.create({
            model: 'claude-3-5-sonnet-20241022',
            max_tokens: 1500,
            system: systemPrompt,
            messages: [
                { role: 'user', content: prompt }
            ]
        });

        res.json({
            message: 'Claude APIによるメール下書きの作成が完了しました',
            isMock: false,
            draft: response.content[0].text.trim()
        });
    } catch (err) {
        console.error('AI Draft email error:', err);
        res.status(500).json({ error: 'AIによるメール作成中にエラーが発生しました' });
    }
});

// Fallback to generate mock/simple calendar events
function generateMockShiftEvents(text) {
    const events = [];
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');

    const lines = text.split('\n');
    let index = 1;

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        const dateMatch = trimmed.match(/(\d{1,2})[/\-月日]/);
        const timeMatch = trimmed.match(/(\d{1,2})[:：]?(\d{2})?\s*[\-〜~]\s*(\d{1,2})[:：]?(\d{2})?/);

        if (dateMatch) {
            let dayVal = parseInt(dateMatch[1]);
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

// Fallback email generator
function generateMockEmailDraft(type, company, user, details) {
    let subject = '';
    let body = '';

    if (type === 'thank_you' || type === 'お礼') {
        subject = `【面接のお礼】${company}様（${user}）`;
        body = `${company}\n採用担当者様\n\nお世話になっております。本日面接でお時間をいただきました${user}です。\n\n本日はお忙しい中、私のために貴重なお時間を割いて面接を実施いただき、誠にありがとうございました。\n面接の中で、貴社の${details || '事業方針やビジョン'}について詳しくお伺いすることができ、貴社で働きたいという熱意がより一層高まりました。\n\n取り急ぎ、本日の面接のお礼を申し上げたくメールいたしました。ご多忙の折、返信には及びません。\n末筆ではございますが、貴社のますますのご発展をお祈り申し上げます。\n\n---------------------------------\n${user}\nメールアドレス: (あなたのメール)\n---------------------------------`;
    } else if (type === 'scheduling' || type === '日程調整') {
        subject = `【面接日程調整のご連絡】${company}様（${user}）`;
        body = `${company}\n採用担当者様\n\nお世話になっております。面接のご案内をいただきました${user}です。\n\nこの度は面接の機会をいただき、誠にありがとうございます。\n提示いただきました日程（あるいは以下の候補日程）についてご連絡いたします。\n\n【候補日程】\n${details || '・6月20日(土) 10:00〜18:00\n・6月22日(月) 13:00〜17:00'}\n\n上記の日程にてご都合のつく時間帯はございますでしょうか。\nお忙しいところ恐縮ですが、ご調整のほどよろしくお願い申し上げます。\n\n---------------------------------\n${user}\n---------------------------------`;
    } else {
        // Default entry/question template
        subject = `【求人応募について】${company}様（${user}）`;
        body = `${company}\n採用担当者様\n\n突然のご連絡にて失礼いたします。この度、貴社の求人を拝見し応募いたしました${user}です。\n\n添付の履歴書にて応募書類をお送りいたしますので、ご査収いただけますと幸いです。\nまた、${details || '質問内容や補足詳細'}についてもお尋ねしたく存じます。\n\nご多忙の中大変恐縮ですが、ご検討のほど何卒よろしくお願い申し上げます。\n\n---------------------------------\n${user}\n---------------------------------`;
    }

    return `件名: ${subject}\n\n${body}`;
}

module.exports = router;
