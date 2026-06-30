const express = require('express');
const router = express.Router();
const { query } = require('../db');
const authenticateToken = require('../middleware/auth');

// Helper to determine status color based on percentage
function getGaugeStatus(percentage, threshold) {
    if (percentage <= threshold) return 'red';
    if (percentage < 50) return 'yellow';
    return 'green';
}

// Helper to find gaps between events for rest suggestion
function findFreeSlots(events, startHour = 9, endHour = 21) {
    const slots = [];
    // Sort events by start time
    const sorted = events
        .map(e => ({
            start: new Date(e.start_time),
            end: new Date(e.end_time)
        }))
        .sort((a, b) => a.start - b.start);

    let current = new Date();
    current.setHours(startHour, 0, 0, 0);
    const limit = new Date();
    limit.setHours(endHour, 0, 0, 0);

    for (const event of sorted) {
        if (event.start > current) {
            // Gap found
            const diffMin = (event.start - current) / (1000 * 60);
            if (diffMin >= 60) { // suggest if gap is at least 1 hour
                slots.push({
                    start: new Date(current),
                    end: new Date(event.start)
                });
            }
        }
        if (event.end > current) {
            current = new Date(event.end);
        }
    }

    if (limit > current) {
        const diffMin = (limit - current) / (1000 * 60);
        if (diffMin >= 60) {
            slots.push({
                start: new Date(current),
                end: new Date(limit)
            });
        }
    }

    return slots;
}

// GET /api/hp-motivation/status - Get current limits & remaining HP/motivation for a specific date
router.get('/status', authenticateToken, async (req, res) => {
    const { date } = req.query; // format: 'YYYY-MM-DD', defaults to today
    const userId = req.user.id;
    const targetDate = date || new Date().toISOString().split('T')[0];

    try {
        const user = await query.get(
            'SELECT max_hp, max_motivation, recovery_rate, warning_threshold FROM users WHERE id = ?',
            [userId]
        );
        if (!user) {
            return res.status(404).json({ error: 'ユーザーが見つかりません' });
        }

        // Fetch events for this date
        const events = await query.all(
            `SELECT hp_consumption, motivation_consumption FROM events 
             WHERE creator_id = ? AND start_time LIKE ? AND deleted_at IS NULL`,
            [userId, `${targetDate}%`]
        );

        let totalHpConsumed = 0;
        let totalMotConsumed = 0;
        events.forEach(e => {
            totalHpConsumed += e.hp_consumption || 0;
            totalMotConsumed += e.motivation_consumption || 0;
        });

        const remainingHp = Math.max(0, user.max_hp - totalHpConsumed);
        const remainingMot = Math.max(0, user.max_motivation - totalMotConsumed);

        const hpPct = Math.round((remainingHp / user.max_hp) * 100);
        const motPct = Math.round((remainingMot / user.max_motivation) * 100);

        // Next-day impact evaluation
        let nextDayAlert = null;
        if (remainingHp < user.warning_threshold || totalHpConsumed > (user.max_hp * 0.8)) {
            // Formula: next day start is reduced by fatigue
            const fatiguePenalty = Math.round((user.max_hp - remainingHp) * (1 - user.recovery_rate));
            const projectedStartingHpTomorrow = Math.max(0, user.max_hp - fatiguePenalty);
            if (projectedStartingHpTomorrow < user.max_hp) {
                nextDayAlert = {
                    projectedHp: projectedStartingHpTomorrow,
                    message: `翌日の体力影響警告: 本日の疲労度が高いため、翌日の初期HPが ${projectedStartingHpTomorrow}/${user.max_hp} に低下する可能性があります。十分な睡眠をとってください。`
                };
            }
        }

        res.json({
            date: targetDate,
            limits: {
                max_hp: user.max_hp,
                max_motivation: user.max_motivation,
                recovery_rate: user.recovery_rate,
                warning_threshold: user.warning_threshold
            },
            consumed: {
                hp: totalHpConsumed,
                motivation: totalMotConsumed
            },
            remaining: {
                hp: remainingHp,
                motivation: remainingMot
            },
            percentages: {
                hp: hpPct,
                motivation: motPct
            },
            statusColors: {
                hp: getGaugeStatus(hpPct, user.warning_threshold),
                motivation: getGaugeStatus(motPct, user.warning_threshold)
            },
            nextDayAlert
        });
    } catch (err) {
        console.error('Get HP/motivation status error:', err);
        res.status(500).json({ error: 'サーバーエラーが発生しました' });
    }
});

