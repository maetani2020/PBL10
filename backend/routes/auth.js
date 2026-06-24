const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { query } = require('../db');
const authenticateToken = require('../middleware/auth');

// Temporary memory store for email verification codes
const emailChangeVerifications = new Map();

function validatePassword(password) {
    if (password.length < 8) return false;
    const hasLetter = /[a-zA-Z]/.test(password);
    const hasNumber = /[0-9]/.test(password);
    return hasLetter && hasNumber;
}

function validateEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

// POST /api/auth/register - User Registration
router.post('/register', async (req, res) => {
    const { email, password, display_name } = req.body;

    if (!email || !password || !display_name) {
        return res.status(400).json({ error: 'メールアドレス、パスワード、表示名は必須項目です' });
    }

    if (!validateEmail(email)) {
        return res.status(400).json({ error: '有効なメールアドレスを入力してください' });
    }

    if (!validatePassword(password)) {
        return res.status(400).json({ error: 'パスワードは英字と数字を両方含む8文字以上である必要があります' });
    }

    try {
        const existingUser = await query.get('SELECT * FROM users WHERE email = ?', [email]);
        if (existingUser) {
            return res.status(400).json({ error: 'このメールアドレスは既に登録されています' });
        }

        const salt = await bcrypt.genSalt(10);
        const passwordHash = await bcrypt.hash(password, salt);

        const result = await query.run(
            'INSERT INTO users (email, password_hash, display_name, role) VALUES (?, ?, ?, ?)',
            [email, passwordHash, display_name, 'user']
        );
        const userId = result.lastID;

        // Create default calendar
        await query.run(
            'INSERT INTO calendars (name, owner_id) VALUES (?, ?)',
            ['マイカレンダー', userId]
        );

        res.status(201).json({
            message: 'ユーザー登録が完了しました',
            user: { id: userId, email, display_name }
        });
    } catch (err) {
        console.error('Registration error:', err);
        res.status(500).json({ error: 'サーバーエラーが発生しました' });
    }
});

// POST /api/auth/login - User Login
router.post('/login', async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ error: 'メールアドレスとパスワードを入力してください' });
    }

    try {
        const user = await query.get('SELECT * FROM users WHERE email = ?', [email]);
        if (!user) {
            return res.status(400).json({ error: 'メールアドレスまたはパスワードが正しくありません' });
        }

        const isMatch = await bcrypt.compare(password, user.password_hash);
        if (!isMatch) {
            return res.status(400).json({ error: 'メールアドレスまたはパスワードが正しくありません' });
        }

        // Generate Access Token (24h)
        const token = jwt.sign(
            { id: user.id, email: user.email, role: user.role },
            process.env.JWT_SECRET || 'super_secret_key_for_calendar_jwt',
            { expiresIn: '24h' }
        );

        // Generate Refresh Token (30d)
        const refreshToken = crypto.randomBytes(40).toString('hex');
        const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

        await query.run(
            'INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES (?, ?, ?)',
            [user.id, refreshToken, expiresAt]
        );

        // Reset inactivity timer on login
        await query.run(
            'UPDATE users SET last_activity_at = ? WHERE id = ?',
            [new Date().toISOString(), user.id]
        );

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

    if (!email || !display_name) {
        return res.status(400).json({ error: 'Googleログインに必要な情報が不足しています' });
    }

    try {
        let user = await query.get('SELECT * FROM users WHERE email = ?', [email]);
        
        if (!user) {
            // Auto-register google user
            const dummyPassword = crypto.randomBytes(16).toString('hex');
            const salt = await bcrypt.genSalt(10);
            const passwordHash = await bcrypt.hash(dummyPassword, salt);

            const result = await query.run(
                'INSERT INTO users (email, password_hash, display_name, role) VALUES (?, ?, ?, ?)',
                [email, passwordHash, display_name, 'user']
            );
            const userId = result.lastID;

            await query.run(
                'INSERT INTO calendars (name, owner_id) VALUES (?, ?)',
                ['マイカレンダー', userId]
            );

            user = { id: userId, email, display_name, role: 'user' };
        }

        const token = jwt.sign(
            { id: user.id, email: user.email, role: user.role },
            process.env.JWT_SECRET || 'super_secret_key_for_calendar_jwt',
            { expiresIn: '24h' }
        );

        const refreshToken = crypto.randomBytes(40).toString('hex');
        const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

        await query.run(
            'INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES (?, ?, ?)',
            [user.id, refreshToken, expiresAt]
        );

        // Reset inactivity timer on Google login
        await query.run(
            'UPDATE users SET last_activity_at = ? WHERE id = ?',
            [new Date().toISOString(), user.id]
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

        const token = jwt.sign(
            { id: user.id, email: user.email, role: user.role },
            process.env.JWT_SECRET || 'super_secret_key_for_calendar_jwt',
            { expiresIn: '24h' }
        );

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

    if (!email) {
        return res.status(400).json({ error: 'メールアドレスを入力してください' });
    }

    try {
        const user = await query.get('SELECT * FROM users WHERE email = ?', [email]);
        if (!user) {
            // For security, don't reveal if user exists or not, but for PBL demo it's fine.
            return res.status(404).json({ error: 'このメールアドレスは登録されていません' });
        }

        const token = crypto.randomBytes(20).toString('hex');
        const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour

        // Clear existing reset tokens for this email
        await query.run('DELETE FROM password_resets WHERE email = ?', [email]);

        await query.run(
            'INSERT INTO password_resets (email, token, expires_at) VALUES (?, ?, ?)',
            [email, token, expiresAt]
        );

        // Simulation: log email contents to console
        console.log(`\n--- [MOCK MAIL SERVER] ---`);
        console.log(`To: ${email}`);
        console.log(`Subject: パスワードリセットのリクエスト`);
        console.log(`Content: 以下のリンクからパスワードの再設定を行ってください（有効期限: 1時間）。`);
        console.log(`Link: http://localhost:3000/reset-password?token=${token}`);
        console.log(`-------------------------\n`);

        res.json({ message: 'パスワード再設定用のメールを送信しました（開発環境のためコンソールに出力されました）' });
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
        return res.status(400).json({ error: 'パスワードは英字と数字を両方含む8文字以上である必要があります' });
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

    if (!new_email || !validateEmail(new_email)) {
        return res.status(400).json({ error: '有効な新規メールアドレスを指定してください' });
    }

    try {
        const existingUser = await query.get('SELECT * FROM users WHERE email = ?', [new_email]);
        if (existingUser) {
            return res.status(400).json({ error: 'このメールアドレスは既に別のユーザーに使用されています' });
        }

        // Generate verification code
        const code = Math.floor(100000 + Math.random() * 900000).toString();
        emailChangeVerifications.set(req.user.id, { new_email, code, expires: Date.now() + 15 * 60 * 1000 });

        console.log(`\n--- [MOCK MAIL SERVER] ---`);
        console.log(`To: ${req.user.email} (現在のメールアドレス)`);
        console.log(`Subject: メールアドレス変更確認コード`);
        console.log(`Content: メールアドレスを ${new_email} へ変更するための確認コードです（有効期限: 15分）。`);
        console.log(`Code: ${code}`);
        console.log(`-------------------------\n`);

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
        await query.run('UPDATE users SET email = ? WHERE id = ?', [verification.new_email, req.user.id]);
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
        return res.status(400).json({ error: '新規パスワードは英字と数字を両方含む8文字以上である必要があります' });
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
