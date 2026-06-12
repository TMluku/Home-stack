import { createLocalRestApi } from "./api/local-rest-api.js";
import { buildReplenishmentQueue, calculateDaysLeft, getRecommendedOffers, getUrgency } from "./core/replenishment.js";
import { createDefaultState, detectedInventoryCandidates, normalizeState, STORAGE_KEY } from "./data/demo-state.js";
import { baseOffers } from "./data/offers.js";

const yenFormatter = new Intl.NumberFormat("ja-JP", {
  style: "currency",
  currency: "JPY",
  maximumFractionDigits: 0,
});

const inventoryList = document.querySelector("#inventory-list");
const offerList = document.querySelector("#offer-list");
const fileInput = document.querySelector("#stock-photo");
const photoPreview = document.querySelector("#photo-preview");
const scanState = document.querySelector("#scan-state");
const generatePlanButton = document.querySelector("#generate-plan");
const addItemForm = document.querySelector("#add-item-form");
const householdForm = document.querySelector("#household-form");
const settingsState = document.querySelector("#settings-state");
const metricItems = document.querySelector("#metric-items");
const metricClicks = document.querySelector("#metric-clicks");
const metricSponsored = document.querySelector("#metric-sponsored");
const metricRevenue = document.querySelector("#metric-revenue");
const filterButtons = document.querySelectorAll("[data-filter]");
const replenishmentList = document.querySelector("#replenishment-list");
const notificationPreview = document.querySelector("#notification-preview");
const autopilotForm = document.querySelector("#autopilot-form");
const autopilotState = document.querySelector("#autopilot-state");
const autopilotSummary = document.querySelector("#autopilot-summary");
const exportStateButton = document.querySelector("#export-state");
const resetStateButton = document.querySelector("#reset-state");
const privacyState = document.querySelector("#privacy-state");

let state = loadState();

const api = createLocalRestApi({
  getState: () => state,
  setState: (nextState) => {
    state = normalizeState(nextState);
  },
  saveState,
  createDefaultState,
  createDetectedItem: createItemFromUpload,
  offers: baseOffers,
});

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return normalizeState(saved);
  } catch {
    return createDefaultState();
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"]/g, (character) => {
    const entities = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
    return entities[character];
  });
}

