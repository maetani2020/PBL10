// calendar-admin.js
// Admin dashboard UI for existing /api/admin backend routes

import { apiRequest, currentUser } from './calendar-auth.js';
import { showToast } from './calendar-state.js';

let isInitialized = false;

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  })[char]);
}

function isAdminUser() {
  return currentUser?.role === "admin";
}

export function updateAdminNavVisibility() {
  const navItem = document.querySelector('[data-nav="admin"]');
  if (navItem) navItem.classList.toggle("hidden", !isAdminUser());
}

export function initAdminUI() {
  if (isInitialized) return;
  isInitialized = true;

  updateAdminNavVisibility();
  document.getElementById("refreshAdminBtn")?.addEventListener("click", loadAdminData);
  document.getElementById("sendAnnouncementBtn")?.addEventListener("click", sendAnnouncement);
}

export function openAdminPanel() {
  updateAdminNavVisibility();
  if (!isAdminUser()) {
    showToast("管理者のみ利用できます");
    return false;
  }

  const panel = document.getElementById("adminPanel");
  if (panel) panel.classList.remove("hidden");
  loadAdminData();
  return true;
}

export function closeAdminPanel() {
  const panel = document.getElementById("adminPanel");
  if (panel) panel.classList.add("hidden");
}

async function loadAdminData() {
  if (!isAdminUser()) return;

  try {
    const [stats, users] = await Promise.all([
      apiRequest('/api/admin/system-stats'),
      apiRequest('/api/admin/users')
    ]);
    renderStats(stats);
    renderUsers(users);
  } catch (err) {
    console.error('Failed to load admin data:', err);
  }
}

function renderStats(stats) {
  const container = document.getElementById("adminStatsCards");
  if (!container || !stats) return;

  const cards = [
    ["ユーザー", stats.database?.users ?? 0],
    ["予定", stats.database?.events ?? 0],
    ["グループ", stats.database?.groups ?? 0],
    ["メモリ", stats.process?.memory?.heapUsed ?? "-"]
  ];

  container.innerHTML = cards.map(([label, value]) => `
    <div class="admin-stat-card">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </div>
  `).join("");
}

function renderUsers(users) {
  const tbody = document.getElementById("adminUsersBody");
  if (!tbody) return;

  tbody.innerHTML = users.map(user => {
    const isSelf = Number(currentUser?.id) === Number(user.id);
    const adminSelected = user.role === "admin" ? " selected" : "";
    const userSelected = user.role !== "admin" ? " selected" : "";
    const disabled = isSelf ? " disabled" : "";

    return `
      <tr>
        <td>${escapeHtml(user.id)}</td>
        <td>${escapeHtml(user.display_name || "")}</td>
        <td>${escapeHtml(user.email || "")}</td>
        <td>
          <select class="admin-role-select" data-user-id="${user.id}"${disabled}>
            <option value="user"${userSelected}>user</option>
            <option value="admin"${adminSelected}>admin</option>
          </select>
        </td>
        <td>
          <button type="button" class="admin-delete-user danger-btn" data-user-id="${user.id}"${disabled}>削除</button>
        </td>
      </tr>
    `;
  }).join("");

  tbody.querySelectorAll(".admin-role-select").forEach(select => {
    select.addEventListener("change", () => updateUserRole(select.dataset.userId, select.value));
  });

  tbody.querySelectorAll(".admin-delete-user").forEach(button => {
    button.addEventListener("click", () => deleteUser(button.dataset.userId));
  });
}

async function updateUserRole(userId, role) {
  try {
    await apiRequest(`/api/admin/users/${userId}/role`, {
      method: 'PUT',
      body: JSON.stringify({ role })
    });
    showToast("ユーザー権限を更新しました");
    await loadAdminData();
  } catch (err) {
    console.error('Failed to update user role:', err);
    await loadAdminData();
  }
}

async function deleteUser(userId) {
  const confirmed = confirm("このユーザーを削除しますか？");
  if (!confirmed) return;

  try {
    await apiRequest(`/api/admin/users/${userId}`, { method: 'DELETE' });
    showToast("ユーザーを削除しました");
    await loadAdminData();
  } catch (err) {
    console.error('Failed to delete user:', err);
  }
}

async function sendAnnouncement() {
  const titleEl = document.getElementById("adminAnnouncementTitle");
  const messageEl = document.getElementById("adminAnnouncementMessage");
  const title = titleEl?.value.trim() || "";
  const message = messageEl?.value.trim() || "";

  if (!title || !message) {
    showToast("タイトルと本文を入力してください");
    return;
  }

  try {
    await apiRequest('/api/admin/announcements', {
      method: 'POST',
      body: JSON.stringify({ title, message })
    });
    if (titleEl) titleEl.value = "";
    if (messageEl) messageEl.value = "";
    showToast("お知らせを送信しました");
  } catch (err) {
    console.error('Failed to send announcement:', err);
  }
}
