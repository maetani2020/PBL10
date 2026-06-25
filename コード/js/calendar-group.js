// calendar-group.js
// Group sharing and group management with PostgreSQL backend integration

import { apiRequest, currentUser } from './calendar-auth.js';
import { showToast } from './calendar-state.js';

let activeGroups = [];
let selectedGroupId = null;

export function getActiveGroups() {
  return activeGroups;
}

export function getSelectedGroupId() {
  return selectedGroupId;
}

export function setSelectedGroupId(id) {
  selectedGroupId = id;
}


function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  })[char]);
}

function roleLabel(role) {
  if (role === "admin") return "管理者";
  if (role === "editor") return "編集者";
  return "閲覧者";
}

function roleOptions(currentRole) {
  return ["admin", "editor", "viewer"].map(role => {
    const selected = role === currentRole ? " selected" : "";
    return `<option value="${role}"${selected}>${roleLabel(role)}</option>`;
  }).join("");
}

// Fetch user's groups from PostgreSQL backend
export async function syncGroups() {
  try {
    activeGroups = await apiRequest('/api/groups');
    populateGroupDropdowns();
    renderGroupList();
  } catch (err) {
    console.error('Failed to sync groups:', err);
  }
}

// Populate the group select dropdown inside Event Modal
function populateGroupDropdowns() {
  const groupSelect = document.getElementById("eventGroupId");
  if (!groupSelect) return;

  groupSelect.innerHTML = '<option value="">(グループなし)</option>';
  activeGroups.forEach(g => {
    const opt = document.createElement("option");
    opt.value = g.id;
    opt.textContent = g.name;
    groupSelect.appendChild(opt);
  });
}

// Render the groups in Group management modal
export function renderGroupList() {
  const container = document.getElementById("groupList");
  if (!container) return;

  container.innerHTML = "";
  if (activeGroups.length === 0) {
    container.innerHTML = '<p style="text-align:center; padding:10px; opacity:0.7;">所属しているグループはありません</p>';
    return;
  }

  activeGroups.forEach(g => {
    const item = document.createElement("div");
    item.className = "group-list-item";
    item.style.display = "flex";
    item.style.justifyContent = "space-between";
    item.style.alignItems = "center";
    item.style.padding = "8px 12px";
    item.style.borderBottom = "1px solid var(--border)";
    item.style.cursor = "pointer";

    item.innerHTML = `
      <div>
        <strong>${g.name}</strong>
        <span style="font-size: 11px; opacity:0.7; margin-left: 8px;">(${g.member_count}名)</span>
      </div>
      <span class="material-icons" style="font-size:16px; opacity:0.5;">chevron_right</span>
    `;

    item.addEventListener("click", () => {
      selectGroupForDetail(g.id);
    });

    container.appendChild(item);
  });
}

// Show detailed information for a specific group
export async function selectGroupForDetail(groupId) {
  selectedGroupId = groupId;
  const detailPanel = document.getElementById("groupDetail");
  const titleEl = document.getElementById("groupDetailTitle");
  const memberListContainer = document.getElementById("memberList");
  
  if (!detailPanel || !titleEl || !memberListContainer) return;

  const group = activeGroups.find(g => Number(g.id) === Number(groupId));
  if (!group) {
    detailPanel.classList.add("hidden");
    return;
  }

  titleEl.textContent = `「${group.name}」詳細`;
  detailPanel.classList.remove("hidden");

  try {
    const members = await apiRequest(`/api/groups/${groupId}/members`);
    memberListContainer.innerHTML = "";
    const canManageMembers = group.role === "admin" || (currentUser && Number(group.owner_id) === Number(currentUser.id));
    
    members.forEach(m => {
      const isOwner = Number(group.owner_id) === Number(m.id);
      const isSelf = currentUser && Number(currentUser.id) === Number(m.id);
      const canChangeRole = canManageMembers && !isOwner && !isSelf;
      const canRemove = canManageMembers && !isOwner && !isSelf;
      const roleControl = canChangeRole
        ? `<select class="member-role-select" data-user-id="${m.id}">${roleOptions(m.role)}</select>`
        : `<span class="member-role-label">${isOwner ? "オーナー" : roleLabel(m.role)}</span>`;
      const removeControl = canRemove
        ? `<button type="button" class="member-remove-btn danger-btn" data-user-id="${m.id}">削除</button>`
        : "";
      
      const mDiv = document.createElement("div");
      mDiv.className = "member-list-item";
      mDiv.innerHTML = `
        <div class="member-profile">
          <strong>${escapeHtml(m.display_name || "No name")}</strong>
          <small>${escapeHtml(m.email || "")}</small>
        </div>
        <div class="member-controls">
          ${roleControl}
          ${removeControl}
        </div>
      `;
      memberListContainer.appendChild(mDiv);
    });

    memberListContainer.querySelectorAll(".member-role-select").forEach(select => {
      select.addEventListener("change", () => updateMemberRole(select.dataset.userId, select.value));
    });

    memberListContainer.querySelectorAll(".member-remove-btn").forEach(button => {
      button.addEventListener("click", () => removeMemberFromGroup(button.dataset.userId));
    });

    const isCurrentUserOwner = currentUser && Number(group.owner_id) === Number(currentUser.id);
    const dissolveBtn = document.getElementById("dissolveGroupBtn");
    const leaveBtn = document.getElementById("leaveGroupBtn");

    if (dissolveBtn) dissolveBtn.style.display = isCurrentUserOwner ? "block" : "none";
    if (leaveBtn) leaveBtn.style.display = isCurrentUserOwner ? "none" : "block";

  } catch (err) {
    console.error('Failed to load group members:', err);
    memberListContainer.innerHTML = '<p style="color:var(--ios-red);">メンバー情報の取得に失敗しました</p>';
  }
}

