// calendar-auth.js
// Authentication state management, API helpers, and auth UI logic

import { showToast } from './calendar-state.js';

// -------------------------------------------------------
// Auth State
// -------------------------------------------------------
export let authToken = localStorage.getItem('ios_calendar_token') || '';
export let refreshTokenStr = localStorage.getItem('ios_calendar_refresh_token') || '';
export let currentUser = JSON.parse(localStorage.getItem('ios_calendar_user')) || null;

export function setAuthToken(token) {
  authToken = token;
  if (token) {
    localStorage.setItem('ios_calendar_token', token);
  } else {
    localStorage.removeItem('ios_calendar_token');
  }
}

export function setRefreshToken(token) {
  refreshTokenStr = token;
  if (token) {
    localStorage.setItem('ios_calendar_refresh_token', token);
  } else {
    localStorage.removeItem('ios_calendar_refresh_token');
  }
}

export function setCurrentUser(user) {
  currentUser = user;
  if (user) {
    localStorage.setItem('ios_calendar_user', JSON.stringify(user));
  } else {
    localStorage.removeItem('ios_calendar_user');
  }
}

export function isLoggedIn() {
  return !!authToken;
}

// -------------------------------------------------------
// API Request Helper (with auto token refresh on 401)
// -------------------------------------------------------
let isRefreshing = false;
let refreshQueue = [];

export async function apiRequest(endpoint, options = {}, _retry = false) {
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }

  try {
    const res = await fetch(endpoint, { ...options, headers });

    // Access token expired → try refresh once
    if (res.status === 401 && !_retry && refreshTokenStr) {
      const refreshed = await tryRefreshToken();
      if (refreshed) {
        return apiRequest(endpoint, options, true); // retry with new token
      } else {
        logout();
        throw new Error('セッションの期限が切れました。再ログインしてください。');
      }
    }

    if (res.status === 401 || res.status === 403) {
      logout();
      throw new Error('セッションの期限が切れました。再ログインしてください。');
    }

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || '通信エラーが発生しました');
    }
    return data;
  } catch (err) {
    showToast(err.message);
    throw err;
  }
}

// -------------------------------------------------------
// Token Auto-Refresh
// -------------------------------------------------------
async function tryRefreshToken() {
  if (isRefreshing) {
    // Queue concurrent requests while refreshing
    return new Promise((resolve) => refreshQueue.push(resolve));
  }

  isRefreshing = true;
  try {
    const res = await fetch('/api/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: refreshTokenStr }),
    });

    if (!res.ok) {
      refreshQueue.forEach(r => r(false));
      refreshQueue = [];
      isRefreshing = false;
      return false;
    }

    const data = await res.json();
    setAuthToken(data.token);
    refreshQueue.forEach(r => r(true));
    refreshQueue = [];
    isRefreshing = false;
    return true;
  } catch {
    refreshQueue.forEach(r => r(false));
    refreshQueue = [];
    isRefreshing = false;
    return false;
  }
}

// -------------------------------------------------------
// Logout (with server-side token blacklisting)
// -------------------------------------------------------
export async function logout() {
  try {
    // サーバー側でJWTをブラックリスト登録
    if (authToken) {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify({ refreshToken: refreshTokenStr }),
      });
    }
  } catch {
    // サーバーエラーでもローカルのトークンはクリア
  }

  setAuthToken('');
  setRefreshToken('');
  setCurrentUser(null);
  showAuthOverlay();
  showToast('ログアウトしました');
}

// -------------------------------------------------------
// Auth Overlay UI helpers
// -------------------------------------------------------
export function showAuthOverlay() {
  const overlay = document.getElementById('authOverlay');
  if (!overlay) return;
  overlay.classList.remove('hidden', 'auth-fade-out');
  overlay.classList.add('auth-fade-in');
  const avatarBtn = document.getElementById('userAvatarBtn');
  if (avatarBtn) avatarBtn.classList.add('hidden');
}

export function hideAuthOverlay() {
  const overlay = document.getElementById('authOverlay');
  if (!overlay) return;
  overlay.classList.remove('auth-fade-in');
  overlay.classList.add('auth-fade-out');
  setTimeout(() => {
    overlay.classList.add('hidden');
    overlay.classList.remove('auth-fade-out');
  }, 350);
  const avatarBtn = document.getElementById('userAvatarBtn');
  if (avatarBtn) avatarBtn.classList.remove('hidden');
}

