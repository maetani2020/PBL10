const config = require('../config');

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function validateEmail(email) {
  const normalized = normalizeEmail(email);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized);
}

function isAllowedSchoolEmail(email) {
  return normalizeEmail(email).endsWith('@' + config.allowedEmailDomain);
}

function normalizeText(value) {
  return String(value ?? '').trim();
}

function validateDisplayName(displayName) {
  const name = normalizeText(displayName);
  return name.length > 0 && Array.from(name).length <= 10;
}

function validatePassword(password) {
  if (typeof password !== 'string') return false;
  if (password.length < 8 || password.length > 100) return false;
  return /[a-zA-Z]/.test(password) && /[0-9]/.test(password);
}

function validateTextLength(value, maxLength) {
  const text = normalizeText(value);
  return text.length > 0 && Array.from(text).length <= maxLength;
}

function parseIntegerInRange(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  const number = Number.isFinite(parsed) ? parsed : fallback;
  if (!Number.isFinite(number)) return null;
  if (number < min || number > max) return null;
  return number;
}

function parseNumberInRange(value, fallback, min, max) {
  const parsed = Number.parseFloat(value);
  const number = Number.isFinite(parsed) ? parsed : fallback;
  if (!Number.isFinite(number)) return null;
  if (number < min || number > max) return null;
  return number;
}

function isLocalDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
}

function isLocalDateTime(value) {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(String(value || ''));
}

function validateReminderMinutes(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map(item => Number.parseInt(item, 10))
    .filter(item => Number.isInteger(item) && item >= 1 && item <= 10080)
    .filter((item, index, array) => array.indexOf(item) === index)
    .slice(0, 10);
}

function fail(res, message, status = 400) {
  return res.status(status).json({ error: message });
}

module.exports = {
  normalizeEmail,
  validateEmail,
  isAllowedSchoolEmail,
  normalizeText,
  validateDisplayName,
  validatePassword,
  validateTextLength,
  parseIntegerInRange,
  parseNumberInRange,
  isLocalDate,
  isLocalDateTime,
  validateReminderMinutes,
  fail
};
