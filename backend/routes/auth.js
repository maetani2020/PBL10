const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query } = require('../db');
const authenticateToken = require('../middleware/auth');

// POST /api/auth/register - User Registration
router.post('/register', async (req, res) => {
    const { email, password, display_name } = req.body;

    if (!email || !password || !display_name) {
        return res.status(400).json({ error: 'メールアドレス、パスワード、表示名は必須項目です' });
    }

    try {
        // Check if user already exists
        const existingUser = await query.get('SELECT * FROM users WHERE email = ?', [email]);
        if (existingUser) {
            return res.status(400).json({ error: 'このメールアドレスは既に登録されています' });
        }

        // Hash password
        const salt = await bcrypt.genSalt(10);
        const passwordHash = await bcrypt.hash(password, salt);

        // Insert user
        const result = await query.run(
            'INSERT INTO users (email, password_hash, display_name) VALUES (?, ?, ?)',
            [email, passwordHash, display_name]
        );
        const userId = result.lastID;

        // Create default calendar for the user
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
        // Find user
        const user = await query.get('SELECT * FROM users WHERE email = ?', [email]);
        if (!user) {
            return res.status(400).json({ error: 'メールアドレスまたはパスワードが正しくありません' });
        }

        // Check password
        const isMatch = await bcrypt.compare(password, user.password_hash);
        if (!isMatch) {
            return res.status(400).json({ error: 'メールアドレスまたはパスワードが正しくありません' });
        }

        // Generate JWT
        const token = jwt.sign(
            { id: user.id, email: user.email },
            process.env.JWT_SECRET || 'super_secret_key_for_calendar_jwt',
            { expiresIn: '24h' }
        );

        res.json({
            message: 'ログインに成功しました',
            token,
            user: {
                id: user.id,
                email: user.email,
                display_name: user.display_name
            }
        });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ error: 'サーバーエラーが発生しました' });
    }
});

// GET /api/auth/me - Get Current User Info
router.get('/me', authenticateToken, async (req, res) => {
    try {
        const user = await query.get('SELECT id, email, display_name FROM users WHERE id = ?', [req.user.id]);
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
