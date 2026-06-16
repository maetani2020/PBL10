const jwt = require('jsonwebtoken');
const { query } = require('../db');

function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: '認証トークンが必要です' });
    }

    jwt.verify(token, process.env.JWT_SECRET || 'super_secret_key_for_calendar_jwt', async (err, user) => {
        if (err) {
            return res.status(403).json({ error: '無効または期限切れのトークンです' });
        }

        try {
            // Check 30-minute inactivity timeout
            const dbUser = await query.get('SELECT last_activity_at FROM users WHERE id = ?', [user.id]);
            if (dbUser && dbUser.last_activity_at) {
                const now = new Date();
                const lastActivity = new Date(dbUser.last_activity_at);
                const diffMin = (now - lastActivity) / (1000 * 60);

                if (diffMin > 30) {
                    return res.status(401).json({ error: '30分間無操作だったため自動ログアウトされました。再度ログインしてください。' });
                }
            }

            // Update last_activity_at
            const nowIso = new Date().toISOString();
            await query.run('UPDATE users SET last_activity_at = ? WHERE id = ?', [nowIso, user.id]);

            req.user = user;
            next();
        } catch (dbErr) {
            console.error('Middleware database query error:', dbErr);
            // Fallback: permit request if database encounters temporary issue during auth check
            req.user = user;
            next();
        }
    });
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
