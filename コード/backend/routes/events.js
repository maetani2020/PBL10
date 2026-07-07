const express = require('express');
const router = express.Router();
const { query } = require('../db');
const authenticateToken = require('../middleware/auth');
const { sendToUsers } = require('../utils/websocket');
const {
    normalizeEmail,
    validateEmail,
    normalizeText,
    validateTextLength,
    parseIntegerInRange,
    isLocalDate,
    isLocalDateTime,
    validateReminderMinutes
} = require('../utils/validation');

const EVENT_TYPES = ['event', 'task', 'mail'];
const VISIBILITY_TYPES = ['public', 'group', 'private'];

function validateEventPayload(body) {
    const title = normalizeText(body.title);
    const start = normalizeText(body.start);
    const end = normalizeText(body.end);
    const visibility = body.visibility || 'group';
    const eventType = body.eventType || 'event';

    if (!validateTextLength(title, 100)) {
        return { error: 'タイトルは1文字以上100文字以内で指定してください' };
    }
    if (!isLocalDateTime(start) || !isLocalDateTime(end)) {
        return { error: '開始時刻と終了時刻は YYYY-MM-DDTHH:mm 形式で指定してください' };
    }
    if (start > end) {
        return { error: '終了時刻は開始時刻以降にしてください' };
    }
    if (!VISIBILITY_TYPES.includes(visibility)) {
        return { error: '無効な公開範囲設定です' };
    }
    if (!EVENT_TYPES.includes(eventType)) {
        return { error: '無効な予定種別です' };
    }

    const hpVal = parseIntegerInRange(body.hp_consumption, 0, 0, 100);
    const motVal = parseIntegerInRange(body.motivation_consumption, 0, 0, 100);
    if (hpVal === null || motVal === null) {
        return { error: 'HP消費率とやる気消費率は0から100の範囲で指定してください' };
    }

    const location = normalizeText(body.location);
    const memo = normalizeText(body.memo);
    const recurrence = body.recurrence ? normalizeText(body.recurrence) : null;
    const color = normalizeText(body.color) || '#007AFF';
    const mailTo = normalizeEmail(body.mailTo);
    const mailSubject = normalizeText(body.mailSubject);
    const mailRemindAt = normalizeText(body.mailRemindAt);

    if (location && Array.from(location).length > 100) {
        return { error: '場所は100文字以内で指定してください' };
    }
    if (memo && Array.from(memo).length > 1000) {
        return { error: 'メモは1000文字以内で指定してください' };
    }
    if (recurrence && Array.from(recurrence).length > 100) {
        return { error: '繰り返し設定が長すぎます' };
    }
    if (!/^#[0-9A-Fa-f]{6}$/.test(color)) {
        return { error: '色は #007AFF のような形式で指定してください' };
    }
    if (mailTo && (!validateEmail(mailTo) || Array.from(mailTo).length > 254)) {
        return { error: 'メール送信先の形式が正しくありません' };
    }
    if (mailSubject && Array.from(mailSubject).length > 120) {
        return { error: 'メール件名は120文字以内で指定してください' };
    }
    if (mailRemindAt && !isLocalDateTime(mailRemindAt)) {
        return { error: 'メール通知時刻は YYYY-MM-DDTHH:mm 形式で指定してください' };
    }

    return {
        value: {
            title,
            start,
            end,
            visibility,
            eventType,
            hpVal,
            motVal,
            location,
            memo,
            recurrence,
            color,
            reminderMinutes: validateReminderMinutes(body.reminderMinutes),
            notifyAtStart: body.notifyAtStart !== false,
            taskDeadlineNotify: body.taskDeadlineNotify !== false,
            mailReminderEnabled: !!body.mailReminderEnabled,
            mailTo,
            mailSubject,
            mailRemindAt,
            mailSent: !!body.mailSent
        }
    };
}

// Helper to format Date objects as 'YYYY-MM-DDTHH:mm'
function formatLocalDateTime(date) {
    const pad = (num) => String(num).padStart(2, '0');
    const yyyy = date.getFullYear();
    const mm = pad(date.getMonth() + 1);
    const dd = pad(date.getDate());
    const hh = pad(date.getHours());
    const min = pad(date.getMinutes());
    return `${yyyy}-${mm}-${dd}T${hh}:${min}`;
}

