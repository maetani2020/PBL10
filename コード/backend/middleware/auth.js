const jwt = require('jsonwebtoken');
const { query } = require('../db');
const config = require('../config');

async function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: '認証トークンが必要です' });
    }

    // 1. JWT検証
    let user;
    try {
        user = jwt.verify(token, config.jwt.secret);
    } catch (err) {
        return res.status(403).json({ error: '無効または期限切れのトークンです' });
    }

    try {
        // 2. JWTブラックリスト確認（ログアウト済みトークン）
        const blacklisted = await query.get(
            'SELECT id FROM blacklisted_tokens WHERE token = ?',
            [token]
        );
        if (blacklisted) {
            return res.status(401).json({ error: 'このトークンは無効化されています。再ログインしてください。' });
        }

        // 3. 無操作タイムアウト確認
        const dbUser = await query.get(
            'SELECT id, email, display_name, role, account_status, timeout_until, restriction_reason, last_activity_at FROM users WHERE id = ?',
            [user.id]
        );
        if (!dbUser) {
            return res.status(401).json({ error: 'ユーザーが見つかりません。再ログインしてください。' });
        }

        if (dbUser.account_status === 'banned') {
            return res.status(403).json({ error: `このアカウントはBANされています。${dbUser.restriction_reason ? `理由: ${dbUser.restriction_reason}` : ''}`.trim() });
        }

        if (dbUser.account_status === 'timeout') {
            const timeoutUntil = dbUser.timeout_until ? new Date(dbUser.timeout_until) : null;
            if (!timeoutUntil || timeoutUntil > new Date()) {
                const untilText = timeoutUntil ? timeoutUntil.toLocaleString('ja-JP') : '未定';
                return res.status(403).json({ error: `このアカウントは ${untilText} までタイムアウト中です。${dbUser.restriction_reason ? `理由: ${dbUser.restriction_reason}` : ''}`.trim() });
            }

            await query.run(
                `UPDATE users
                 SET account_status = 'active',
                     timeout_until = NULL,
                     restriction_reason = NULL,
                     restricted_at = NULL,
                     restricted_by = NULL
                 WHERE id = ?`,
                [dbUser.id]
            );
            dbUser.account_status = 'active';
            dbUser.timeout_until = null;
            dbUser.restriction_reason = null;
        }

        if (dbUser.last_activity_at) {
            const now = new Date();
            const lastActivity = new Date(dbUser.last_activity_at);
            const diffMin = (now - lastActivity) / (1000 * 60);

            if (diffMin > config.session.inactivityTimeoutMinutes) {
                return res.status(401).json({ error: `${config.session.inactivityTimeoutMinutes}分間無操作だったため自動ログアウトされました。再度ログインしてください。` });
            }
        }

        // 4. 最終操作時刻を更新
        await query.run(
            'UPDATE users SET last_activity_at = CURRENT_TIMESTAMP WHERE id = ?',
            [user.id]
        );

        req.user = {
            id: dbUser.id,
            email: dbUser.email,
            display_name: dbUser.display_name,
            role: dbUser.role
        };
        req.token = token; // logout時に使用するためリクエストに付加
        next();
    } catch (dbErr) {
        console.error('Middleware database query error:', dbErr);
        return res.status(500).json({ error: '認証状態の確認に失敗しました。時間をおいて再度お試しください。' });
    }
}

function isAdmin(req, res, next) {
    if (!req.user || req.user.role !== 'admin') {
        return res.status(403).json({ error: '管理者権限が必要です' });
    }
    next();
}

// Attach properties to preserve compatibility
authenticateToken.authenticateToken = authenticateToken;
authenticateToken.isAdmin = isAdmin;

module.exports = authenticateToken;
