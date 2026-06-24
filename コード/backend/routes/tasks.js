const express = require('express');
const router = express.Router();
const { query } = require('../db');
const authenticateToken = require('../middleware/auth');
const { sendToUsers } = require('../utils/websocket');

// Helper to check user membership in a group
async function checkGroupMembership(groupId, userId) {
    const member = await query.get(
        'SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?',
        [groupId, userId]
    );
    return !!member;
}

// Helper to get all user IDs in a group for broadcasting
async function getGroupMemberIds(groupId) {
    const members = await query.all('SELECT user_id FROM group_members WHERE group_id = ?', [groupId]);
    return members.map(m => m.user_id);
}

// GET /api/tasks - Get all tasks (personal + group tasks user belongs to)
router.get('/', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;

        // Fetch personal tasks and tasks belonging to any of user's groups
        const tasks = await query.all(
            `SELECT t.*, g.name as group_name
             FROM tasks t
             LEFT JOIN groups g ON t.group_id = g.id
             LEFT JOIN group_members gm ON t.group_id = gm.group_id AND gm.user_id = ?
             WHERE t.user_id = ? OR (t.group_id IS NOT NULL AND gm.user_id IS NOT NULL)`,
            [userId, userId]
        );

        const formattedTasks = tasks.map(t => ({
            id: t.id,
            user_id: t.user_id,
            group_id: t.group_id,
            group_name: t.group_name,
            title: t.title,
            due_date: t.due_date,
            completed: t.completed === 1,
            hp_consumption: t.hp_consumption,
            motivation_consumption: t.motivation_consumption,
            created_at: t.created_at
        }));

        res.json(formattedTasks);
    } catch (err) {
        console.error('Get tasks error:', err);
        res.status(500).json({ error: 'サーバーエラーが発生しました' });
    }
});

// POST /api/tasks - Create a new task
router.post('/', authenticateToken, async (req, res) => {
    const { title, due_date, hp_consumption, motivation_consumption, group_id } = req.body;

    if (!title || !title.trim()) {
        return res.status(400).json({ error: 'タスクのタイトルを入力してください' });
    }

    try {
        const userId = req.user.id;

        // If it's a group task, verify group membership
        if (group_id) {
            const isMember = await checkGroupMembership(group_id, userId);
            if (!isMember) {
                return res.status(403).json({ error: 'このグループにタスクを登録する権限がありません' });
            }
        }

        const hpVal = parseInt(hp_consumption || 0);
        const motVal = parseInt(motivation_consumption || 0);

        const result = await query.run(
            `INSERT INTO tasks (user_id, group_id, title, due_date, completed, hp_consumption, motivation_consumption)
             VALUES (?, ?, ?, ?, 0, ?, ?)`,
            [userId, group_id || null, title.trim(), due_date || null, hpVal, motVal]
        );

        const newTaskId = result.lastID;

        // Broadcast to group members if shared
        if (group_id) {
            const memberIds = await getGroupMemberIds(group_id);
            sendToUsers(memberIds, {
                type: 'task_sync',
                groupId: group_id,
                action: 'create',
                taskId: newTaskId
            });
        }

        res.status(201).json({
            message: 'タスクを登録しました',
            task: { id: newTaskId, user_id: userId, group_id, title, due_date, completed: false, hp_consumption: hpVal, motivation_consumption: motVal }
        });
    } catch (err) {
        console.error('Create task error:', err);
        res.status(500).json({ error: 'サーバーエラーが発生しました' });
    }
});

