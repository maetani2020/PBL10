const TOKEN_KEY = 'pbl_admin_token';
const USER_KEY = 'pbl_admin_user';
const STATS_REFRESH_MS = 2000;
const LOG_FILTER_DEBOUNCE_MS = 300;

let adminToken = localStorage.getItem(TOKEN_KEY) || '';
let adminUser = JSON.parse(localStorage.getItem(USER_KEY) || 'null');
let usersCache = [];
let groupsCache = [];
let eventsCache = [];
let adminLogsCache = [];
let statsRefreshTimer = null;
let adminLogFilterTimer = null;

const loginView = document.getElementById('adminLogin');
const appView = document.getElementById('adminApp');
const toastEl = document.getElementById('adminToast');

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[char]);
}

function showToast(message) {
  toastEl.textContent = message;
  toastEl.classList.remove('hidden');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toastEl.classList.add('hidden'), 2800);
}

function roleLabel(role) {
  return role === 'admin' ? '管理者' : '一般ユーザー';
}

function userStatusLabel(user) {
  if (user.account_status === 'banned') return 'BAN中';
  if (user.account_status === 'timeout') return 'タイムアウト中';
  return '通常';
}

function userStatusClass(user) {
  if (user.account_status === 'banned') return 'chip-danger';
  if (user.account_status === 'timeout') return 'chip-warning';
  return 'chip-success';
}

function groupRoleLabel(role) {
  if (role === 'admin') return '管理者';
  if (role === 'editor') return '編集者';
  return '閲覧者';
}

function eventTypeLabel(type) {
  if (type === 'task') return 'タスク';
  if (type === 'mail') return 'メール';
  return '通常予定';
}

function visibilityLabel(value) {
  if (value === 'public') return '全体公開';
  if (value === 'private') return '自分のみ';
  return 'グループ共有';
}

function formatDateTime(value) {
  if (!value) return '-';
  return String(value).replace('T', ' ').slice(0, 16);
}

