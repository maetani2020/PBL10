const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { query } = require('../db');
const authenticateToken = require('../middleware/auth');
const config = require('../config');
const { sendMail } = require('../utils/mailer');
const {
    normalizeEmail,
    validateEmail,
    isAllowedSchoolEmail,
    normalizeText,
    validateDisplayName,
    validatePassword
} = require('../utils/validation');

// Temporary memory store for email verification codes
const emailChangeVerifications = new Map();
const loginAttempts = new Map();

function getClientIp(req) {
    const clientIp = req.ip || req.connection.remoteAddress || '';
    return clientIp.startsWith('::ffff:') ? clientIp.substring(7) : clientIp;
}

function getLoginAttemptKey(req, email) {
    return `${getClientIp(req)}:${normalizeEmail(email)}`;
}

function getLoginLockState(req, email) {
    const key = getLoginAttemptKey(req, email);
    const entry = loginAttempts.get(key);
    if (!entry) return null;

    if (entry.lockUntil && entry.lockUntil > Date.now()) {
        const remainingMinutes = Math.ceil((entry.lockUntil - Date.now()) / 60000);
        return { key, remainingMinutes };
    }

    if (entry.lockUntil && entry.lockUntil <= Date.now()) {
        loginAttempts.delete(key);
    }
    return { key };
}

function recordLoginFailure(req, email) {
    const key = getLoginAttemptKey(req, email);
    const now = Date.now();
    const windowMs = config.loginRateLimit.windowMinutes * 60 * 1000;
    const lockMs = config.loginRateLimit.lockMinutes * 60 * 1000;
    const current = loginAttempts.get(key);
    const entry = current && current.firstAttemptAt + windowMs > now
        ? current
        : { count: 0, firstAttemptAt: now, lockUntil: null };

    entry.count += 1;
    if (entry.count >= config.loginRateLimit.maxAttempts) {
        entry.lockUntil = now + lockMs;
    }
    loginAttempts.set(key, entry);
    return entry;
}

function clearLoginFailures(req, email) {
    loginAttempts.delete(getLoginAttemptKey(req, email));
}

