const express = require('express');
const router = express.Router();
const { query } = require('../db');
const authenticateToken = require('../middleware/auth');
const { sendToUsers } = require('../utils/websocket');

// Helper to check user's role in a group
async function getGroupRole(groupId, userId) {
    const member = await query.get(
        'SELECT role FROM group_members WHERE group_id = ? AND user_id = ?',
        [groupId, userId]
    );
    return member ? member.role : null;
}

// Helper to get all user IDs in a group
async function getGroupMemberIds(groupId) {
    const members = await query.all('SELECT user_id FROM group_members WHERE group_id = ?', [groupId]);
    return members.map(m => m.user_id);
}

// GET /api/groups - Get all groups the current user belongs to
router.get('/', authenticateToken, async (req, res) => {
    try {
        const groups = await query.all(
            `SELECT g.*, gm.role, (SELECT COUNT(*) FROM group_members WHERE group_id = g.id) as member_count
             FROM groups g
             JOIN group_members gm ON g.id = gm.group_id
             WHERE gm.user_id = ?`,
            [req.user.id]
        );
        res.json(groups);
    } catch (err) {
        console.error('Get groups error:', err);
        res.status(500).json({ error: 'サーバーエラーが発生しました' });
    }
});

// POST /api/groups - Create a new group
router.post('/', authenticateToken, async (req, res) => {
    const { name } = req.body;

    if (!name || !name.trim()) {
        return res.status(400).json({ error: 'グループ名を入力してください' });
    }

    try {
        // Create Group
        const result = await query.run(
            'INSERT INTO groups (name, owner_id) VALUES (?, ?)',
            [name.trim(), req.user.id]
        );
        const groupId = result.lastID;

        // Add creator as Admin
        await query.run(
            'INSERT INTO group_members (group_id, user_id, role) VALUES (?, ?, ?)',
            [groupId, req.user.id, 'admin']
        );

        // Create a Group Calendar associated with this group
        await query.run(
            'INSERT INTO calendars (name, group_id) VALUES (?, ?)',
            [`${name.trim()}のカレンダー`, groupId]
        );

        res.status(201).json({
            message: 'グループを作成しました',
            group: { id: groupId, name, owner_id: req.user.id, role: 'admin' }
        });
    } catch (err) {
        console.error('Create group error:', err);
        res.status(500).json({ error: 'サーバーエラーが発生しました' });
    }
});

// GET /api/groups/:id/members - Get all members of a group
router.get('/:id/members', authenticateToken, async (req, res) => {
    const groupId = req.params.id;

    try {
        const role = await getGroupRole(groupId, req.user.id);
        if (!role) {
            return res.status(403).json({ error: 'このグループの情報にアクセスする権限がありません' });
        }

        const members = await query.all(
            `SELECT u.id, u.display_name, u.email, gm.role, gm.created_at
             FROM group_members gm
             JOIN users u ON gm.user_id = u.id
             WHERE gm.group_id = ?`,
            [groupId]
        );
        res.json(members);
    } catch (err) {
        console.error('Get group members error:', err);
        res.status(500).json({ error: 'サーバーエラーが発生しました' });
    }
});

// POST /api/groups/:id/invite - Invite a user to a group using their User ID (Admin or Editor only)
router.post('/:id/invite', authenticateToken, async (req, res) => {
    const groupId = req.params.id;
    const { user_id } = req.body;

    if (!user_id) {
        return res.status(400).json({ error: '招待するユーザーのIDを指定してください' });
    }

    try {
        // 1. Check permissions (Admin or Editor can invite)
        const callerRole = await getGroupRole(groupId, req.user.id);
        if (!callerRole || !['admin', 'editor'].includes(callerRole)) {
            return res.status(403).json({ error: 'メンバーを招待する権限がありません（管理者または編集者のみ可能）' });
        }

        // 2. Check group size limit (max 20 members)
        const memberCountRes = await query.get('SELECT COUNT(*) as count FROM group_members WHERE group_id = ?', [groupId]);
        if (memberCountRes.count >= 20) {
            return res.status(400).json({ error: 'グループメンバーの上限は20名です' });
        }

        // 3. Find target user
        const targetUser = await query.get('SELECT id, display_name FROM users WHERE id = ?', [user_id]);
        if (!targetUser) {
            return res.status(404).json({ error: '指定されたユーザーIDが見つかりません' });
        }

        // 4. Check if already a member
        const existingMember = await getGroupRole(groupId, user_id);
        if (existingMember) {
            return res.status(400).json({ error: 'このユーザーは既にグループに参加しています' });
        }

        // 5. Add user as viewer (default)
        await query.run(
            'INSERT INTO group_members (group_id, user_id, role) VALUES (?, ?, ?)',
            [groupId, user_id, 'viewer']
        );

        // Get updated list of member IDs and broadcast
        const memberIds = await getGroupMemberIds(groupId);
        sendToUsers(memberIds, {
            type: 'group_sync',
            groupId,
            message: `${targetUser.display_name} さんがグループに参加しました`
        });

        res.json({ message: `${targetUser.display_name} さんを招待しました` });
    } catch (err) {
        console.error('Invite user error:', err);
        res.status(500).json({ error: 'サーバーエラーが発生しました' });
    }
});

