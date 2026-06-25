const express = require('express');
const router = express.Router();
const os = require('os');
const { query } = require('../db');
const { authenticateToken, isAdmin } = require('../middleware/auth');

// IP Whitelist middleware (Optional, recommended)
function verifyIpWhitelist(req, res, next) {
    const whitelistStr = process.env.ADMIN_IP_WHITELIST;
    if (!whitelistStr) {
        return next(); // Whitelist not configured, skip
    }

    const whitelist = whitelistStr.split(',').map(ip => ip.trim());
    const clientIp = req.ip || req.connection.remoteAddress;

    // Normalize IPv6 mapped IPv4 addresses (e.g., ::ffff:127.0.0.1)
    const normalizedIp = clientIp.startsWith('::ffff:') ? clientIp.substring(7) : clientIp;

    if (!whitelist.includes(normalizedIp) && !whitelist.includes(clientIp)) {
        console.warn(`Blocked admin request from unauthorized IP: ${clientIp}`);
        return res.status(403).json({ error: '許可されていないIPアドレスからのアクセスです' });
    }
    next();
}

// Apply admin access control to all endpoints in this router
router.use(authenticateToken);
router.use(isAdmin);
router.use(verifyIpWhitelist);

// GET /api/admin/users - Get all users
router.get('/users', async (req, res) => {
    try {
        const users = await query.all(
            'SELECT id, email, display_name, role, created_at FROM users ORDER BY id ASC'
        );
        res.json(users);
    } catch (err) {
        console.error('Admin get users error:', err);
        res.status(500).json({ error: 'サーバーエラーが発生しました' });
    }
});

// PUT /api/admin/users/:id/role - Update user role
router.put('/users/:id/role', async (req, res) => {
    const userId = req.params.id;
    const { role } = req.body;

    if (!role || !['admin', 'user'].includes(role)) {
        return res.status(400).json({ error: '無効な役割です。admin または user を指定してください。' });
    }

    try {
        // Prevent self-demotion
        if (parseInt(userId) === req.user.id) {
            return res.status(400).json({ error: '自分自身の管理者権限を変更することはできません' });
        }

        const user = await query.get('SELECT id FROM users WHERE id = ?', [userId]);
        if (!user) {
            return res.status(404).json({ error: 'ユーザーが見つかりません' });
        }

        await query.run('UPDATE users SET role = ? WHERE id = ?', [role, userId]);
        res.json({ message: 'ユーザー権限を更新しました' });
    } catch (err) {
        console.error('Admin update role error:', err);
        res.status(500).json({ error: 'サーバーエラーが発生しました' });
    }
});

// DELETE /api/admin/users/:id - Delete a user account
router.delete('/users/:id', async (req, res) => {
    const userId = req.params.id;

    try {
        // Prevent deleting oneself
        if (parseInt(userId) === req.user.id) {
            return res.status(400).json({ error: '自分自身のアカウントを削除することはできません' });
        }

        const user = await query.get('SELECT id FROM users WHERE id = ?', [userId]);
        if (!user) {
            return res.status(404).json({ error: 'ユーザーが見つかりません' });
        }

        await query.run('DELETE FROM users WHERE id = ?', [userId]);
        res.json({ message: 'ユーザーアカウントを削除しました' });
    } catch (err) {
        console.error('Admin delete user error:', err);
        res.status(500).json({ error: 'サーバーエラーが発生しました' });
    }
});

// POST /api/admin/announcements - Broadcast system announcement to all users
router.post('/announcements', async (req, res) => {
    const { title, message } = req.body;

    if (!title || !message) {
        return res.status(400).json({ error: 'タイトルとお知らせ内容は必須項目です' });
    }

    try {
        const users = await query.all('SELECT id FROM users');
        const now = new Date().toISOString();

        for (const user of users) {
            // Log in notification history for each user
            await query.run(
                `INSERT INTO notification_history (user_id, title, message, sent_at, type)
                 VALUES (?, ?, ?, ?, ?)`,
                [user.id, `[お知らせ] ${title.trim()}`, message.trim(), now, 'announcement']
            );
        }

        console.log(`\n--- [SYSTEM ANNOUNCEMENT BROADCAST] ---`);
        console.log(`Title: ${title}`);
        console.log(`Message: ${message}`);
        console.log(`Sent to ${users.length} users.`);
        console.log(`---------------------------------------\n`);

        res.json({ message: `${users.length}名のユーザーにお知らせを配信しました` });
    } catch (err) {
        console.error('Admin broadcast announcement error:', err);
        res.status(500).json({ error: 'サーバーエラーが発生しました' });
    }
});