function renderInventory() {
  const sortedInventory = [...state.inventory].sort((a, b) => calculateDaysLeft(a, state.household) - calculateDaysLeft(b, state.household));

  inventoryList.innerHTML = sortedInventory
    .map((item) => {
      const daysLeft = calculateDaysLeft(item, state.household);
      const urgency = getUrgency(daysLeft);
      return `
        <article class="inventory-item inventory-item--${urgency}">
          <div class="inventory-item__top">
            <div>
              <strong>${escapeHtml(item.name)}</strong>
              <p>${escapeHtml(item.category)} / あと${daysLeft}日目安</p>
            </div>
            <strong>${item.stock}%</strong>
          </div>
          <div class="progress" aria-label="残量 ${item.stock}%">
            <span style="width: ${item.stock}%"></span>
          </div>
          <p>${escapeHtml(item.note)}</p>
          <div class="inventory-actions">
            <button type="button" data-action="decrease" data-id="${item.id}">-10%</button>
            <button type="button" data-action="increase" data-id="${item.id}">+10%</button>
            <button type="button" data-action="toggle-auto" data-id="${item.id}">
              ${item.autoReplenish ? "自動補充ON" : "自動補充OFF"}
            </button>
            <button type="button" data-action="remove" data-id="${item.id}" aria-label="${escapeHtml(item.name)}を削除">削除</button>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderOffers() {
  const offers = getRecommendedOffers(state, baseOffers);

  offerList.innerHTML = offers
    .map(
      (offer) => `
        <article class="offer-card">
          <span class="offer-card__label offer-card__label--${offer.labelType}">${offer.label}</span>
          <h3>${escapeHtml(offer.title)}</h3>
          <div class="offer-card__price">${yenFormatter.format(offer.price)}</div>
          <dl class="offer-details">
            <div><dt>購入先</dt><dd>${escapeHtml(offer.retailer)}</dd></div>
            <div><dt>単価</dt><dd>${escapeHtml(offer.unitPrice)}</dd></div>
            <div><dt>送料/還元</dt><dd>${escapeHtml(offer.shipping)}・${escapeHtml(offer.points)}</dd></div>
          </dl>
          <p>${escapeHtml(offer.detail)}</p>
          <small>${escapeHtml(offer.reason)}</small>
          <button class="link-button" type="button" data-offer-id="${offer.id}" data-offer-type="${offer.labelType}">
            ${escapeHtml(offer.linkText)} →
          </button>
        </article>
      `,
    )
    .join("");
}

function renderHouseholdForm() {
  householdForm.adults.value = state.household.adults;
  householdForm.children.value = state.household.children;
  householdForm.pets.value = state.household.pets;
  householdForm.channel.value = state.household.channel;
  householdForm.allowSponsored.checked = state.household.allowSponsored;
  householdForm.deletePhoto.checked = state.household.deletePhoto;
}

function renderAutopilotForm() {
  autopilotForm.enabled.checked = state.autopilot.enabled;
  autopilotForm.maxAmount.value = state.autopilot.maxAmount;
  autopilotForm.cancelWindowHours.value = state.autopilot.cancelWindowHours;
  autopilotForm.brandPolicy.value = state.autopilot.brandPolicy;
  autopilotForm.deliveryPolicy.value = state.autopilot.deliveryPolicy;
  autopilotForm.requireApprovalForSponsored.checked = state.autopilot.requireApprovalForSponsored;
}

function renderFilters() {
  filterButtons.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.filter === state.activeFilter);
  });
}

function renderMetrics() {
  metricItems.textContent = state.inventory.length;
  metricClicks.textContent = state.metrics.clicks;
  metricSponsored.textContent = state.metrics.sponsoredClicks;
  metricRevenue.textContent = yenFormatter.format(state.metrics.estimatedRevenue);
}

function renderAutopilotSummary() {
  const allowedCount = state.inventory.filter((item) => item.autoReplenish).length;
  const reservableCount = buildReplenishmentQueue(state, baseOffers).filter((entry) => entry.autoReservable).length;
  const status = state.autopilot.enabled ? "有効" : "無効";
  autopilotSummary.innerHTML = `
    <strong>自動購入予約: ${status}</strong>
    <p>許可済み商品 ${allowedCount}件 / 今すぐ自動予約できる候補 ${reservableCount}件。1回の上限は${yenFormatter.format(state.autopilot.maxAmount)}、キャンセル猶予は${state.autopilot.cancelWindowHours}時間です。</p>
    <small>実決済は未実装です。将来は小売API・決済トークン・購入前通知・キャンセル導線を接続します。</small>
  `;
}

function renderNotificationPreview() {
  const queue = buildReplenishmentQueue(state, baseOffers).filter((entry) => entry.decision === "pending");
  const firstEntry = queue[0];

  if (!firstEntry) {
    notificationPreview.innerHTML = `
      <strong>通知プレビュー</strong>
      <p>14日以内に切れそうな商品はありません。次回の再撮影または残量更新を待ちます。</p>
    `;
    return;
  }

  notificationPreview.innerHTML = `
    <strong>${state.household.channel.toUpperCase()}通知プレビュー</strong>
    <p>${escapeHtml(firstEntry.item.name)}があと${firstEntry.item.daysLeft}日で切れそうです。${escapeHtml(firstEntry.offer.retailer)}で${yenFormatter.format(firstEntry.offer.price)}、${escapeHtml(firstEntry.offer.shipping)}です。</p>
    <small>広告提案は明示し、自動購入では勝手にブランド変更しません。</small>
  `;
}

function renderReplenishmentQueue() {
  const queue = buildReplenishmentQueue(state, baseOffers);

  if (queue.length === 0) {
    replenishmentList.innerHTML = '<p class="empty-state">補充候補はありません。在庫を追加するか残量を下げると表示されます。</p>';
    return;
  }

  replenishmentList.innerHTML = queue
    .map(
      ({ item, offer, decision, autoReservable, estimatedRevenue }) => `
        <article class="queue-item queue-item--${decision}">
          <div>
            <span class="notice-card__tag">あと${item.daysLeft}日</span>
            <h3>${escapeHtml(item.name)}</h3>
            <p>${escapeHtml(offer.title)} / ${escapeHtml(offer.retailer)} / ${yenFormatter.format(offer.price)}</p>
            <small>${escapeHtml(offer.points)}・推定送客収益 ${yenFormatter.format(estimatedRevenue)}</small>
          </div>
          <div class="queue-actions">
            <button type="button" data-queue-action="approve" data-item-id="${item.id}" data-revenue="${estimatedRevenue}">承認</button>
            <button type="button" data-queue-action="auto-reserve" data-item-id="${item.id}" data-revenue="${estimatedRevenue}" ${autoReservable ? "" : "disabled"}>自動予約</button>
            <button type="button" data-queue-action="snooze" data-item-id="${item.id}">3日後</button>
            <button type="button" data-queue-action="cancel" data-item-id="${item.id}">今回は不要</button>
          </div>
        </article>
      `,
    )
    .join("");
}

function renderApp() {
  renderInventory();
  renderOffers();
  renderFilters();
  renderMetrics();
  renderAutopilotSummary();
  renderNotificationPreview();
  renderReplenishmentQueue();
}

function createItemFromUpload(index) {
  const [name, category, stock, dailyUsage, note] = detectedInventoryCandidates[index % detectedInventoryCandidates.length];
  return { id: `detected-${Date.now()}-${index}`, name, category, stock, dailyUsage, autoReplenish: false, note };
}

async function handlePhotoUpload(event) {
  const [file] = event.target.files;

  if (!file) {
    return;
  }

  const previewUrl = URL.createObjectURL(file);
  photoPreview.style.backgroundImage = `url(${previewUrl})`;
  photoPreview.hidden = false;
  scanState.textContent = state.household.deletePhoto ? "解析後削除" : "解析デモ";

  await api.request("POST", "/photo-detections");
  renderApp();
}

async function handleInventoryAction(event) {
  const button = event.target.closest("button[data-action]");

  if (!button) return;

  const { action, id } = button.dataset;
  const item = state.inventory.find((candidate) => candidate.id === id);
  if (!item) return;

  if (action === "remove") {
    await api.request("DELETE", `/inventory/${id}`);
  } else if (action === "decrease") {
    await api.request("PATCH", `/inventory/${id}`, { stockDelta: -10 });
  } else if (action === "increase") {
    await api.request("PATCH", `/inventory/${id}`, { stockDelta: 10 });
  } else if (action === "toggle-auto") {
    await api.request("PATCH", `/inventory/${id}`, { autoReplenish: !item.autoReplenish });
  }

  renderApp();
}

async function handleAddItem(event) {
  event.preventDefault();
  const formData = new FormData(addItemForm);
  const name = formData.get("name").toString().trim();

  if (!name) return;

  const response = await api.request("POST", "/inventory", {
    name,
    category: formData.get("category").toString(),
    stock: Number(formData.get("stock")) || 50,
    dailyUsage: Number(formData.get("dailyUsage")) || 5,
    autoReplenish: false,
    note: "手動登録。在庫操作から残量を調整できます。",
  });

  if (!response.ok) return;

  addItemForm.reset();
  document.querySelector("#item-stock").value = 50;
  document.querySelector("#item-usage").value = 5;
  renderApp();
}

async function handleAutopilotSave(event) {
  event.preventDefault();
  const formData = new FormData(autopilotForm);
  const response = await api.request("PUT", "/settings/autopilot", {
    enabled: formData.has("enabled"),
    maxAmount: Number(formData.get("maxAmount")) || 5000,
    cancelWindowHours: Number(formData.get("cancelWindowHours")) || 24,
    brandPolicy: formData.get("brandPolicy").toString(),
    deliveryPolicy: formData.get("deliveryPolicy").toString(),
    requireApprovalForSponsored: formData.has("requireApprovalForSponsored"),
  });

  if (!response.ok) return;
  autopilotState.textContent = state.autopilot.enabled ? "自動購入予約ルールを保存しました" : "自動購入予約は無効です";
  renderApp();
}

async function handleHouseholdSave(event) {
  event.preventDefault();
  const formData = new FormData(householdForm);
  const response = await api.request("PUT", "/settings/household", {
    adults: Number(formData.get("adults")) || 1,
    children: Number(formData.get("children")) || 0,
    pets: Number(formData.get("pets")) || 0,
    channel: formData.get("channel").toString(),
    allowSponsored: formData.has("allowSponsored"),
    deletePhoto: formData.has("deletePhoto"),
  });

  if (!response.ok) return;
  settingsState.textContent = `${state.household.channel.toUpperCase()}通知ルールを保存しました`;
  renderApp();
}

async function refreshPlan() {
  await api.request("POST", "/replenishment-plan/refresh");
  renderApp();
  generatePlanButton.textContent = "消費ペースを反映しました";
  window.setTimeout(() => {
    generatePlanButton.textContent = "補充提案を更新";
  }, 1800);
}

async function handleOfferClick(event) {
  const button = event.target.closest("button[data-offer-id]");

  if (!button) return;

  const response = await api.request("POST", `/offers/${button.dataset.offerId}/click`);
  if (!response.ok) return;
  renderMetrics();
  button.textContent = "クリックを記録しました ✓";
}

async function handleFilterClick(event) {
  const button = event.target.closest("[data-filter]");

  if (!button) return;

  await api.request("PUT", "/ui/offer-filter", { filter: button.dataset.filter });
  renderApp();
}

async function handleQueueAction(event) {
  const button = event.target.closest("button[data-queue-action]");

  if (!button) return;

  const { queueAction, itemId } = button.dataset;
  await api.request("PATCH", `/queue/${itemId}`, {
    action: queueAction,
    estimatedRevenue: Number(button.dataset.revenue) || 0,
  });
  renderApp();
}

async function exportDemoState() {
  const response = await api.request("GET", "/state/export");
  if (!response.ok) return;
  const data = JSON.stringify(response.data, null, 2);
  navigator.clipboard?.writeText(data);
  privacyState.textContent = "デモデータをクリップボードへ書き出しました";
}

async function resetDemoState() {
  await api.request("POST", "/state/reset");
  renderHouseholdForm();
  renderAutopilotForm();
  renderApp();
  privacyState.textContent = "端末内データをリセットしました";
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js");
  });
}

fileInput.addEventListener("change", handlePhotoUpload);
inventoryList.addEventListener("click", handleInventoryAction);
addItemForm.addEventListener("submit", handleAddItem);
householdForm.addEventListener("submit", handleHouseholdSave);
autopilotForm.addEventListener("submit", handleAutopilotSave);
generatePlanButton.addEventListener("click", refreshPlan);
offerList.addEventListener("click", handleOfferClick);
replenishmentList.addEventListener("click", handleQueueAction);
filterButtons.forEach((button) => button.addEventListener("click", handleFilterClick));
exportStateButton.addEventListener("click", exportDemoState);
resetStateButton.addEventListener("click", resetDemoState);

renderHouseholdForm();
renderAutopilotForm();
renderApp();
