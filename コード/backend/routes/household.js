const express = require('express');
const router = express.Router();
const { query } = require('../db');
const authenticateToken = require('../middleware/auth');

// GET /api/household/entries - Get all ledger entries (with optional filters)
router.get('/entries', authenticateToken, async (req, res) => {
    const { type, month, category } = req.query; // month format: 'YYYY-MM'
    const userId = req.user.id;

    try {
        let sql = 'SELECT * FROM household_accounts WHERE user_id = ?';
        const params = [userId];

        if (type) {
            sql += ' AND type = ?';
            params.push(type);
        }

        if (month) {
            sql += ' AND date LIKE ?';
            params.push(`${month}%`);
        }

        if (category) {
            sql += ' AND category = ?';
            params.push(category);
        }

        sql += ' ORDER BY date DESC, id DESC';

        const entries = await query.all(sql, params);
        res.json(entries);
    } catch (err) {
        console.error('Get household entries error:', err);
        res.status(500).json({ error: 'サーバーエラーが発生しました' });
    }
});

// POST /api/household/entries - Create a ledger entry
router.post('/entries', authenticateToken, async (req, res) => {
    const { type, amount, category, game_title, date, memo } = req.body;

    if (!type || !amount || !category || !date) {
        return res.status(400).json({ error: '収支タイプ、金額、カテゴリ、日付は必須項目です' });
    }

    if (!['income', 'expense'].includes(type)) {
        return res.status(400).json({ error: '無効な収支タイプです。income または expense を指定してください。' });
    }

    const amountVal = parseInt(amount);
    if (isNaN(amountVal) || amountVal <= 0) {
        return res.status(400).json({ error: '金額は正の整数で指定してください' });
    }

    try {
        const userId = req.user.id;

        const result = await query.run(
            `INSERT INTO household_accounts (user_id, type, amount, category, game_title, date, memo)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [userId, type, amountVal, category, game_title || null, date, memo || '']
        );

        res.status(201).json({
            message: '収支データを登録しました',
            entry: { id: result.lastID, user_id: userId, type, amount: amountVal, category, game_title, date, memo }
        });
    } catch (err) {
        console.error('Create household entry error:', err);
        res.status(500).json({ error: 'サーバーエラーが発生しました' });
    }
});

// PUT /api/household/entries/:id - Update a ledger entry
router.put('/entries/:id', authenticateToken, async (req, res) => {
    const entryId = req.params.id;
    const { type, amount, category, game_title, date, memo } = req.body;

    try {
        const userId = req.user.id;
        const entry = await query.get('SELECT * FROM household_accounts WHERE id = ?', [entryId]);

        if (!entry) {
            return res.status(404).json({ error: '収支データが見つかりません' });
        }

        if (entry.user_id !== userId) {
            return res.status(403).json({ error: 'このデータを変更する権限がありません' });
        }

        const finalType = type || entry.type;
        const finalAmount = amount !== undefined ? parseInt(amount) : entry.amount;
        const finalCategory = category || entry.category;
        const finalGameTitle = game_title !== undefined ? game_title : entry.game_title;
        const finalDate = date || entry.date;
        const finalMemo = memo !== undefined ? memo : entry.memo;

        if (finalAmount <= 0) {
            return res.status(400).json({ error: '金額は正の整数である必要があります' });
        }

        await query.run(
            `UPDATE household_accounts 
             SET type = ?, amount = ?, category = ?, game_title = ?, date = ?, memo = ?
             WHERE id = ?`,
            [finalType, finalAmount, finalCategory, finalGameTitle, finalDate, finalMemo, entryId]
        );

        res.json({
            message: '収支データを更新しました',
            entry: { id: entryId, user_id: userId, type: finalType, amount: finalAmount, category: finalCategory, game_title: finalGameTitle, date: finalDate, memo: finalMemo }
        });
    } catch (err) {
        console.error('Update household entry error:', err);
        res.status(500).json({ error: 'サーバーエラーが発生しました' });
    }
});

// DELETE /api/household/entries/:id - Delete a ledger entry
router.delete('/entries/:id', authenticateToken, async (req, res) => {
    const entryId = req.params.id;

    try {
        const userId = req.user.id;
        const entry = await query.get('SELECT * FROM household_accounts WHERE id = ?', [entryId]);

        if (!entry) {
            return res.status(404).json({ error: '収支データが見つかりません' });
        }

        if (entry.user_id !== userId) {
            return res.status(403).json({ error: 'このデータを削除する権限がありません' });
        }

        await query.run('DELETE FROM household_accounts WHERE id = ?', [entryId]);
        res.json({ message: '収支データを削除しました' });
    } catch (err) {
        console.error('Delete household entry error:', err);
        res.status(500).json({ error: 'サーバーエラーが発生しました' });
    }
});

// GET /api/household/daily-summary - Daily expense sum for calendar days (filtered by month 'YYYY-MM')
router.get('/daily-summary', authenticateToken, async (req, res) => {
    const { month } = req.query; // format: 'YYYY-MM'
    const userId = req.user.id;

    if (!month) {
        return res.status(400).json({ error: '対象の月（month: YYYY-MM）は必須です' });
    }

    try {
        const summary = await query.all(
            `SELECT date, SUM(amount) as total_expense 
             FROM household_accounts 
             WHERE user_id = ? AND type = 'expense' AND date LIKE ? 
             GROUP BY date 
             ORDER BY date ASC`,
            [userId, `${month}%`]
        );
        res.json(summary);
    } catch (err) {
        console.error('Get daily summary error:', err);
        res.status(500).json({ error: 'サーバーエラーが発生しました' });
    }
});

// GET /api/household/monthly-report - Income vs Expense, category details, game billing breakdowns (filtered by month 'YYYY-MM')
router.get('/monthly-report', authenticateToken, async (req, res) => {
    const { month } = req.query;
    const userId = req.user.id;

    if (!month) {
        return res.status(400).json({ error: '対象の月（month: YYYY-MM）は必須です' });
    }

    try {
        // Income Sum
        const incomeRes = await query.get(
            `SELECT SUM(amount) as total FROM household_accounts 
             WHERE user_id = ? AND type = 'income' AND date LIKE ?`,
            [userId, `${month}%`]
        );

        // Expense Sum
        const expenseRes = await query.get(
            `SELECT SUM(amount) as total FROM household_accounts 
             WHERE user_id = ? AND type = 'expense' AND date LIKE ?`,
            [userId, `${month}%`]
        );

        // Expenses grouped by category
        const categories = await query.all(
            `SELECT category, SUM(amount) as amount 
             FROM household_accounts 
             WHERE user_id = ? AND type = 'expense' AND date LIKE ? 
             GROUP BY category 
             ORDER BY amount DESC`,
            [userId, `${month}%`]
        );

        // Game billing sub-breakdown (category: 'game_billing' or linked by game_title)
        const gameBilling = await query.all(
            `SELECT game_title, SUM(amount) as amount 
             FROM household_accounts 
             WHERE user_id = ? AND type = 'expense' AND date LIKE ? AND (category = 'game_billing' OR game_title IS NOT NULL) 
             GROUP BY game_title 
             ORDER BY amount DESC`,
            [userId, `${month}%`]
        );

        res.json({
            month,
            income: incomeRes.total || 0,
            expense: expenseRes.total || 0,
            savings: (incomeRes.total || 0) - (expenseRes.total || 0),
            categories,
            gameBilling: gameBilling.filter(g => g.game_title !== null)
        });
    } catch (err) {
        console.error('Get monthly report error:', err);
        res.status(500).json({ error: 'サーバーエラーが発生しました' });
    }
});

module.exports = router;
