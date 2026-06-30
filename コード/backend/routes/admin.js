const express = require('express');
const router = express.Router();
const os = require('os');
const { query } = require('../db');
const { authenticateToken, isAdmin } = require('../middleware/auth');
const { sendToUsers } = require('../utils/websocket');

let previousCpuSnapshot = getCpuSnapshot();

function bytesToMb(bytes) {
    return Math.round(bytes / (1024 * 1024)) + ' MB';
}

function toPercent(value) {
    const normalized = Math.max(0, Math.min(100, Number(value) || 0));
    return normalized.toFixed(1) + '%';
}

function getCpuSnapshot() {
    return os.cpus().reduce((snapshot, cpu) => {
        const times = cpu.times;
        const total = Object.values(times).reduce((sum, time) => sum + time, 0);
        snapshot.idle += times.idle;
        snapshot.total += total;
        return snapshot;
    }, { idle: 0, total: 0 });
}

function getCpuUsagePercent() {
    const currentSnapshot = getCpuSnapshot();
    const idleDiff = currentSnapshot.idle - previousCpuSnapshot.idle;
    const totalDiff = currentSnapshot.total - previousCpuSnapshot.total;
    previousCpuSnapshot = currentSnapshot;

    if (totalDiff <= 0) return 0;
    return (1 - idleDiff / totalDiff) * 100;
}

function getClientIp(req) {
    const clientIp = req.ip || req.connection.remoteAddress || '';
    return clientIp.startsWith('::ffff:') ? clientIp.substring(7) : clientIp;
}

