// calendar-auth.js
// Authentication state management, API helpers, and auth UI logic

import { showToast } from './calendar-state.js';

// -------------------------------------------------------
// Auth State
// -------------------------------------------------------
export let authToken = localStorage.getItem('ios_calendar_token') || '';
export let currentUser = JSON.parse(localStorage.getItem('ios_calendar_user')) || null;

export function setAuthToken(token) {
  authToken = token;
  if (token) {
    localStorage.setItem('ios_calendar_token', token);
  } else {
    localStorage.removeItem('ios_calendar_token');
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
// API Request Helper (with Bearer token support)
// -------------------------------------------------------
export async function apiRequest(endpoint, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }

  try {
    const res = await fetch(endpoint, { ...options, headers });

    // Session expired → auto logout
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
// Logout
// -------------------------------------------------------
export function logout() {
  setAuthToken('');
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
  // Hide avatar button when logged out
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
  // Show avatar button when logged in
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

  if (avatarBtn) {
    avatarBtn.textContent = currentUser.display_name?.charAt(0).toUpperCase() || 'U';
  }
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

  if (!authToggleBtn || !authPrimaryBtn) return;

  // Toggle between login / signup
  authToggleBtn.addEventListener('click', () => {
    isSignupMode = !isSignupMode;
    if (isSignupMode) {
      authDisplayNameContainer?.classList.remove('hidden');
      authToggleBtn.textContent = 'すでにアカウントをお持ちですか？ サインイン';
      authPrimaryBtn.textContent = 'アカウントを作成';
    } else {
      authDisplayNameContainer?.classList.add('hidden');
      authToggleBtn.textContent = '新規アカウントを作成する';
      authPrimaryBtn.textContent = 'サインイン';
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
        // Registration
        await apiRequest('/api/auth/register', {
          method: 'POST',
          body: JSON.stringify({ email, password, display_name: displayName }),
        });
        showToast('登録完了！サインインします。');
        isSignupMode = false;
        authDisplayNameContainer?.classList.add('hidden');
        authToggleBtn.textContent = '新規アカウントを作成する';
        authPrimaryBtn.textContent = 'サインイン';
        authPrimaryBtn.disabled = false;
      } else {
        // Login
        const data = await apiRequest('/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({ email, password }),
        });
        setAuthToken(data.token);
        setCurrentUser(data.user);
        hideAuthOverlay();
        updateUserDisplay();
        showToast(`ようこそ、${data.user.display_name}さん！`);

        // Trigger app initialization after login
        const event = new CustomEvent('auth:loggedin');
        document.dispatchEvent(event);
        authPrimaryBtn.disabled = false;
      }
    } catch (err) {
      console.error('Auth error:', err);
      authPrimaryBtn.disabled = false;
      authPrimaryBtn.textContent = isSignupMode ? 'アカウントを作成' : 'サインイン';
    }
  });

  // Allow Enter key submission
  [authEmailInput, authPasswordInput, authDisplayNameInput].forEach(el => {
    el?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') authPrimaryBtn.click();
    });
  });
}

// -------------------------------------------------------
// Account Panel (in sidebar)
// -------------------------------------------------------
export function initAccountPanel() {
  const logoutBtn = document.getElementById('sidebarLogoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', logout);
  }
}

// -------------------------------------------------------
// checkAuth: called on page load
// Returns true if already logged in, false otherwise
// -------------------------------------------------------
export function checkAuth() {
  if (isLoggedIn()) {
    hideAuthOverlay();
    updateUserDisplay();
    return true;
  } else {
    showAuthOverlay();
    return false;
  }
}