// -------------------------------------------------------
// User Profile Display
// -------------------------------------------------------
export function updateUserDisplay() {
  if (!currentUser) return;
  const avatarBtn = document.getElementById('userAvatarBtn');
  const userNameEl = document.getElementById('accountUserName');
  const userEmailEl = document.getElementById('accountUserEmail');
  const userAvatarLarge = document.getElementById('accountUserAvatar');

  if (avatarBtn) avatarBtn.textContent = currentUser.display_name?.charAt(0).toUpperCase() || 'U';
  if (userNameEl) userNameEl.textContent = currentUser.display_name || '';
  if (userEmailEl) userEmailEl.textContent = currentUser.email || '';
  if (userAvatarLarge) userAvatarLarge.textContent = currentUser.display_name?.charAt(0).toUpperCase() || 'U';
}

// -------------------------------------------------------
// Auth Form Logic (Login / Register toggle)
// -------------------------------------------------------
let isSignupMode = false;

export function initAuthForm() {
  const authToggleBtn = document.getElementById('authToggleMode');
  const authPrimaryBtn = document.getElementById('authPrimaryBtn');
  const authEmailInput = document.getElementById('authEmail');
  const authPasswordInput = document.getElementById('authPassword');
  const authDisplayNameContainer = document.getElementById('authDisplayNameContainer');
  const authDisplayNameInput = document.getElementById('authDisplayName');
  const forgotPasswordLink = document.getElementById('forgotPasswordLink');

  if (!authToggleBtn || !authPrimaryBtn) return;

  // Toggle between login / signup
  authToggleBtn.addEventListener('click', () => {
    isSignupMode = !isSignupMode;
    if (isSignupMode) {
      authDisplayNameContainer?.classList.remove('hidden');
      authToggleBtn.textContent = 'すでにアカウントをお持ちですか？ サインイン';
      authPrimaryBtn.textContent = 'アカウントを作成';
      forgotPasswordLink?.classList.add('hidden');
    } else {
      authDisplayNameContainer?.classList.add('hidden');
      authToggleBtn.textContent = '新規アカウントを作成する';
      authPrimaryBtn.textContent = 'サインイン';
      forgotPasswordLink?.classList.remove('hidden');
    }
  });

  // Primary action (login or register)
  authPrimaryBtn.addEventListener('click', async () => {
    const email = authEmailInput?.value.trim();
    const password = authPasswordInput?.value;
    const displayName = authDisplayNameInput?.value.trim();

    if (!email || !password || (isSignupMode && !displayName)) {
      showToast('すべての項目を入力してください');
      return;
    }

    authPrimaryBtn.disabled = true;
    authPrimaryBtn.textContent = '処理中...';

    try {
      if (isSignupMode) {
        await apiRequest('/api/auth/register', {
          method: 'POST',
          body: JSON.stringify({ email, password, display_name: displayName }),
        });
        showToast('登録完了！サインインします。');
        isSignupMode = false;
        authDisplayNameContainer?.classList.add('hidden');
        authToggleBtn.textContent = '新規アカウントを作成する';
        authPrimaryBtn.textContent = 'サインイン';
        forgotPasswordLink?.classList.remove('hidden');
        authPrimaryBtn.disabled = false;
      } else {
        const data = await apiRequest('/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({ email, password }),
        });
        setAuthToken(data.token);
        if (data.refreshToken) setRefreshToken(data.refreshToken);
        setCurrentUser(data.user);
        hideAuthOverlay();
        updateUserDisplay();
        showToast(`ようこそ、${data.user.display_name}さん！`);
        document.dispatchEvent(new CustomEvent('auth:loggedin'));
        authPrimaryBtn.disabled = false;
      }
    } catch (err) {
      console.error('Auth error:', err);
      authPrimaryBtn.disabled = false;
      authPrimaryBtn.textContent = isSignupMode ? 'アカウントを作成' : 'サインイン';
    }
  });

  // Google Sign-In button
  const googleLoginBtn = document.getElementById('googleLoginBtn');
  if (googleLoginBtn) {
    googleLoginBtn.addEventListener('click', handleGoogleLogin);
  }

  // パスワードリセットリンク
  if (forgotPasswordLink) {
    forgotPasswordLink.addEventListener('click', () => showPasswordResetModal());
  }

  // Enter key
  [authEmailInput, authPasswordInput, authDisplayNameInput].forEach(el => {
    el?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') authPrimaryBtn.click();
    });
  });
}