async function logAdminAction(req, action, targetType = null, targetId = null, details = {}) {
    try {
        await query.run(
            `INSERT INTO admin_logs (admin_user_id, action, target_type, target_id, details, ip_address)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [
                req.user?.id || null,
                action,
                targetType,
                targetId == null ? null : String(targetId),
                JSON.stringify(details || {}),
                getClientIp(req)
            ]
        );
    } catch (err) {
        console.error('Admin log write error:', err);
    }
}

async function getCalendarAccessors(calendarId) {
    const calendar = await query.get('SELECT owner_id, group_id FROM calendars WHERE id = ?', [calendarId]);
    if (!calendar) return [];

    const userIds = new Set();
    if (calendar.owner_id) userIds.add(calendar.owner_id);

    const shares = await query.all('SELECT user_id FROM calendar_shares WHERE calendar_id = ?', [calendarId]);
    shares.forEach(share => userIds.add(share.user_id));

    if (calendar.group_id) {
        const members = await query.all('SELECT user_id FROM group_members WHERE group_id = ?', [calendar.group_id]);
        members.forEach(member => userIds.add(member.user_id));
    }

    return Array.from(userIds);
}

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
            `SELECT u.id, u.email, u.display_name, u.role, u.created_at, u.last_activity_at,
                    COUNT(DISTINCT e.id) AS event_count,
                    COUNT(DISTINCT gm.group_id) AS group_count,
                    COUNT(DISTINCT nh.id) AS notification_count
             FROM users u
             LEFT JOIN events e ON e.creator_id = u.id AND e.deleted_at IS NULL
             LEFT JOIN group_members gm ON gm.user_id = u.id
             LEFT JOIN notification_history nh ON nh.user_id = u.id
             GROUP BY u.id, u.email, u.display_name, u.role, u.created_at, u.last_activity_at
             ORDER BY u.id ASC`
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

        const user = await query.get('SELECT id, email, display_name, role FROM users WHERE id = ?', [userId]);
        if (!user) {
            return res.status(404).json({ error: 'ユーザーが見つかりません' });
        }

        await query.run('UPDATE users SET role = ? WHERE id = ?', [role, userId]);
        await logAdminAction(req, 'user:role:update', 'user', userId, {
            email: user.email,
            displayName: user.display_name,
            beforeRole: user.role,
            afterRole: role
        });
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

        const user = await query.get('SELECT id, email, display_name, role FROM users WHERE id = ?', [userId]);
        if (!user) {
            return res.status(404).json({ error: 'ユーザーが見つかりません' });
        }

        await query.run('DELETE FROM users WHERE id = ?', [userId]);
        await logAdminAction(req, 'user:delete', 'user', userId, {
            email: user.email,
            displayName: user.display_name,
            role: user.role
        });
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

        await logAdminAction(req, 'announcement:send', 'announcement', null, {
            title: title.trim(),
            userCount: users.length
        });
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
        const today = new Date();
        const todayPrefix = [
            today.getFullYear(),
            String(today.getMonth() + 1).padStart(2, '0'),
            String(today.getDate()).padStart(2, '0')
        ].join('-');

        const userCount = await query.get('SELECT COUNT(*) as count FROM users');
        const adminCount = await query.get("SELECT COUNT(*) as count FROM users WHERE role = 'admin'");
        const eventCount = await query.get('SELECT COUNT(*) as count FROM events WHERE deleted_at IS NULL');
        const deletedEventCount = await query.get('SELECT COUNT(*) as count FROM events WHERE deleted_at IS NOT NULL');
        const todayEventCount = await query.get(
            'SELECT COUNT(*) as count FROM events WHERE deleted_at IS NULL AND start_time LIKE ?',
            [`${todayPrefix}%`]
        );
        const groupCount = await query.get('SELECT COUNT(*) as count FROM groups');
        const pendingInvitationCount = await query.get("SELECT COUNT(*) as count FROM group_invitations WHERE status = 'pending'");
        const taskCount = await query.get('SELECT COUNT(*) as count FROM tasks');
        const notificationCount = await query.get('SELECT COUNT(*) as count FROM notification_history');
        const adminLogCount = await query.get('SELECT COUNT(*) as count FROM admin_logs');

        // 2. Fetch System/Runtime Info
        const memoryUsage = process.memoryUsage();
        const totalMemory = os.totalmem();
        const freeMemory = os.freemem();
        const usedMemory = totalMemory - freeMemory;
        const memoryUsagePercent = totalMemory > 0 ? (usedMemory / totalMemory) * 100 : 0;
        const cpuUsagePercent = getCpuUsagePercent();
        const stats = {
            updatedAt: new Date().toISOString(),
            os: {
                platform: os.platform(),
                arch: os.arch(),
                release: os.release(),
                totalmem: bytesToMb(totalMemory),
                freemem: bytesToMb(freeMemory),
                usedmem: bytesToMb(usedMemory),
                memoryUsage: toPercent(memoryUsagePercent),
                memoryUsagePercent: Number(memoryUsagePercent.toFixed(1)),
                cpuUsage: toPercent(cpuUsagePercent),
                cpuUsagePercent: Number(cpuUsagePercent.toFixed(1)),
                loadavg: os.loadavg().map(value => Number(value.toFixed(2))),
                cpus: os.cpus().length
            },
            process: {
                uptime: Math.round(process.uptime()) + ' 秒',
                uptimeSeconds: Math.round(process.uptime()),
                memory: {
                    rss: bytesToMb(memoryUsage.rss),
                    heapTotal: bytesToMb(memoryUsage.heapTotal),
                    heapUsed: bytesToMb(memoryUsage.heapUsed),
                    external: bytesToMb(memoryUsage.external),
                    heapUsage: toPercent(memoryUsage.heapTotal > 0 ? (memoryUsage.heapUsed / memoryUsage.heapTotal) * 100 : 0)
                }
            },
            database: {
                users: userCount.count,
                admins: adminCount.count,
                events: eventCount.count,
                deletedEvents: deletedEventCount.count,
                todayEvents: todayEventCount.count,
                groups: groupCount.count,
                pendingInvitations: pendingInvitationCount.count,
                tasks: taskCount.count,
                notificationHistory: notificationCount.count,
                adminLogs: adminLogCount.count
            }
        };

        res.json(stats);
    } catch (err) {
        console.error('Admin get system stats error:', err);
        res.status(500).json({ error: 'サーバーエラーが発生しました' });
    }
});

// GET /api/admin/backup - Export safe application data as JSON
router.get('/backup', async (req, res) => {
    try {
        const backup = {
            generatedAt: new Date().toISOString(),
            generatedBy: {
                id: req.user.id,
                email: req.user.email,
                displayName: req.user.display_name
            },
            format: 'pbl-calendar-backup-v1',
            note: 'Password hashes, refresh tokens, reset tokens, blacklisted tokens, and push subscription secrets are not included.',
            tables: {
                users: await query.all(
                    `SELECT id, email, display_name, max_hp, max_motivation, recovery_rate,
                            warning_threshold, role, notification_settings, last_activity_at, created_at
                     FROM users
                     ORDER BY id ASC`
                ),
                groups: await query.all('SELECT * FROM groups ORDER BY id ASC'),
                groupMembers: await query.all('SELECT * FROM group_members ORDER BY id ASC'),
                groupInvitations: await query.all('SELECT * FROM group_invitations ORDER BY id ASC'),
                calendars: await query.all('SELECT * FROM calendars ORDER BY id ASC'),
                calendarShares: await query.all('SELECT * FROM calendar_shares ORDER BY id ASC'),
                events: await query.all('SELECT * FROM events ORDER BY created_at ASC'),
                tasks: await query.all('SELECT * FROM tasks ORDER BY id ASC'),
                householdAccounts: await query.all('SELECT * FROM household_accounts ORDER BY id ASC'),
                notifications: await query.all('SELECT * FROM notifications ORDER BY id ASC'),
                notificationHistory: await query.all('SELECT * FROM notification_history ORDER BY id ASC'),
                adminLogs: await query.all('SELECT * FROM admin_logs ORDER BY id ASC')
            }
        };

        await logAdminAction(req, 'backup:create', 'system', 'backup', {
            tableCount: Object.keys(backup.tables).length,
            userCount: backup.tables.users.length,
            eventCount: backup.tables.events.length,
            groupCount: backup.tables.groups.length
        });

        res.setHeader('Content-Disposition', `attachment; filename="pbl-calendar-backup-${Date.now()}.json"`);
        res.json(backup);
    } catch (err) {
        console.error('Admin backup error:', err);
        res.status(500).json({ error: 'バックアップの作成に失敗しました' });
    }
});

// GET /api/admin/logs - List admin operation logs
router.get('/logs', async (req, res) => {
    try {
        const requestedLimit = Number(req.query.limit || 100);
        const limit = Math.max(1, Math.min(300, Number.isFinite(requestedLimit) ? requestedLimit : 100));
        const logs = await query.all(
            `SELECT al.id, al.admin_user_id, al.action, al.target_type, al.target_id,
                    al.details, al.ip_address, al.created_at,
                    u.email AS admin_email, u.display_name AS admin_name
             FROM admin_logs al
             LEFT JOIN users u ON al.admin_user_id = u.id
             ORDER BY al.created_at DESC, al.id DESC
             LIMIT ?`,
            [limit]
        );

        res.json(logs.map(log => ({
            ...log,
            details: log.details ? JSON.parse(log.details) : {}
        })));
    } catch (err) {
        console.error('Admin get logs error:', err);
        res.status(500).json({ error: '管理者操作ログの取得に失敗しました' });
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
                    COUNT(DISTINCT CASE WHEN e.deleted_at IS NULL THEN e.id END) AS event_count,
                    COUNT(DISTINCT CASE WHEN gi.status = 'pending' THEN gi.id END) AS pending_invitation_count
             FROM groups g
             LEFT JOIN users u ON g.owner_id = u.id
             LEFT JOIN group_members gm ON g.id = gm.group_id
             LEFT JOIN group_invitations gi ON g.id = gi.group_id
             LEFT JOIN calendars c ON c.group_id = g.id
             LEFT JOIN events e ON e.calendar_id = c.id
             GROUP BY g.id, g.name, g.owner_id, g.created_at, u.display_name, u.email
             ORDER BY g.created_at DESC`
        );
        res.json(groups);
    } catch (err) {
        console.error('Admin get groups error:', err);
        res.status(500).json({ error: 'グループ一覧の取得に失敗しました' });
    }
});

