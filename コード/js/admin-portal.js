const TOKEN_KEY = 'pbl_admin_token';
const USER_KEY = 'pbl_admin_user';

let adminToken = localStorage.getItem(TOKEN_KEY) || '';
let adminUser = JSON.parse(localStorage.getItem(USER_KEY) || 'null');
let eventsCache = [];

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
  setTimeout(() => toastEl.classList.add('hidden'), 2600);
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
  loginView.classList.remove('hidden');
  appView.classList.add('hidden');
}

function showApp() {
  loginView.classList.add('hidden');
  appView.classList.remove('hidden');
  document.getElementById('adminUserLabel').textContent = adminUser ? adminUser.email : '';
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
  await Promise.all([loadStats(), loadUsers(), loadGroups(), loadEvents()]);
}

async function loadStats() {
  const stats = await api('/api/admin/system-stats');
  const cards = [
    ['ユーザー', stats.database?.users ?? 0],
    ['イベント', stats.database?.events ?? 0],
    ['グループ', stats.database?.groups ?? 0],
    ['タスク', stats.database?.tasks ?? 0],
    ['稼働時間', stats.process?.uptime ?? '-'],
    ['メモリ', stats.process?.memory?.heapUsed ?? '-']
  ];
  document.getElementById('statsGrid').innerHTML = cards.map(([label, value]) => `
    <div class="stat-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>
  `).join('');
}

async function loadUsers() {
  const users = await api('/api/admin/users');
  document.getElementById('usersTable').innerHTML = users.map(user => `
    <article class="row-card">
      <div class="row-head">
        <div>
          <div class="row-title">${escapeHtml(user.display_name || 'No name')} <span class="row-meta">#${escapeHtml(user.id)}</span></div>
          <div class="row-meta">${escapeHtml(user.email)} / role: ${escapeHtml(user.role)}</div>
        </div>
        <div class="actions">
          <button class="primary" data-user-settings="${user.id}">設定リセット</button>
          <button data-user-history="${user.id}">通知履歴削除</button>
          <button class="danger" data-user-delete="${user.id}" ${Number(user.id) === Number(adminUser?.id) ? 'disabled' : ''}>ユーザー削除</button>
        </div>
      </div>
    </article>
  `).join('');
}

async function loadGroups() {
  const groups = await api('/api/admin/groups');
  document.getElementById('groupsList').innerHTML = groups.map(group => `
    <article class="row-card" data-group-card="${group.id}">
      <div class="row-head">
        <div>
          <div class="row-title">${escapeHtml(group.name)} <span class="row-meta">#${escapeHtml(group.id)}</span></div>
          <div class="row-meta">オーナー: ${escapeHtml(group.owner_name || '-')} / メンバー: ${escapeHtml(group.member_count)} / イベント: ${escapeHtml(group.event_count)}</div>
        </div>
        <div class="actions">
          <button data-group-members="${group.id}">メンバー表示</button>
          <button class="danger" data-group-delete="${group.id}">グループ削除</button>
        </div>
      </div>
      <div class="member-list hidden" id="members-${group.id}"></div>
    </article>
  `).join('');
}

async function renderMembers(groupId, forceOpen = false) {
  const box = document.getElementById('members-' + groupId);
  if (!box) return;

  if (!forceOpen && !box.classList.contains('hidden')) {
    box.classList.add('hidden');
    return;
  }

  const members = await api(`/api/admin/groups/${groupId}/members`);
  box.innerHTML = members.map(member => `
    <div class="member-row">
      <div>
        <div class="row-title">${escapeHtml(member.display_name || 'No name')}</div>
        <div class="row-meta">${escapeHtml(member.email)} / ${escapeHtml(member.role)}</div>
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
  `).join('');
  box.classList.remove('hidden');
}

async function loadEvents() {
  eventsCache = await api('/api/admin/events');
  renderEvents();
}

