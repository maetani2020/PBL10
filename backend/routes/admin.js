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

module.exports = router;
