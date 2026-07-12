const express = require('express');
const router = express.Router();
const { query } = require('../db');
const authenticateToken = require('../middleware/auth');
const { normalizeText, validateTextLength } = require('../utils/validation');
const { getVapidPublicKey, sendWebPushToUser } = require('../utils/push');

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

// GET /api/notifications/vapid-public-key - Public key used by browser PushManager
router.get('/vapid-public-key', authenticateToken, (req, res) => {
    res.json({ publicKey: getVapidPublicKey() || '' });
});

// POST /api/notifications/subscribe - Save push subscription JSON
router.post('/subscribe', authenticateToken, async (req, res) => {
    const { subscription } = req.body;

    if (!subscription) {
        return res.status(400).json({ error: 'サブスクリプション情報が必要です' });
    }

    try {
        const userId = req.user.id;
        const parsedSubscription = typeof subscription === 'string' ? JSON.parse(subscription) : subscription;

        if (!parsedSubscription.endpoint || !parsedSubscription.keys) {
            return res.status(400).json({ error: 'Invalid push subscription' });
        }

        const subJson = JSON.stringify(parsedSubscription);

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

// PATCH /api/notifications/history/:id/read - Mark one history item as read
router.patch('/history/:id/read', authenticateToken, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: '通知履歴IDが正しくありません' });
    }

    try {
        const result = await query.run(
            "UPDATE notification_history SET status = 'read' WHERE id = ? AND user_id = ?",
            [id, req.user.id]
        );

        if (!result.changes) {
            return res.status(404).json({ error: '通知履歴が見つかりません' });
        }

        res.json({ success: true, message: '既読にしました' });
    } catch (err) {
        console.error('Mark notification history read error:', err);
        res.status(500).json({ error: 'サーバーエラーが発生しました' });
    }
});

// GET /api/notifications/active-ad - Latest active admin ad ticker
router.get('/active-ad', authenticateToken, async (req, res) => {
    try {
        const now = new Date().toISOString();
        const ad = await query.get(
            `SELECT id, text, url, image_url, expires_at, created_at
             FROM admin_ads
             WHERE expires_at IS NULL OR expires_at > ?
             ORDER BY id DESC
             LIMIT 1`,
            [now]
        );
        res.json({ ad: ad || null });
    } catch (err) {
        console.error('Get active admin ad error:', err);
        res.status(500).json({ error: '広告の取得に失敗しました' });
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

        // 2. Send Web Push to registered browsers.
        const pushResult = await sendWebPushToUser(userId, {
            title,
            message,
            type: finalType,
            tag: `manual-test-${userId}`,
            url: '/calendar.html'
        });

        res.json({
            success: true,
            message: 'テスト通知を送信しました。履歴に保存され、登録済みブラウザへPush送信しました。',
            push: pushResult
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
