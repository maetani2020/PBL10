const jwt = require('jsonwebtoken');
const { query } = require('../db');

async function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: '認証トークンが必要です' });
    }

    // 1. JWT検証
    let user;
    try {
        user = jwt.verify(token, process.env.JWT_SECRET || 'super_secret_key_for_calendar_jwt');
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

        // 3. 30分無操作タイムアウト確認
        const dbUser = await query.get('SELECT last_activity_at FROM users WHERE id = ?', [user.id]);
        if (dbUser && dbUser.last_activity_at) {
            const now = new Date();
            const lastActivity = new Date(dbUser.last_activity_at);
            const diffMin = (now - lastActivity) / (1000 * 60);

            if (diffMin > 30) {
                return res.status(401).json({ error: '30分間無操作だったため自動ログアウトされました。再度ログインしてください。' });
            }
        }

        // 4. 最終操作時刻を更新
        await query.run(
            'UPDATE users SET last_activity_at = CURRENT_TIMESTAMP WHERE id = ?',
            [user.id]
        );

        req.user = user;
        req.token = token; // logout時に使用するためリクエストに付加
        next();
    } catch (dbErr) {
        console.error('Middleware database query error:', dbErr);
        // DB一時エラー時はフォールバックで通過
        req.user = user;
        req.token = token;
        next();
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