// Helper to check user's write access to a calendar
async function verifyWriteAccess(calendarId, userId) {
    const calendar = await query.get('SELECT owner_id, group_id FROM calendars WHERE id = ?', [calendarId]);
    if (!calendar) return { hasAccess: false, error: 'カレンダーが見つかりません' };

    // Owner check
    if (calendar.owner_id && calendar.owner_id === userId) {
        return { hasAccess: true, isOwner: true };
    }

    // Group check
    if (calendar.group_id) {
        const member = await query.get(
            'SELECT role FROM group_members WHERE group_id = ? AND user_id = ?',
            [calendar.group_id, userId]
        );
        if (!member) {
            return { hasAccess: false, error: 'このグループカレンダーへのアクセス権限がありません' };
        }
        if (member.role === 'viewer') {
            return { hasAccess: false, error: '閲覧ユーザーは予定の作成・変更を行えません' };
        }
        return { hasAccess: true, role: member.role };
    }

    // Individual shares check
    const share = await query.get(
        'SELECT access_level FROM calendar_shares WHERE calendar_id = ? AND user_id = ?',
        [calendarId, userId]
    );
    if (share && share.access_level === 'readwrite') {
        return { hasAccess: true, isOwner: false };
    }

    return { hasAccess: false, error: 'このカレンダーに予定を追加/変更する権限がありません' };
}

// Helper to get all user IDs who have access to a calendar
async function getCalendarAccessors(calendarId) {
    const calendar = await query.get('SELECT owner_id, group_id FROM calendars WHERE id = ?', [calendarId]);
    if (!calendar) return [];

    const userIds = new Set();
    if (calendar.owner_id) userIds.add(calendar.owner_id);

    // Shared users
    const shares = await query.all('SELECT user_id FROM calendar_shares WHERE calendar_id = ?', [calendarId]);
    shares.forEach(s => userIds.add(s.user_id));

    // Group members
    if (calendar.group_id) {
        const groupMembers = await query.all('SELECT user_id FROM group_members WHERE group_id = ?', [calendar.group_id]);
        groupMembers.forEach(gm => userIds.add(gm.user_id));
    }

    return Array.from(userIds);
}

// Helper to check user's HP & Motivation capacity for a specific date
async function checkCapacityWarning(userId, dateStr, additionalHp = 0, additionalMot = 0, excludeEventId = null) {
    const user = await query.get('SELECT max_hp, max_motivation FROM users WHERE id = ?', [userId]);
    if (!user) return null;

    const sql = excludeEventId
        ? `SELECT SUM(hp_consumption) as hp, SUM(motivation_consumption) as mot 
           FROM events 
           WHERE creator_id = ? AND start_time LIKE ? AND deleted_at IS NULL AND id != ?`
        : `SELECT SUM(hp_consumption) as hp, SUM(motivation_consumption) as mot 
           FROM events 
           WHERE creator_id = ? AND start_time LIKE ? AND deleted_at IS NULL`;

    const params = excludeEventId
        ? [userId, `${dateStr}%`, excludeEventId]
        : [userId, `${dateStr}%`];

    const current = await query.get(sql, params);
    const totalHp = (current.hp || 0) + additionalHp;
    const totalMot = (current.mot || 0) + additionalMot;

    if (totalHp > user.max_hp || totalMot > user.max_motivation) {
        return {
            hpExceeded: totalHp > user.max_hp,
            motExceeded: totalMot > user.max_motivation,
            totalHp,
            maxHp: user.max_hp,
            totalMot,
            maxMot: user.max_motivation,
            message: `注意: ${dateStr} の予定消費量が上限を超えています（HP: ${totalHp}/${user.max_hp}, やる気: ${totalMot}/${user.max_motivation}）`
        };
    }
    return null;
}

