const config = require('../config');
const { query } = require('../db');
const { sendMail } = require('./mailer');
const { sendWebPushToUser } = require('./push');

const DEFAULT_REMINDER_MINUTES = [30, 5];
let schedulerStarted = false;
let schedulerRunning = false;

function formatLocalDateTime(date) {
    const pad = (num) => String(num).padStart(2, '0');
    return [
        date.getFullYear(),
        pad(date.getMonth() + 1),
        pad(date.getDate())
    ].join('-') + `T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatLocalDate(date) {
    const pad = (num) => String(num).padStart(2, '0');
    return [
        date.getFullYear(),
        pad(date.getMonth() + 1),
        pad(date.getDate())
    ].join('-');
}

function parseLocalDateTime(value) {
    if (!value || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(String(value))) {
        return null;
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

function addMinutes(date, minutes) {
    return new Date(date.getTime() + minutes * 60 * 1000);
}

function isDue(targetDate, now) {
    return targetDate && targetDate.getTime() <= now.getTime();
}

function isScheduleDateBeforeToday(value, now) {
    const datePart = String(value || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return false;
    return datePart < formatLocalDate(now);
}

function parseReminderMinutes(value) {
    try {
        const parsed = JSON.parse(value || '[]');
        if (Array.isArray(parsed) && parsed.length > 0) {
            return parsed
                .map(item => Number.parseInt(item, 10))
                .filter(item => Number.isInteger(item) && item >= 1 && item <= 10080);
        }
    } catch {
        // Fall through to defaults.
    }
    return DEFAULT_REMINDER_MINUTES;
}

function parseSettings(value) {
    try {
        return {
            events: true,
            tasks: true,
            game: true,
            email: true,
            ...JSON.parse(value || '{}')
        };
    } catch {
        return { events: true, tasks: true, game: true, email: true };
    }
}

function isTypeEnabled(settings, type) {
    if (type === 'task') return settings.tasks !== false;
    if (type === 'email') return settings.email !== false;
    if (type === 'game') return settings.game !== false;
    return settings.events !== false;
}

async function getCalendarAccessors(calendarId, creatorId, visibility) {
    if (visibility === 'private') {
        return creatorId ? [creatorId] : [];
    }

    const calendar = await query.get('SELECT owner_id, group_id FROM calendars WHERE id = ?', [calendarId]);
    if (!calendar) return creatorId ? [creatorId] : [];

    const userIds = new Set();
    if (creatorId) userIds.add(creatorId);
    if (calendar.owner_id) userIds.add(calendar.owner_id);

    const shares = await query.all('SELECT user_id FROM calendar_shares WHERE calendar_id = ?', [calendarId]);
    shares.forEach(share => userIds.add(share.user_id));

    if (calendar.group_id) {
        const members = await query.all('SELECT user_id FROM group_members WHERE group_id = ?', [calendar.group_id]);
        members.forEach(member => userIds.add(member.user_id));
    }

    return Array.from(userIds);
}

async function claimDelivery({ userId, eventId, deliveryKey, channel, title, message, scheduledFor }) {
    const result = await query.run(
        `INSERT INTO notification_deliveries
            (user_id, event_id, delivery_key, channel, title, message, scheduled_for)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id, delivery_key, channel) DO NOTHING`,
        [userId, eventId || null, deliveryKey, channel, title, message, scheduledFor]
    );
    return !!result.lastID;
}

async function saveHistory(userId, title, message, type) {
    await query.run(
        `INSERT INTO notification_history (user_id, title, message, sent_at, type)
         VALUES (?, ?, ?, ?, ?)`,
        [userId, title, message, new Date().toISOString(), type]
    );
}

async function sendPushNotificationToUsers({ userIds, eventId, deliveryKey, title, message, type, scheduledFor }) {
    for (const userId of userIds) {
        const user = await query.get('SELECT notification_settings FROM users WHERE id = ?', [userId]);
        if (!user) continue;

        const settings = parseSettings(user.notification_settings);
        if (!isTypeEnabled(settings, type)) continue;

        const claimed = await claimDelivery({
            userId,
            eventId,
            deliveryKey,
            channel: 'push',
            title,
            message,
            scheduledFor
        });
        if (!claimed) continue;

        await saveHistory(userId, title, message, type);
        await sendWebPushToUser(userId, {
            title,
            message,
            type,
            tag: deliveryKey,
            url: `${config.appUrl}/calendar.html`
        });
    }
}

async function handleEventPushReminder(event, now) {
    if (event.allday === 1) return;

    const type = event.event_type || 'event';
    if (type !== 'event' && type !== 'task') return;

    const baseTime = parseLocalDateTime(type === 'task' ? event.end_time : event.start_time);
    if (!baseTime) return;
    if (isScheduleDateBeforeToday(type === 'task' ? event.end_time : event.start_time, now)) return;

    const userIds = await getCalendarAccessors(event.calendar_id, event.creator_id, event.visibility);
    if (userIds.length === 0) return;

    const reminders = parseReminderMinutes(event.reminder_minutes);
    for (const minutes of reminders) {
        const scheduledDate = addMinutes(baseTime, -minutes);
        if (!isDue(scheduledDate, now)) continue;

        const title = type === 'task' ? 'タスク期限通知' : '予定通知';
        const message = type === 'task'
            ? `「${event.title}」の期限${minutes}分前です`
            : `「${event.title}」の${minutes}分前です`;
        const scheduledFor = formatLocalDateTime(scheduledDate);
        const deliveryKey = `event:${event.id}:${type}:before:${minutes}:${scheduledFor}`;

        await sendPushNotificationToUsers({
            userIds,
            eventId: event.id,
            deliveryKey,
            title,
            message,
            type,
            scheduledFor
        });
    }

    const shouldNotifyAtTime = type === 'task'
        ? event.task_deadline_notify === 1
        : event.notify_at_start === 1;
    if (!shouldNotifyAtTime || !isDue(baseTime, now)) return;

    const title = type === 'task' ? 'タスク期限通知' : '予定通知';
    const message = type === 'task'
        ? `「${event.title}」の期限時刻です`
        : `「${event.title}」の開始時刻になりました`;
    const scheduledFor = formatLocalDateTime(baseTime);
    const deliveryKey = `event:${event.id}:${type}:at:${scheduledFor}`;

    await sendPushNotificationToUsers({
        userIds,
        eventId: event.id,
        deliveryKey,
        title,
        message,
        type,
        scheduledFor
    });
}

async function handleMailReminder(event, now) {
    if (event.mail_reminder_enabled !== 1 || event.mail_sent === 1 || !event.mail_remind_at) {
        return;
    }

    const scheduledDate = parseLocalDateTime(event.mail_remind_at);
    if (!isDue(scheduledDate, now)) return;
    if (isScheduleDateBeforeToday(event.start_time, now)) return;

    const creator = event.creator_id
        ? await query.get('SELECT id, email, notification_settings FROM users WHERE id = ?', [event.creator_id])
        : null;
    if (!creator) return;

    const settings = parseSettings(creator.notification_settings);
    if (!isTypeEnabled(settings, 'email')) return;

    const to = event.mail_to || creator.email;
    const subject = event.mail_subject || `Shared Calendar: ${event.title}`;
    const message = [
        `予定「${event.title}」のメールリマインドです。`,
        `日時: ${event.start_time} - ${event.end_time}`,
        event.memo ? `メモ: ${event.memo}` : ''
    ].filter(Boolean).join('\n');
    const scheduledFor = formatLocalDateTime(scheduledDate);
    const deliveryKey = `event:${event.id}:email:${scheduledFor}`;

    const claimed = await claimDelivery({
        userId: creator.id,
        eventId: event.id,
        deliveryKey,
        channel: 'email',
        title: subject,
        message,
        scheduledFor
    });
    if (!claimed) return;

    await sendMail({ to, subject, text: message });
    await saveHistory(creator.id, 'メール送信リマインド', `「${event.title}」のメールを送信しました`, 'email');
    await query.run('UPDATE events SET mail_sent = 1 WHERE id = ?', [event.id]);

    await sendWebPushToUser(creator.id, {
        title: 'メール送信リマインド',
        message: `「${event.title}」のメールを送信しました`,
        type: 'email',
        tag: deliveryKey,
        url: `${config.appUrl}/calendar.html`
    });
}

async function scanDueNotifications() {
    if (schedulerRunning) return;
    schedulerRunning = true;

    try {
        const now = new Date();
        const scanFrom = formatLocalDateTime(addMinutes(now, -60 * 24 * 30));
        const scanTo = formatLocalDateTime(addMinutes(now, 60 * 24 * 8));
        const nowLocal = formatLocalDateTime(now);

        const events = await query.all(
            `SELECT *
             FROM events
             WHERE deleted_at IS NULL
               AND (
                    (start_time >= ? AND start_time <= ?)
                 OR (end_time >= ? AND end_time <= ?)
                 OR (
                        mail_reminder_enabled = 1
                    AND mail_sent = 0
                    AND mail_remind_at IS NOT NULL
                    AND mail_remind_at >= ?
                    AND mail_remind_at <= ?
                 )
               )`,
            [scanFrom, scanTo, scanFrom, scanTo, scanFrom, nowLocal]
        );

        for (const event of events) {
            await handleEventPushReminder(event, now);
            await handleMailReminder(event, now);
        }

        const cleanupBefore = new Date(now.getTime() - 1000 * 60 * 60 * 24 * 45).toISOString();
        await query.run('DELETE FROM notification_deliveries WHERE delivered_at < ?', [cleanupBefore]);
    } catch (err) {
        console.error('Notification scheduler error:', err);
    } finally {
        schedulerRunning = false;
    }
}

function startNotificationScheduler() {
    if (schedulerStarted) return;
    schedulerStarted = true;

    scanDueNotifications();
    const timer = setInterval(scanDueNotifications, config.notificationScheduler.intervalMs);
    if (typeof timer.unref === 'function') timer.unref();
    console.log(`Notification scheduler started: every ${config.notificationScheduler.intervalMs}ms`);
}

module.exports = {
    scanDueNotifications,
    startNotificationScheduler
};
