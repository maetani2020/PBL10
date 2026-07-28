const express = require('express');
const router = express.Router();
const { query } = require('../db');
const authenticateToken = require('../middleware/auth');
const {
    normalizeEmail,
    validateEmail,
    isAllowedSchoolEmail,
    normalizeText,
    validateTextLength
} = require('../utils/validation');

// GET /api/calendars - Get all calendars user has access to (owned & shared)
router.get('/', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;

        // Get owned calendars
        const ownedCalendars = await query.all(
            `SELECT id, name, owner_id, 'owner' as access_level, 0 as is_shared, NULL as owner_name, NULL as group_id 
             FROM calendars 
             WHERE owner_id = ?`,
            [userId]
        );

        // Get shared calendars
        const sharedCalendars = await query.all(
            `SELECT c.id, c.name, c.owner_id, cs.access_level, 1 as is_shared, u.display_name as owner_name, NULL as group_id
             FROM calendars c
             JOIN calendar_shares cs ON c.id = cs.calendar_id
             JOIN users u ON c.owner_id = u.id
             WHERE cs.user_id = ?`,
            [userId]
        );

        // Get group calendars
        const groupCalendars = await query.all(
            `SELECT c.id, c.name, c.owner_id, gm.role as access_level, 1 as is_shared, NULL as owner_name, c.group_id
             FROM calendars c
             JOIN group_members gm ON c.group_id = gm.group_id
             WHERE gm.user_id = ?`,
            [userId]
        );

        // Combine lists
        const allCalendars = [...ownedCalendars, ...sharedCalendars, ...groupCalendars];
        res.json(allCalendars);
    } catch (err) {
        console.error('Get calendars error:', err);
        res.status(500).json({ error: 'サーバーエラーが発生しました' });
    }
});

// POST /api/calendars - Create a new calendar
router.post('/', authenticateToken, async (req, res) => {
    const { name } = req.body;
    const calendarName = normalizeText(name);
    if (!validateTextLength(calendarName, 50)) {
        return res.status(400).json({ error: 'カレンダー名は1文字以上50文字以内で入力してください' });
    }

    try {
        const result = await query.run(
            'INSERT INTO calendars (name, owner_id) VALUES (?, ?)',
            [calendarName, req.user.id]
        );
        res.status(201).json({
            message: 'カレンダーを作成しました',
            calendar: { id: result.lastID, name: calendarName, owner_id: req.user.id, access_level: 'owner' }
        });
    } catch (err) {
        console.error('Create calendar error:', err);
        res.status(500).json({ error: 'サーバーエラーが発生しました' });
    }
});

// POST /api/calendars/:id/share - Share a calendar with another user by email
router.post('/:id/share', authenticateToken, async (req, res) => {
    const calendarId = req.params.id;
    const { email, access_level } = req.body; // access_level: 'readonly' or 'readwrite'
    const normalizedEmail = normalizeEmail(email);

    if (!normalizedEmail || !access_level) {
        return res.status(400).json({ error: '共有先のメールアドレスと権限を指定してください' });
    }

    if (!validateEmail(normalizedEmail) || !isAllowedSchoolEmail(normalizedEmail)) {
        return res.status(400).json({ error: '共有先メールアドレスは @oic-ok.ac.jp の形式で指定してください' });
    }

    if (!['readonly', 'readwrite'].includes(access_level)) {
        return res.status(400).json({ error: '無効な権限レベルです' });
    }

    try {
        // 1. Check if calendar exists and belongs to the current user (only owner can share)
        const calendar = await query.get('SELECT * FROM calendars WHERE id = ?', [calendarId]);
        if (!calendar) {
            return res.status(404).json({ error: 'カレンダーが見つかりません' });
        }

        if (calendar.owner_id !== req.user.id) {
            return res.status(403).json({ error: '他のユーザーのカレンダーを共有する権限はありません' });
        }

        // 2. Find target user by email
        const targetUser = await query.get('SELECT id, email, display_name FROM users WHERE email = ?', [normalizedEmail]);
        if (!targetUser) {
            return res.status(404).json({ error: '指定されたメールアドレスのユーザーが見つかりません' });
        }

        if (targetUser.id === req.user.id) {
            return res.status(400).json({ error: '自分自身と共有することはできません' });
        }

        // 3. Upsert share setting
        await query.run(
            `INSERT INTO calendar_shares (calendar_id, user_id, access_level) 
             VALUES (?, ?, ?)
             ON CONFLICT(calendar_id, user_id) DO UPDATE SET access_level = excluded.access_level`,
            [calendarId, targetUser.id, access_level]
        );

        res.json({
            message: `カレンダーを ${targetUser.display_name} さんに共有しました`,
            sharedWith: {
                id: targetUser.id,
                email: targetUser.email,
                display_name: targetUser.display_name,
                access_level
            }
        });
    } catch (err) {
        console.error('Share calendar error:', err);
        res.status(500).json({ error: 'サーバーエラーが発生しました' });
    }
});

// DELETE /api/calendars/:id - Delete calendar (only owner)
router.delete('/:id', authenticateToken, async (req, res) => {
    const calendarId = req.params.id;

    try {
        const calendar = await query.get('SELECT * FROM calendars WHERE id = ?', [calendarId]);
        if (!calendar) {
            return res.status(404).json({ error: 'カレンダーが見つかりません' });
        }

        if (calendar.owner_id !== req.user.id) {
            return res.status(403).json({ error: 'このカレンダーを削除する権限がありません' });
        }

        await query.run('DELETE FROM calendars WHERE id = ?', [calendarId]);
        res.json({ message: 'カレンダーを削除しました' });
    } catch (err) {
        console.error('Delete calendar error:', err);
        res.status(500).json({ error: 'サーバーエラーが発生しました' });
    }
});

module.exports = router;
