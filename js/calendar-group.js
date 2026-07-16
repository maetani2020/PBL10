// calendar-group.js
// Group sharing and group management with PostgreSQL backend integration

import { apiRequest, currentUser } from './calendar-auth.js';
import { showToast, showFieldError, clearFieldErrors } from './calendar-state.js';

let activeGroups = [];
let activeGroupInvitations = [];
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

function invitationStatusLabel(status) {
  if (status === "accepted") return "参加済み";
  if (status === "declined") return "拒否済み";
  return "承認待ち";
}

function invitationStatusClass(status) {
  if (status === "accepted") return "accepted";
  if (status === "declined") return "declined";
  return "pending";
}

function formatInvitationDate(value) {
  if (!value) return "-";
  return String(value).replace("T", " ").slice(0, 16);
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
    const [groups, invitations] = await Promise.all([
      apiRequest('/api/groups'),
      apiRequest('/api/groups/invitations').catch(() => [])
    ]);
    activeGroups = groups;
    activeGroupInvitations = invitations;
    populateGroupDropdowns();
    renderGroupList();
    if (selectedGroupId && activeGroups.some(g => Number(g.id) === Number(selectedGroupId))) {
      await selectGroupForDetail(selectedGroupId);
    }
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
  const pendingInvitations = activeGroupInvitations.filter(inv => inv.status === "pending");

  if (activeGroups.length === 0 && pendingInvitations.length === 0) {
    container.innerHTML = '<p style="text-align:center; padding:10px; opacity:0.7;">所属しているグループはありません</p>';
    return;
  }

  if (pendingInvitations.length > 0) {
    const invitationSection = document.createElement("div");
    invitationSection.className = "group-invitation-section";
    invitationSection.innerHTML = `
      <div class="group-invitation-title">届いている招待</div>
      ${pendingInvitations.map(inv => `
        <div class="invitation-list-item">
          <div class="member-profile">
            <strong>${escapeHtml(inv.group_name || "No group")}</strong>
            <small>招待者: ${escapeHtml(inv.inviter_name || inv.inviter_email || "-")} / 権限: ${roleLabel(inv.role)}</small>
          </div>
          <div class="member-controls">
            <span class="invitation-status-chip ${invitationStatusClass(inv.status)}">${invitationStatusLabel(inv.status)}</span>
            <button type="button" class="invitation-accept-btn primary-btn" data-invitation-id="${inv.id}">参加</button>
            <button type="button" class="invitation-decline-btn danger-btn" data-invitation-id="${inv.id}">拒否</button>
          </div>
        </div>
      `).join("")}
    `;
    container.appendChild(invitationSection);
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
        ${Number(g.pending_invitation_count || 0) > 0 ? `<span class="invitation-status-chip pending" style="margin-left:8px;">招待中 ${g.pending_invitation_count}</span>` : ""}
      </div>
      <span class="material-icons" style="font-size:16px; opacity:0.5;">chevron_right</span>
    `;

    item.addEventListener("click", () => {
      selectGroupForDetail(g.id);
    });

    container.appendChild(item);
  });

  container.querySelectorAll(".invitation-accept-btn").forEach(button => {
    button.addEventListener("click", event => {
      event.stopPropagation();
      respondToGroupInvitation(button.dataset.invitationId, "accepted");
    });
  });

  container.querySelectorAll(".invitation-decline-btn").forEach(button => {
    button.addEventListener("click", event => {
      event.stopPropagation();
      respondToGroupInvitation(button.dataset.invitationId, "declined");
    });
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
    const canInviteMembers = ["admin", "editor"].includes(group.role);
    
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

    if (canInviteMembers) {
      const invitations = (await apiRequest(`/api/groups/${groupId}/invitations`).catch(() => []))
        .filter(inv => inv.status === "pending");
      const invitationStatus = document.createElement("div");
      invitationStatus.className = "group-invitation-section compact";
      invitationStatus.innerHTML = `
        <div class="group-invitation-title">招待状態</div>
        ${invitations.length ? invitations.map(inv => `
          <div class="invitation-list-item">
            <div class="member-profile">
              <strong>${escapeHtml(inv.invited_name || "No name")}</strong>
              <small>${escapeHtml(inv.invited_email || "")}</small>
              <small>送信: ${formatInvitationDate(inv.created_at)} / 返答: ${formatInvitationDate(inv.responded_at)}</small>
            </div>
            <div class="member-controls">
              <span class="invitation-status-chip ${invitationStatusClass(inv.status)}">${invitationStatusLabel(inv.status)}</span>
            </div>
          </div>
        `).join("") : '<p class="group-invitation-empty">招待中のユーザーはいません</p>'}
      `;
      memberListContainer.appendChild(invitationStatus);
    }

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

    const inviteInput = document.getElementById("inviteUserId");
    const inviteBtn = document.getElementById("inviteMemberBtn");
    if (inviteInput) {
      inviteInput.disabled = !canInviteMembers;
      inviteInput.placeholder = canInviteMembers ? "招待するメールアドレス" : "招待は管理者または編集者のみ可能";
    }
    if (inviteBtn) inviteBtn.disabled = !canInviteMembers;

  } catch (err) {
    console.error('Failed to load group members:', err);
    memberListContainer.innerHTML = '<p style="color:var(--ios-red);">メンバー情報の取得に失敗しました</p>';
  }
}

async function respondToGroupInvitation(invitationId, status) {
  if (!invitationId) return;

  const confirmed = status === "accepted"
    ? confirm("このグループ招待を承認して参加しますか？")
    : confirm("このグループ招待を拒否しますか？");
  if (!confirmed) return;

  try {
    const data = await apiRequest(`/api/groups/invitations/${invitationId}/respond`, {
      method: "POST",
      body: JSON.stringify({ status })
    });
    showToast(data.message || (status === "accepted" ? "グループに参加しました" : "招待を拒否しました"));
    await syncGroups();
  } catch (err) {
    console.error("Failed to respond group invitation:", err);
    showToast(err.message || "招待への返答に失敗しました");
  }
}

// Create group
export async function createGroup() {
  const nameInput = document.getElementById("newGroupName");
  if (!nameInput) return;

  clearFieldErrors(document.getElementById("groupModal"));
  const name = nameInput.value.trim();
  if (!name) {
    return showFieldError(nameInput, "グループ名を入力してください");
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
    showToast(err.message || "グループの作成に失敗しました");
  }
}

// Invite user
export async function inviteMember() {
  const emailInput = document.getElementById("inviteUserId");
  if (!emailInput || !selectedGroupId) return;

  clearFieldErrors(document.getElementById("groupModal"));
  const email = emailInput.value.trim();
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return showFieldError(emailInput, "招待するメールアドレスを入力してください");
  }

  if (!email.toLowerCase().endsWith("@oic-ok.ac.jp")) {
    return showFieldError(emailInput, "招待できるメールアドレスは @oic-ok.ac.jp のみです");
  }

  try {
    await apiRequest(`/api/groups/${selectedGroupId}/invite`, {
      method: 'POST',
      body: JSON.stringify({ email })
    });
    emailInput.value = "";
    showToast("招待を送信しました");
    await selectGroupForDetail(selectedGroupId);
    await syncGroups();
  } catch (err) {
    console.error('Failed to invite member:', err);
    showToast(err.message || "メンバー招待に失敗しました");
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
    showToast(err.message || "メンバー権限の更新に失敗しました");
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
    showToast(err.message || "メンバー削除に失敗しました");
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
    showToast(err.message || "グループの解散に失敗しました");
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
    showToast(err.message || "グループからの脱退に失敗しました");
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
