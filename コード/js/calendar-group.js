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

  const group = activeGroups.find(g => g.id === groupId);
  if (!group) {
    detailPanel.classList.add("hidden");
    return;
  }

  titleEl.textContent = `「${group.name}」詳細`;
  detailPanel.classList.remove("hidden");

  // Fetch members
  try {
    const members = await apiRequest(`/api/groups/${groupId}/members`);
    memberListContainer.innerHTML = "";
    
    members.forEach(m => {
      const isOwner = group.owner_id === m.id;
      const roleText = isOwner ? "オーナー" : (m.role === "editor" ? "編集者" : "閲覧者");
      
      const mDiv = document.createElement("div");
      mDiv.className = "member-list-item";
      mDiv.style.display = "flex";
      mDiv.style.justifyContent = "space-between";
      mDiv.style.padding = "6px 0";
      mDiv.style.borderBottom = "1px solid var(--border)";
      mDiv.innerHTML = `
        <span>${m.display_name} <small style="opacity:0.6;">(${m.id})</small></span>
        <span style="font-size:12px; font-weight:600; opacity:0.8;">${roleText}</span>
      `;
      memberListContainer.appendChild(mDiv);
    });

    // Update action button states based on role
    const isCurrentUserOwner = group.owner_id === currentUser.id;
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
  const idInput = document.getElementById("inviteUserId");
  if (!idInput || !selectedGroupId) return;

  const userId = parseInt(idInput.value.trim());
  if (isNaN(userId)) {
    showToast("有効なユーザーIDを入力してください");
    return;
  }

  try {
    await apiRequest(`/api/groups/${selectedGroupId}/invite`, {
      method: 'POST',
      body: JSON.stringify({ user_id: userId })
    });
    idInput.value = "";
    showToast("メンバーを招待しました ✉️");
    selectGroupForDetail(selectedGroupId);
  } catch (err) {
    console.error('Failed to invite member:', err);
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
