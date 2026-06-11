const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

// Ensure data directory exists
const dbDir = path.join(__dirname, 'data');
if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
}

const dbPath = path.join(dbDir, 'calendar.db');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Failed to open SQLite database:', err.message);
    } else {
        console.log('Connected to SQLite database at:', dbPath);
    }
});

// Enable foreign keys
db.run('PRAGMA foreign_keys = ON;');

// Helper functions for Promise-based operations
const query = {
    run(sql, params = []) {
        return new Promise((resolve, reject) => {
            db.run(sql, params, function (err) {
                if (err) reject(err);
                else resolve({ lastID: this.lastID, changes: this.changes });
            });
        });
    },
    get(sql, params = []) {
        return new Promise((resolve, reject) => {
            db.get(sql, params, (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
    },
    all(sql, params = []) {
        return new Promise((resolve, reject) => {
            db.all(sql, params, (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    }
};

// Initialize database schema
async function initDb() {
    try {
        // Create Users Table
        await query.run(`
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                display_name TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Create Calendars Table
        await query.run(`
            CREATE TABLE IF NOT EXISTS calendars (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                owner_id INTEGER NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `);

        // Create Calendar Shares Table
        await query.run(`
            CREATE TABLE IF NOT EXISTS calendar_shares (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                calendar_id INTEGER NOT NULL,
                user_id INTEGER NOT NULL,
                access_level TEXT NOT NULL CHECK(access_level IN ('readonly', 'readwrite')),
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(calendar_id, user_id),
                FOREIGN KEY (calendar_id) REFERENCES calendars(id) ON DELETE CASCADE,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `);

        // Create Events Table
        await query.run(`
            CREATE TABLE IF NOT EXISTS events (
                id TEXT PRIMARY KEY,
                calendar_id INTEGER NOT NULL,
                title TEXT NOT NULL,
                location TEXT,
                allday INTEGER DEFAULT 0, -- 0 = false, 1 = true
                start_time TEXT NOT NULL,
                end_time TEXT NOT NULL,
                color TEXT DEFAULT '#007AFF',
                memo TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (calendar_id) REFERENCES calendars(id) ON DELETE CASCADE
            )
        `);

        console.log('Database schema initialized successfully.');
    } catch (err) {
        console.error('Error initializing database:', err);
    }
}

module.exports = {
    db,
    query,
    initDb
};