// GET /api/events - Get all events user is authorized to view
router.get('/', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;

        // Fetch events linked to user's owned, shared, or group calendars
        const events = await query.all(
            `SELECT DISTINCT e.*, c.name as calendar_name,
                (CASE 
                    WHEN c.owner_id = ? THEN 'owner' 
                    WHEN gm.role = 'admin' THEN 'owner'
                    WHEN gm.role = 'editor' THEN 'readwrite'
                    WHEN gm.role = 'viewer' THEN 'readonly'
                    WHEN cs.access_level = 'readwrite' THEN 'readwrite'
                    ELSE 'readonly'
                 END) as user_access
             FROM events e
             JOIN calendars c ON e.calendar_id = c.id
             LEFT JOIN calendar_shares cs ON c.id = cs.calendar_id AND cs.user_id = ?
             LEFT JOIN group_members gm ON c.group_id = gm.group_id AND gm.user_id = ?
             WHERE e.deleted_at IS NULL
               AND (c.owner_id = ? OR cs.user_id = ? OR gm.user_id = ?)`,
            [userId, userId, userId, userId, userId, userId]
        );

        // Filter out private events not created by current user
        const filteredEvents = events.filter(e => {
            if (e.visibility === 'private' && e.creator_id !== userId) {
                return false;
            }
            return true;
        }).map(e => ({
            id: e.id,
            calendar_id: e.calendar_id,
            calendar_name: e.calendar_name,
            creator_id: e.creator_id,
            title: e.title,
            location: e.location,
            allday: e.allday === 1,
            start: e.start_time,
            end: e.end_time,
            color: e.color,
            memo: e.memo,
            visibility: e.visibility,
            hp_consumption: e.hp_consumption,
            motivation_consumption: e.motivation_consumption,
            recurrence: e.recurrence,
            user_access: e.user_access,
            eventType: e.event_type || 'event',
            reminderMinutes: e.reminder_minutes ? JSON.parse(e.reminder_minutes) : [],
            notifyAtStart: e.notify_at_start === 1,
            taskDeadlineNotify: e.task_deadline_notify === 1,
            mailReminderEnabled: e.mail_reminder_enabled === 1,
            mailTo: e.mail_to || '',
            mailSubject: e.mail_subject || '',
            mailRemindAt: e.mail_remind_at || '',
            mailSent: e.mail_sent === 1
        }));

        res.json(filteredEvents);
    } catch (err) {
        console.error('Get events error:', err);
        res.status(500).json({ error: 'サーバーエラーが発生しました' });
    }
});