async function logSecurityEvent(req, action, targetId = null, details = {}) {
    try {
        await query.run(
            `INSERT INTO admin_logs (admin_user_id, action, target_type, target_id, details, ip_address)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [
                details.adminUserId || null,
                action,
                'auth',
                targetId == null ? null : String(targetId),
                JSON.stringify(details),
                getClientIp(req)
            ]
        );
    } catch (err) {
        console.error('Security log write error:', err);
    }
}

function createAccessToken(user) {
    return jwt.sign(
        { id: user.id, email: user.email, role: user.role },
        config.jwt.secret,
        { expiresIn: config.jwt.expiresIn }
    );
}

function createRefreshTokenExpiry() {
    return new Date(Date.now() + config.jwt.refreshDays * 24 * 60 * 60 * 1000).toISOString();
}

async function ensureUserCanLogin(user) {
    if (user.account_status === 'banned') {
        return {
            ok: false,
            status: 403,
            message: `このアカウントはBANされています。${user.restriction_reason ? `理由: ${user.restriction_reason}` : ''}`.trim()
        };
    }

    if (user.account_status === 'timeout') {
        const timeoutUntil = user.timeout_until ? new Date(user.timeout_until) : null;
        if (!timeoutUntil || timeoutUntil > new Date()) {
            const untilText = timeoutUntil ? timeoutUntil.toLocaleString('ja-JP') : '未定';
            return {
                ok: false,
                status: 403,
                message: `このアカウントは ${untilText} までタイムアウト中です。${user.restriction_reason ? `理由: ${user.restriction_reason}` : ''}`.trim()
            };
        }

        await query.run(
            `UPDATE users
             SET account_status = 'active',
                 timeout_until = NULL,
                 restriction_reason = NULL,
                 restricted_at = NULL,
                 restricted_by = NULL
             WHERE id = ?`,
            [user.id]
        );
        user.account_status = 'active';
        user.timeout_until = null;
        user.restriction_reason = null;
    }

    return { ok: true };
}

// POST /api/auth/register - User Registration
router.post('/register', async (req, res) => {
    const { email, password, display_name } = req.body;
    const normalizedEmail = normalizeEmail(email);
    const normalizedDisplayName = normalizeText(display_name);

    if (!normalizedEmail || !password || !normalizedDisplayName) {
        return res.status(400).json({ error: 'メールアドレス、パスワード、表示名は必須項目です' });
    }

    if (!validateEmail(normalizedEmail)) {
        return res.status(400).json({ error: '有効なメールアドレスを入力してください' });
    }

    if (!isAllowedSchoolEmail(normalizedEmail)) {
        return res.status(400).json({ error: 'メールアドレスは @oic-ok.ac.jp のみ登録できます' });
    }

    if (!validateDisplayName(normalizedDisplayName)) {
        return res.status(400).json({ error: 'ユーザー名は10文字以内で入力してください' });
    }

    if (!validatePassword(password)) {
        return res.status(400).json({ error: 'パスワードは英字と数字を両方含む8文字以上、100文字以内で入力してください' });
    }

    try {
        const existingUser = await query.get('SELECT * FROM users WHERE email = ?', [normalizedEmail]);
        if (existingUser) {
            return res.status(400).json({ error: 'このメールアドレスは既に登録されています' });
        }

        const salt = await bcrypt.genSalt(10);
        const passwordHash = await bcrypt.hash(password, salt);

        const result = await query.run(
            'INSERT INTO users (email, password_hash, display_name, role) VALUES (?, ?, ?, ?)',
            [normalizedEmail, passwordHash, normalizedDisplayName, 'user']
        );
        const userId = result.lastID;

        await query.run(
            'INSERT INTO calendars (name, owner_id) VALUES (?, ?)',
            ['マイカレンダー', userId]
        );

        res.status(201).json({
            message: 'ユーザー登録が完了しました',
            user: { id: userId, email: normalizedEmail, display_name: normalizedDisplayName }
        });
    } catch (err) {
        console.error('Registration error:', err);
        res.status(500).json({ error: 'サーバーエラーが発生しました' });
    }
});

// POST /api/auth/login - User Login
router.post('/login', async (req, res) => {
    const { email, password } = req.body;
    const normalizedEmail = normalizeEmail(email);

    if (!normalizedEmail || !password) {
        return res.status(400).json({ error: 'メールアドレスとパスワードを入力してください' });
    }

    const lockState = getLoginLockState(req, normalizedEmail);
    if (lockState?.remainingMinutes) {
        return res.status(429).json({ error: `ログイン試行回数が多すぎます。${lockState.remainingMinutes}分後に再試行してください。` });
    }

    try {
        const user = await query.get('SELECT * FROM users WHERE email = ?', [normalizedEmail]);
        if (!user) {
            recordLoginFailure(req, normalizedEmail);
            return res.status(400).json({ error: 'メールアドレスまたはパスワードが正しくありません' });
        }

        const isMatch = await bcrypt.compare(password, user.password_hash);
        if (!isMatch) {
            const failure = recordLoginFailure(req, normalizedEmail);
            if (user.role === 'admin') {
                await logSecurityEvent(req, failure.lockUntil ? 'admin:login:locked' : 'admin:login:failed', user.id, {
                    adminUserId: user.id,
                    email: user.email,
                    failureCount: failure.count
                });
            }
            return res.status(400).json({ error: 'メールアドレスまたはパスワードが正しくありません' });
        }

        const loginStatus = await ensureUserCanLogin(user);
        if (!loginStatus.ok) {
            return res.status(loginStatus.status).json({ error: loginStatus.message });
        }

        clearLoginFailures(req, normalizedEmail);

        const token = createAccessToken(user);

        const refreshToken = crypto.randomBytes(40).toString('hex');
        const expiresAt = createRefreshTokenExpiry();

        await query.run(
            'INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES (?, ?, ?)',
            [user.id, refreshToken, expiresAt]
        );

        // Reset inactivity timer on login
        await query.run(
            'UPDATE users SET last_activity_at = CURRENT_TIMESTAMP WHERE id = ?',
            [user.id]
        );

        if (user.role === 'admin') {
            await logSecurityEvent(req, 'admin:login:success', user.id, {
                adminUserId: user.id,
                email: user.email
            });
        }

        res.json({
            message: 'ログインに成功しました',
            token,
            refreshToken,
            user: {
                id: user.id,
                email: user.email,
                display_name: user.display_name,
                role: user.role
            }
        });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ error: 'サーバーエラーが発生しました' });
    }
});

// POST /api/auth/google - Mock Google OAuth Login
router.post('/google-login', async (req, res) => {
    const { email, display_name } = req.body;
    const normalizedEmail = normalizeEmail(email);
    const normalizedDisplayName = normalizeText(display_name);

    if (!normalizedEmail || !normalizedDisplayName) {
        return res.status(400).json({ error: 'Googleログインに必要な情報が不足しています' });
    }

    if (!validateEmail(normalizedEmail) || !isAllowedSchoolEmail(normalizedEmail)) {
        return res.status(400).json({ error: 'Googleログインは @oic-ok.ac.jp のメールアドレスのみ利用できます' });
    }

    if (!validateDisplayName(normalizedDisplayName)) {
        return res.status(400).json({ error: 'ユーザー名は10文字以内で入力してください' });
    }

    try {
        let user = await query.get('SELECT * FROM users WHERE email = ?', [normalizedEmail]);
        
        if (!user) {
            // Auto-register google user
            const dummyPassword = crypto.randomBytes(16).toString('hex');
            const salt = await bcrypt.genSalt(10);
            const passwordHash = await bcrypt.hash(dummyPassword, salt);

            const result = await query.run(
                'INSERT INTO users (email, password_hash, display_name, role) VALUES (?, ?, ?, ?)',
                [normalizedEmail, passwordHash, normalizedDisplayName, 'user']
            );
            const userId = result.lastID;

            await query.run(
                'INSERT INTO calendars (name, owner_id) VALUES (?, ?)',
                ['マイカレンダー', userId]
            );

            user = { id: userId, email: normalizedEmail, display_name: normalizedDisplayName, role: 'user' };
        }

        const loginStatus = await ensureUserCanLogin(user);
        if (!loginStatus.ok) {
            return res.status(loginStatus.status).json({ error: loginStatus.message });
        }

        const token = createAccessToken(user);

        const refreshToken = crypto.randomBytes(40).toString('hex');
        const expiresAt = createRefreshTokenExpiry();

        await query.run(
            'INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES (?, ?, ?)',
            [user.id, refreshToken, expiresAt]
        );

        // Reset inactivity timer on Google login
        await query.run(
            'UPDATE users SET last_activity_at = CURRENT_TIMESTAMP WHERE id = ?',
            [user.id]
        );

        res.json({
            message: 'Googleログインに成功しました',
            token,
            refreshToken,
            user: {
                id: user.id,
                email: user.email,
                display_name: user.display_name,
                role: user.role
            }
        });
    } catch (err) {
        console.error('Google login error:', err);
        res.status(500).json({ error: 'サーバーエラーが発生しました' });
    }
});

// POST /api/auth/refresh - Refresh Access Token
router.post('/refresh', async (req, res) => {
    const { refreshToken } = req.body;

    if (!refreshToken) {
        return res.status(400).json({ error: 'リフレッシュトークンが必要です' });
    }

    try {
        const storedToken = await query.get('SELECT * FROM refresh_tokens WHERE token = ?', [refreshToken]);
        if (!storedToken) {
            return res.status(401).json({ error: '無効なリフレッシュトークンです' });
        }

        if (new Date(storedToken.expires_at) < new Date()) {
            await query.run('DELETE FROM refresh_tokens WHERE token = ?', [refreshToken]);
            return res.status(401).json({ error: '期限切れのリフレッシュトークンです' });
        }

        const user = await query.get('SELECT * FROM users WHERE id = ?', [storedToken.user_id]);
        if (!user) {
            return res.status(401).json({ error: 'ユーザーが見つかりません' });
        }

        const loginStatus = await ensureUserCanLogin(user);
        if (!loginStatus.ok) {
            await query.run('DELETE FROM refresh_tokens WHERE token = ?', [refreshToken]);
            return res.status(loginStatus.status).json({ error: loginStatus.message });
        }

        const token = createAccessToken(user);

        res.json({ token });
    } catch (err) {
        console.error('Refresh token error:', err);
        res.status(500).json({ error: 'サーバーエラーが発生しました' });
    }
});

// POST /api/auth/logout - Invalidate Refresh Token & Blacklist Access Token
router.post('/logout', authenticateToken, async (req, res) => {
    const { refreshToken } = req.body;

    try {
        // 1. リフレッシュトークンを削除（提供されている場合）
        if (refreshToken) {
            await query.run('DELETE FROM refresh_tokens WHERE token = ?', [refreshToken]);
        }

        // 2. 現在のアクセストークンをブラックリストに登録
        const token = req.token;
        if (token) {
            // JWTのペイロードから有効期限を取得してブラックリストに記録
            const decoded = jwt.decode(token);
            const expiresAt = decoded?.exp
                ? new Date(decoded.exp * 1000).toISOString()
                : new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

            await query.run(
                'INSERT INTO blacklisted_tokens (token, expires_at) VALUES (?, ?) ON CONFLICT (token) DO NOTHING',
                [token, expiresAt]
            );

            // 3. 古い期限切れブラックリストエントリを定期クリーンアップ
            await query.run('DELETE FROM blacklisted_tokens WHERE expires_at < ?', [new Date().toISOString()]);
        }

        res.json({ message: 'ログアウトしました' });
    } catch (err) {
        console.error('Logout error:', err);
        res.status(500).json({ error: 'サーバーエラーが発生しました' });
    }
});


// POST /api/auth/password-reset-request - Request Password Reset Link
router.post('/password-reset-request', async (req, res) => {
    const { email } = req.body;
    const normalizedEmail = normalizeEmail(email);

    if (!normalizedEmail) {
        return res.status(400).json({ error: 'メールアドレスを入力してください' });
    }

    if (!validateEmail(normalizedEmail) || !isAllowedSchoolEmail(normalizedEmail)) {
        return res.status(400).json({ error: '登録済みの @oic-ok.ac.jp メールアドレスを入力してください' });
    }

    try {
        const user = await query.get('SELECT * FROM users WHERE email = ?', [normalizedEmail]);
        if (!user) {
            // For security, don't reveal if user exists or not, but for PBL demo it's fine.
            return res.status(404).json({ error: 'このメールアドレスは登録されていません' });
        }

        const token = crypto.randomBytes(20).toString('hex');
        const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour

        // Clear existing reset tokens for this email
        await query.run('DELETE FROM password_resets WHERE email = ?', [normalizedEmail]);

        await query.run(
            'INSERT INTO password_resets (email, token, expires_at) VALUES (?, ?, ?)',
            [normalizedEmail, token, expiresAt]
        );

        await sendMail({
            to: normalizedEmail,
            subject: 'パスワードリセットのリクエスト',
            text: [
                '以下のリンクからパスワードの再設定を行ってください。',
                '有効期限は1時間です。',
                `${config.appUrl}/reset-password?token=${token}`
            ].join('\n')
        });

        res.json({ message: 'パスワード再設定用のメールを送信しました' });
    } catch (err) {
        console.error('Password reset request error:', err);
        res.status(500).json({ error: 'サーバーエラーが発生しました' });
    }
});

// POST /api/auth/password-reset - Confirm Password Reset
router.post('/password-reset', async (req, res) => {
    const { token, new_password } = req.body;

    if (!token || !new_password) {
        return res.status(400).json({ error: 'トークンと新しいパスワードは必須項目です' });
    }

    if (!validatePassword(new_password)) {
        return res.status(400).json({ error: 'パスワードは英字と数字を両方含む8文字以上、100文字以内で入力してください' });
    }

    try {
        const resetInfo = await query.get('SELECT * FROM password_resets WHERE token = ?', [token]);
        if (!resetInfo) {
            return res.status(400).json({ error: '無効なトークンです' });
        }

        if (new Date(resetInfo.expires_at) < new Date()) {
            await query.run('DELETE FROM password_resets WHERE token = ?', [token]);
            return res.status(400).json({ error: '有効期限切れのトークンです' });
        }

        const salt = await bcrypt.genSalt(10);
        const passwordHash = await bcrypt.hash(new_password, salt);

        await query.run('UPDATE users SET password_hash = ? WHERE email = ?', [passwordHash, resetInfo.email]);
        await query.run('DELETE FROM password_resets WHERE email = ?', [resetInfo.email]);

        res.json({ message: 'パスワードの再設定が完了しました' });
    } catch (err) {
        console.error('Password reset execute error:', err);
        res.status(500).json({ error: 'サーバーエラーが発生しました' });
    }
});

// POST /api/auth/change-email-request - Request email change (requires JWT)
router.post('/change-email-request', authenticateToken, async (req, res) => {
    const { new_email } = req.body;
    const normalizedNewEmail = normalizeEmail(new_email);

    if (!normalizedNewEmail || !validateEmail(normalizedNewEmail)) {
        return res.status(400).json({ error: '有効な新規メールアドレスを指定してください' });
    }

    if (!isAllowedSchoolEmail(normalizedNewEmail)) {
        return res.status(400).json({ error: 'メールアドレスは @oic-ok.ac.jp のみ変更できます' });
    }

    try {
        const existingUser = await query.get('SELECT * FROM users WHERE email = ?', [normalizedNewEmail]);
        if (existingUser) {
            return res.status(400).json({ error: 'このメールアドレスは既に別のユーザーに使用されています' });
        }

        // Generate verification code
        const code = Math.floor(100000 + Math.random() * 900000).toString();
        emailChangeVerifications.set(req.user.id, { normalizedNewEmail, code, expires: Date.now() + 15 * 60 * 1000 });

        await sendMail({
            to: req.user.email,
            subject: 'メールアドレス変更確認コード',
            text: [
                `メールアドレスを ${normalizedNewEmail} へ変更するための確認コードです。`,
                '有効期限は15分です。',
                `確認コード: ${code}`
            ].join('\n')
        });

        res.json({ message: '現在のメールアドレスに変更用確認コードを送信しました' });
    } catch (err) {
        console.error('Email change request error:', err);
        res.status(500).json({ error: 'サーバーエラーが発生しました' });
    }
});

// POST /api/auth/change-email-confirm - Confirm email change (requires JWT)
router.post('/change-email-confirm', authenticateToken, async (req, res) => {
    const { code } = req.body;

    if (!code) {
        return res.status(400).json({ error: '確認コードを入力してください' });
    }

    const verification = emailChangeVerifications.get(req.user.id);
    if (!verification) {
        return res.status(400).json({ error: 'メールアドレス変更リクエストが見つかりません。再請求してください。' });
    }

    if (verification.expires < Date.now()) {
        emailChangeVerifications.delete(req.user.id);
        return res.status(400).json({ error: '期限切れの確認コードです。再度手続きを行ってください。' });
    }

    if (verification.code !== code.trim()) {
        return res.status(400).json({ error: '確認コードが正しくありません' });
    }

    try {
        await query.run('UPDATE users SET email = ? WHERE id = ?', [verification.normalizedNewEmail, req.user.id]);
        emailChangeVerifications.delete(req.user.id);

        res.json({ message: 'メールアドレスを変更しました。次回のログインから新しいメールアドレスを使用してください。' });
    } catch (err) {
        console.error('Email change confirm error:', err);
        res.status(500).json({ error: 'サーバーエラーが発生しました' });
    }
});

// POST /api/auth/change-password - Change password (requires JWT)
router.post('/change-password', authenticateToken, async (req, res) => {
    const { current_password, new_password } = req.body;

    if (!current_password || !new_password) {
        return res.status(400).json({ error: '現在のパスワードと新しいパスワードを入力してください' });
    }

    if (!validatePassword(new_password)) {
        return res.status(400).json({ error: 'パスワードは英字と数字を両方含む8文字以上、100文字以内で入力してください' });
    }

    try {
        const user = await query.get('SELECT password_hash FROM users WHERE id = ?', [req.user.id]);
        const isMatch = await bcrypt.compare(current_password, user.password_hash);
        if (!isMatch) {
            return res.status(400).json({ error: '現在のパスワードが正しくありません' });
        }

        const salt = await bcrypt.genSalt(10);
        const passwordHash = await bcrypt.hash(new_password, salt);

        await query.run('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, req.user.id]);
        res.json({ message: 'パスワードを変更しました' });
    } catch (err) {
        console.error('Password change error:', err);
        res.status(500).json({ error: 'サーバーエラーが発生しました' });
    }
});

// GET /api/auth/me - Get Current User Info
router.get('/me', authenticateToken, async (req, res) => {
    try {
        const user = await query.get(
            'SELECT id, email, display_name, max_hp, max_motivation, recovery_rate, warning_threshold, role FROM users WHERE id = ?',
            [req.user.id]
        );
        if (!user) {
            return res.status(404).json({ error: 'ユーザーが見つかりません' });
        }
        res.json(user);
    } catch (err) {
        console.error('Get user info error:', err);
        res.status(500).json({ error: 'サーバーエラーが発生しました' });
    }
});

module.exports = router;