// POST /api/hp-motivation/settings - Update limits/settings
router.post('/settings', authenticateToken, async (req, res) => {
    const { max_hp, max_motivation, recovery_rate, warning_threshold } = req.body;

    if (max_hp === undefined && max_motivation === undefined && recovery_rate === undefined && warning_threshold === undefined) {
        return res.status(400).json({ error: '更新する項目を指定してください' });
    }

    try {
        const userId = req.user.id;
        const user = await query.get('SELECT * FROM users WHERE id = ?', [userId]);

        const finalMaxHp = max_hp !== undefined ? parseInt(max_hp) : user.max_hp;
        const finalMaxMot = max_motivation !== undefined ? parseInt(max_motivation) : user.max_motivation;
        const finalRecovery = recovery_rate !== undefined ? parseFloat(recovery_rate) : user.recovery_rate;
        const finalThreshold = warning_threshold !== undefined ? parseInt(warning_threshold) : user.warning_threshold;

        await query.run(
            `UPDATE users 
             SET max_hp = ?, max_motivation = ?, recovery_rate = ?, warning_threshold = ?
             WHERE id = ?`,
            [finalMaxHp, finalMaxMot, finalRecovery, finalThreshold, userId]
        );

        res.json({
            message: '設定を更新しました',
            settings: {
                max_hp: finalMaxHp,
                max_motivation: finalMaxMot,
                recovery_rate: finalRecovery,
                warning_threshold: finalThreshold
            }
        });
    } catch (err) {
        console.error('Update HP settings error:', err);
        res.status(500).json({ error: 'サーバーエラーが発生しました' });
    }
});

// GET /api/hp-motivation/statistics - Weekly/Monthly HP and motivation trend line graphs
router.get('/statistics', authenticateToken, async (req, res) => {
    const { range } = req.query; // 'week' (default) or 'month'
    const userId = req.user.id;
    const daysCount = range === 'month' ? 30 : 7;

    try {
        const user = await query.get('SELECT max_hp, max_motivation FROM users WHERE id = ?', [userId]);
        if (!user) {
            return res.status(404).json({ error: 'ユーザーが見つかりません' });
        }

        const statistics = [];
        const today = new Date();

        for (let i = daysCount - 1; i >= 0; i--) {
            const tempDate = new Date(today);
            tempDate.setDate(today.getDate() - i);
            const dateStr = tempDate.toISOString().split('T')[0];

            // Sum events' consumption
            const events = await query.all(
                'SELECT hp_consumption, motivation_consumption FROM events WHERE creator_id = ? AND start_time LIKE ? AND deleted_at IS NULL',
                [userId, `${dateStr}%`]
            );

            let hpConsumed = 0;
            let motConsumed = 0;
            events.forEach(e => {
                hpConsumed += e.hp_consumption || 0;
                motConsumed += e.motivation_consumption || 0;
            });

            const remainingHp = Math.max(0, user.max_hp - hpConsumed);
            const remainingMot = Math.max(0, user.max_motivation - motConsumed);

            statistics.push({
                date: dateStr,
                remaining_hp: remainingHp,
                remaining_motivation: remainingMot,
                hp_percentage: Math.round((remainingHp / user.max_hp) * 100),
                motivation_percentage: Math.round((remainingMot / user.max_motivation) * 100)
            });
        }

        res.json({
            range,
            max_hp: user.max_hp,
            max_motivation: user.max_motivation,
            data: statistics
        });
    } catch (err) {
        console.error('Get HP statistics error:', err);
        res.status(500).json({ error: 'サーバーエラーが発生しました' });
    }
});

// POST /api/hp-motivation/suggest-rest - Suggest rest slot in calendar gap
router.post('/suggest-rest', authenticateToken, async (req, res) => {
    const { date } = req.body; // format 'YYYY-MM-DD'
    const userId = req.user.id;
    const targetDate = date || new Date().toISOString().split('T')[0];

    try {
        // 1. Fetch current limits and remaining status
        const user = await query.get('SELECT max_hp, warning_threshold FROM users WHERE id = ?', [userId]);
        if (!user) {
            return res.status(404).json({ error: 'ユーザーが見つかりません' });
        }

        const events = await query.all(
            `SELECT start_time, end_time, hp_consumption FROM events 
             WHERE creator_id = ? AND start_time LIKE ? AND deleted_at IS NULL`,
            [userId, `${targetDate}%`]
        );

        let totalHpConsumed = 0;
        events.forEach(e => totalHpConsumed += e.hp_consumption || 0);
        const remainingHp = user.max_hp - totalHpConsumed;

        // Suggest only if remaining HP is low
        if (remainingHp > user.warning_threshold) {
            return res.json({
                lowFatigue: true,
                message: '体力が十分残っているため、休息の必要はありません。',
                suggestions: []
            });
        }

        // Find gaps
        const freeSlots = findFreeSlots(events, 9, 20); // check gaps between 9 AM and 8 PM
        const suggestions = freeSlots.map(slot => {
            const startStr = slot.start.toTimeString().substring(0, 5);
            const endStr = slot.end.toTimeString().substring(0, 5);
            return {
                start: `${targetDate}T${startStr}`,
                end: `${targetDate}T${endStr}`,
                title: 'リフレッシュ休息',
                memo: '自動提案された休息時間です。水分を摂り少し横になりましょう。',
                hp_recovery: 20, // registering a rest recovers 20 HP
                color: '#34C759' // Green color
            };
        });

        res.json({
            lowFatigue: false,
            message: `HP残量が ${remainingHp}/${user.max_hp} と低下しています。以下の時間帯に休憩を入れて回復を図ることをおすすめします。`,
            suggestions
        });
    } catch (err) {
        console.error('Suggest rest error:', err);
        res.status(500).json({ error: 'サーバーエラーが発生しました' });
    }
});

module.exports = router;
