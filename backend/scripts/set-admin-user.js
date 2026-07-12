require('dotenv').config();

const bcrypt = require('bcryptjs');
const { initDb, query } = require('../db');
const config = require('../config');
const { normalizeEmail, isAllowedSchoolEmail, validatePassword, validateDisplayName } = require('../utils/validation');

async function main() {
  const email = normalizeEmail(process.env.ADMIN_EMAIL || process.argv[2]);
  const password = process.env.ADMIN_PASSWORD || process.argv[3];
  const displayName = String(process.env.ADMIN_DISPLAY_NAME || 'admin').trim();

  if (!email || !isAllowedSchoolEmail(email)) {
    throw new Error(`ADMIN_EMAIL must end with @${config.allowedEmailDomain}`);
  }

  if (!validatePassword(password)) {
    throw new Error('ADMIN_PASSWORD must be 8-100 chars and include letters and numbers');
  }

  if (!validateDisplayName(displayName)) {
    throw new Error('ADMIN_DISPLAY_NAME must be 1-10 chars');
  }

  await initDb();

  const passwordHash = await bcrypt.hash(password, 10);
  const existing = await query.get('SELECT id FROM users WHERE email = ?', [email]);

  let userId;
  if (existing) {
    userId = existing.id;
    await query.run(
      'UPDATE users SET password_hash = ?, display_name = ?, role = ? WHERE id = ?',
      [passwordHash, displayName, 'admin', userId]
    );
  } else {
    const result = await query.run(
      'INSERT INTO users (email, password_hash, display_name, role) VALUES (?, ?, ?, ?)',
      [email, passwordHash, displayName, 'admin']
    );
    userId = result.lastID;
  }

  const calendar = await query.get('SELECT id FROM calendars WHERE owner_id = ? LIMIT 1', [userId]);
  if (!calendar) {
    await query.run('INSERT INTO calendars (name, owner_id) VALUES (?, ?)', ['My Calendar', userId]);
  }

  console.log(`Admin user is ready: ${email}`);
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error(err.message);
    process.exit(1);
  });