function formatUtcDateTimeInJapan(value) {
  if (!value) return '-';
  const raw = String(value).trim();
  const hasTimeZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw);
  const normalized = raw.includes('T') ? raw : raw.replace(' ', 'T');
  const date = new Date(hasTimeZone ? normalized : `${normalized}Z`);
  if (Number.isNaN(date.getTime())) return formatDateTime(value);

  const parts = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date).reduce((acc, part) => {
    acc[part.type] = part.value;
    return acc;
  }, {});

  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute} JST`;
}

function adminActionLabel(action) {
  const labels = {
    'backup:create': 'バックアップ作成',
    'backup:restore': 'バックアップ復元',
    'user:role:update': 'ユーザー権限変更',
    'user:delete': 'ユーザー削除',
    'announcement:send': 'お知らせ送信',
    'ad:send': '広告配信',
    'group_member:role:update': 'グループ権限変更',
    'group_member:remove': 'グループメンバー削除',
    'group:delete': 'グループ削除',
    'event:create': 'イベント作成',
    'event:update': 'イベント更新',
    'event:copy': 'イベントコピー',
    'event:delete': 'イベント削除',
    'event:restore': 'イベント復元',
    'user_settings:reset': 'ユーザー設定リセット',
    'notification_history:delete': '通知履歴削除',
    'user:ban': 'ユーザーBAN',
    'user:timeout': 'ユーザータイムアウト',
    'user:unrestrict': 'BAN/タイムアウト解除',
    'admin:login:success': '管理者ログイン成功',
    'admin:login:failed': '管理者ログイン失敗',
    'admin:login:locked': '管理者ログインロック'
  };
  return labels[action] || action || '-';
}

function invitationStatusLabel(status) {
  if (status === 'accepted') return '参加済み';
  if (status === 'declined') return '拒否済み';
  return '承認待ち';
}

function invitationStatusClass(status) {
  if (status === 'accepted') return 'chip-success';
  if (status === 'declined') return 'chip-danger';
  return 'chip-warning';
}

function formatLogDetails(details) {
  if (!details || typeof details !== 'object') return '-';
  const entries = Object.entries(details)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .slice(0, 6);
  if (!entries.length) return '-';
  return entries.map(([key, value]) => `${key}: ${value}`).join(' / ');
}

function getAdminLogFilterParams() {
  const params = new URLSearchParams();
  const keyword = document.getElementById('adminLogSearch')?.value.trim();
  const actionGroup = document.getElementById('adminLogActionFilter')?.value || 'all';
  const targetType = document.getElementById('adminLogTargetFilter')?.value || 'all';
  const date = document.getElementById('adminLogDateFilter')?.value || '';

  params.set('limit', '200');
  if (keyword) params.set('q', keyword);
  if (actionGroup !== 'all') params.set('action_group', actionGroup);
  if (targetType !== 'all') params.set('target_type', targetType);
  if (date) params.set('date', date);

  return params.toString();
}

function scheduleAdminLogsLoad() {
  clearTimeout(adminLogFilterTimer);
  adminLogFilterTimer = setTimeout(() => {
    loadAdminLogs().catch(err => showToast(err.message));
  }, LOG_FILTER_DEBOUNCE_MS);
}

function clearAdminLogFilters() {
  const search = document.getElementById('adminLogSearch');
  const action = document.getElementById('adminLogActionFilter');
  const target = document.getElementById('adminLogTargetFilter');
  const date = document.getElementById('adminLogDateFilter');

  if (search) search.value = '';
  if (action) action.value = 'all';
  if (target) target.value = 'all';
  if (date) date.value = '';

  loadAdminLogs().catch(err => showToast(err.message));
}

function downloadJsonFile(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function api(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };
  if (adminToken) headers.Authorization = 'Bearer ' + adminToken;

  const res = await fetch(path, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      clearSession();
      showLogin();
    }
    throw new Error(data.error || '通信に失敗しました');
  }
  return data;
}

function setSession(token, user) {
  adminToken = token;
  adminUser = user;
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

function clearSession() {
  adminToken = '';
  adminUser = null;
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

function showLogin() {
  stopStatsAutoRefresh();
  loginView.classList.remove('hidden');
  appView.classList.add('hidden');
}

function showApp() {
  loginView.classList.add('hidden');
  appView.classList.remove('hidden');
  document.getElementById('adminUserLabel').textContent = adminUser
    ? `${adminUser.display_name || adminUser.email} / ${adminUser.email}`
    : '';
  startStatsAutoRefresh();
}

function startStatsAutoRefresh() {
  stopStatsAutoRefresh();
  statsRefreshTimer = setInterval(() => {
    const overviewPanel = document.getElementById('overviewPanel');
    if (!adminToken || appView.classList.contains('hidden') || overviewPanel?.classList.contains('hidden')) return;
    loadStats().catch(err => console.warn('Failed to refresh system stats:', err));
  }, STATS_REFRESH_MS);
}

function stopStatsAutoRefresh() {
  if (!statsRefreshTimer) return;
  clearInterval(statsRefreshTimer);
  statsRefreshTimer = null;
}

async function login() {
  const email = document.getElementById('adminEmail').value.trim();
  const password = document.getElementById('adminPassword').value;
  if (!email || !password) {
    showToast('メールアドレスとパスワードを入力してください');
    return;
  }

  try {
    const data = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password })
    });

    if (data.user?.role !== 'admin') {
      showToast('管理者ユーザーのみログインできます');
      return;
    }

    setSession(data.token, data.user);
    showApp();
    await loadAll();
  } catch (err) {
    showToast(err.message);
  }
}

async function loadAll() {
  await Promise.all([loadStats(), loadUsers(), loadGroups(), loadEvents(), loadAdminLogs()]);
}

async function loadStats() {
  const stats = await api('/api/admin/system-stats');
  const cards = [
    ['CPU使用率', stats.os?.cpuUsage ?? '-'],
    ['メモリ使用率', stats.os?.memoryUsage ?? '-'],
    ['ユーザー', stats.database?.users ?? 0],
    ['管理者', stats.database?.admins ?? 0],
    ['BAN中', stats.database?.bannedUsers ?? 0],
    ['タイムアウト中', stats.database?.timeoutUsers ?? 0],
    ['イベント', stats.database?.events ?? 0],
    ['削除済み予定', stats.database?.deletedEvents ?? 0],
    ['今日の予定', stats.database?.todayEvents ?? 0],
    ['グループ', stats.database?.groups ?? 0],
    ['招待待ち', stats.database?.pendingInvitations ?? 0],
    ['タスク', stats.database?.tasks ?? 0],
    ['通知履歴', stats.database?.notificationHistory ?? 0],
    ['広告', stats.database?.adminAds ?? 0],
    ['操作ログ', stats.database?.adminLogs ?? 0],
    ['稼働時間', stats.process?.uptime ?? '-'],
    ['Nodeメモリ', stats.process?.memory?.heapUsed ?? '-']
  ];
  document.getElementById('statsGrid').innerHTML = cards.map(([label, value]) => `
    <div class="stat-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>
  `).join('');

  const updatedAt = stats.updatedAt
    ? new Date(stats.updatedAt).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : '-';

  document.getElementById('systemDetails').innerHTML = `
    <div><strong>OS</strong><span>${escapeHtml(stats.os?.platform)} / ${escapeHtml(stats.os?.release)}</span></div>
    <div><strong>CPU</strong><span>${escapeHtml(stats.os?.cpus)} cores / ${escapeHtml(stats.os?.cpuUsage ?? '-')}</span></div>
    <div><strong>メモリ</strong><span>${escapeHtml(stats.os?.usedmem ?? '-')} / ${escapeHtml(stats.os?.totalmem ?? '-')} 使用中</span></div>
    <div><strong>空きメモリ</strong><span>${escapeHtml(stats.os?.freemem)} / ${escapeHtml(stats.os?.totalmem)}</span></div>
    <div><strong>Node heap</strong><span>${escapeHtml(stats.process?.memory?.heapUsed ?? '-')} / ${escapeHtml(stats.process?.memory?.heapTotal ?? '-')} (${escapeHtml(stats.process?.memory?.heapUsage ?? '-')})</span></div>
    <div><strong>更新間隔</strong><span>2秒ごと / 最終更新 ${escapeHtml(updatedAt)}</span></div>
  `;
}

async function loadUsers() {
  usersCache = await api('/api/admin/users');
  renderUsers();
}

function renderUsers() {
  const keyword = document.getElementById('userSearch').value.trim().toLowerCase();
  const role = document.getElementById('userRoleFilter').value;
  const users = usersCache.filter(user => {
    const text = [user.display_name, user.email, user.role].join(' ').toLowerCase();
    return (!keyword || text.includes(keyword)) && (role === 'all' || user.role === role);
  });

  document.getElementById('usersTable').innerHTML = users.map(user => {
    const isSelf = Number(user.id) === Number(adminUser?.id);
    const isRestricted = ['banned', 'timeout'].includes(user.account_status);
    return `
      <article class="row-card">
        <div class="row-head">
          <div>
            <div class="row-title">${escapeHtml(user.display_name || 'No name')} <span class="row-meta">#${escapeHtml(user.id)}</span></div>
            <div class="row-meta">${escapeHtml(user.email)}</div>
            ${user.account_status === 'timeout' ? `<div class="row-meta">期限: ${escapeHtml(formatDateTime(user.timeout_until))}</div>` : ''}
            ${user.restriction_reason ? `<div class="row-meta">理由: ${escapeHtml(user.restriction_reason)}</div>` : ''}
            <div class="chips">
              <span class="chip ${user.role === 'admin' ? 'chip-admin' : ''}">${roleLabel(user.role)}</span>
              <span class="chip ${userStatusClass(user)}">${userStatusLabel(user)}</span>
              <span class="chip">予定 ${escapeHtml(user.event_count ?? 0)}</span>
              <span class="chip">グループ ${escapeHtml(user.group_count ?? 0)}</span>
              <span class="chip">通知 ${escapeHtml(user.notification_count ?? 0)}</span>
            </div>
          </div>
          <div class="actions">
            <select data-user-role="${user.id}" ${isSelf ? 'disabled' : ''}>
              <option value="user" ${user.role === 'user' ? 'selected' : ''}>一般ユーザー</option>
              <option value="admin" ${user.role === 'admin' ? 'selected' : ''}>管理者</option>
            </select>
            <button class="primary" data-user-settings="${user.id}">設定リセット</button>
            <button data-user-history="${user.id}">通知履歴削除</button>
            ${isRestricted
              ? `<button data-user-unrestrict="${user.id}" ${isSelf ? 'disabled' : ''}>制限解除</button>`
              : `<button data-user-timeout="${user.id}" ${isSelf ? 'disabled' : ''}>タイムアウト</button>
                 <button class="danger" data-user-ban="${user.id}" ${isSelf ? 'disabled' : ''}>BAN</button>`}
            <button class="danger" data-user-delete="${user.id}" ${isSelf ? 'disabled' : ''}>ユーザー削除</button>
          </div>
        </div>
      </article>
    `;
  }).join('') || '<p class="empty-text">該当するユーザーはいません</p>';
}

async function loadGroups() {
  groupsCache = await api('/api/admin/groups');
  renderGroups();
}

function renderGroups() {
  const keyword = document.getElementById('groupSearch').value.trim().toLowerCase();
  const groups = groupsCache.filter(group => {
    const text = [group.name, group.owner_name, group.owner_email].join(' ').toLowerCase();
    return !keyword || text.includes(keyword);
  });

  document.getElementById('groupsList').innerHTML = groups.map(group => `
    <article class="row-card" data-group-card="${group.id}">
      <div class="row-head">
        <div>
          <div class="row-title">${escapeHtml(group.name)} <span class="row-meta">#${escapeHtml(group.id)}</span></div>
          <div class="row-meta">オーナー: ${escapeHtml(group.owner_name || '-')} / ${escapeHtml(group.owner_email || '-')}</div>
          <div class="chips">
            <span class="chip">メンバー ${escapeHtml(group.member_count ?? 0)}</span>
            <span class="chip">招待待ち ${escapeHtml(group.pending_invitation_count ?? 0)}</span>
            <span class="chip">イベント ${escapeHtml(group.event_count ?? 0)}</span>
          </div>
        </div>
        <div class="actions">
          <button data-group-members="${group.id}">メンバー表示</button>
          <button class="danger" data-group-delete="${group.id}">グループ削除</button>
        </div>
      </div>
      <div class="member-list hidden" id="members-${group.id}"></div>
    </article>
  `).join('') || '<p class="empty-text">該当するグループはありません</p>';
}

async function renderMembers(groupId, forceOpen = false) {
  const box = document.getElementById('members-' + groupId);
  if (!box) return;

  if (!forceOpen && !box.classList.contains('hidden')) {
    box.classList.add('hidden');
    return;
  }

  const [members, invitations] = await Promise.all([
    api(`/api/admin/groups/${groupId}/members`),
    api(`/api/admin/groups/${groupId}/invitations`).catch(() => [])
  ]);
  const memberHtml = members.map(member => `
    <div class="member-row">
      <div>
        <div class="row-title">${escapeHtml(member.display_name || 'No name')}</div>
        <div class="row-meta">${escapeHtml(member.email)}</div>
      </div>
      <div class="actions">
        <select data-member-role="${groupId}:${member.id}">
          <option value="admin" ${member.role === 'admin' ? 'selected' : ''}>管理者</option>
          <option value="editor" ${member.role === 'editor' ? 'selected' : ''}>編集者</option>
          <option value="viewer" ${member.role === 'viewer' ? 'selected' : ''}>閲覧者</option>
        </select>
        <button class="danger" data-member-remove="${groupId}:${member.id}">削除</button>
      </div>
    </div>
  `).join('') || '<p class="empty-text">メンバーはいません</p>';
  const invitationHtml = `
    <div class="admin-invitation-list">
      <div class="row-title">招待状態</div>
      ${invitations.length ? invitations.map(invitation => `
        <div class="member-row">
          <div>
            <div class="row-title">${escapeHtml(invitation.invited_name || 'No name')}</div>
            <div class="row-meta">${escapeHtml(invitation.invited_email || '')}</div>
            <div class="row-meta">送信: ${escapeHtml(formatDateTime(invitation.created_at))} / 返答: ${escapeHtml(formatDateTime(invitation.responded_at))}</div>
          </div>
          <div class="actions">
            <span class="chip ${invitationStatusClass(invitation.status)}">${invitationStatusLabel(invitation.status)}</span>
          </div>
        </div>
      `).join('') : '<p class="empty-text">招待履歴はありません</p>'}
    </div>
  `;
  box.innerHTML = memberHtml + invitationHtml;
  box.classList.remove('hidden');
}

async function loadEvents() {
  eventsCache = await api('/api/admin/events');
  renderEvents();
}

function renderEvents() {
  const keyword = document.getElementById('eventSearch').value.trim().toLowerCase();
  const visibility = document.getElementById('eventVisibilityFilter').value;
  const type = document.getElementById('eventTypeFilter').value;
  const status = document.getElementById('eventStatusFilter').value;
  const filtered = eventsCache.filter(event => {
    const text = [event.title, event.creator_name, event.creator_email, event.group_name, event.calendar_name].join(' ').toLowerCase();
    const isDeleted = !!event.deleted_at;
    return (!keyword || text.includes(keyword))
      && (visibility === 'all' || event.visibility === visibility)
      && (type === 'all' || (event.event_type || 'event') === type)
      && (status === 'all' || (status === 'deleted' ? isDeleted : !isDeleted));
  });

  document.getElementById('eventsList').innerHTML = filtered.map(event => {
    const isDeleted = !!event.deleted_at;
    return `
    <article class="row-card event-row ${isDeleted ? 'deleted-event-row' : ''}" style="border-left-color:${escapeHtml(event.color || '#1a73e8')}">
      <div class="row-head">
        <div>
          <div class="row-title">${escapeHtml(event.title)} <span class="row-meta">#${escapeHtml(event.id)}</span></div>
          <div class="row-meta">${formatDateTime(event.start_time)} - ${formatDateTime(event.end_time)}</div>
          <div class="row-meta">作成者: ${escapeHtml(event.creator_name || '-')} / ${escapeHtml(event.creator_email || '-')}</div>
          <div class="row-meta">カレンダー: ${escapeHtml(event.calendar_name || '-')} / グループ: ${escapeHtml(event.group_name || 'なし')}</div>
          ${isDeleted ? `<div class="row-meta">削除: ${escapeHtml(formatDateTime(event.deleted_at))} / ${escapeHtml(event.deleted_by_name || event.deleted_by_email || '-')}</div>` : ''}
          <div class="chips">
            <span class="chip ${isDeleted ? 'chip-danger' : 'chip-success'}">${isDeleted ? '削除済み' : '有効'}</span>
            <span class="chip">${visibilityLabel(event.visibility)}</span>
            <span class="chip">${eventTypeLabel(event.event_type || 'event')}</span>
            <span class="chip">HP ${escapeHtml(event.hp_consumption ?? 0)}%</span>
            <span class="chip">やる気 ${escapeHtml(event.motivation_consumption ?? 0)}%</span>
          </div>
        </div>
        <div class="actions">
          ${isDeleted
            ? `<button class="primary" data-event-restore="${event.id}">復元</button>`
            : `<button class="danger" data-event-delete="${event.id}">イベント削除</button>`}
        </div>
      </div>
    </article>
  `;
  }).join('') || '<p class="empty-text">該当するイベントはありません</p>';
}

async function createBackup() {
  const backup = await api('/api/admin/backup');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  downloadJsonFile(backup, `pbl-calendar-backup-${stamp}.json`);
  showToast('バックアップを作成しました');
  await Promise.all([loadAdminLogs(), loadStats()]);
}

function readBackupJsonFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        resolve(JSON.parse(reader.result));
      } catch {
        reject(new Error('JSONファイルの読み込みに失敗しました'));
      }
    };
    reader.onerror = () => reject(new Error('ファイルの読み込みに失敗しました'));
    reader.readAsText(file, 'utf-8');
  });
}

function validateBackupPreview(file, backup) {
  if (!file || !file.name.toLowerCase().endsWith('.json')) {
    throw new Error('アップロードできるファイルは .json のみです');
  }
  if (!backup || typeof backup !== 'object') {
    throw new Error('バックアップJSONの形式が正しくありません');
  }
  if (backup.backup_version !== 1) {
    throw new Error('backup_version が正しくありません。新しく作成したバックアップを選択してください');
  }
  if (!backup.exported_at || Number.isNaN(Date.parse(backup.exported_at))) {
    throw new Error('exported_at が存在しない、または日時形式が正しくありません');
  }
}

async function restoreBackup() {
  const fileInput = document.getElementById('backupImportFile');
  const passwordInput = document.getElementById('backupRestorePassword');
  const restoreBtn = document.getElementById('restoreBackupBtn');
  const file = fileInput?.files?.[0];
  const password = passwordInput?.value || '';

  if (!file) {
    showToast('復元するバックアップJSONを選択してください');
    return;
  }
  if (!password) {
    showToast('管理者パスワードを入力してください');
    return;
  }

  const backup = await readBackupJsonFile(file);
  validateBackupPreview(file, backup);

  const exportedAt = formatDateTime(backup.exported_at);
  const warning = [
    'バックアップを復元します。',
    '',
    `ファイル: ${file.name}`,
    `作成日時: ${exportedAt}`,
    '',
    '現在のグループ・予定・通知などはバックアップ内容に置き換わります。',
    '復元前に現在データの自動バックアップを作成します。',
    '',
    '続行しますか？'
  ].join('\n');

  if (!confirm(warning)) return;

  restoreBtn.disabled = true;
  restoreBtn.innerHTML = '<span class="material-icons">hourglass_top</span>復元中...';
  try {
    const data = await api('/api/admin/backup/import', {
      method: 'POST',
      body: JSON.stringify({
        filename: file.name,
        admin_password: password,
        backup
      })
    });
    fileInput.value = '';
    passwordInput.value = '';
    showToast(data.message || 'バックアップを復元しました');
    await loadAll();
  } finally {
    restoreBtn.disabled = false;
    restoreBtn.innerHTML = '<span class="material-icons">upload_file</span>バックアップを復元';
  }
}

async function loadAdminLogs() {
  adminLogsCache = await api(`/api/admin/logs?${getAdminLogFilterParams()}`);
  renderAdminLogs();
}

function renderAdminLogs() {
  const container = document.getElementById('adminLogsList');
  if (!container) return;

  container.innerHTML = adminLogsCache.map(log => `
    <article class="row-card">
      <div class="row-head">
        <div>
          <div class="row-title">${escapeHtml(adminActionLabel(log.action))} <span class="row-meta">#${escapeHtml(log.id)}</span></div>
          <div class="row-meta">${escapeHtml(formatUtcDateTimeInJapan(log.created_at))} / ${escapeHtml(log.admin_name || log.admin_email || 'Unknown admin')}</div>
          <div class="chips">
            <span class="chip">${escapeHtml(log.target_type || 'system')}</span>
            <span class="chip">対象 ${escapeHtml(log.target_id || '-')}</span>
            <span class="chip">IP ${escapeHtml(log.ip_address || '-')}</span>
          </div>
          <div class="row-meta">${escapeHtml(formatLogDetails(log.details))}</div>
        </div>
      </div>
    </article>
  `).join('') || '<p class="empty-text">管理者操作ログはまだありません</p>';
}

async function sendAnnouncement() {
  const titleEl = document.getElementById('adminAnnouncementTitle');
  const messageEl = document.getElementById('adminAnnouncementMessage');
  const title = titleEl.value.trim();
  const message = messageEl.value.trim();

  if (!title || !message) {
    showToast('タイトルと本文を入力してください');
    return;
  }

  if (!confirm('全ユーザーにお知らせを送信しますか？')) return;

  const data = await api('/api/admin/announcements', {
    method: 'POST',
    body: JSON.stringify({ title, message })
  });
  titleEl.value = '';
  messageEl.value = '';
  showToast(data.message || 'お知らせを送信しました');
  await Promise.all([loadStats(), loadAdminLogs()]);
}

function syncAdInputAvailability() {
  const pairs = [
    ['adminAdUseText', 'adminAdText'],
    ['adminAdUseUrl', 'adminAdUrl'],
    ['adminAdUseImage', 'adminAdImageUrl'],
    ['adminAdUseImage', 'adminAdImageFile']
  ];

  pairs.forEach(([checkId, fieldId]) => {
    const checkbox = document.getElementById(checkId);
    const field = document.getElementById(fieldId);
    if (!checkbox || !field) return;
    field.disabled = !checkbox.checked;
  });
}

function readAdImageFile(file) {
  return new Promise((resolve, reject) => {
    if (!file) {
      resolve('');
      return;
    }
    if (!file.type.startsWith('image/')) {
      reject(new Error('画像ファイルを選択してください'));
      return;
    }
    if (file.size > 1024 * 1024) {
      reject(new Error('画像ファイルは1MB以内にしてください'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('画像ファイルの読み込みに失敗しました'));
    reader.readAsDataURL(file);
  });
}

async function sendAdminAd() {
  const useText = document.getElementById('adminAdUseText')?.checked;
  const useUrl = document.getElementById('adminAdUseUrl')?.checked;
  const useImage = document.getElementById('adminAdUseImage')?.checked;
  const textEl = document.getElementById('adminAdText');
  const urlEl = document.getElementById('adminAdUrl');
  const imageEl = document.getElementById('adminAdImageUrl');
  const imageFileEl = document.getElementById('adminAdImageFile');
  const imageData = useImage ? await readAdImageFile(imageFileEl?.files?.[0]) : '';

  const payload = {
    text: useText ? textEl.value.trim() : '',
    url: useUrl ? urlEl.value.trim() : '',
    image_url: useImage ? imageEl.value.trim() : '',
    image_data: imageData
  };

  if (!payload.text && !payload.url && !payload.image_url && !payload.image_data) {
    showToast('広告に使う文字、URL、画像のどれかを入力してください');
    return;
  }

  if (!confirm('カレンダー画面に広告を流しますか？')) return;

  const data = await api('/api/admin/ads', {
    method: 'POST',
    body: JSON.stringify(payload)
  });

  textEl.value = '';
  urlEl.value = '';
  imageEl.value = '';
  if (imageFileEl) imageFileEl.value = '';
  showToast(data.message || '広告を配信しました');
  await Promise.all([loadStats(), loadAdminLogs()]);
}

async function handleClick(event) {
  const target = event.target.closest('button');
  if (!target) return;

  try {
    if (target.dataset.userSettings) {
      if (!confirm('このユーザーの設定を初期化しますか？')) return;
      await api(`/api/admin/users/${target.dataset.userSettings}/settings`, { method: 'DELETE' });
      showToast('設定を初期化しました');
      await loadAdminLogs();
    }
    if (target.dataset.userHistory) {
      if (!confirm('このユーザーの通知履歴を削除しますか？')) return;
      await api(`/api/admin/users/${target.dataset.userHistory}/notification-history`, { method: 'DELETE' });
      showToast('通知履歴を削除しました');
      await Promise.all([loadUsers(), loadStats(), loadAdminLogs()]);
    }
    if (target.dataset.userDelete) {
      if (!confirm('このユーザーを削除しますか？関連データも削除されます。')) return;
      await api(`/api/admin/users/${target.dataset.userDelete}`, { method: 'DELETE' });
      showToast('ユーザーを削除しました');
      await Promise.all([loadUsers(), loadGroups(), loadEvents(), loadStats(), loadAdminLogs()]);
    }
    if (target.dataset.userBan) {
      const reason = prompt('BAN理由を入力してください', '管理者によるBAN');
      if (reason === null) return;
      await api(`/api/admin/users/${target.dataset.userBan}/ban`, {
        method: 'POST',
        body: JSON.stringify({ reason })
      });
      showToast('ユーザーをBANしました');
      await Promise.all([loadUsers(), loadStats(), loadAdminLogs()]);
    }
    if (target.dataset.userTimeout) {
      const minutesText = prompt('タイムアウト時間を分で入力してください（例: 60）', '60');
      if (minutesText === null) return;
      const minutes = Number.parseInt(minutesText, 10);
      if (!Number.isInteger(minutes) || minutes < 1) {
        showToast('1以上の分数を入力してください');
        return;
      }
      const reason = prompt('タイムアウト理由を入力してください', '管理者によるタイムアウト');
      if (reason === null) return;
      await api(`/api/admin/users/${target.dataset.userTimeout}/timeout`, {
        method: 'POST',
        body: JSON.stringify({ minutes, reason })
      });
      showToast('ユーザーをタイムアウトしました');
      await Promise.all([loadUsers(), loadStats(), loadAdminLogs()]);
    }
    if (target.dataset.userUnrestrict) {
      if (!confirm('このユーザーのBAN/タイムアウトを解除しますか？')) return;
      await api(`/api/admin/users/${target.dataset.userUnrestrict}/unrestrict`, { method: 'POST' });
      showToast('制限を解除しました');
      await Promise.all([loadUsers(), loadStats(), loadAdminLogs()]);
    }
    if (target.dataset.groupMembers) {
      await renderMembers(target.dataset.groupMembers);
    }
    if (target.dataset.groupDelete) {
      if (!confirm('このグループを削除しますか？関連イベントも削除されます。')) return;
      await api(`/api/admin/groups/${target.dataset.groupDelete}`, { method: 'DELETE' });
      showToast('グループを削除しました');
      await Promise.all([loadGroups(), loadEvents(), loadStats(), loadAdminLogs()]);
    }
    if (target.dataset.memberRemove) {
      const [groupId, userId] = target.dataset.memberRemove.split(':');
      if (!confirm('このメンバーをグループから削除しますか？')) return;
      await api(`/api/admin/groups/${groupId}/members/${userId}`, { method: 'DELETE' });
      showToast('メンバーを削除しました');
      await Promise.all([renderMembers(groupId, true), loadGroups(), loadAdminLogs()]);
    }
    if (target.dataset.eventDelete) {
      if (!confirm('このイベントを削除済みにしますか？管理者画面から復元できます。')) return;
      await api(`/api/admin/events/${encodeURIComponent(target.dataset.eventDelete)}`, { method: 'DELETE' });
      showToast('イベントを削除しました');
      await Promise.all([loadEvents(), loadStats(), loadAdminLogs()]);
    }
    if (target.dataset.eventRestore) {
      if (!confirm('このイベントを復元しますか？')) return;
      await api(`/api/admin/events/${encodeURIComponent(target.dataset.eventRestore)}/restore`, { method: 'POST' });
      showToast('イベントを復元しました');
      await Promise.all([loadEvents(), loadStats(), loadAdminLogs()]);
    }
  } catch (err) {
    showToast(err.message);
  }
}

async function handleChange(event) {
  const memberSelect = event.target.closest('select[data-member-role]');
  if (memberSelect) {
    const [groupId, userId] = memberSelect.dataset.memberRole.split(':');
    try {
      await api(`/api/admin/groups/${groupId}/members/${userId}/role`, {
        method: 'PUT',
        body: JSON.stringify({ role: memberSelect.value })
      });
      showToast('グループ権限を更新しました');
      await Promise.all([renderMembers(groupId, true), loadAdminLogs()]);
    } catch (err) {
      showToast(err.message);
    }
    return;
  }

  const userSelect = event.target.closest('select[data-user-role]');
  if (userSelect) {
    const userId = userSelect.dataset.userRole;
    try {
      await api(`/api/admin/users/${userId}/role`, {
        method: 'PUT',
        body: JSON.stringify({ role: userSelect.value })
      });
      showToast('ユーザー権限を更新しました');
      await Promise.all([loadUsers(), loadAdminLogs()]);
    } catch (err) {
      showToast(err.message);
      await loadUsers();
    }
  }
}

function bindTabs() {
  document.querySelectorAll('.admin-tab').forEach(button => {
    button.addEventListener('click', () => {
      document.querySelectorAll('.admin-tab').forEach(item => item.classList.toggle('active', item === button));
      document.querySelectorAll('.panel').forEach(panel => panel.classList.add('hidden'));
      document.getElementById(button.dataset.tab + 'Panel').classList.remove('hidden');
      if (button.dataset.tab === 'maintenance') {
        loadAdminLogs().catch(err => showToast(err.message));
      }
    });
  });
}

document.getElementById('adminLoginBtn').addEventListener('click', login);
document.getElementById('adminPassword').addEventListener('keydown', event => {
  if (event.key === 'Enter') login();
});
document.getElementById('refreshAllBtn').addEventListener('click', () => loadAll().catch(err => showToast(err.message)));
document.getElementById('adminLogoutBtn').addEventListener('click', () => {
  clearSession();
  showLogin();
});
document.getElementById('userSearch').addEventListener('input', renderUsers);
document.getElementById('userRoleFilter').addEventListener('change', renderUsers);
document.getElementById('groupSearch').addEventListener('input', renderGroups);
document.getElementById('eventSearch').addEventListener('input', renderEvents);
document.getElementById('eventVisibilityFilter').addEventListener('change', renderEvents);
document.getElementById('eventTypeFilter').addEventListener('change', renderEvents);
document.getElementById('eventStatusFilter').addEventListener('change', renderEvents);
document.getElementById('sendAnnouncementBtn').addEventListener('click', () => sendAnnouncement().catch(err => showToast(err.message)));
document.getElementById('sendAdBtn')?.addEventListener('click', () => sendAdminAd().catch(err => showToast(err.message)));
['adminAdUseText', 'adminAdUseUrl', 'adminAdUseImage'].forEach(id => {
  document.getElementById(id)?.addEventListener('change', syncAdInputAvailability);
});
syncAdInputAvailability();
document.getElementById('createBackupBtn').addEventListener('click', () => createBackup().catch(err => showToast(err.message)));
document.getElementById('restoreBackupBtn')?.addEventListener('click', () => restoreBackup().catch(err => showToast(err.message)));
document.getElementById('refreshLogsBtn').addEventListener('click', () => loadAdminLogs().catch(err => showToast(err.message)));
document.getElementById('adminLogSearch')?.addEventListener('input', scheduleAdminLogsLoad);
document.getElementById('adminLogActionFilter')?.addEventListener('change', () => loadAdminLogs().catch(err => showToast(err.message)));
document.getElementById('adminLogTargetFilter')?.addEventListener('change', () => loadAdminLogs().catch(err => showToast(err.message)));
document.getElementById('adminLogDateFilter')?.addEventListener('change', () => loadAdminLogs().catch(err => showToast(err.message)));
document.getElementById('clearLogFiltersBtn')?.addEventListener('click', clearAdminLogFilters);
document.addEventListener('click', handleClick);
document.addEventListener('change', handleChange);
bindTabs();

if (adminToken && adminUser?.role === 'admin') {
  showApp();
  loadAll().catch(err => {
    showToast(err.message);
    clearSession();
    showLogin();
  });
} else {
  showLogin();
}