// POST /api/events - Create a new event
router.post('/', authenticateToken, async (req, res) => {
    const { id, calendar_id, allday } = req.body;
    const payload = validateEventPayload(req.body);
    if (payload.error) {
        return res.status(400).json({ error: payload.error });
    }
    const eventData = payload.value;

    if (id && !/^[A-Za-z0-9_-]{1,100}$/.test(String(id))) {
        return res.status(400).json({ error: 'イベントIDの形式が正しくありません' });
    }

    try {
        const userId = req.user.id;
        let targetCalendarId = calendar_id;

        if (!targetCalendarId) {
            let defaultCalendar = await query.get(
                'SELECT id FROM calendars WHERE owner_id = ? ORDER BY id ASC LIMIT 1',
                [userId]
            );
            if (!defaultCalendar) {
                await query.run(
                    'INSERT INTO calendars (name, owner_id) VALUES (?, ?)',
                    ['マイカレンダー', userId]
                );
                defaultCalendar = await query.get(
                    'SELECT id FROM calendars WHERE owner_id = ? ORDER BY id DESC LIMIT 1',
                    [userId]
                );
            }
            targetCalendarId = defaultCalendar.id;
        }

        // Check write permission
        const permission = await verifyWriteAccess(targetCalendarId, userId);
        if (!permission.hasAccess) {
            return res.status(403).json({ error: permission.error });
        }

        // Capacity Warnings Check (based on event start date)
        const dateStr = eventData.start.split('T')[0];
        const warning = await checkCapacityWarning(userId, dateStr, eventData.hpVal, eventData.motVal);

        const eventId = id || 'event_' + Date.now();
        const alldayVal = allday ? 1 : 0;

        await query.run(
            `INSERT INTO events (id, calendar_id, creator_id, title, location, allday, start_time, end_time, color, memo, visibility, hp_consumption, motivation_consumption, recurrence, event_type, reminder_minutes, notify_at_start, task_deadline_notify, mail_reminder_enabled, mail_to, mail_subject, mail_remind_at, mail_sent)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                eventId,
                targetCalendarId,
                userId,
                eventData.title,
                eventData.location,
                alldayVal,
                eventData.start,
                eventData.end,
                eventData.color,
                eventData.memo,
                eventData.visibility,
                eventData.hpVal,
                eventData.motVal,
                eventData.recurrence,
                eventData.eventType,
                JSON.stringify(eventData.reminderMinutes),
                eventData.notifyAtStart ? 1 : 0,
                eventData.taskDeadlineNotify ? 1 : 0,
                eventData.mailReminderEnabled ? 1 : 0,
                eventData.mailTo,
                eventData.mailSubject,
                eventData.mailRemindAt,
                eventData.mailSent ? 1 : 0
            ]
        );

        // Broadcast to calendar accessors via WebSocket
        const accessors = await getCalendarAccessors(targetCalendarId);
        sendToUsers(accessors, {
            type: 'event_sync',
            calendarId: targetCalendarId,
            action: 'create',
            eventId
        });

        res.status(201).json({
            message: '予定を追加しました',
            warning: warning ? warning.message : null,
            warningDetail: warning,
            event: {
                id: eventId,
                calendar_id: targetCalendarId,
                creator_id: userId,
                title: eventData.title,
                location: eventData.location,
                allday: !!allday,
                start: eventData.start,
                end: eventData.end,
                color: eventData.color,
                memo: eventData.memo,
                visibility: eventData.visibility,
                hp_consumption: eventData.hpVal,
                motivation_consumption: eventData.motVal,
                recurrence: eventData.recurrence
            }
        });
    } catch (err) {
        console.error('Create event error:', err);
        res.status(500).json({ error: 'サーバーエラーが発生しました' });
    }
});

// PUT /api/events/:id - Update an existing event
router.put('/:id', authenticateToken, async (req, res) => {
    const eventId = req.params.id;
    const { calendar_id, allday } = req.body;
    const payload = validateEventPayload(req.body);
    if (payload.error) {
        return res.status(400).json({ error: payload.error });
    }
    const eventData = payload.value;

    try {
        const userId = req.user.id;

        const existingEvent = await query.get('SELECT * FROM events WHERE id = ? AND deleted_at IS NULL', [eventId]);
        if (!existingEvent) {
            return res.status(404).json({ error: 'イベントが見つかりません' });
        }

        // Check write permission for original calendar
        const originalPermission = await verifyWriteAccess(existingEvent.calendar_id, userId);
        if (!originalPermission.hasAccess) {
            return res.status(403).json({ error: 'このイベントを編集する権限がありません' });
        }

        // Check write permission for target calendar if changed
        let targetCalendarId = existingEvent.calendar_id;
        if (calendar_id && calendar_id !== existingEvent.calendar_id) {
            const targetPermission = await verifyWriteAccess(calendar_id, userId);
            if (!targetPermission.hasAccess) {
                return res.status(403).json({ error: '移動先カレンダーへの編集権限がありません' });
            }
            targetCalendarId = calendar_id;
        }

        // Capacity check
        const dateStr = eventData.start.split('T')[0];
        const warning = await checkCapacityWarning(userId, dateStr, eventData.hpVal, eventData.motVal, eventId);

        const alldayVal = allday ? 1 : 0;

        await query.run(
            `UPDATE events 
             SET calendar_id = ?, title = ?, location = ?, allday = ?, start_time = ?, end_time = ?, color = ?, memo = ?, visibility = ?, hp_consumption = ?, motivation_consumption = ?, recurrence = ?, event_type = ?, reminder_minutes = ?, notify_at_start = ?, task_deadline_notify = ?, mail_reminder_enabled = ?, mail_to = ?, mail_subject = ?, mail_remind_at = ?, mail_sent = ?
             WHERE id = ?`,
            [
                targetCalendarId,
                eventData.title,
                eventData.location,
                alldayVal,
                eventData.start,
                eventData.end,
                eventData.color,
                eventData.memo,
                eventData.visibility,
                eventData.hpVal,
                eventData.motVal,
                eventData.recurrence,
                eventData.eventType,
                JSON.stringify(eventData.reminderMinutes),
                eventData.notifyAtStart ? 1 : 0,
                eventData.taskDeadlineNotify ? 1 : 0,
                eventData.mailReminderEnabled ? 1 : 0,
                eventData.mailTo,
                eventData.mailSubject,
                eventData.mailRemindAt,
                eventData.mailSent ? 1 : 0,
                eventId
            ]
        );

        // Broadcast to original and new calendar accessors
        const oldAccessors = await getCalendarAccessors(existingEvent.calendar_id);
        const newAccessors = await getCalendarAccessors(targetCalendarId);
        const allAccessors = Array.from(new Set([...oldAccessors, ...newAccessors]));

        sendToUsers(allAccessors, {
            type: 'event_sync',
            calendarId: targetCalendarId,
            action: 'update',
            eventId
        });

        res.json({
            message: '予定を更新しました',
            warning: warning ? warning.message : null,
            warningDetail: warning,
            event: {
                id: eventId,
                calendar_id: targetCalendarId,
                title: eventData.title,
                location: eventData.location,
                allday: !!allday,
                start: eventData.start,
                end: eventData.end,
                color: eventData.color,
                memo: eventData.memo,
                visibility: eventData.visibility,
                hp_consumption: eventData.hpVal,
                motivation_consumption: eventData.motVal,
                recurrence: eventData.recurrence
            }
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

        const existingEvent = await query.get('SELECT * FROM events WHERE id = ? AND deleted_at IS NULL', [eventId]);
        if (!existingEvent) {
            return res.status(404).json({ error: 'イベントが見つかりません' });
        }

        const permission = await verifyWriteAccess(existingEvent.calendar_id, userId);
        if (!permission.hasAccess) {
            return res.status(403).json({ error: 'このイベントを削除する権限がありません' });
        }

        await query.run(
            'UPDATE events SET deleted_at = CURRENT_TIMESTAMP, deleted_by = ? WHERE id = ?',
            [userId, eventId]
        );

        // Broadcast removal
        const accessors = await getCalendarAccessors(existingEvent.calendar_id);
        sendToUsers(accessors, {
            type: 'event_sync',
            calendarId: existingEvent.calendar_id,
            action: 'delete',
            eventId
        });

        res.json({ message: '予定を削除しました' });
    } catch (err) {
        console.error('Delete event error:', err);
        res.status(500).json({ error: 'サーバーエラーが発生しました' });
    }
});

// POST /api/events/copy-paste - Copy multiple events to a target date
router.post('/copy-paste', authenticateToken, async (req, res) => {
    const { eventIds, targetDate } = req.body; // targetDate format: 'YYYY-MM-DD'

    if (!eventIds || !Array.isArray(eventIds) || eventIds.length === 0 || !targetDate) {
        return res.status(400).json({ error: 'イベントID配列と貼り付け先の日付(targetDate)は必須項目です' });
    }

    if (eventIds.length > 50) {
        return res.status(400).json({ error: '一度にコピーできる予定は50件までです' });
    }

    if (!isLocalDate(targetDate)) {
        return res.status(400).json({ error: '貼り付け先の日付は YYYY-MM-DD 形式で指定してください' });
    }

    try {
        const userId = req.user.id;
        const pastedEvents = [];
        const affectedCalendarIds = new Set();

        for (const eventId of eventIds) {
            const event = await query.get('SELECT * FROM events WHERE id = ? AND deleted_at IS NULL', [eventId]);
            if (!event) continue;

            // Check permissions
            const permission = await verifyWriteAccess(event.calendar_id, userId);
            if (!permission.hasAccess) continue; // Skip unauthorized duplicates

            // Calculate start/end times relative to the new date
            const origStart = new Date(event.start_time);
            const origEnd = new Date(event.end_time);
            const durationMs = origEnd.getTime() - origStart.getTime();

            // event.start_time is formatted as YYYY-MM-DDTHH:mm
            const timePart = event.start_time.split('T')[1] || '09:00';
            const targetStart = new Date(`${targetDate}T${timePart}`);
            const targetEnd = new Date(targetStart.getTime() + durationMs);

            const startStr = formatLocalDateTime(targetStart);
            const endStr = formatLocalDateTime(targetEnd);
            const newEventId = 'event_' + Date.now() + '_' + Math.floor(Math.random() * 1000);

            await query.run(
                `INSERT INTO events (id, calendar_id, creator_id, title, location, allday, start_time, end_time, color, memo, visibility, hp_consumption, motivation_consumption, recurrence)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [newEventId, event.calendar_id, userId, event.title, event.location, event.allday, startStr, endStr, event.color, event.memo, event.visibility, event.hp_consumption, event.motivation_consumption, event.recurrence]
            );

            pastedEvents.push({
                id: newEventId,
                calendar_id: event.calendar_id,
                title: event.title,
                start: startStr,
                end: endStr
            });
            affectedCalendarIds.add(event.calendar_id);
        }

        // Broadcast to all affected calendars
        for (const calendarId of affectedCalendarIds) {
            const accessors = await getCalendarAccessors(calendarId);
            sendToUsers(accessors, {
                type: 'event_sync',
                calendarId,
                action: 'copy_paste'
            });
        }

        res.json({
            message: `${pastedEvents.length}件の予定を ${targetDate} にコピーしました`,
            events: pastedEvents
        });
    } catch (err) {
        console.error('Copy paste events error:', err);
        res.status(500).json({ error: 'サーバーエラーが発生しました' });
    }
});

module.exports = router;