// GET /api/admin/groups/:id/invitations - List invitation statuses of any group
router.get('/groups/:id/invitations', async (req, res) => {
    try {
        const invitations = await query.all(
            `SELECT gi.id, gi.group_id, gi.invited_user_id, gi.invited_by, gi.role,
                    gi.status, gi.created_at, gi.responded_at,
                    invited.display_name AS invited_name,
                    invited.email AS invited_email,
                    inviter.display_name AS inviter_name,
                    inviter.email AS inviter_email
             FROM group_invitations gi
             JOIN users invited ON gi.invited_user_id = invited.id
             LEFT JOIN users inviter ON gi.invited_by = inviter.id
             WHERE gi.group_id = ?
             ORDER BY
                CASE gi.status WHEN 'pending' THEN 0 WHEN 'declined' THEN 1 ELSE 2 END,
                gi.created_at DESC`,
            [req.params.id]
        );
        res.json(invitations);
    } catch (err) {
        console.error('Admin get group invitations error:', err);
        res.status(500).json({ error: 'グループ招待状態の取得に失敗しました' });
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
        const group = await query.get('SELECT id, name, owner_id FROM groups WHERE id = ?', [req.params.groupId]);
        if (!group) return res.status(404).json({ error: 'グループが見つかりません' });

        if (parseInt(req.params.userId) === group.owner_id && role !== 'admin') {
            return res.status(400).json({ error: 'グループオーナーは管理者から変更できません' });
        }

        const member = await query.get(
            `SELECT gm.role, u.email, u.display_name
             FROM group_members gm
             JOIN users u ON gm.user_id = u.id
             WHERE gm.group_id = ? AND gm.user_id = ?`,
            [req.params.groupId, req.params.userId]
        );

        await query.run(
            'UPDATE group_members SET role = ? WHERE group_id = ? AND user_id = ?',
            [role, req.params.groupId, req.params.userId]
        );
        await logAdminAction(req, 'group_member:role:update', 'group_member', `${req.params.groupId}:${req.params.userId}`, {
            groupId: req.params.groupId,
            groupName: group.name,
            userId: req.params.userId,
            userEmail: member?.email,
            userName: member?.display_name,
            beforeRole: member?.role,
            afterRole: role
        });
        res.json({ message: 'グループ権限を更新しました' });
    } catch (err) {
        console.error('Admin update group role error:', err);
        res.status(500).json({ error: 'グループ権限の更新に失敗しました' });
    }
});

