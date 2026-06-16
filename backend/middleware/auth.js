const jwt = require('jsonwebtoken');

function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: '認証トークンが必要です' });
    }

    jwt.verify(token, process.env.JWT_SECRET || 'super_secret_key_for_calendar_jwt', (err, user) => {
        if (err) {
            return res.status(403).json({ error: '無効または期限切れのトークンです' });
        }
        req.user = user;
        next();
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
