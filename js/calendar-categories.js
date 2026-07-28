// calendar-categories.js
// User-defined event categories with colors (localStorage)

import { showToast } from './calendar-state.js';

const CATEGORIES_STORAGE_KEY = "shared_calendar_categories";

export const DEFAULT_CATEGORIES = [
  { id: "cat_work", name: "仕事", color: "#007AFF" },
  { id: "cat_private", name: "プライベート", color: "#34C759" },
  { id: "cat_school", name: "学校", color: "#FF9500" },
  { id: "cat_health", name: "健康", color: "#FF2D55" },
  { id: "cat_other", name: "その他", color: "#5856D6" }
];

export const CATEGORY_COLOR_PRESETS = [
  "#007AFF",
  "#34C759",
  "#FF9500",
  "#FF2D55",
  "#5856D6",
  "#AF52DE",
  "#00C7BE",
  "#FFCC00",
  "#8E8E93",
  "#FF3B30"
];

function createCategoryId() {
  return `cat_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

export function normalizeCategoryColor(color, fallback = "#007AFF") {
  const value = String(color || "").trim();
  if (/^#[0-9A-Fa-f]{6}$/.test(value)) return value.toUpperCase();
  return fallback;
}

function escapeAttr(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

function normalizeCategory(raw) {
  if (!raw || typeof raw !== "object") return null;
  const name = String(raw.name || "").trim();
  if (!name) return null;
  const id = String(raw.id || "").trim() || createCategoryId();
  return {
    id: id.slice(0, 64),
    name: name.slice(0, 40),
    color: normalizeCategoryColor(raw.color)
  };
}

export function getCategories() {
  try {
    const raw = localStorage.getItem(CATEGORIES_STORAGE_KEY);
    if (!raw) {
      saveCategories(DEFAULT_CATEGORIES);
      return DEFAULT_CATEGORIES.map((c) => ({ ...c }));
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      saveCategories(DEFAULT_CATEGORIES);
      return DEFAULT_CATEGORIES.map((c) => ({ ...c }));
    }
    const categories = parsed.map(normalizeCategory).filter(Boolean);
    if (categories.length === 0) {
      saveCategories(DEFAULT_CATEGORIES);
      return DEFAULT_CATEGORIES.map((c) => ({ ...c }));
    }
    return categories;
  } catch (err) {
    console.error("Failed to read categories:", err);
    return DEFAULT_CATEGORIES.map((c) => ({ ...c }));
  }
}

export function saveCategories(categories) {
  const normalized = (Array.isArray(categories) ? categories : [])
    .map(normalizeCategory)
    .filter(Boolean);
  localStorage.setItem(CATEGORIES_STORAGE_KEY, JSON.stringify(normalized));
  document.dispatchEvent(new CustomEvent("categories:updated"));
  return normalized;
}

export function getCategoryById(id) {
  if (!id) return null;
  return getCategories().find((c) => c.id === id) || null;
}

export function findCategoryForEvent(event) {
  if (!event) return null;
  const byId = getCategoryById(event.category_id || event.categoryId);
  if (byId) return byId;
  const color = normalizeCategoryColor(event.color, "");
  if (!color) return null;
  return getCategories().find((c) => normalizeCategoryColor(c.color) === color) || null;
}

export function addCategory(name, color) {
  const categories = getCategories();
  const category = normalizeCategory({
    id: createCategoryId(),
    name,
    color
  });
  if (!category) {
    showToast("カテゴリ名を入力してください");
    return null;
  }
  if (categories.some((c) => c.name === category.name)) {
    showToast("同じ名前のカテゴリがあります");
    return null;
  }
  categories.push(category);
  saveCategories(categories);
  showToast(`「${category.name}」を追加しました`);
  return category;
}

export function updateCategory(id, patch = {}) {
  const categories = getCategories();
  const index = categories.findIndex((c) => c.id === id);
  if (index < 0) return null;

  const next = normalizeCategory({
    ...categories[index],
    ...patch,
    id
  });
  if (!next) {
    showToast("カテゴリ名を入力してください");
    return null;
  }

  if (categories.some((c) => c.id !== id && c.name === next.name)) {
    showToast("同じ名前のカテゴリがあります");
    return null;
  }

  categories[index] = next;
  saveCategories(categories);
  return next;
}

export function deleteCategory(id) {
  const categories = getCategories();
  if (categories.length <= 1) {
    showToast("カテゴリは最低1つ必要です");
    return false;
  }
  const next = categories.filter((c) => c.id !== id);
  if (next.length === categories.length) return false;
  saveCategories(next);
  showToast("カテゴリを削除しました");
  return true;
}

export function resetCategoriesToDefault() {
  saveCategories(DEFAULT_CATEGORIES);
  showToast("カテゴリを初期状態に戻しました");
}

export function populateEventCategorySelect(selectedId = "", selectedColor = "") {
  const select = document.getElementById("eventCategory");
  if (!select) return;

  const categories = getCategories();
  const matched = findCategoryForEvent({ category_id: selectedId, color: selectedColor });
  const resolvedId = (matched && categories.some((c) => c.id === matched.id))
    ? matched.id
    : (categories[0]?.id || "");

  select.innerHTML = categories.map((category) => `
    <option value="${escapeAttr(category.id)}" data-color="${escapeAttr(category.color)}">
      ${escapeAttr(category.name)}
    </option>
  `).join("");

  if (resolvedId) select.value = resolvedId;
  syncEventCategoryColorPreview();
}

export function getSelectedEventCategory() {
  const select = document.getElementById("eventCategory");
  const categoryId = select?.value || "";
  const category = getCategoryById(categoryId) || getCategories()[0] || DEFAULT_CATEGORIES[0];
  return {
    category_id: category?.id || "",
    color: normalizeCategoryColor(category?.color)
  };
}

export function syncEventCategoryColorPreview() {
  const select = document.getElementById("eventCategory");
  const preview = document.getElementById("eventCategoryColorPreview");
  if (!select || !preview) return;
  const option = select.selectedOptions?.[0];
  const color = normalizeCategoryColor(option?.dataset?.color || getSelectedEventCategory().color);
  preview.style.backgroundColor = color;
  preview.title = color;
}

function renderPresetColors(container, selectedColor, onPick) {
  if (!container) return;
  container.innerHTML = "";
  CATEGORY_COLOR_PRESETS.forEach((color) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "category-color-swatch";
    btn.style.backgroundColor = color;
    btn.title = color;
    btn.setAttribute("aria-label", `色 ${color}`);
    if (normalizeCategoryColor(selectedColor) === color) {
      btn.classList.add("is-selected");
    }
    btn.addEventListener("click", () => onPick(color));
    container.appendChild(btn);
  });
}

function refreshNewCategoryColorPresets() {
  const colorInput = document.getElementById("newCategoryColor");
  const selected = colorInput?.value || "#007AFF";
  renderPresetColors(document.getElementById("newCategoryColorPresets"), selected, (color) => {
    if (colorInput) colorInput.value = color;
    refreshNewCategoryColorPresets();
  });
}

export function renderCategorySettingsList() {
  const list = document.getElementById("categorySettingsList");
  if (!list) return;

  const categories = getCategories();
  list.innerHTML = "";

  categories.forEach((category) => {
    const row = document.createElement("div");
    row.className = "category-settings-item";
    row.dataset.id = category.id;

    row.innerHTML = `
      <input type="color" class="category-item-color" value="${escapeAttr(category.color)}" title="色を変更" aria-label="${escapeAttr(category.name)}の色" />
      <input type="text" class="category-item-name" maxlength="40" value="${escapeAttr(category.name)}" aria-label="カテゴリ名" />
      <button type="button" class="category-item-delete" title="削除" aria-label="${escapeAttr(category.name)}を削除">
        <span class="material-icons">delete</span>
      </button>
    `;

    const colorInput = row.querySelector(".category-item-color");
    const nameInput = row.querySelector(".category-item-name");
    const deleteBtn = row.querySelector(".category-item-delete");

    colorInput.addEventListener("change", () => {
      updateCategory(category.id, { color: colorInput.value });
      renderCategorySettingsList();
      populateEventCategorySelect(document.getElementById("eventCategory")?.value || "", "");
    });

    nameInput.addEventListener("change", () => {
      const updated = updateCategory(category.id, { name: nameInput.value });
      if (!updated) {
        nameInput.value = category.name;
        return;
      }
      renderCategorySettingsList();
      populateEventCategorySelect(document.getElementById("eventCategory")?.value || "", "");
    });

    deleteBtn.addEventListener("click", () => {
      if (!deleteCategory(category.id)) return;
      renderCategorySettingsList();
      populateEventCategorySelect(document.getElementById("eventCategory")?.value || "", "");
    });

    list.appendChild(row);
  });
}

export function openCategorySettingsModal() {
  const modal = document.getElementById("categorySettingsModal");
  if (!modal) return;

  const nameInput = document.getElementById("newCategoryName");
  const colorInput = document.getElementById("newCategoryColor");
  if (nameInput) nameInput.value = "";
  if (colorInput) colorInput.value = "#007AFF";

  renderCategorySettingsList();
  refreshNewCategoryColorPresets();
  modal.style.display = "flex";
}

export function closeCategorySettingsModal() {
  const modal = document.getElementById("categorySettingsModal");
  if (modal) modal.style.display = "none";
}

export function initCategorySettingsUI() {
  document.getElementById("categorySettingsBtn")?.addEventListener("click", openCategorySettingsModal);
  document.getElementById("closeCategorySettingsBtn")?.addEventListener("click", closeCategorySettingsModal);

  document.getElementById("addCategoryBtn")?.addEventListener("click", () => {
    const name = document.getElementById("newCategoryName")?.value || "";
    const color = document.getElementById("newCategoryColor")?.value || "#007AFF";
    const created = addCategory(name, color);
    if (!created) return;
    const nameInput = document.getElementById("newCategoryName");
    if (nameInput) nameInput.value = "";
    renderCategorySettingsList();
    populateEventCategorySelect(created.id, created.color);
  });

  document.getElementById("resetCategoriesBtn")?.addEventListener("click", () => {
    resetCategoriesToDefault();
    renderCategorySettingsList();
    populateEventCategorySelect();
  });

  document.getElementById("newCategoryColor")?.addEventListener("input", refreshNewCategoryColorPresets);
  document.getElementById("eventCategory")?.addEventListener("change", syncEventCategoryColorPreview);

  document.addEventListener("categories:updated", () => {
    const current = document.getElementById("eventCategory")?.value || "";
    populateEventCategorySelect(current, "");
  });

  getCategories();
  populateEventCategorySelect();
}