// DELETE /api/admin/groups/:groupId/members/:userId - Remove member from any group
router.delete('/groups/:groupId/members/:userId', async (req, res) => {
    try {
        const group = await query.get('SELECT id, name, owner_id FROM groups WHERE id = ?', [req.params.groupId]);
        if (!group) return res.status(404).json({ error: 'グループが見つかりません' });

        if (parseInt(req.params.userId) === group.owner_id) {
            return res.status(400).json({ error: 'グループオーナーは削除できません。先にグループを削除してください' });
        }

        const member = await query.get(
            `SELECT gm.role, u.email, u.display_name
             FROM group_members gm
             JOIN users u ON gm.user_id = u.id
             WHERE gm.group_id = ? AND gm.user_id = ?`,
            [req.params.groupId, req.params.userId]
        );

        await query.run(
            'DELETE FROM group_members WHERE group_id = ? AND user_id = ?',
            [req.params.groupId, req.params.userId]
        );
        await logAdminAction(req, 'group_member:remove', 'group_member', `${req.params.groupId}:${req.params.userId}`, {
            groupId: req.params.groupId,
            groupName: group.name,
            userId: req.params.userId,
            userEmail: member?.email,
            userName: member?.display_name,
            role: member?.role
        });
        res.json({ message: 'メンバーを削除しました' });
    } catch (err) {
        console.error('Admin remove group member error:', err);
        res.status(500).json({ error: 'メンバー削除に失敗しました' });
    }
});

