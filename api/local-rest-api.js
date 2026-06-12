const CATEGORY_OPTIONS = new Set(["ペット用品", "ベビー用品", "洗濯・掃除", "紙用品", "食品・飲料"]);
const CHANNEL_OPTIONS = new Set(["line", "email", "webpush"]);
const BRAND_POLICY_OPTIONS = new Set(["never", "cheaper-confirm", "allow-same-spec"]);
const DELIVERY_POLICY_OPTIONS = new Set(["standard", "fast"]);
const FILTER_OPTIONS = new Set(["all", "lowest", "sponsored"]);
const QUEUE_ACTION_OPTIONS = new Set(["approve", "auto-reserve", "snooze", "cancel"]);

function clampNumber(value, { min, max, fallback }) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function clone(value) {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

function createId(prefix = "resource") {
  if (globalThis.crypto?.randomUUID) {
    return `${prefix}-${globalThis.crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function ok(data, status = 200) {
  return { ok: true, status, data, error: null };
}

function fail(status, message, details = {}) {
  return { ok: false, status, data: null, error: { message, details } };
}

function parsePath(path) {
  return path.split("?")[0].split("/").filter(Boolean).map(decodeURIComponent);
}

function sanitizeInventoryItem(payload) {
  const name = String(payload?.name || "").trim();
  if (!name) {
    return { error: "商品名は必須です。" };
  }

  const category = CATEGORY_OPTIONS.has(payload?.category) ? payload.category : "洗濯・掃除";

  return {
    value: {
      id: payload?.id || createId("item"),
      name,
      category,
      stock: clampNumber(payload?.stock, { min: 5, max: 100, fallback: 50 }),
      dailyUsage: clampNumber(payload?.dailyUsage, { min: 1, max: 30, fallback: 5 }),
      autoReplenish: Boolean(payload?.autoReplenish),
      note: String(payload?.note || "手動登録。在庫操作から残量を調整できます。"),
    },
  };
}

function sanitizeHousehold(payload) {
  return {
    adults: clampNumber(payload?.adults, { min: 1, max: 8, fallback: 1 }),
    children: clampNumber(payload?.children, { min: 0, max: 8, fallback: 0 }),
    pets: clampNumber(payload?.pets, { min: 0, max: 8, fallback: 0 }),
    channel: CHANNEL_OPTIONS.has(payload?.channel) ? payload.channel : "line",
    allowSponsored: Boolean(payload?.allowSponsored),
    deletePhoto: Boolean(payload?.deletePhoto),
  };
}

function sanitizeAutopilot(payload) {
  return {
    enabled: Boolean(payload?.enabled),
    maxAmount: clampNumber(payload?.maxAmount, { min: 500, max: 50000, fallback: 5000 }),
    cancelWindowHours: clampNumber(payload?.cancelWindowHours, { min: 6, max: 48, fallback: 24 }),
    brandPolicy: BRAND_POLICY_OPTIONS.has(payload?.brandPolicy) ? payload.brandPolicy : "never",
    deliveryPolicy: DELIVERY_POLICY_OPTIONS.has(payload?.deliveryPolicy) ? payload.deliveryPolicy : "standard",
    requireApprovalForSponsored: Boolean(payload?.requireApprovalForSponsored),
  };
}

export function createLocalRestApi({ getState, setState, saveState, createDefaultState, createDetectedItem, offers }) {
  function commit(mutator) {
    const draft = clone(getState());
    const data = mutator(draft);
    setState(draft);
    saveState();
    return data;
  }

  function findOffer(id) {
    return offers.find((offer) => offer.id === id);
  }

  return {
    async request(method, path, body = {}) {
      const verb = method.toUpperCase();
      const [resource, id, subresource] = parsePath(path);

      if (verb === "GET" && resource === "inventory") {
        return ok(getState().inventory);
      }

      if (verb === "POST" && resource === "inventory") {
        const sanitized = sanitizeInventoryItem(body);
        if (sanitized.error) return fail(422, sanitized.error);
        const data = commit((draft) => {
          draft.inventory.push(sanitized.value);
          return sanitized.value;
        });
        return ok(data, 201);
      }

      if (verb === "PATCH" && resource === "inventory" && id) {
        const data = commit((draft) => {
          const item = draft.inventory.find((candidate) => candidate.id === id);
          if (!item) return null;
          if (body.stockDelta) item.stock = clampNumber(item.stock + Number(body.stockDelta), { min: 5, max: 100, fallback: item.stock });
          if (typeof body.autoReplenish === "boolean") item.autoReplenish = body.autoReplenish;
          if (body.name) item.name = String(body.name).trim();
          if (CATEGORY_OPTIONS.has(body.category)) item.category = body.category;
          if (body.dailyUsage) item.dailyUsage = clampNumber(body.dailyUsage, { min: 1, max: 30, fallback: item.dailyUsage });
          return item;
        });
        return data ? ok(data) : fail(404, "在庫が見つかりません。", { id });
      }

      if (verb === "DELETE" && resource === "inventory" && id) {
        const data = commit((draft) => {
          const before = draft.inventory.length;
          draft.inventory = draft.inventory.filter((item) => item.id !== id);
          delete draft.queueDecisions[id];
          return { deleted: before !== draft.inventory.length };
        });
        return data.deleted ? ok(data) : fail(404, "在庫が見つかりません。", { id });
      }

      if (verb === "PUT" && resource === "settings" && id === "household") {
        const data = commit((draft) => {
          draft.household = sanitizeHousehold(body);
          return draft.household;
        });
        return ok(data);
      }

      if (verb === "PUT" && resource === "settings" && id === "autopilot") {
        const data = commit((draft) => {
          draft.autopilot = sanitizeAutopilot(body);
          return draft.autopilot;
        });
        return ok(data);
      }

      if (verb === "PUT" && resource === "ui" && id === "offer-filter") {
        if (!FILTER_OPTIONS.has(body.filter)) return fail(422, "不正なフィルターです。", { filter: body.filter });
        const data = commit((draft) => {
          draft.activeFilter = body.filter;
          return { filter: draft.activeFilter };
        });
        return ok(data);
      }

      if (verb === "POST" && resource === "photo-detections") {
        const data = commit((draft) => {
          const item = createDetectedItem(draft.inventory.length);
          const sanitized = sanitizeInventoryItem(item).value;
          draft.inventory = [...draft.inventory, sanitized].slice(-8);
          return sanitized;
        });
        return ok(data, 201);
      }

      if (verb === "POST" && resource === "replenishment-plan" && id === "refresh") {
        const data = commit((draft) => {
          draft.inventory = draft.inventory.map((item) => ({
            ...item,
            stock: Math.max(5, item.stock - Math.ceil(item.dailyUsage / 2)),
          }));
          draft.queueDecisions = {};
          return { refreshed: true, inventoryCount: draft.inventory.length };
        });
        return ok(data);
      }

      if (verb === "POST" && resource === "offers" && id && subresource === "click") {
        const offer = findOffer(id);
        if (!offer) return fail(404, "オファーが見つかりません。", { id });
        const data = commit((draft) => {
          draft.metrics.clicks += 1;
          if (offer.labelType === "sponsored") draft.metrics.sponsoredClicks += 1;
          draft.metrics.estimatedRevenue += Math.round(offer.price * offer.affiliateRate);
          return draft.metrics;
        });
        return ok(data);
      }

      if (verb === "PATCH" && resource === "queue" && id) {
        if (!QUEUE_ACTION_OPTIONS.has(body.action)) return fail(422, "不正なキュー操作です。", { action: body.action });
        const data = commit((draft) => {
          draft.queueDecisions[id] = body.action;
          if (body.action === "approve" || body.action === "auto-reserve") {
            draft.metrics.approvals += 1;
            draft.metrics.clicks += 1;
            draft.metrics.estimatedRevenue += clampNumber(body.estimatedRevenue, { min: 0, max: 100000, fallback: 0 });
          }
          if (body.action === "auto-reserve") draft.metrics.autoReservations += 1;
          if (body.action === "snooze") {
            draft.inventory = draft.inventory.map((item) =>
              item.id === id ? { ...item, stock: Math.min(100, item.stock + item.dailyUsage * 3) } : item,
            );
          }
          return { action: body.action, itemId: id };
        });
        return ok(data);
      }

      if (verb === "GET" && resource === "state" && id === "export") {
        return ok({ exportedAt: new Date().toISOString(), ...getState() });
      }

      if (verb === "POST" && resource === "state" && id === "reset") {
        setState(createDefaultState());
        saveState();
        return ok({ reset: true });
      }

      return fail(404, "REST endpoint is not implemented.", { method: verb, path });
    },
  };
}