// GET /api/admin/system-stats - Monitor system resources & database statistics
router.get('/system-stats', async (req, res) => {
    try {
        // 1. Get counts from Database
        const userCount = await query.get('SELECT COUNT(*) as count FROM users');
        const eventCount = await query.get('SELECT COUNT(*) as count FROM events');
        const groupCount = await query.get('SELECT COUNT(*) as count FROM groups');
        const taskCount = await query.get('SELECT COUNT(*) as count FROM tasks');

        // 2. Fetch System/Runtime Info
        const memoryUsage = process.memoryUsage();
        const stats = {
            os: {
                platform: os.platform(),
                arch: os.arch(),
                release: os.release(),
                totalmem: Math.round(os.totalmem() / (1024 * 1024)) + ' MB',
                freemem: Math.round(os.freemem() / (1024 * 1024)) + ' MB',
                loadavg: os.loadavg(),
                cpus: os.cpus().length
            },
            process: {
                uptime: Math.round(process.uptime()) + ' 秒',
                memory: {
                    rss: Math.round(memoryUsage.rss / (1024 * 1024)) + ' MB',
                    heapTotal: Math.round(memoryUsage.heapTotal / (1024 * 1024)) + ' MB',
                    heapUsed: Math.round(memoryUsage.heapUsed / (1024 * 1024)) + ' MB',
                    external: Math.round(memoryUsage.external / (1024 * 1024)) + ' MB'
                }
            },
            database: {
                users: userCount.count,
                events: eventCount.count,
                groups: groupCount.count,
                tasks: taskCount.count
            }
        };

        res.json(stats);
    } catch (err) {
        console.error('Admin get system stats error:', err);
        res.status(500).json({ error: 'サーバーエラーが発生しました' });
    }
});

// GET /api/admin/groups - Manage all groups
router.get('/groups', async (req, res) => {
    try {
        const groups = await query.all(
            `SELECT g.id, g.name, g.owner_id, g.created_at,
                    u.display_name AS owner_name,
                    u.email AS owner_email,
                    COUNT(DISTINCT gm.user_id) AS member_count,
                    COUNT(DISTINCT e.id) AS event_count
             FROM groups g
             LEFT JOIN users u ON g.owner_id = u.id
             LEFT JOIN group_members gm ON g.id = gm.group_id
             LEFT JOIN calendars c ON c.group_id = g.id
             LEFT JOIN events e ON e.calendar_id = c.id
             GROUP BY g.id
             ORDER BY g.created_at DESC`
        );
        res.json(groups);
    } catch (err) {
        console.error('Admin get groups error:', err);
        res.status(500).json({ error: 'グループ一覧の取得に失敗しました' });
    }
});

// GET /api/admin/groups/:id/members - List members of any group
router.get('/groups/:id/members', async (req, res) => {
    try {
        const members = await query.all(
            `SELECT u.id, u.display_name, u.email, gm.role, gm.created_at
             FROM group_members gm
             JOIN users u ON gm.user_id = u.id
             WHERE gm.group_id = ?
             ORDER BY gm.created_at ASC`,
            [req.params.id]
        );
        res.json(members);
    } catch (err) {
        console.error('Admin get group members error:', err);
        res.status(500).json({ error: 'メンバー一覧の取得に失敗しました' });
    }
});

// PUT /api/admin/groups/:groupId/members/:userId/role - Change any group member role
router.put('/groups/:groupId/members/:userId/role', async (req, res) => {
    const { role } = req.body;
    if (!['admin', 'editor', 'viewer'].includes(role)) {
        return res.status(400).json({ error: '無効な権限です' });
    }

    try {
        const group = await query.get('SELECT owner_id FROM groups WHERE id = ?', [req.params.groupId]);
        if (!group) return res.status(404).json({ error: 'グループが見つかりません' });

        if (parseInt(req.params.userId) === group.owner_id && role !== 'admin') {
            return res.status(400).json({ error: 'グループオーナーは管理者から変更できません' });
        }

        await query.run(
            'UPDATE group_members SET role = ? WHERE group_id = ? AND user_id = ?',
            [role, req.params.groupId, req.params.userId]
        );
        res.json({ message: 'グループ権限を更新しました' });
    } catch (err) {
        console.error('Admin update group role error:', err);
        res.status(500).json({ error: 'グループ権限の更新に失敗しました' });
    }
});