// -------------------------------------------------------
// Google Login (Google Identity Services)
// -------------------------------------------------------
async function handleGoogleLogin() {
  // Google Identity Services を使用した実装
  const GOOGLE_CLIENT_ID = window.GOOGLE_CLIENT_ID || '';

  if (GOOGLE_CLIENT_ID && window.google?.accounts?.id) {
    // 実際のGoogle OAuth使用
    window.google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: async (response) => {
        try {
          // IDトークンをデコードしてユーザー情報取得
          const payload = JSON.parse(atob(response.credential.split('.')[1]));
          const data = await apiRequest('/api/auth/google-login', {
            method: 'POST',
            body: JSON.stringify({ email: payload.email, display_name: payload.name }),
          });
          setAuthToken(data.token);
          if (data.refreshToken) setRefreshToken(data.refreshToken);
          setCurrentUser(data.user);
          hideAuthOverlay();
          updateUserDisplay();
          showToast(`Googleでログインしました！ようこそ、${data.user.display_name}さん`);
          document.dispatchEvent(new CustomEvent('auth:loggedin'));
        } catch (err) {
          console.error('Google login error:', err);
        }
      },
    });
    window.google.accounts.id.prompt();
  } else {
    // デモ用モックフロー（Google Client ID未設定時：自動的にダミーGoogleアカウントで登録・ログインする）
    showToast('Google Client ID未設定のため、デモGoogleアカウントで自動サインインします ⚙️');
    
    try {
      const data = await apiRequest('/api/auth/google-login', {
        method: 'POST',
        body: JSON.stringify({ 
          email: 'demo-google-user@example.com', 
          display_name: 'デモGoogleユーザー' 
        }),
      });
      setAuthToken(data.token);
      if (data.refreshToken) setRefreshToken(data.refreshToken);
      setCurrentUser(data.user);
      hideAuthOverlay();
      updateUserDisplay();
      showToast(`【デモ】Googleアカウントでサインインしました！ようこそ、${data.user.display_name}さん`);
      document.dispatchEvent(new CustomEvent('auth:loggedin'));
    } catch (err) {
      console.error('Demo Google login error:', err);
    }
  }
}

// -------------------------------------------------------
// パスワードリセット Modal
// -------------------------------------------------------
function showPasswordResetModal() {
  const modal = document.getElementById('passwordResetModal');
  if (!modal) return;
  modal.classList.remove('hidden');
  document.getElementById('resetEmail')?.focus();
}

function hidePasswordResetModal() {
  const modal = document.getElementById('passwordResetModal');
  if (!modal) return;
  modal.classList.add('hidden');
  if (document.getElementById('resetEmail')) document.getElementById('resetEmail').value = '';
}

export function initPasswordResetModal() {
  const sendBtn = document.getElementById('sendResetEmailBtn');
  const cancelBtn = document.getElementById('cancelResetBtn');

  cancelBtn?.addEventListener('click', hidePasswordResetModal);

  sendBtn?.addEventListener('click', async () => {
    const email = document.getElementById('resetEmail')?.value.trim();
    if (!email) { showToast('メールアドレスを入力してください'); return; }

    sendBtn.disabled = true;
    sendBtn.textContent = '送信中...';
    try {
      const data = await apiRequest('/api/auth/password-reset-request', {
        method: 'POST',
        body: JSON.stringify({ email }),
      });
      showToast(data.message || 'リセットメールを送信しました（開発環境はサーバーログを確認）');
      hidePasswordResetModal();
    } catch {
      // error shown by apiRequest
    } finally {
      sendBtn.disabled = false;
      sendBtn.textContent = '送信';
    }
  });
}

