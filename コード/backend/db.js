const { Pool } = require('pg');

const poolConfig = process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL }
    : {
        user: process.env.PGUSER || 'postgres',
        host: process.env.PGHOST || 'localhost',
        database: process.env.PGDATABASE || 'calendar',
        password: process.env.PGPASSWORD || 'postgres',
        port: parseInt(process.env.PGPORT || '5432'),
    };

// SSL option for cloud deployment (Render, Heroku, AWS RDS, GCP)
if (process.env.PGSSL === 'true' || (process.env.DATABASE_URL && !process.env.DATABASE_URL.includes('localhost'))) {
    poolConfig.ssl = { rejectUnauthorized: false };
}

const pgPool = new Pool(poolConfig);
console.log('Database connected: PostgreSQL');

// Translate SQLite "?" parameters to Postgres "$1, $2..." parameters dynamically
function convertSqlPlaceholders(sql) {
    let index = 1;
    return sql.replace(/\?/g, () => `$${index++}`);
}

// Helper functions for Promise-based operations
const query = {
    async run(sql, params = []) {
        const pgSql = convertSqlPlaceholders(sql);
        let executeSql = pgSql;
        const isInsert = pgSql.trim().toUpperCase().startsWith('INSERT');
        if (isInsert && !pgSql.toUpperCase().includes('RETURNING')) {
            executeSql = pgSql.trim().replace(/;?$/, ' RETURNING id');
        }
        const res = await pgPool.query(executeSql, params);
        const lastID = res.rows[0] ? res.rows[0].id : null;
        return { lastID, changes: res.rowCount };
    },
    async get(sql, params = []) {
        const pgSql = convertSqlPlaceholders(sql);
        const res = await pgPool.query(pgSql, params);
        return res.rows[0];
    },
    async all(sql, params = []) {
        const pgSql = convertSqlPlaceholders(sql);
        const res = await pgPool.query(pgSql, params);
        return res.rows;
    }
};

// Auto-convert SQLite syntax to Postgres syntax for table creations
async function createTable(sql) {
    const executeSql = sql
        .replace(/INTEGER PRIMARY KEY AUTOINCREMENT/gi, 'SERIAL PRIMARY KEY')
        .replace(/DATETIME/gi, 'TIMESTAMP');
    await query.run(executeSql);
}