// DELETE /api/admin/groups/:id - Delete any group
router.delete('/groups/:id', async (req, res) => {
    try {
        const group = await query.get('SELECT id, name, owner_id FROM groups WHERE id = ?', [req.params.id]);
        if (!group) return res.status(404).json({ error: 'グループが見つかりません' });

        await query.run('DELETE FROM groups WHERE id = ?', [req.params.id]);
        await logAdminAction(req, 'group:delete', 'group', req.params.id, {
            groupName: group.name,
            ownerId: group.owner_id
        });
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
                    e.color, e.memo, e.hp_consumption, e.motivation_consumption,
                    e.mail_reminder_enabled, e.mail_remind_at, e.mail_sent,
                    e.deleted_at, e.deleted_by,
                    e.creator_id, creator.display_name AS creator_name, creator.email AS creator_email,
                    deleter.display_name AS deleted_by_name, deleter.email AS deleted_by_email,
                    c.id AS calendar_id, c.name AS calendar_name,
                    g.id AS group_id, g.name AS group_name
             FROM events e
             JOIN calendars c ON e.calendar_id = c.id
             LEFT JOIN groups g ON c.group_id = g.id
             LEFT JOIN users creator ON e.creator_id = creator.id
             LEFT JOIN users deleter ON e.deleted_by = deleter.id
             ORDER BY e.start_time DESC
             LIMIT 800`
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
        const event = await query.get('SELECT id, title, start_time, creator_id, calendar_id, deleted_at FROM events WHERE id = ?', [req.params.id]);
        if (!event) return res.status(404).json({ error: 'イベントが見つかりません' });

        if (event.deleted_at) {
            return res.status(400).json({ error: 'このイベントは既に削除済みです' });
        }

        await query.run(
            'UPDATE events SET deleted_at = CURRENT_TIMESTAMP, deleted_by = ? WHERE id = ?',
            [req.user.id, req.params.id]
        );
        await logAdminAction(req, 'event:delete', 'event', req.params.id, {
            title: event.title,
            startTime: event.start_time,
            creatorId: event.creator_id
        });

        const accessors = await getCalendarAccessors(event.calendar_id);
        sendToUsers(accessors, {
            type: 'event_sync',
            calendarId: event.calendar_id,
            action: 'delete',
            eventId: req.params.id
        });

        res.json({ message: 'イベントを削除しました' });
    } catch (err) {
        console.error('Admin delete event error:', err);
        res.status(500).json({ error: 'イベント削除に失敗しました' });
    }
});

// POST /api/admin/events/:id/restore - Restore a soft-deleted event
router.post('/events/:id/restore', async (req, res) => {
    try {
        const event = await query.get('SELECT id, title, start_time, creator_id, calendar_id, deleted_at FROM events WHERE id = ?', [req.params.id]);
        if (!event) return res.status(404).json({ error: 'イベントが見つかりません' });

        if (!event.deleted_at) {
            return res.status(400).json({ error: 'このイベントは削除されていません' });
        }

        await query.run(
            'UPDATE events SET deleted_at = NULL, deleted_by = NULL WHERE id = ?',
            [req.params.id]
        );
        await logAdminAction(req, 'event:restore', 'event', req.params.id, {
            title: event.title,
            startTime: event.start_time,
            creatorId: event.creator_id
        });

        const accessors = await getCalendarAccessors(event.calendar_id);
        sendToUsers(accessors, {
            type: 'event_sync',
            calendarId: event.calendar_id,
            action: 'restore',
            eventId: req.params.id
        });

        res.json({ message: 'イベントを復元しました' });
    } catch (err) {
        console.error('Admin restore event error:', err);
        res.status(500).json({ error: 'イベント復元に失敗しました' });
    }
});

// DELETE /api/admin/users/:id/settings - Reset user settings
router.delete('/users/:id/settings', async (req, res) => {
    try {
        const user = await query.get('SELECT id, email, display_name FROM users WHERE id = ?', [req.params.id]);
        if (!user) return res.status(404).json({ error: 'ユーザーが見つかりません' });

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
        await logAdminAction(req, 'user_settings:reset', 'user', req.params.id, {
            email: user.email,
            displayName: user.display_name
        });
        res.json({ message: 'ユーザー設定を初期化しました' });
    } catch (err) {
        console.error('Admin reset user settings error:', err);
        res.status(500).json({ error: 'ユーザー設定の初期化に失敗しました' });
    }
});

// DELETE /api/admin/users/:id/notification-history - Delete user notification history
router.delete('/users/:id/notification-history', async (req, res) => {
    try {
        const user = await query.get('SELECT id, email, display_name FROM users WHERE id = ?', [req.params.id]);
        if (!user) return res.status(404).json({ error: 'ユーザーが見つかりません' });

        const historyCount = await query.get('SELECT COUNT(*) as count FROM notification_history WHERE user_id = ?', [req.params.id]);
        await query.run('DELETE FROM notification_history WHERE user_id = ?', [req.params.id]);
        await logAdminAction(req, 'notification_history:delete', 'user', req.params.id, {
            email: user.email,
            displayName: user.display_name,
            deletedCount: historyCount?.count || 0
        });
        res.json({ message: '通知履歴を削除しました' });
    } catch (err) {
        console.error('Admin delete notification history error:', err);
        res.status(500).json({ error: '通知履歴の削除に失敗しました' });
    }
});

module.exports = router;
