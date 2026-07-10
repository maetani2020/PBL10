// calendar-auth.js
// Authentication state management, API helpers, and auth UI logic

import { showToast, showFieldError, clearFieldErrors } from './calendar-state.js';

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
let passwordResetToken = '';

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
    const data = await res.json().catch(() => ({}));

    // Access token expired: try refresh once.
    if (res.status === 401 && !_retry && refreshTokenStr) {
      const refreshed = await tryRefreshToken();
      if (refreshed) {
        return apiRequest(endpoint, options, true); // retry with new token
      } else {
        logout();
        throw new Error(data.error || 'ログインの有効期限が切れました。もう一度ログインしてください。');
      }
    }

    if (res.status === 401) {
      logout();
      throw new Error(data.error || 'ログインの有効期限が切れました。もう一度ログインしてください。');
    }

    if (res.status === 403) {
      throw new Error(data.error || 'この操作を行う権限がありません。');
    }

    if (!res.ok) {
      throw new Error(data.error || '通信エラーが発生しました');
    }
    return data;
  } catch (err) {
    const message = err.name === 'TypeError'
      ? 'サーバーに接続できません。通信状況を確認してください。'
      : err.message;
    showToast(message);
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
let signupVerificationPending = false;
let pendingSignupEmail = '';

export function initAuthForm() {
  const authToggleBtn = document.getElementById('authToggleMode');
  const authPrimaryBtn = document.getElementById('authPrimaryBtn');
  const authEmailInput = document.getElementById('authEmail');
  const authPasswordInput = document.getElementById('authPassword');
  const authDisplayNameContainer = document.getElementById('authDisplayNameContainer');
  const authDisplayNameInput = document.getElementById('authDisplayName');
  const forgotPasswordLink = document.getElementById('forgotPasswordLink');
  const authInputs = document.querySelector('.auth-inputs');
  let authVerificationCodeContainer = document.getElementById('authVerificationCodeContainer');
  let authVerificationCodeInput = document.getElementById('authVerificationCode');

  if (!authVerificationCodeContainer && authInputs) {
    authVerificationCodeContainer = document.createElement('div');
    authVerificationCodeContainer.id = 'authVerificationCodeContainer';
    authVerificationCodeContainer.className = 'hidden';
    authVerificationCodeInput = document.createElement('input');
    authVerificationCodeInput.type = 'text';
    authVerificationCodeInput.id = 'authVerificationCode';
    authVerificationCodeInput.className = 'auth-input-field';
    authVerificationCodeInput.inputMode = 'numeric';
    authVerificationCodeInput.maxLength = 6;
    authVerificationCodeInput.placeholder = 'メール確認コード（6桁）';
    authVerificationCodeInput.autocomplete = 'one-time-code';
    authVerificationCodeContainer.appendChild(authVerificationCodeInput);
    authInputs.appendChild(authVerificationCodeContainer);
  }

  if (!authToggleBtn || !authPrimaryBtn) return;

  const resetSignupVerification = () => {
    signupVerificationPending = false;
    pendingSignupEmail = '';
    authVerificationCodeContainer?.classList.add('hidden');
    if (authVerificationCodeInput) authVerificationCodeInput.value = '';
  };

  const showSignupVerification = (email) => {
    signupVerificationPending = true;
    pendingSignupEmail = email;
    authVerificationCodeContainer?.classList.remove('hidden');
    authPrimaryBtn.textContent = '確認して登録';
    authVerificationCodeInput?.focus();
  };

  // Toggle between login / signup
  authToggleBtn.addEventListener('click', () => {
    clearFieldErrors(document.getElementById('authOverlay'));
    resetSignupVerification();
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
    clearFieldErrors(document.getElementById('authOverlay'));
    const email = authEmailInput?.value.trim();
    const password = authPasswordInput?.value;
    const displayName = authDisplayNameInput?.value.trim();
    const verificationCode = authVerificationCodeInput?.value.trim() || '';

    if (isSignupMode && !displayName) return showFieldError(authDisplayNameInput, 'ユーザー名を入力してください');
    if (!email) return showFieldError(authEmailInput, 'メールアドレスを入力してください');
    if (!password) return showFieldError(authPasswordInput, 'パスワードを入力してください');

    if (isSignupMode) {
      if (!email.toLowerCase().endsWith('@oic-ok.ac.jp')) {
        return showFieldError(authEmailInput, 'メールアドレスは @oic-ok.ac.jp のみ登録できます');
      }
      if ([...displayName].length > 10) {
        return showFieldError(authDisplayNameInput, 'ユーザー名は10文字以内で入力してください');
      }
      if (password.length > 100) {
        return showFieldError(authPasswordInput, 'パスワードは100文字以内で入力してください');
      }
    }

    authPrimaryBtn.disabled = true;
    authPrimaryBtn.textContent = '処理中...';

    try {
      if (isSignupMode) {
        if (signupVerificationPending) {
          if (!verificationCode) {
            authPrimaryBtn.disabled = false;
            authPrimaryBtn.textContent = '確認して登録';
            return showFieldError(authVerificationCodeInput, 'メールに届いた確認コードを入力してください');
          }
          const verifyData = await apiRequest('/api/auth/register/verify', {
            method: 'POST',
            body: JSON.stringify({ email: pendingSignupEmail || email, code: verificationCode }),
          });
          showToast(verifyData.message || 'メール認証が完了しました。ログインしてください');
          resetSignupVerification();
          isSignupMode = false;
          authDisplayNameContainer?.classList.add('hidden');
          authToggleBtn.textContent = '新規アカウントを作成する';
          authPrimaryBtn.textContent = 'サインイン';
          forgotPasswordLink?.classList.remove('hidden');
          if (authPasswordInput) authPasswordInput.value = '';
          authPrimaryBtn.disabled = false;
          return;
        }

        const data = await apiRequest('/api/auth/register', {
          method: 'POST',
          body: JSON.stringify({ email, password, display_name: displayName }),
        });
        if (data.requiresVerification) {
          showSignupVerification(data.email || email);
          showToast(data.message || '登録確認コードをメールで送信しました');
          authPrimaryBtn.disabled = false;
          return;
        }
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
      if (signupVerificationPending) {
        authPrimaryBtn.textContent = '確認して登録';
        return;
      }
      authPrimaryBtn.textContent = isSignupMode ? 'アカウントを作成' : 'サインイン';
    }
  });

  // パスワードリセットリンク
  if (forgotPasswordLink) {
    forgotPasswordLink.addEventListener('click', () => showPasswordResetModal());
  }

  [authEmailInput, authPasswordInput, authDisplayNameInput].forEach(el => {
    el?.addEventListener('input', () => {
      if (!signupVerificationPending) return;
      resetSignupVerification();
      if (isSignupMode) authPrimaryBtn.textContent = 'アカウントを作成';
    });
  });

  // Enter key
  [authEmailInput, authPasswordInput, authDisplayNameInput, authVerificationCodeInput].forEach(el => {
    el?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') authPrimaryBtn.click();
    });
  });
}

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

function getResetTokenFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get('token') || '';
}

function clearResetTokenFromUrl() {
  window.history.replaceState({}, document.title, '/');
}

function returnToCalendarRoot() {
  clearResetTokenFromUrl();
  if (window.location.pathname !== '/') {
    window.location.replace('/');
  }
}

function showNewPasswordModal(token) {
  passwordResetToken = token;
  const modal = document.getElementById('newPasswordModal');
  if (!modal) return;
  modal.classList.remove('hidden');
  document.getElementById('newResetPassword')?.focus();
}

function hideNewPasswordModal({ clearToken = false } = {}) {
  const modal = document.getElementById('newPasswordModal');
  if (!modal) return;
  modal.classList.add('hidden');
  const passwordInput = document.getElementById('newResetPassword');
  const confirmInput = document.getElementById('confirmResetPassword');
  if (passwordInput) passwordInput.value = '';
  if (confirmInput) confirmInput.value = '';
  if (clearToken) {
    passwordResetToken = '';
    returnToCalendarRoot();
  }
}

export function initPasswordResetModal() {
  const sendBtn = document.getElementById('sendResetEmailBtn');
  const cancelBtn = document.getElementById('cancelResetBtn');
  const submitNewPasswordBtn = document.getElementById('submitNewPasswordBtn');
  const cancelNewPasswordBtn = document.getElementById('cancelNewPasswordBtn');

  cancelBtn?.addEventListener('click', hidePasswordResetModal);
  cancelNewPasswordBtn?.addEventListener('click', () => hideNewPasswordModal({ clearToken: true }));

  sendBtn?.addEventListener('click', async () => {
    clearFieldErrors(document.getElementById('passwordResetModal'));
    const email = document.getElementById('resetEmail')?.value.trim();
    if (!email) { showFieldError('resetEmail', 'メールアドレスを入力してください'); return; }

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

  submitNewPasswordBtn?.addEventListener('click', async () => {
    clearFieldErrors(document.getElementById('newPasswordModal'));
    const newPassword = document.getElementById('newResetPassword')?.value || '';
    const confirmPassword = document.getElementById('confirmResetPassword')?.value || '';

    if (!passwordResetToken) {
      showToast('リセット用トークンが見つかりません。もう一度メールを送信してください。');
      return;
    }
    if (!newPassword) return showFieldError('newResetPassword', '新しいパスワードを入力してください');
    if (newPassword.length < 8 || newPassword.length > 100 || !/[a-zA-Z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
      return showFieldError('newResetPassword', 'パスワードは英字と数字を含む8文字以上・100文字以内で入力してください');
    }
    if (newPassword !== confirmPassword) {
      return showFieldError('confirmResetPassword', '確認用パスワードが一致しません');
    }

    submitNewPasswordBtn.disabled = true;
    submitNewPasswordBtn.textContent = '変更中...';
    try {
      const data = await apiRequest('/api/auth/password-reset', {
        method: 'POST',
        body: JSON.stringify({
          token: passwordResetToken,
          new_password: newPassword
        })
      });
      hideNewPasswordModal({ clearToken: true });
      showAuthOverlay();
      setTimeout(() => window.location.replace('/'), 600);
      showToast(data.message || 'パスワードを変更しました。新しいパスワードでログインしてください。');
    } catch {
      // error shown by apiRequest
    } finally {
      submitNewPasswordBtn.disabled = false;
      submitNewPasswordBtn.textContent = '変更';
    }
  });

  const token = getResetTokenFromUrl();
  if (token) {
    showAuthOverlay();
    showNewPasswordModal(token);
  } else if (window.location.pathname === '/reset-password') {
    returnToCalendarRoot();
  }
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
    const nameInput = document.getElementById('newDisplayName');
    if (nameInput) nameInput.value = currentUser?.display_name || '';
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

  const changeDisplayNameBtn = document.getElementById('changeDisplayNameBtn');
  changeDisplayNameBtn?.addEventListener('click', async () => {
    clearFieldErrors(document.getElementById('accountSettingsModal'));
    const newDisplayName = document.getElementById('newDisplayName')?.value.trim();

    if (!newDisplayName) { showFieldError('newDisplayName', 'ユーザー名を入力してください'); return; }
    if (Array.from(newDisplayName).length > 10) { showFieldError('newDisplayName', 'ユーザー名は10文字以内で入力してください'); return; }

    changeDisplayNameBtn.disabled = true;
    changeDisplayNameBtn.textContent = '変更中...';
    try {
      const data = await apiRequest('/api/auth/change-display-name', {
        method: 'POST',
        body: JSON.stringify({ display_name: newDisplayName }),
      });
      setCurrentUser(data.user);
      updateUserDisplay();
      showToast(data.message || 'ユーザー名を変更しました');
    } catch {
      // error shown by apiRequest
    } finally {
      changeDisplayNameBtn.disabled = false;
      changeDisplayNameBtn.textContent = 'ユーザー名を変更';
    }
  });

  const changePasswordBtn = document.getElementById('changePasswordBtn');
  changePasswordBtn?.addEventListener('click', async () => {
    clearFieldErrors(document.getElementById('accountSettingsModal'));
    const current = document.getElementById('currentPassword')?.value;
    const newPw = document.getElementById('newPassword')?.value;
    const confirm = document.getElementById('confirmPassword')?.value;

    if (!current) { showFieldError('currentPassword', '現在のパスワードを入力してください'); return; }
    if (!newPw) { showFieldError('newPassword', '新しいパスワードを入力してください'); return; }
    if (!confirm) { showFieldError('confirmPassword', '確認用パスワードを入力してください'); return; }
    if (newPw !== confirm) { showFieldError('confirmPassword', '新しいパスワードが一致しません'); return; }
    if (newPw.length > 100) { showFieldError('newPassword', 'パスワードは100文字以内で入力してください'); return; }

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
    clearFieldErrors(document.getElementById('accountSettingsModal'));
    const newEmail = document.getElementById('newEmail')?.value.trim();
    if (!newEmail) { showFieldError('newEmail', '新しいメールアドレスを入力してください'); return; }
    if (!newEmail.toLowerCase().endsWith('@oic-ok.ac.jp')) { showFieldError('newEmail', 'メールアドレスは @oic-ok.ac.jp のみ変更できます'); return; }

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
    clearFieldErrors(document.getElementById('accountSettingsModal'));
    const code = document.getElementById('emailConfirmCode')?.value.trim();
    if (!code) { showFieldError('emailConfirmCode', '確認コードを入力してください'); return; }

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
  if (isLoggedIn()) {
    hideAuthOverlay();
    updateUserDisplay();
    return true;
  } else {
    showAuthOverlay();
    return false;
  }
}