// Column migration helper to avoid breaking existing tables
async function addColumnIfNotExists(tableName, columnName, columnDefinition) {
    try {
        const res = await query.get(
            `SELECT 1 FROM information_schema.columns 
             WHERE table_name = ? AND column_name = ?`,
            [tableName.toLowerCase(), columnName.toLowerCase()]
        );
        const exists = !!res;

        if (!exists) {
            console.log(`Migrating DB: Adding column '${columnName}' to table '${tableName}'...`);
            await query.run(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDefinition}`);
        }
    } catch (err) {
        console.error(`Failed to migrate column '${columnName}' in table '${tableName}':`, err.message);
    }
}

// Initialize database schema
async function initDb() {
    try {
        // 1. Create Users Table
        await createTable(`
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                display_name TEXT NOT NULL,
                max_hp INTEGER DEFAULT 100,
                max_motivation INTEGER DEFAULT 100,
                recovery_rate REAL DEFAULT 1.0,
                warning_threshold INTEGER DEFAULT 20,
                role TEXT DEFAULT 'user',
                notification_settings TEXT DEFAULT '{"events":true,"tasks":true,"game":true,"email":true}',
                last_activity_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await addColumnIfNotExists('users', 'max_hp', 'INTEGER DEFAULT 100');
        await addColumnIfNotExists('users', 'max_motivation', 'INTEGER DEFAULT 100');
        await addColumnIfNotExists('users', 'recovery_rate', 'REAL DEFAULT 1.0');
        await addColumnIfNotExists('users', 'warning_threshold', 'INTEGER DEFAULT 20');
        await addColumnIfNotExists('users', 'role', "TEXT DEFAULT 'user'");
        await addColumnIfNotExists('users', 'notification_settings', "TEXT DEFAULT '{\"events\":true,\"tasks\":true,\"game\":true,\"email\":true}'");
        await addColumnIfNotExists('users', 'last_activity_at', 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP');

        // 2. Create Refresh Tokens Table
        await createTable(`
            CREATE TABLE IF NOT EXISTS refresh_tokens (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                token TEXT UNIQUE NOT NULL,
                expires_at DATETIME NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `);

        // 3. Create Password Resets Table
        await createTable(`
            CREATE TABLE IF NOT EXISTS password_resets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT NOT NULL,
                token TEXT UNIQUE NOT NULL,
                expires_at DATETIME NOT NULL
            )
        `);

        // 4. Create Groups Table
        await createTable(`
            CREATE TABLE IF NOT EXISTS groups (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                owner_id INTEGER NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `);

        // 5. Create Group Members Table
        await createTable(`
            CREATE TABLE IF NOT EXISTS group_members (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                group_id INTEGER NOT NULL,
                user_id INTEGER NOT NULL,
                role TEXT NOT NULL CHECK(role IN ('admin', 'editor', 'viewer')),
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(group_id, user_id),
                FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `);

        // 6. Create Group Invitations Table
        await createTable(`
            CREATE TABLE IF NOT EXISTS group_invitations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                group_id INTEGER NOT NULL,
                invited_user_id INTEGER NOT NULL,
                invited_by INTEGER,
                role TEXT NOT NULL DEFAULT 'viewer' CHECK(role IN ('admin', 'editor', 'viewer')),
                status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'accepted', 'declined')),
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                responded_at DATETIME DEFAULT NULL,
                UNIQUE(group_id, invited_user_id),
                FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
                FOREIGN KEY (invited_user_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (invited_by) REFERENCES users(id) ON DELETE SET NULL
            )
        `);

        // 7. Create Calendars Table
        await createTable(`
            CREATE TABLE IF NOT EXISTS calendars (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                owner_id INTEGER NULL,
                group_id INTEGER NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE
            )
        `);
        await addColumnIfNotExists('calendars', 'group_id', 'INTEGER DEFAULT NULL');

        // 8. Create Calendar Shares Table
        await createTable(`
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

        // 9. Create Events Table
        await createTable(`
            CREATE TABLE IF NOT EXISTS events (
                id TEXT PRIMARY KEY,
                calendar_id INTEGER NOT NULL,
                creator_id INTEGER,
                title TEXT NOT NULL,
                location TEXT,
                allday INTEGER DEFAULT 0, -- 0 = false, 1 = true
                start_time TEXT NOT NULL,
                end_time TEXT NOT NULL,
                color TEXT DEFAULT '#007AFF',
                memo TEXT,
                visibility TEXT DEFAULT 'group' CHECK(visibility IN ('public', 'group', 'private')),
                hp_consumption INTEGER DEFAULT 0,
                motivation_consumption INTEGER DEFAULT 0,
                recurrence TEXT DEFAULT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (calendar_id) REFERENCES calendars(id) ON DELETE CASCADE,
                FOREIGN KEY (creator_id) REFERENCES users(id) ON DELETE SET NULL
            )
        `);
        await addColumnIfNotExists('events', 'creator_id', 'INTEGER DEFAULT NULL');
        await addColumnIfNotExists('events', 'visibility', "TEXT DEFAULT 'group'");
        await addColumnIfNotExists('events', 'hp_consumption', 'INTEGER DEFAULT 0');
        await addColumnIfNotExists('events', 'motivation_consumption', 'INTEGER DEFAULT 0');
        await addColumnIfNotExists('events', 'recurrence', 'TEXT DEFAULT NULL');
        await addColumnIfNotExists('events', 'event_type', "TEXT DEFAULT 'event'");
        await addColumnIfNotExists('events', 'reminder_minutes', "TEXT DEFAULT '[]'");
        await addColumnIfNotExists('events', 'notify_at_start', 'INTEGER DEFAULT 1');
        await addColumnIfNotExists('events', 'task_deadline_notify', 'INTEGER DEFAULT 1');
        await addColumnIfNotExists('events', 'mail_reminder_enabled', 'INTEGER DEFAULT 0');
        await addColumnIfNotExists('events', 'mail_to', 'TEXT DEFAULT NULL');
        await addColumnIfNotExists('events', 'mail_subject', 'TEXT DEFAULT NULL');
        await addColumnIfNotExists('events', 'mail_remind_at', 'TEXT DEFAULT NULL');
        await addColumnIfNotExists('events', 'mail_sent', 'INTEGER DEFAULT 0');
        await addColumnIfNotExists('events', 'deleted_at', 'TIMESTAMP DEFAULT NULL');
        await addColumnIfNotExists('events', 'deleted_by', 'INTEGER DEFAULT NULL');

        // 10. Create Tasks Table
        await createTable(`
            CREATE TABLE IF NOT EXISTS tasks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                group_id INTEGER DEFAULT NULL,
                title TEXT NOT NULL,
                due_date TEXT,
                completed INTEGER DEFAULT 0, -- 0 = false, 1 = true
                hp_consumption INTEGER DEFAULT 0,
                motivation_consumption INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE
            )
        `);

        // 11. Create Household Accounts Table
        await createTable(`
            CREATE TABLE IF NOT EXISTS household_accounts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                type TEXT NOT NULL CHECK(type IN ('income', 'expense')),
                amount INTEGER NOT NULL,
                category TEXT NOT NULL,
                game_title TEXT DEFAULT NULL,
                date TEXT NOT NULL,
                memo TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `);

        // 12. Create Push Subscriptions Table
        await createTable(`
            CREATE TABLE IF NOT EXISTS push_subscriptions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                subscription_json TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(user_id, subscription_json),
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `);

        // 13. Create Notifications Table
        await createTable(`
            CREATE TABLE IF NOT EXISTS notifications (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                title TEXT NOT NULL,
                message TEXT NOT NULL,
                status TEXT DEFAULT 'unread' CHECK(status IN ('unread', 'read')),
                notify_at TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `);

        // 14. Create Notification History Table
        await createTable(`
            CREATE TABLE IF NOT EXISTS notification_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                title TEXT NOT NULL,
                message TEXT NOT NULL,
                sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                type TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `);

        // 15. Create Admin Logs Table
        await createTable(`
            CREATE TABLE IF NOT EXISTS admin_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                admin_user_id INTEGER,
                action TEXT NOT NULL,
                target_type TEXT,
                target_id TEXT,
                details TEXT,
                ip_address TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (admin_user_id) REFERENCES users(id) ON DELETE SET NULL
            )
        `);

        // 16. Create JWT Blacklist Table (for logout token invalidation)
        await createTable(`
            CREATE TABLE IF NOT EXISTS blacklisted_tokens (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                token TEXT UNIQUE NOT NULL,
                expires_at DATETIME NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        console.log('Database schema initialized and migrated successfully.');
    } catch (err) {
        console.error('Error initializing database:', err);
    }
}


module.exports = {
    query,
    initDb,
    isPostgres: true
};
