const express = require('express');
const router = express.Router();
const { query } = require('../db');
const authenticateToken = require('../middleware/auth');
const { normalizeText, validateTextLength } = require('../utils/validation');

const NOTIFICATION_TYPES = ['event', 'task', 'game', 'email', 'announcement'];

function validateNotificationPayload(body) {
    const title = normalizeText(body.title);
    const message = normalizeText(body.message);
    const type = normalizeText(body.type) || 'event';

    if (!validateTextLength(title, 80)) {
        return { error: 'タイトルは1文字以上80文字以内で入力してください' };
    }
    if (!validateTextLength(message, 1000)) {
        return { error: 'メッセージは1文字以上1000文字以内で入力してください' };
    }
    if (!NOTIFICATION_TYPES.includes(type)) {
        return { error: '通知種別が正しくありません' };
    }
    return { value: { title, message, type } };
}

// POST /api/notifications/subscribe - Save push subscription JSON
router.post('/subscribe', authenticateToken, async (req, res) => {
    const { subscription } = req.body;

    if (!subscription) {
        return res.status(400).json({ error: 'サブスクリプション情報が必要です' });
    }

    try {
        const userId = req.user.id;
        const subJson = typeof subscription === 'object' ? JSON.stringify(subscription) : subscription;

        // Save subscription (preventing duplicates using ON CONFLICT)
        await query.run(
            `INSERT INTO push_subscriptions (user_id, subscription_json)
             VALUES (?, ?)
             ON CONFLICT(user_id, subscription_json) DO NOTHING`,
            [userId, subJson]
        );

        res.json({ message: 'プッシュ通知の購読を登録しました' });
    } catch (err) {
        console.error('Subscribe push error:', err);
        res.status(500).json({ error: 'サーバーエラーが発生しました' });
    }
});

// GET /api/notifications/history - View past notification logs (retains last 30 days)
router.get('/history', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;

        // Auto-purge logs older than 30 days
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - 30);
        await query.run(
            'DELETE FROM notification_history WHERE sent_at < ?',
            [cutoff.toISOString()]
        );

        // Fetch logs
        const logs = await query.all(
            'SELECT * FROM notification_history WHERE user_id = ? ORDER BY sent_at DESC',
            [userId]
        );

        res.json(logs);
    } catch (err) {
        console.error('Get notification history error:', err);
        res.status(500).json({ error: 'サーバーエラーが発生しました' });
    }
});

// GET /api/notifications/settings - Get user's notification toggles
router.get('/settings', authenticateToken, async (req, res) => {
    try {
        const user = await query.get('SELECT notification_settings FROM users WHERE id = ?', [req.user.id]);
        if (!user) {
            return res.status(404).json({ error: 'ユーザーが見つかりません' });
        }

        const settings = user.notification_settings 
            ? JSON.parse(user.notification_settings) 
            : { events: true, tasks: true, game: true, email: true };

        res.json(settings);
    } catch (err) {
        console.error('Get notification settings error:', err);
        res.status(500).json({ error: 'サーバーエラーが発生しました' });
    }
});

// POST /api/notifications/settings - Update notification toggles
router.post('/settings', authenticateToken, async (req, res) => {
    const { events, tasks, game, email } = req.body;

    try {
        const userId = req.user.id;
        const user = await query.get('SELECT notification_settings FROM users WHERE id = ?', [userId]);
        
        const currentSettings = user.notification_settings 
            ? JSON.parse(user.notification_settings) 
            : { events: true, tasks: true, game: true, email: true };

        const newSettings = {
            events: events !== undefined ? !!events : currentSettings.events,
            tasks: tasks !== undefined ? !!tasks : currentSettings.tasks,
            game: game !== undefined ? !!game : currentSettings.game,
            email: email !== undefined ? !!email : currentSettings.email
        };

        await query.run(
            'UPDATE users SET notification_settings = ? WHERE id = ?',
            [JSON.stringify(newSettings), userId]
        );

        res.json({
            message: '通知設定を更新しました',
            settings: newSettings
        });
    } catch (err) {
        console.error('Update notification settings error:', err);
        res.status(500).json({ error: 'サーバーエラーが発生しました' });
    }
});

// POST /api/notifications/trigger-test - Trigger a test notification (useful for testing PWA notifications)
router.post('/trigger-test', authenticateToken, async (req, res) => {
    const payload = validateNotificationPayload(req.body);

    if (payload.error) {
        return res.status(400).json({ error: payload.error });
    }

    try {
        const userId = req.user.id;
        const { title, message, type: finalType } = payload.value;

        // Check if notification is enabled for this type
        const user = await query.get('SELECT notification_settings FROM users WHERE id = ?', [userId]);
        const settings = user.notification_settings 
            ? JSON.parse(user.notification_settings) 
            : { events: true, tasks: true, game: true, email: true };

        let isEnabled = true;
        if (finalType === 'event' && !settings.events) isEnabled = false;
        if (finalType === 'task' && !settings.tasks) isEnabled = false;
        if (finalType === 'game' && !settings.game) isEnabled = false;
        if (finalType === 'email' && !settings.email) isEnabled = false;

        if (!isEnabled) {
            return res.json({
                success: false,
                message: `テスト通知の送信を見送りました（該当の通知カテゴリ [${finalType}] がOFFに設定されています）`
            });
        }

        const now = new Date().toISOString();

        // 1. Save to notification logs history
        await query.run(
            `INSERT INTO notification_history (user_id, title, message, sent_at, type)
             VALUES (?, ?, ?, ?, ?)`,
            [userId, title, message, now, finalType]
        );

        // 2. Simulate push notification log to console
        console.log(`\n--- [PUSH NOTIFICATION SIMULATED] ---`);
        console.log(`To User ID: ${userId}`);
        console.log(`Title: ${title}`);
        console.log(`Message: ${message}`);
        console.log(`Type: ${finalType}`);
        console.log(`Sent At: ${now}`);
        console.log(`------------------------------------\n`);

        res.json({
            success: true,
            message: 'テスト通知を送信しました。履歴に保存され、コンソールにプッシュログが出力されました。'
        });
    } catch (err) {
        console.error('Trigger test notification error:', err);
        res.status(500).json({ error: 'サーバーエラーが発生しました' });
    }
});

// DELETE /api/notifications/history - Clear all notification history for current user
router.delete('/history', authenticateToken, async (req, res) => {
    try {
        await query.run('DELETE FROM notification_history WHERE user_id = ?', [req.user.id]);
        res.json({ message: '通知履歴をすべて削除しました' });
    } catch (err) {
        console.error('Delete notification history error:', err);
        res.status(500).json({ error: 'サーバーエラーが発生しました' });
    }
});

// POST /api/notifications/history - Log a custom notification history entry
router.post('/history', authenticateToken, async (req, res) => {
    const payload = validateNotificationPayload(req.body);
    if (payload.error) {
        return res.status(400).json({ error: payload.error });
    }

    try {
        const userId = req.user.id;
        const now = new Date().toISOString();
        const { title, message, type } = payload.value;
        await query.run(
            `INSERT INTO notification_history (user_id, title, message, sent_at, type)
             VALUES (?, ?, ?, ?, ?)`,
            [userId, title, message, now, type]
        );
        res.json({ success: true, message: '通知履歴を保存しました' });
    } catch (err) {
        console.error('Add notification history log error:', err);
        res.status(500).json({ error: 'サーバーエラーが発生しました' });
    }
});

module.exports = router;