// DELETE /api/admin/groups/:groupId/members/:userId - Remove member from any group
router.delete('/groups/:groupId/members/:userId', async (req, res) => {
    try {
        const group = await query.get('SELECT owner_id FROM groups WHERE id = ?', [req.params.groupId]);
        if (!group) return res.status(404).json({ error: 'グループが見つかりません' });

        if (parseInt(req.params.userId) === group.owner_id) {
            return res.status(400).json({ error: 'グループオーナーは削除できません。先にグループを削除してください' });
        }

        await query.run(
            'DELETE FROM group_members WHERE group_id = ? AND user_id = ?',
            [req.params.groupId, req.params.userId]
        );
        res.json({ message: 'メンバーを削除しました' });
    } catch (err) {
        console.error('Admin remove group member error:', err);
        res.status(500).json({ error: 'メンバー削除に失敗しました' });
    }
});

// DELETE /api/admin/groups/:id - Delete any group
router.delete('/groups/:id', async (req, res) => {
    try {
        const group = await query.get('SELECT id FROM groups WHERE id = ?', [req.params.id]);
        if (!group) return res.status(404).json({ error: 'グループが見つかりません' });

        await query.run('DELETE FROM groups WHERE id = ?', [req.params.id]);
        res.json({ message: 'グループを削除しました' });
    } catch (err) {
        console.error('Admin delete group error:', err);
        res.status(500).json({ error: 'グループ削除に失敗しました' });
    }
});

// GET /api/admin/events - List all events
router.get('/events', async (req, res) => {
    try {
        const events = await query.all(
            `SELECT e.id, e.title, e.start_time, e.end_time, e.visibility, e.event_type,
                    e.creator_id, creator.display_name AS creator_name, creator.email AS creator_email,
                    c.id AS calendar_id, c.name AS calendar_name,
                    g.id AS group_id, g.name AS group_name
             FROM events e
             JOIN calendars c ON e.calendar_id = c.id
             LEFT JOIN groups g ON c.group_id = g.id
             LEFT JOIN users creator ON e.creator_id = creator.id
             ORDER BY e.start_time DESC
             LIMIT 500`
        );
        res.json(events);
    } catch (err) {
        console.error('Admin get events error:', err);
        res.status(500).json({ error: 'イベント一覧の取得に失敗しました' });
    }
});

// DELETE /api/admin/events/:id - Delete any event
router.delete('/events/:id', async (req, res) => {
    try {
        const event = await query.get('SELECT id FROM events WHERE id = ?', [req.params.id]);
        if (!event) return res.status(404).json({ error: 'イベントが見つかりません' });

        await query.run('DELETE FROM events WHERE id = ?', [req.params.id]);
        res.json({ message: 'イベントを削除しました' });
    } catch (err) {
        console.error('Admin delete event error:', err);
        res.status(500).json({ error: 'イベント削除に失敗しました' });
    }
});

// DELETE /api/admin/users/:id/settings - Reset user settings
router.delete('/users/:id/settings', async (req, res) => {
    try {
        await query.run(
            `UPDATE users
             SET max_hp = 100,
                 max_motivation = 100,
                 recovery_rate = 1.0,
                 warning_threshold = 20,
                 notification_settings = ?
             WHERE id = ?`,
            ['{"events":true,"tasks":true,"game":true,"email":true}', req.params.id]
        );
        res.json({ message: 'ユーザー設定を初期化しました' });
    } catch (err) {
        console.error('Admin reset user settings error:', err);
        res.status(500).json({ error: 'ユーザー設定の初期化に失敗しました' });
    }
});

// DELETE /api/admin/users/:id/notification-history - Delete user notification history
router.delete('/users/:id/notification-history', async (req, res) => {
    try {
        await query.run('DELETE FROM notification_history WHERE user_id = ?', [req.params.id]);
        res.json({ message: '通知履歴を削除しました' });
    } catch (err) {
        console.error('Admin delete notification history error:', err);
        res.status(500).json({ error: '通知履歴の削除に失敗しました' });
    }
});

module.exports = router;
