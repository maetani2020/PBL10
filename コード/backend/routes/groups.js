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
            `SELECT g.*, gm.role,
                    (SELECT COUNT(*) FROM group_members WHERE group_id = g.id) as member_count,
                    (SELECT COUNT(*) FROM group_invitations WHERE group_id = g.id AND status = 'pending') as pending_invitation_count
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

// GET /api/groups/invitations - Show invitation statuses for the current user
router.get('/invitations', authenticateToken, async (req, res) => {
    try {
        const invitations = await query.all(
            `SELECT gi.id, gi.group_id, gi.invited_user_id, gi.invited_by, gi.role,
                    gi.status, gi.created_at, gi.responded_at,
                    g.name AS group_name,
                    inviter.display_name AS inviter_name,
                    inviter.email AS inviter_email
             FROM group_invitations gi
             JOIN groups g ON gi.group_id = g.id
             LEFT JOIN users inviter ON gi.invited_by = inviter.id
             WHERE gi.invited_user_id = ?
             ORDER BY
                CASE gi.status WHEN 'pending' THEN 0 WHEN 'declined' THEN 1 ELSE 2 END,
                gi.created_at DESC`,
            [req.user.id]
        );
        res.json(invitations);
    } catch (err) {
        console.error('Get group invitations error:', err);
        res.status(500).json({ error: '招待状態の取得に失敗しました' });
    }
});

// POST /api/groups/invitations/:invitationId/respond - Accept or decline an invitation
router.post('/invitations/:invitationId/respond', authenticateToken, async (req, res) => {
    const invitationId = req.params.invitationId;
    const { status } = req.body;

    if (!['accepted', 'declined'].includes(status)) {
        return res.status(400).json({ error: '招待の返答は accepted または declined を指定してください' });
    }

    try {
        const invitation = await query.get(
            `SELECT gi.*, g.name AS group_name
             FROM group_invitations gi
             JOIN groups g ON gi.group_id = g.id
             WHERE gi.id = ? AND gi.invited_user_id = ?`,
            [invitationId, req.user.id]
        );

        if (!invitation) {
            return res.status(404).json({ error: '招待が見つかりません' });
        }

        if (invitation.status !== 'pending') {
            return res.status(400).json({ error: 'この招待には既に返答済みです' });
        }

        if (status === 'accepted') {
            await query.run(
                `INSERT INTO group_members (group_id, user_id, role)
                 VALUES (?, ?, ?)
                 ON CONFLICT (group_id, user_id) DO NOTHING`,
                [invitation.group_id, req.user.id, invitation.role || 'viewer']
            );
        }

        await query.run(
            `UPDATE group_invitations
             SET status = ?, responded_at = CURRENT_TIMESTAMP
             WHERE id = ?`,
            [status, invitationId]
        );

        const memberIds = await getGroupMemberIds(invitation.group_id);
        sendToUsers(Array.from(new Set([...memberIds, req.user.id])), {
            type: 'group_sync',
            groupId: invitation.group_id,
            message: status === 'accepted' ? 'グループ招待が承認されました' : 'グループ招待が拒否されました'
        });

        res.json({
            message: status === 'accepted'
                ? `「${invitation.group_name}」に参加しました`
                : `「${invitation.group_name}」への招待を拒否しました`
        });
    } catch (err) {
        console.error('Respond group invitation error:', err);
        res.status(500).json({ error: '招待への返答に失敗しました' });
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

// GET /api/groups/:id/invitations - Show invitation statuses for a group
router.get('/:id/invitations', authenticateToken, async (req, res) => {
    const groupId = req.params.id;

    try {
        const role = await getGroupRole(groupId, req.user.id);
        if (!role || !['admin', 'editor'].includes(role)) {
            return res.status(403).json({ error: '招待状態を確認する権限がありません' });
        }

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
            [groupId]
        );

        res.json(invitations);
    } catch (err) {
        console.error('Get group invitation status error:', err);
        res.status(500).json({ error: '招待状態の取得に失敗しました' });
    }
});

// POST /api/groups/:id/invite - Invite a user to a group using email or User ID (Admin or Editor only)
router.post('/:id/invite', authenticateToken, async (req, res) => {
    const groupId = req.params.id;
    const { user_id, email } = req.body;

    if (!user_id && !email) {
        return res.status(400).json({ error: '招待するユーザーのメールアドレスを指定してください' });
    }

    try {
        // 1. Check permissions (Admin or Editor can invite)
        const callerRole = await getGroupRole(groupId, req.user.id);
        if (!callerRole || !['admin', 'editor'].includes(callerRole)) {
            return res.status(403).json({ error: 'メンバーを招待する権限がありません（管理者または編集者のみ可能）' });
        }

        // 2. Check group size limit (max 20 accepted members + pending invites)
        const memberCountRes = await query.get('SELECT COUNT(*) as count FROM group_members WHERE group_id = ?', [groupId]);
        const pendingCountRes = await query.get(
            "SELECT COUNT(*) as count FROM group_invitations WHERE group_id = ? AND status = 'pending'",
            [groupId]
        );
        if ((memberCountRes.count + pendingCountRes.count) >= 20) {
            return res.status(400).json({ error: 'グループメンバーの上限は20名です' });
        }

        // 3. Find user by email first, keeping user_id compatibility for old clients
        let targetUser = null;
        if (email) {
            targetUser = await query.get(
                'SELECT id, email, display_name FROM users WHERE LOWER(email) = LOWER(?)',
                [String(email).trim()]
            );
        } else {
            targetUser = await query.get(
                'SELECT id, email, display_name FROM users WHERE id = ?',
                [user_id]
            );
        }

        if (!targetUser) {
            return res.status(404).json({ error: '指定されたメールアドレスのユーザーが見つかりません' });
        }

        // 4. Check if already a member
        const existingMember = await query.get(
            'SELECT id FROM group_members WHERE group_id = ? AND user_id = ?',
            [groupId, targetUser.id]
        );
        if (existingMember) {
            return res.status(400).json({ error: 'このユーザーは既にグループのメンバーです' });
        }

        // 5. Create or renew a pending invitation
        const existingInvitation = await query.get(
            'SELECT id, status FROM group_invitations WHERE group_id = ? AND invited_user_id = ?',
            [groupId, targetUser.id]
        );

        if (existingInvitation?.status === 'pending') {
            return res.status(400).json({ error: 'このユーザーは既に招待中です' });
        }

        if (existingInvitation) {
            await query.run(
                `UPDATE group_invitations
                 SET status = 'pending', role = 'viewer', invited_by = ?, created_at = CURRENT_TIMESTAMP, responded_at = NULL
                 WHERE id = ?`,
                [req.user.id, existingInvitation.id]
            );
        } else {
            await query.run(
                `INSERT INTO group_invitations (group_id, invited_user_id, invited_by, role, status)
                 VALUES (?, ?, ?, ?, 'pending')`,
                [groupId, targetUser.id, req.user.id, 'viewer']
            );
        }

        // Broadcast to current members and invited user
        const memberIds = await getGroupMemberIds(groupId);
        sendToUsers(Array.from(new Set([...memberIds, targetUser.id])), {
            type: 'group_sync',
            groupId,
            message: 'グループ招待が送信されました'
        });

        res.status(201).json({
            message: 'ユーザーへ招待を送信しました',
            status: 'pending',
            user: targetUser
        });
    } catch (err) {
        console.error('Invite member error:', err);
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
