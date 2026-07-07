const ACTION_GROUP_PREFIXES = {
  user: ['user:'],
  group: ['group:', 'group_member:'],
  event: ['event:'],
  announcement: ['announcement:'],
  backup: ['backup:'],
  login: ['admin:login:'],
  settings: ['user_settings:', 'notification_history:']
};

const TARGET_TYPES = new Set([
  'user',
  'group',
  'group_member',
  'event',
  'announcement',
  'system'
]);

function cleanText(value, maxLength = 120) {
  return String(value || '').trim().slice(0, maxLength);
}

function normalizeLimit(value, fallback = 100) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.max(1, Math.min(300, parsed));
}

function normalizeAdminLogFilters(raw = {}) {
  const actionGroup = cleanText(raw.action_group || raw.actionGroup || 'all', 40);
  const targetType = cleanText(raw.target_type || raw.targetType || 'all', 40);
  const date = cleanText(raw.date || '', 10);

  return {
    keyword: cleanText(raw.q || raw.search || '', 120).toLowerCase(),
    actionGroup: ACTION_GROUP_PREFIXES[actionGroup] ? actionGroup : 'all',
    targetType: TARGET_TYPES.has(targetType) ? targetType : 'all',
    date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : '',
    limit: normalizeLimit(raw.limit, 100)
  };
}

function buildAdminLogWhereClause(filters) {
  const where = [];
  const params = [];

  if (filters.keyword) {
    where.push(`LOWER(
      COALESCE(al.action, '') || ' ' ||
      COALESCE(al.target_type, '') || ' ' ||
      COALESCE(al.target_id, '') || ' ' ||
      COALESCE(al.details, '') || ' ' ||
      COALESCE(al.ip_address, '') || ' ' ||
      COALESCE(u.email, '') || ' ' ||
      COALESCE(u.display_name, '')
    ) LIKE ?`);
    params.push(`%${filters.keyword}%`);
  }

  const prefixes = ACTION_GROUP_PREFIXES[filters.actionGroup];
  if (prefixes) {
    where.push(`(${prefixes.map(() => 'al.action LIKE ?').join(' OR ')})`);
    prefixes.forEach(prefix => params.push(`${prefix}%`));
  }

  if (filters.targetType !== 'all') {
    where.push('al.target_type = ?');
    params.push(filters.targetType);
  }

  if (filters.date) {
    where.push('CAST(al.created_at AS TEXT) LIKE ?');
    params.push(`${filters.date}%`);
  }

  return {
    sql: where.length ? `WHERE ${where.join(' AND ')}` : '',
    params
  };
}

function matchesAdminLogFilters(log, filters) {
  const keywordText = [
    log.action,
    log.target_type,
    log.target_id,
    log.details && typeof log.details === 'object' ? JSON.stringify(log.details) : log.details,
    log.ip_address,
    log.admin_email,
    log.admin_name
  ].join(' ').toLowerCase();

  const prefixes = ACTION_GROUP_PREFIXES[filters.actionGroup];
  const matchesAction = !prefixes || prefixes.some(prefix => String(log.action || '').startsWith(prefix));
  const matchesTarget = filters.targetType === 'all' || log.target_type === filters.targetType;
  const matchesDate = !filters.date || String(log.created_at || '').startsWith(filters.date);
  const matchesKeyword = !filters.keyword || keywordText.includes(filters.keyword);

  return matchesAction && matchesTarget && matchesDate && matchesKeyword;
}

module.exports = {
  ACTION_GROUP_PREFIXES,
  normalizeAdminLogFilters,
  buildAdminLogWhereClause,
  matchesAdminLogFilters
};