// PUT /api/tasks/:id - Update an existing task (or complete/toggle it)
router.put('/:id', authenticateToken, async (req, res) => {
    const taskId = req.params.id;
    const { title, due_date, completed, hp_consumption, motivation_consumption } = req.body;

    try {
        const userId = req.user.id;
        const task = await query.get('SELECT * FROM tasks WHERE id = ?', [taskId]);

        if (!task) {
            return res.status(404).json({ error: 'タスクが見つかりません' });
        }

        // Verify write permission: creator can modify, group members can modify if group task
        let isAuthorized = task.user_id === userId;
        if (!isAuthorized && task.group_id) {
            isAuthorized = await checkGroupMembership(task.group_id, userId);
        }

        if (!isAuthorized) {
            return res.status(403).json({ error: 'このタスクを編集する権限がありません' });
        }

        const compVal = completed !== undefined ? (completed ? 1 : 0) : task.completed;
        const hpVal = hp_consumption !== undefined ? parseInt(hp_consumption) : task.hp_consumption;
        const motVal = motivation_consumption !== undefined ? parseInt(motivation_consumption) : task.motivation_consumption;
        const finalTitle = title !== undefined ? title.trim() : task.title;
        const finalDueDate = due_date !== undefined ? due_date : task.due_date;

        await query.run(
            `UPDATE tasks 
             SET title = ?, due_date = ?, completed = ?, hp_consumption = ?, motivation_consumption = ?
             WHERE id = ?`,
            [finalTitle, finalDueDate, compVal, hpVal, motVal, taskId]
        );

        // Broadcast to group members if shared
        if (task.group_id) {
            const memberIds = await getGroupMemberIds(task.group_id);
            sendToUsers(memberIds, {
                type: 'task_sync',
                groupId: task.group_id,
                action: 'update',
                taskId
            });
        }

        res.json({
            message: 'タスクを更新しました',
            task: { id: taskId, user_id: task.user_id, group_id: task.group_id, title: finalTitle, due_date: finalDueDate, completed: !!compVal, hp_consumption: hpVal, motivation_consumption: motVal }
        });
    } catch (err) {
        console.error('Update task error:', err);
        res.status(500).json({ error: 'サーバーエラーが発生しました' });
    }
});

// DELETE /api/tasks/:id - Delete a task
router.delete('/:id', authenticateToken, async (req, res) => {
    const taskId = req.params.id;

    try {
        const userId = req.user.id;
        const task = await query.get('SELECT * FROM tasks WHERE id = ?', [taskId]);

        if (!task) {
            return res.status(404).json({ error: 'タスクが見つかりません' });
        }

        // Verify write permission
        let isAuthorized = task.user_id === userId;
        if (!isAuthorized && task.group_id) {
            isAuthorized = await checkGroupMembership(task.group_id, userId);
        }

        if (!isAuthorized) {
            return res.status(403).json({ error: 'このタスクを削除する権限がありません' });
        }

        await query.run('DELETE FROM tasks WHERE id = ?', [taskId]);

        // Broadcast to group
        if (task.group_id) {
            const memberIds = await getGroupMemberIds(task.group_id);
            sendToUsers(memberIds, {
                type: 'task_sync',
                groupId: task.group_id,
                action: 'delete',
                taskId
            });
        }

        res.json({ message: 'タスクを削除しました' });
    } catch (err) {
        console.error('Delete task error:', err);
        res.status(500).json({ error: 'サーバーエラーが発生しました' });
    }
});

// POST /api/tasks/recommend - Task Recommendation (Weather/Free slots consideration) [Phase 2 AI Hook]
router.post('/recommend', authenticateToken, async (req, res) => {
    // Recommendation logic taking current date, weather condition mock, and empty slots
    const { weather, date } = req.body; // e.g. weather: 'rainy'/'sunny', date: '2026-06-16'

    try {
        const userId = req.user.id;
        const formattedDate = date || new Date().toISOString().split('T')[0];

        // Retrieve existing events for the day to check availability
        const events = await query.all(
            `SELECT start_time, end_time FROM events 
             WHERE creator_id = ? AND start_time LIKE ?`,
            [userId, `${formattedDate}%`]
        );

        // Determine recommendation suggestions based on weather and free slots
        const suggestions = [];
        if (weather === 'rainy' || weather === '雨') {
            suggestions.push({
                title: '自宅での読書・資格勉強',
                reason: '雨の日予報かつ、午後空きスケジュールがあるため、インドアでのスキル向上タスクを推奨します。',
                hp_consumption: 15,
                motivation_consumption: 25
            });
            suggestions.push({
                title: '部屋の掃除と片づけ',
                reason: '外出を控える日に身の回りの整理を行うと気分転換になります。',
                hp_consumption: 25,
                motivation_consumption: 10
            });
        } else {
            suggestions.push({
                title: '近所へのウォーキングまたはジム通い',
                reason: '晴れの日ですので、予定の無い時間帯に外で体力を動かしリフレッシュすることを提案します。',
                hp_consumption: 30,
                motivation_consumption: -20 // rest/recover motivation
            });
            suggestions.push({
                title: 'カフェでキャリア情報の収集',
                reason: '午前中にまとまった空き時間があります。天気が良いためカフェ等でリラックスして調べ物が捗ります。',
                hp_consumption: 10,
                motivation_consumption: 15
            });
        }

        res.json({
            message: 'スケジュールと天気を考慮したタスク自動推薦です。',
            suggestions
        });
    } catch (err) {
        console.error('Task recommendation error:', err);
        res.status(500).json({ error: 'サーバーエラーが発生しました' });
    }
});

module.exports = router;