// POST /api/groups/:id/role - Change member role (Admin only)
router.post('/:id/role', authenticateToken, async (req, res) => {
    const groupId = req.params.id;
    const { target_user_id, role } = req.body;

    if (!target_user_id || !role) {
        return res.status(400).json({ error: 'ターゲットユーザーIDと役割（role）を指定してください' });
    }

    if (!['admin', 'editor', 'viewer'].includes(role)) {
        return res.status(400).json({ error: '無効な役割です。admin, editor, viewer の中から指定してください。' });
    }

    try {
        // Check if caller is Admin
        const callerRole = await getGroupRole(groupId, req.user.id);
        if (callerRole !== 'admin') {
            return res.status(403).json({ error: 'メンバーの権限を変更する権限がありません（管理者のみ可能）' });
        }

        // Check if target is in group
        const targetRole = await getGroupRole(groupId, target_user_id);
        if (!targetRole) {
            return res.status(404).json({ error: '指定されたユーザーはこのグループに参加していません' });
        }

        // Cannot demote group owner/creator (the owner of the group record)
        const group = await query.get('SELECT owner_id FROM groups WHERE id = ?', [groupId]);
        if (parseInt(target_user_id) === group.owner_id && role !== 'admin') {
            return res.status(400).json({ error: 'グループオーナーの管理者権限を剥奪することはできません' });
        }

        await query.run(
            'UPDATE group_members SET role = ? WHERE group_id = ? AND user_id = ?',
            [role, groupId, target_user_id]
        );

        const memberIds = await getGroupMemberIds(groupId);
        sendToUsers(memberIds, {
            type: 'group_sync',
            groupId,
            message: 'グループメンバーの権限が更新されました'
        });

        res.json({ message: '権限を更新しました' });
    } catch (err) {
        console.error('Change role error:', err);
        res.status(500).json({ error: 'サーバーエラーが発生しました' });
    }
});

// DELETE /api/groups/:id/members/:userId - Leave group (self) or remove member (Admin only)
router.delete('/:id/members/:userId', authenticateToken, async (req, res) => {
    const groupId = req.params.id;
    const targetUserId = parseInt(req.params.userId);
    const isSelf = targetUserId === req.user.id;

    try {
        const callerRole = await getGroupRole(groupId, req.user.id);
        if (!callerRole) {
            return res.status(403).json({ error: 'このグループにアクセスする権限がありません' });
        }

        const targetRole = await getGroupRole(groupId, targetUserId);
        if (!targetRole) {
            return res.status(404).json({ error: '指定されたメンバーはグループに属していません' });
        }

        // Permission check
        if (!isSelf && callerRole !== 'admin') {
            return res.status(403).json({ error: 'メンバーを削除する権限がありません（管理者のみ可能）' });
        }

        // Cannot leave/remove if they are the owner, must disband instead
        const group = await query.get('SELECT owner_id FROM groups WHERE id = ?', [groupId]);
        if (targetUserId === group.owner_id) {
            return res.status(400).json({ error: 'グループオーナーは脱退できません。グループを解散してください。' });
        }

        // Retrieve member IDs before removal for broadcast
        const memberIds = await getGroupMemberIds(groupId);

        // Delete membership
        await query.run(
            'DELETE FROM group_members WHERE group_id = ? AND user_id = ?',
            [groupId, targetUserId]
        );

        // Broadcast to remaining members and the removed member
        sendToUsers([...memberIds], {
            type: 'group_sync',
            groupId,
            message: isSelf ? 'メンバーが脱退しました' : 'メンバーがグループから削除されました'
        });

        res.json({ message: isSelf ? 'グループから脱退しました' : 'グループからメンバーを削除しました' });
    } catch (err) {
        console.error('Leave/kick member error:', err);
        res.status(500).json({ error: 'サーバーエラーが発生しました' });
    }
});

// DELETE /api/groups/:id - Disband group (Admin owner only)
router.delete('/:id', authenticateToken, async (req, res) => {
    const groupId = req.params.id;

    try {
        const group = await query.get('SELECT owner_id FROM groups WHERE id = ?', [groupId]);
        if (!group) {
            return res.status(404).json({ error: 'グループが見つかりません' });
        }

        // Only group owner can disband
        if (group.owner_id !== req.user.id) {
            return res.status(403).json({ error: 'グループを解散できるのは作成者（オーナー）のみです' });
        }

        const memberIds = await getGroupMemberIds(groupId);

        // Deleting the group will cascade delete group_members, calendars, and events due to FOREIGN KEY ON DELETE CASCADE
        await query.run('DELETE FROM groups WHERE id = ?', [groupId]);

        // Broadcast disband message
        sendToUsers(memberIds, {
            type: 'group_sync',
            groupId,
            isDisbanded: true,
            message: 'グループが解散されました'
        });

        res.json({ message: 'グループを解散しました' });
    } catch (err) {
        console.error('Disband group error:', err);
        res.status(500).json({ error: 'サーバーエラーが発生しました' });
    }
});

module.exports = router;