// Create group
export async function createGroup() {
  const nameInput = document.getElementById("newGroupName");
  if (!nameInput) return;

  const name = nameInput.value.trim();
  if (!name) {
    showToast("グループ名を入力してください");
    return;
  }

  try {
    await apiRequest('/api/groups', {
      method: 'POST',
      body: JSON.stringify({ name })
    });
    nameInput.value = "";
    showToast("グループを作成しました ✨");
    await syncGroups();
  } catch (err) {
    console.error('Failed to create group:', err);
  }
}

// Invite user
export async function inviteMember() {
  const emailInput = document.getElementById("inviteUserId");
  if (!emailInput || !selectedGroupId) return;

  const email = emailInput.value.trim();
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    showToast("招待するメールアドレスを入力してください");
    return;
  }

  try {
    await apiRequest(`/api/groups/${selectedGroupId}/invite`, {
      method: 'POST',
      body: JSON.stringify({ email })
    });
    emailInput.value = "";
    showToast("メンバーを招待しました");
    await selectGroupForDetail(selectedGroupId);
    await syncGroups();
  } catch (err) {
    console.error('Failed to invite member:', err);
  }
}

async function updateMemberRole(userId, role) {
  if (!selectedGroupId || !userId) return;

  try {
    await apiRequest(`/api/groups/${selectedGroupId}/role`, {
      method: 'POST',
      body: JSON.stringify({ target_user_id: Number(userId), role })
    });
    showToast("メンバー権限を更新しました");
    await selectGroupForDetail(selectedGroupId);
  } catch (err) {
    console.error('Failed to update member role:', err);
    await selectGroupForDetail(selectedGroupId);
  }
}

async function removeMemberFromGroup(userId) {
  if (!selectedGroupId || !userId) return;

  const confirmed = confirm("このメンバーをグループから削除しますか？");
  if (!confirmed) return;

  try {
    await apiRequest(`/api/groups/${selectedGroupId}/members/${userId}`, {
      method: 'DELETE'
    });
    showToast("メンバーをグループから削除しました");
    await selectGroupForDetail(selectedGroupId);
    await syncGroups();
  } catch (err) {
    console.error('Failed to remove member:', err);
  }
}

// Dissolve group
export async function dissolveGroup() {
  if (!selectedGroupId) return;
  const group = activeGroups.find(g => g.id === selectedGroupId);
  if (!group) return;

  const confirmDissolve = confirm(`本当にグループ「${group.name}」を解散しますか？この操作は取り消せません。`);
  if (!confirmDissolve) return;

  try {
    await apiRequest(`/api/groups/${selectedGroupId}`, {
      method: 'DELETE'
    });
    showToast("グループを解散しました 🗑️");
    selectedGroupId = null;
    document.getElementById("groupDetail")?.classList.add("hidden");
    await syncGroups();
  } catch (err) {
    console.error('Failed to dissolve group:', err);
  }
}

// Leave group
export async function leaveGroup() {
  if (!selectedGroupId || !currentUser) return;
  const group = activeGroups.find(g => g.id === selectedGroupId);
  if (!group) return;

  const confirmLeave = confirm(`本当にグループ「${group.name}」から脱退しますか？`);
  if (!confirmLeave) return;

  try {
    await apiRequest(`/api/groups/${selectedGroupId}/members/${currentUser.id}`, {
      method: 'DELETE'
    });
    showToast("グループから脱退しました");
    selectedGroupId = null;
    document.getElementById("groupDetail")?.classList.add("hidden");
    await syncGroups();
  } catch (err) {
    console.error('Failed to leave group:', err);
  }
}

// Modal Control helper
export function openGroupModal() {
  syncGroups();
  const modal = document.getElementById("groupModal");
  if (modal) modal.style.display = "flex";
}

export function closeGroupModal() {
  const modal = document.getElementById("groupModal");
  if (modal) modal.style.display = "none";
}