// -------------------------------------------------------
// Account Settings Modal (パスワード変更・メール変更)
// -------------------------------------------------------
export function initAccountSettings() {
  // 設定モーダルを開く
  const openSettingsBtn = document.getElementById('openAccountSettingsBtn');
  const settingsModal = document.getElementById('accountSettingsModal');
  const closeSettingsBtn = document.getElementById('closeAccountSettingsBtn');

  openSettingsBtn?.addEventListener('click', () => {
    settingsModal?.classList.remove('hidden');
  });

  closeSettingsBtn?.addEventListener('click', () => {
    settingsModal?.classList.add('hidden');
  });

  settingsModal?.addEventListener('click', (e) => {
    if (e.target === settingsModal) settingsModal.classList.add('hidden');
  });

  // タブ切替
  document.querySelectorAll('.settings-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.settings-tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.settings-tab-panel').forEach(p => p.classList.add('hidden'));
      btn.classList.add('active');
      const target = btn.dataset.tab;
      document.getElementById(`settingsTab_${target}`)?.classList.remove('hidden');
    });
  });

  // パスワード変更
  const changePasswordBtn = document.getElementById('changePasswordBtn');
  changePasswordBtn?.addEventListener('click', async () => {
    const current = document.getElementById('currentPassword')?.value;
    const newPw = document.getElementById('newPassword')?.value;
    const confirm = document.getElementById('confirmPassword')?.value;

    if (!current || !newPw || !confirm) { showToast('すべての項目を入力してください'); return; }
    if (newPw !== confirm) { showToast('新しいパスワードが一致しません'); return; }

    changePasswordBtn.disabled = true;
    changePasswordBtn.textContent = '変更中...';
    try {
      const data = await apiRequest('/api/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ current_password: current, new_password: newPw }),
      });
      showToast(data.message || 'パスワードを変更しました');
      document.getElementById('currentPassword').value = '';
      document.getElementById('newPassword').value = '';
      document.getElementById('confirmPassword').value = '';
    } catch {
      // error shown by apiRequest
    } finally {
      changePasswordBtn.disabled = false;
      changePasswordBtn.textContent = 'パスワードを変更';
    }
  });

  // メール変更リクエスト
  const requestEmailChangeBtn = document.getElementById('requestEmailChangeBtn');
  requestEmailChangeBtn?.addEventListener('click', async () => {
    const newEmail = document.getElementById('newEmail')?.value.trim();
    if (!newEmail) { showToast('新しいメールアドレスを入力してください'); return; }

    requestEmailChangeBtn.disabled = true;
    requestEmailChangeBtn.textContent = '送信中...';
    try {
      const data = await apiRequest('/api/auth/change-email-request', {
        method: 'POST',
        body: JSON.stringify({ new_email: newEmail }),
      });
      showToast(data.message || '確認コードを送信しました（サーバーログを確認）');
      // 確認コード入力エリアを表示
      document.getElementById('emailConfirmSection')?.classList.remove('hidden');
    } catch {
      // error shown
    } finally {
      requestEmailChangeBtn.disabled = false;
      requestEmailChangeBtn.textContent = '確認コードを送信';
    }
  });

  // メール変更確認
  const confirmEmailChangeBtn = document.getElementById('confirmEmailChangeBtn');
  confirmEmailChangeBtn?.addEventListener('click', async () => {
    const code = document.getElementById('emailConfirmCode')?.value.trim();
    if (!code) { showToast('確認コードを入力してください'); return; }

    confirmEmailChangeBtn.disabled = true;
    confirmEmailChangeBtn.textContent = '確認中...';
    try {
      const data = await apiRequest('/api/auth/change-email-confirm', {
        method: 'POST',
        body: JSON.stringify({ code }),
      });
      showToast(data.message || 'メールアドレスを変更しました。再ログインしてください。');
      // ログアウトして再ログインを促す
      await logout();
    } catch {
      // error shown
    } finally {
      confirmEmailChangeBtn.disabled = false;
      confirmEmailChangeBtn.textContent = '確認して変更';
    }
  });
}

// -------------------------------------------------------
// Account Panel (in sidebar)
// -------------------------------------------------------
export function initAccountPanel() {
  const logoutBtn = document.getElementById('sidebarLogoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      logoutBtn.disabled = true;
      logoutBtn.textContent = 'ログアウト中...';
      await logout();
      logoutBtn.disabled = false;
      logoutBtn.innerHTML = '<span class="material-icons" style="vertical-align:middle;font-size:16px;margin-right:4px;">logout</span>ログアウト';
    });
  }
}

// -------------------------------------------------------
// checkAuth: called on page load
// -------------------------------------------------------
export async function checkAuth() {
  // バックエンドから設定情報（Google Client ID）を取得
  try {
    const res = await fetch('/api/config');
    const data = await res.json();
    window.GOOGLE_CLIENT_ID = data.googleClientId;
  } catch (err) {
    console.error('Failed to load config:', err);
  }

  if (isLoggedIn()) {
    hideAuthOverlay();
    updateUserDisplay();
    return true;
  } else {
    showAuthOverlay();
    return false;
  }
}