function renderEvents() {
  const keyword = document.getElementById('eventSearch').value.trim().toLowerCase();
  const filtered = eventsCache.filter(event => {
    const text = [event.title, event.creator_name, event.creator_email, event.group_name, event.calendar_name].join(' ').toLowerCase();
    return !keyword || text.includes(keyword);
  });

  document.getElementById('eventsList').innerHTML = filtered.map(event => `
    <article class="row-card">
      <div class="row-head">
        <div>
          <div class="row-title">${escapeHtml(event.title)} <span class="row-meta">#${escapeHtml(event.id)}</span></div>
          <div class="row-meta">${escapeHtml(event.start_time)} - ${escapeHtml(event.end_time)}</div>
          <div class="row-meta">作成者: ${escapeHtml(event.creator_name || '-')} / グループ: ${escapeHtml(event.group_name || 'なし')}</div>
        </div>
        <div class="actions">
          <button class="danger" data-event-delete="${event.id}">イベント削除</button>
        </div>
      </div>
    </article>
  `).join('');
}

async function handleClick(event) {
  const target = event.target.closest('button');
  if (!target) return;

  try {
    if (target.dataset.userSettings) {
      if (!confirm('このユーザーの設定を初期化しますか？')) return;
      await api(`/api/admin/users/${target.dataset.userSettings}/settings`, { method: 'DELETE' });
      showToast('設定を初期化しました');
    }
    if (target.dataset.userHistory) {
      if (!confirm('このユーザーの通知履歴を削除しますか？')) return;
      await api(`/api/admin/users/${target.dataset.userHistory}/notification-history`, { method: 'DELETE' });
      showToast('通知履歴を削除しました');
    }
    if (target.dataset.userDelete) {
      if (!confirm('このユーザーを削除しますか？')) return;
      await api(`/api/admin/users/${target.dataset.userDelete}`, { method: 'DELETE' });
      showToast('ユーザーを削除しました');
      await loadUsers();
    }
    if (target.dataset.groupMembers) {
      await renderMembers(target.dataset.groupMembers);
    }
    if (target.dataset.groupDelete) {
      if (!confirm('このグループを削除しますか？関連イベントも削除されます。')) return;
      await api(`/api/admin/groups/${target.dataset.groupDelete}`, { method: 'DELETE' });
      showToast('グループを削除しました');
      await Promise.all([loadGroups(), loadEvents(), loadStats()]);
    }
    if (target.dataset.memberRemove) {
      const [groupId, userId] = target.dataset.memberRemove.split(':');
      if (!confirm('このメンバーをグループから削除しますか？')) return;
      await api(`/api/admin/groups/${groupId}/members/${userId}`, { method: 'DELETE' });
      showToast('メンバーを削除しました');
      await renderMembers(groupId, true);
    }
    if (target.dataset.eventDelete) {
      if (!confirm('このイベントを削除しますか？')) return;
      await api(`/api/admin/events/${encodeURIComponent(target.dataset.eventDelete)}`, { method: 'DELETE' });
      showToast('イベントを削除しました');
      await Promise.all([loadEvents(), loadStats()]);
    }
  } catch (err) {
    showToast(err.message);
  }
}

async function handleChange(event) {
  const select = event.target.closest('select[data-member-role]');
  if (!select) return;

  const [groupId, userId] = select.dataset.memberRole.split(':');
  try {
    await api(`/api/admin/groups/${groupId}/members/${userId}/role`, {
      method: 'PUT',
      body: JSON.stringify({ role: select.value })
    });
    showToast('権限を更新しました');
  } catch (err) {
    showToast(err.message);
  }
}

document.getElementById('adminLoginBtn').addEventListener('click', login);
document.getElementById('adminPassword').addEventListener('keydown', event => {
  if (event.key === 'Enter') login();
});
document.getElementById('refreshAllBtn').addEventListener('click', loadAll);
document.getElementById('adminLogoutBtn').addEventListener('click', () => {
  clearSession();
  showLogin();
});
document.getElementById('eventSearch').addEventListener('input', renderEvents);
document.addEventListener('click', handleClick);
document.addEventListener('change', handleChange);

document.querySelectorAll('.admin-tab').forEach(button => {
  button.addEventListener('click', () => {
    document.querySelectorAll('.admin-tab').forEach(item => item.classList.toggle('active', item === button));
    document.querySelectorAll('.panel').forEach(panel => panel.classList.add('hidden'));
    document.getElementById(button.dataset.tab + 'Panel').classList.remove('hidden');
  });
});

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
