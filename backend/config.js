const crypto = require('crypto');

function intEnv(name, fallback, min = null, max = null) {
  const raw = process.env[name];
  const parsed = Number.parseInt(raw, 10);
  let value = Number.isFinite(parsed) ? parsed : fallback;
  if (min !== null) value = Math.max(min, value);
  if (max !== null) value = Math.min(max, value);
  return value;
}

function listEnv(name, fallback = []) {
  const raw = process.env[name];
  if (!raw) return fallback;
  return raw.split(',').map(item => item.trim()).filter(Boolean);
}

const generatedJwtSecret = crypto.randomBytes(32).toString('hex');
const jwtSecret = process.env.JWT_SECRET || generatedJwtSecret;

if (!process.env.JWT_SECRET) {
  console.warn('[security] JWT_SECRET is not set. A temporary secret was generated for this process.');
}

const appUrl = (process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, '');

module.exports = {
  appUrl,
  port: intEnv('PORT', 3000, 1, 65535),
  host: process.env.HOST || '0.0.0.0',
  allowedEmailDomain: process.env.ALLOWED_EMAIL_DOMAIN || 'oic-ok.ac.jp',
  jwt: {
    secret: jwtSecret,
    expiresIn: process.env.JWT_EXPIRES_IN || '2h',
    refreshDays: intEnv('REFRESH_TOKEN_DAYS', 30, 1, 90)
  },
  session: {
    inactivityTimeoutMinutes: intEnv('INACTIVITY_TIMEOUT_MINUTES', 30, 5, 1440)
  },
  loginRateLimit: {
    maxAttempts: intEnv('LOGIN_MAX_ATTEMPTS', 5, 1, 50),
    windowMinutes: intEnv('LOGIN_WINDOW_MINUTES', 15, 1, 1440),
    lockMinutes: intEnv('LOGIN_LOCK_MINUTES', 15, 1, 1440)
  },
  cors: {
    origins: listEnv('CORS_ORIGIN', ['*'])
  },
  mail: {
    mode: process.env.MAIL_MODE || 'mock',
    host: process.env.SMTP_HOST || '',
    port: intEnv('SMTP_PORT', 587, 1, 65535),
    secure: String(process.env.SMTP_SECURE || '').toLowerCase() === 'true',
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.MAIL_FROM || process.env.SMTP_USER || 'Shared Calendar <no-reply@shared-calendar.local>'
  },
  webPush: {
    publicKey: process.env.VAPID_PUBLIC_KEY || '',
    privateKey: process.env.VAPID_PRIVATE_KEY || '',
    subject: process.env.VAPID_SUBJECT || `mailto:admin@${process.env.ALLOWED_EMAIL_DOMAIN || 'oic-ok.ac.jp'}`
  },
  notificationScheduler: {
    intervalMs: intEnv('NOTIFICATION_SCAN_INTERVAL_MS', 60000, 10000, 3600000)
  },
  admin: {
    ipWhitelist: listEnv('ADMIN_IP_WHITELIST')
  }
};
