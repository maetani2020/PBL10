process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret_1234567890';
process.env.ALLOWED_EMAIL_DOMAIN = 'oic-ok.ac.jp';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeEmail,
  validateEmail,
  isAllowedSchoolEmail,
  validateDisplayName,
  validatePassword,
  isLocalDateTime,
  validateReminderMinutes
} = require('../../utils/validation');

test('school email validation accepts only oic-ok.ac.jp addresses', () => {
  assert.equal(normalizeEmail('  USER@OIC-OK.AC.JP '), 'user@oic-ok.ac.jp');
  assert.equal(validateEmail('24110012@oic-ok.ac.jp'), true);
  assert.equal(isAllowedSchoolEmail('24110012@oic-ok.ac.jp'), true);
  assert.equal(isAllowedSchoolEmail('student@gmail.com'), false);
});

test('display name and password rules match registration limits', () => {
  assert.equal(validateDisplayName('admin'), true);
  assert.equal(validateDisplayName('1234567890'), true);
  assert.equal(validateDisplayName('12345678901'), false);

  assert.equal(validatePassword('Monddaiki1'), true);
  assert.equal(validatePassword('password'), false);
  assert.equal(validatePassword('12345678'), false);
  assert.equal(validatePassword('a1'), false);
});

test('date-time and reminder validators normalize event inputs', () => {
  assert.equal(isLocalDateTime('2026-07-07T09:30'), true);
  assert.equal(isLocalDateTime('2026/07/07 09:30'), false);

  assert.deepEqual(
    validateReminderMinutes([30, '5', 30, 0, 10081, 'abc']),
    [30, 5]
  );
});
