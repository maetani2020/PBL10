const express = require('express');
const router = express.Router();
const { query } = require('../db');
const authenticateToken = require('../middleware/auth');

// Helper to check if a user has write access to a calendar
async function hasWriteAccess(calendarId, userId) {
    const calendar = await query.get('SELECT owner_id FROM calendars WHERE id = ?', [calendarId]);
    if (!calendar) return false;
    if (calendar.owner_id === userId) return true;

    const share = await query.get(
        'SELECT access_level FROM calendar_shares WHERE calendar_id = ? AND user_id = ?',
        [calendarId, userId]
    );
    return share && share.access_level === 'readwrite';
}

// GET /api/events - Get all events user is authorized to view
router.get('/', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;

        // Retrieve events for calendars owned by the user or shared with the user
        const events = await query.all(
            `SELECT e.*, c.name as calendar_name, 
                    (CASE WHEN c.owner_id = ? THEN 'owner' ELSE cs.access_level END) as user_access
             FROM events e
             JOIN calendars c ON e.calendar_id = c.id
             LEFT JOIN calendar_shares cs ON c.id = cs.calendar_id AND cs.user_id = ?
             WHERE c.owner_id = ? OR cs.user_id = ?`,
            [userId, userId, userId, userId]
        );

        // Normalize format for frontend (convert allday integer to boolean)
        const formattedEvents = events.map(e => ({
            id: e.id,
            calendar_id: e.calendar_id,
            calendar_name: e.calendar_name,
            title: e.title,
            location: e.location,
            allday: e.allday === 1,
            start: e.start_time,
            end: e.end_time,
            color: e.color,
            memo: e.memo,
            user_access: e.user_access
        }));

        res.json(formattedEvents);
    } catch (err) {
        console.error('Get events error:', err);
        res.status(500).json({ error: 'サーバーエラーが発生しました' });
    }
});

// POST /api/events - Create a new event
router.post('/', authenticateToken, async (req, res) => {
    const { id, calendar_id, title, location, allday, start, end, color, memo } = req.body;

    if (!title || !start || !end) {
        return res.status(400).json({ error: 'タイトル、開始時刻、終了時刻は必須です' });
    }

    try {
        const userId = req.user.id;
        let targetCalendarId = calendar_id;

        // If no calendar_id is specified, use the user's default (oldest owned) calendar
        if (!targetCalendarId) {
            const defaultCalendar = await query.get(
                'SELECT id FROM calendars WHERE owner_id = ? ORDER BY id ASC LIMIT 1',
                [userId]
            );
            if (!defaultCalendar) {
                return res.status(400).json({ error: 'デフォルトのカレンダーが見つかりません' });
            }
            targetCalendarId = defaultCalendar.id;
        }

        // Check write permission
        const isAuthorized = await hasWriteAccess(targetCalendarId, userId);
        if (!isAuthorized) {
            return res.status(403).json({ error: 'このカレンダーにイベントを追加する権限がありません' });
        }

        const eventId = id || 'event_' + Date.now();
        const alldayVal = allday ? 1 : 0;

        await query.run(
            `INSERT INTO events (id, calendar_id, title, location, allday, start_time, end_time, color, memo)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [eventId, targetCalendarId, title, location || '', alldayVal, start, end, color || '#007AFF', memo || '']
        );

        res.status(201).json({
            message: '予定を追加しました',
            event: { id: eventId, calendar_id: targetCalendarId, title, location, allday: !!allday, start, end, color, memo }
        });
    } catch (err) {
        console.error('Create event error:', err);
        res.status(500).json({ error: 'サーバーエラーが発生しました' });
    }
});

// PUT /api/events/:id - Update an existing event
router.put('/:id', authenticateToken, async (req, res) => {
    const eventId = req.params.id;
    const { calendar_id, title, location, allday, start, end, color, memo } = req.body;

    if (!title || !start || !end) {
        return res.status(400).json({ error: 'タイトル、開始時刻、終了時刻は必須です' });
    }

    try {
        const userId = req.user.id;

        // Find existing event
        const existingEvent = await query.get('SELECT * FROM events WHERE id = ?', [eventId]);
        if (!existingEvent) {
            return res.status(404).json({ error: 'イベントが見つかりません' });
        }

        // Check write permission for original calendar
        const isAuthorizedOriginal = await hasWriteAccess(existingEvent.calendar_id, userId);
        if (!isAuthorizedOriginal) {
            return res.status(403).json({ error: 'このイベントを編集する権限がありません' });
        }

        // Check write permission for new calendar (if calendar_id is changing)
        let targetCalendarId = existingEvent.calendar_id;
        if (calendar_id && calendar_id !== existingEvent.calendar_id) {
            const isAuthorizedNew = await hasWriteAccess(calendar_id, userId);
            if (!isAuthorizedNew) {
                return res.status(403).json({ error: '移動先カレンダーへの編集権限がありません' });
            }
            targetCalendarId = calendar_id;
        }

        const alldayVal = allday ? 1 : 0;

        await query.run(
            `UPDATE events 
             SET calendar_id = ?, title = ?, location = ?, allday = ?, start_time = ?, end_time = ?, color = ?, memo = ?
             WHERE id = ?`,
            [targetCalendarId, title, location || '', alldayVal, start, end, color || '#007AFF', memo || '', eventId]
        );

        res.json({
            message: '予定を更新しました',
            event: { id: eventId, calendar_id: targetCalendarId, title, location, allday: !!allday, start, end, color, memo }
        });
    } catch (err) {
        console.error('Update event error:', err);
        res.status(500).json({ error: 'サーバーエラーが発生しました' });
    }
});

// DELETE /api/events/:id - Delete an event
router.delete('/:id', authenticateToken, async (req, res) => {
    const eventId = req.params.id;

    try {
        const userId = req.user.id;

        // Find existing event
        const existingEvent = await query.get('SELECT * FROM events WHERE id = ?', [eventId]);
        if (!existingEvent) {
            return res.status(404).json({ error: 'イベントが見つかりません' });
        }

        // Check write permission
        const isAuthorized = await hasWriteAccess(existingEvent.calendar_id, userId);
        if (!isAuthorized) {
            return res.status(403).json({ error: 'このイベントを削除する権限がありません' });
        }

        await query.run('DELETE FROM events WHERE id = ?', [eventId]);
        res.json({ message: '予定を削除しました' });
    } catch (err) {
        console.error('Delete event error:', err);
        res.status(500).json({ error: 'サーバーエラーが発生しました' });
    }
});

module.exports = router;
