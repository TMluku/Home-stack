"use client";

import type { MouseEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import { flushSync } from "react-dom";
import { categories, createDefaultState, detectedInventoryCandidates, normalizeState, STORAGE_KEY } from "@/lib/demo-state";
import { recordOutboundClick, recordQueueDecision } from "@/lib/metrics";
import type { NotificationJobSummary } from "@/lib/notification-jobs";
import { buildNotificationJobs, summarizeNotificationJobs } from "@/lib/notification-jobs";
import { baseOffers } from "@/lib/offers";
import type { ConditionAuditLogEntry, NotificationDraft, PriceFetchPlanStep, ServerSyncPayload } from "@/lib/post-mvp";
import {
  buildConditionAuditLog,
  buildNotificationDrafts,
  buildPriceFetchPlan,
  buildServerSyncPayload,
  buildStaticPriceScanResults,
  buildStaticProductSearchResult,
  isValidJanCode,
  resolveBarcode,
  resolveJanProduct,
} from "@/lib/post-mvp";
import {
  buildReplenishmentQueue,
  buildShoppingListSummary,
  calculateDaysLeft,
  formatShoppingMemo,
  getRecommendedOffers,
  getUrgency,
} from "@/lib/replenishment";
import type {
  AppState,
  BrandPolicy,
  Channel,
  DeliveryPolicy,
  InventoryItem,
  LivePriceResult,
  Offer,
  OfferFilter,
  ProductSearchResult,
  QueueDecision,
} from "@/lib/types";

const yenFormatter = new Intl.NumberFormat("ja-JP", {
  style: "currency",
  currency: "JPY",
  maximumFractionDigits: 0,
});

const channelLabels: Record<Channel, string> = {
  line: "LINE",
  email: "メール",
  webpush: "Web Push",
};

const filterLabels: Record<OfferFilter, string> = {
  all: "すべて",
  "no-conditions": "条件なし",
  conditions: "条件あり",
};

const isStaticExport = process.env.NEXT_PUBLIC_STATIC_EXPORT === "true";
const serverSyncAccountId = "demo-account";

export function HomeStackApp() {
  const [state, setState] = useState<AppState>(() => createDefaultState());
  const [loaded, setLoaded] = useState(false);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [scanState, setScanState] = useState("待機中");
  const [settingsMessage, setSettingsMessage] = useState("未保存");
  const [autopilotMessage, setAutopilotMessage] = useState("未保存");
  const [privacyMessage, setPrivacyMessage] = useState("操作待ち");
  const [planMessage, setPlanMessage] = useState("補充プランを再計算");
  const [queueMessage, setQueueMessage] = useState("買い物メモを作成できます");
  const [activeOfferId, setActiveOfferId] = useState(baseOffers[0]?.id ?? "");
  const [livePriceUrls, setLivePriceUrls] = useState("");
  const [livePriceResults, setLivePriceResults] = useState<LivePriceResult[]>([]);
  const [livePriceStatus, setLivePriceStatus] = useState("商品ページURLを貼ると、サーバー側で価格候補を抽出します。");
  const [productSearchQuery, setProductSearchQuery] = useState("");
  const [janCode, setJanCode] = useState("");
  const [productSearchResult, setProductSearchResult] = useState<ProductSearchResult | null>(null);
  const [productSearchStatus, setProductSearchStatus] = useState("商品名から複数ECサイトの価格候補を検索できます。");

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      setState(normalizeState(saved ? JSON.parse(saved) : null));
    } catch {
      setState(createDefaultState());
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (loaded) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    }
  }, [loaded, state]);

  const offers = useMemo(() => getRecommendedOffers(state, baseOffers), [state]);
  const queue = useMemo(() => buildReplenishmentQueue(state, baseOffers), [state]);
  const queueSummary = useMemo(() => buildShoppingListSummary(queue), [queue]);
  const pendingQueue = queue.filter((entry) => entry.decision === "pending");
  const activeOffer = offers.find((offer) => offer.id === activeOfferId) ?? offers[0] ?? baseOffers[0];
  const atRiskCount = state.inventory.filter((item) => calculateDaysLeft(item, state.household) <= 10).length;
  const allowedCount = state.inventory.filter((item) => item.autoReplenish).length;
  const reservableCount = queue.filter((entry) => entry.autoReservable).length;
  const conditionAuditLog = useMemo(() => buildConditionAuditLog(offers), [offers]);
  const notificationDrafts = useMemo(() => buildNotificationDrafts(queue, state.household.channel), [queue, state.household.channel]);
  const notificationJobSummary = useMemo(
    () =>
      summarizeNotificationJobs(
        buildNotificationJobs({
          accountId: serverSyncAccountId,
          drafts: notificationDrafts,
          contactPoints: {},
        }),
      ),
    [notificationDrafts],
  );
  const priceFetchPlan = useMemo(
    () => buildPriceFetchPlan(productSearchQuery || janCode || activeOffer?.title || "", livePriceUrls.split(/\r?\n/)),
    [productSearchQuery, janCode, activeOffer, livePriceUrls],
  );
  const serverSyncPayload = useMemo(
    () =>
      buildServerSyncPayload({
        state,
        auditLog: conditionAuditLog,
        notificationDrafts,
      }),
    [state, conditionAuditLog, notificationDrafts],
  );
  const bestConditionSavings = useMemo(
    () =>
      baseOffers.reduce((total, offer) => {
        const noCondition = baseOffers
          .filter((candidate) => candidate.category === offer.category && candidate.conditions.length === 0)
          .sort((a, b) => a.effectivePrice - b.effectivePrice)[0];
        return total + Math.max(0, (noCondition?.effectivePrice ?? offer.effectivePrice) - offer.effectivePrice);
      }, 0),
    [],
  );

  function updateState(updater: (draft: AppState) => void) {
    setState((current) => {
      const draft = structuredClone(current);
      updater(draft);
      return normalizeState(draft);
    });
  }

  function handlePhotoUpload(file?: File) {
    if (!file) return;
    setPhotoPreview(URL.createObjectURL(file));
    setScanState(state.household.deletePhoto ? "解析後に削除する設定" : "端末内プレビューのみ");
    updateState((draft) => {
      const candidate = detectedInventoryCandidates[draft.inventory.length % detectedInventoryCandidates.length];
      const item: InventoryItem = {
        ...candidate,
        id: `detected-${Date.now()}`,
        autoReplenish: false,
      };
      draft.inventory = [...draft.inventory, item].slice(-8);
    });
  }

  function changeStock(id: string, delta: number) {
    updateState((draft) => {
      const item = draft.inventory.find((candidate) => candidate.id === id);
      if (item) item.stock = Math.min(100, Math.max(5, item.stock + delta));
    });
  }

  function toggleAuto(id: string) {
    updateState((draft) => {
      const item = draft.inventory.find((candidate) => candidate.id === id);
      if (item) item.autoReplenish = !item.autoReplenish;
    });
  }

  function removeItem(id: string) {
    updateState((draft) => {
      draft.inventory = draft.inventory.filter((item) => item.id !== id);
      delete draft.queueDecisions[id];
    });
  }

  function addItem(formData: FormData) {
    const name = String(formData.get("name") || "").trim();
    if (!name) return;
    updateState((draft) => {
      draft.inventory.push({
        id: `item-${Date.now()}`,
        name,
        category: String(formData.get("category") || "洗濯・掃除"),
        stock: clampNumber(formData.get("stock"), 5, 100, 50),
        dailyUsage: clampNumber(formData.get("dailyUsage"), 1, 30, 5),
        autoReplenish: false,
        note: "手動登録。残量を更新すると補充キューに反映されます。",
      });
    });
  }

  function saveHousehold(formData: FormData) {
    const channel = String(formData.get("channel") || "line") as Channel;
    updateState((draft) => {
      draft.household = {
        adults: clampNumber(formData.get("adults"), 1, 8, 1),
        children: clampNumber(formData.get("children"), 0, 8, 0),
        pets: clampNumber(formData.get("pets"), 0, 8, 0),
        channel,
        includeConditionalOffers: formData.has("includeConditionalOffers"),
        deletePhoto: formData.has("deletePhoto"),
      };
    });
    setSettingsMessage(`${channelLabels[channel]}通知ルールを保存しました`);
  }

  function saveAutopilot(formData: FormData) {
    updateState((draft) => {
      draft.autopilot = {
        enabled: formData.has("enabled"),
        maxAmount: clampNumber(formData.get("maxAmount"), 500, 50000, 5000),
        cancelWindowHours: clampNumber(formData.get("cancelWindowHours"), 6, 48, 24),
        brandPolicy: String(formData.get("brandPolicy") || "never") as BrandPolicy,
        deliveryPolicy: String(formData.get("deliveryPolicy") || "standard") as DeliveryPolicy,
        requireApprovalForConditional: formData.has("requireApprovalForConditional"),
      };
    });
    setAutopilotMessage(formData.has("enabled") ? "自動予約シミュレーションを有効にしました" : "自動予約シミュレーションは無効です");
  }

  function refreshPlan() {
    updateState((draft) => {
      draft.inventory = draft.inventory.map((item) => ({ ...item, stock: Math.max(5, item.stock - Math.ceil(item.dailyUsage / 2)) }));
      draft.queueDecisions = {};
    });
    setPlanMessage("消費ペースを反映しました");
    window.setTimeout(() => setPlanMessage("補充プランを再計算"), 1800);
  }

  function clickOffer(offer: Offer) {
    setActiveOfferId(offer.id);
    updateState((draft) => {
      recordOutboundClick(draft.metrics, offer.effectivePrice, offer.affiliateRate, offer.conditions.length > 0);
    });
  }

  function clickComparisonCandidate(offer: Offer, competitor: Offer["competitors"][number]) {
    setActiveOfferId(offer.id);
    updateState((draft) => {
      recordOutboundClick(draft.metrics, competitor.effectivePrice, offer.affiliateRate, competitor.conditions.length > 0);
    });
  }

  function openOfferLink(event: MouseEvent<HTMLElement>, offer: Offer) {
    event.preventDefault();
    flushSync(() => clickOffer(offer));
    queueExternalOpen(offer.url);
  }

  function openComparisonLink(event: MouseEvent<HTMLElement>, offer: Offer, competitor: Offer["competitors"][number]) {
    event.preventDefault();
    flushSync(() => clickComparisonCandidate(offer, competitor));
    queueExternalOpen(competitor.url);
  }

  async function scanLivePrices() {
    const urls = livePriceUrls
      .split(/\r?\n/)
      .map((url) => url.trim())
      .filter(Boolean);
    if (urls.length === 0) {
      setLivePriceStatus("URLを1行に1つずつ入力してください。");
      return;
    }

    setLivePriceStatus("価格ページを取得中です...");
    setLivePriceResults([]);

    if (isStaticExport) {
      const results = buildStaticPriceScanResults(livePriceUrls);
      setLivePriceResults(results);
      setLivePriceStatus("GitHub Pages版ではサーバー側価格取得は未接続です。API接続後に自動抽出します。");
      return;
    }

    try {
      const response = await fetch("/api/price-scan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ urls }),
      });
      const payload = (await response.json()) as { ok: boolean; results?: LivePriceResult[]; error?: string };
      setLivePriceResults(payload.results ?? []);
      setLivePriceStatus(payload.ok ? "取得しました。抽出元と取得時刻を確認してください。" : (payload.error ?? "取得に失敗しました。"));
    } catch (error) {
      setLivePriceStatus(error instanceof Error ? error.message : "取得に失敗しました。");
    }
  }

  async function searchMarketPrices(nextQuery = productSearchQuery) {
    const query = nextQuery.trim();
    if (!query) {
      setProductSearchStatus("商品名、ブランド、容量を入力してください。");
      return;
    }

    setProductSearchQuery(query);
    setProductSearchStatus("楽天市場 / Yahoo!ショッピングを検索中です...");
    setProductSearchResult(null);

    if (isStaticExport) {
      const result = buildStaticProductSearchResult(query, baseOffers);
      setProductSearchResult(result);
      setProductSearchStatus(
        `${result.candidates.length}件の静的候補を表示しました。GitHub Pagesでは外部検索リンクとデモ価格台帳を使います。`,
      );
      return;
    }

    try {
      const response = await fetch("/api/product-search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query }),
      });
      const payload = (await response.json()) as ({ ok: true } & ProductSearchResult) | { ok: false; error?: string };
      if (!payload.ok) {
        setProductSearchStatus(payload.error ?? "商品検索に失敗しました。");
        return;
      }
      setProductSearchResult(payload);
      setProductSearchStatus(`${payload.candidates.length}件の価格候補を見つけました。価格・一致度・取得元を確認してください。`);
    } catch (error) {
      setProductSearchStatus(error instanceof Error ? error.message : "商品検索に失敗しました。");
    }
  }

  function searchJanProduct() {
    const resolution = resolveBarcode(janCode);
    const searchCode = resolution.valid ? resolution.normalized : resolution.corrections[0];
    if (!searchCode || !isValidJanCode(searchCode)) {
      setProductSearchStatus("JANコードは13桁とチェックデジットを確認してください。");
      return;
    }
    if (!resolution.valid) {
      setJanCode(searchCode);
      setProductSearchStatus(`チェックデジット候補 ${searchCode} で検索します。`);
    }
    const product = resolveJanProduct(searchCode);
    searchMarketPrices(product ? `${product.name} ${product.unitHint}` : searchCode);
  }

  function updateQueue(itemId: string, action: QueueDecision, estimatedRevenue = 0) {
    updateState((draft) => {
      draft.queueDecisions[itemId] = action;
      recordQueueDecision(draft.metrics, action, estimatedRevenue);
      if (action === "snooze") {
        draft.inventory = draft.inventory.map((item) =>
          item.id === itemId ? { ...item, stock: Math.min(100, item.stock + item.dailyUsage * 3) } : item,
        );
      }
    });
  }

  async function copyShoppingList() {
    if (queueSummary.lines.length === 0) {
      setQueueMessage("コピーできる補充候補がありません");
      return;
    }

    const copied = await copyText(formatShoppingMemo(queueSummary));
    setQueueMessage(copied ? "買い物メモをクリップボードへコピーしました" : "クリップボードへコピーできませんでした");
  }

  async function exportState() {
    const data = JSON.stringify({ exportedAt: new Date().toISOString(), ...state }, null, 2);
    const copied = await copyText(data);
    setPrivacyMessage(copied ? "デモデータをクリップボードへ書き出しました" : "クリップボードへ書き出せませんでした");
  }

  function resetState() {
    setState(createDefaultState());
    setPrivacyMessage("端末内データをリセットしました");
  }

  return (
    <>
      <header className="hero hero--spark">
        <nav className="nav" aria-label="メインナビゲーション">
          <a className="logo" href="#top" aria-label="Home Stack ホーム">
            Home Stack
          </a>
          <a className="nav__link" href="#scan">
            在庫
          </a>
          <a className="nav__link" href="#offers">
            価格比較
          </a>
          <a className="nav__link" href="#replenishment">
            補充キュー
          </a>
          <a className="nav__link" href="#autopilot">
            自動予約
          </a>
          <a className="nav__cta" href="#scan">
            試す
          </a>
        </nav>

        <section id="top" className="hero__grid">
          <div className="hero__copy">
            <p className="eyebrow">Home Stock Radar</p>
            <h1>家の日用品を、なくなる前に価格順で見つける。</h1>
            <p className="hero__lead">
              在庫、消費ペース、実質価格、条件付き割引をひとつの画面で確認できます。MVPではデモ価格と一部の実検索で、補充判断の流れを検証します。
            </p>
            <div className="hero__actions">
              <a className="button button--primary" href="#scan">
                在庫を調整する
              </a>
              <a className="button button--ghost" href="#offers">
                価格順リストを見る
              </a>
            </div>
            <dl className="radar-strip">
              <div>
                <dt>10日以内</dt>
                <dd>{atRiskCount}</dd>
              </div>
              <div>
                <dt>条件込み差額</dt>
                <dd>{yenFormatter.format(bestConditionSavings)}</dd>
              </div>
              <div>
                <dt>自動予約可</dt>
                <dd>{reservableCount}</dd>
              </div>
            </dl>
          </div>

          <aside className="phone-card radar-card" aria-label="補充通知のプレビュー">
            <div className="phone-card__status">今日のレーダー</div>
            <article className="notice-card notice-card--pulse">
              <span className="notice-card__tag">あと数日</span>
              <h2>猫砂が補充ラインに近づいています</h2>
              <p>条件あり価格も含めて、実質価格の安い順に候補を表示します。条件の中身は商品カードから確認できます。</p>
              <a className="mini-button" href="#offers">
                比較を見る
              </a>
            </article>
            <article className="notice-card notice-card--quiet">
              <span className="notice-card__tag">透明性</span>
              <h2>条件付き価格は条件を明示</h2>
              <p>クーポン、ポイント還元、送料無料ラインなどを実質価格に含める場合は、条件ありバナーと詳細を出します。</p>
            </article>
          </aside>
        </section>
      </header>

      <main>
        <section id="scan" className="section section--split">
          <div>
            <p className="eyebrow">Inventory Dock</p>
            <h2>在庫を登録して、補充タイミングを見える化する。</h2>
            <p>写真アップロードはMVPではデモ候補を追加します。残量や1日あたり消費量を更新すると、補充キューと価格候補が再計算されます。</p>
            <label className="upload-box" htmlFor="stock-photo">
              <input
                id="stock-photo"
                type="file"
                accept="image/*"
                capture="environment"
                onChange={(event) => handlePhotoUpload(event.target.files?.[0])}
              />
              <span className="upload-box__icon">+</span>
              <strong>写真を選択 / 撮影</strong>
              <small>デモでは端末内プレビューと候補追加だけを行います。</small>
            </label>
            {photoPreview ? <div className="photo-preview" style={{ backgroundImage: `url(${photoPreview})` }} /> : null}
          </div>

          <div className="inventory-panel" aria-live="polite">
            <div className="panel-header">
              <h3>在庫カード</h3>
              <span>{scanState}</span>
            </div>
            <div className="inventory-list">
              {state.inventory.map((item, index) => {
                const daysLeft = calculateDaysLeft(item, state.household);
                const urgency = getUrgency(daysLeft);
                return (
                  <article className={`inventory-item inventory-item--${urgency}`} key={item.id}>
                    <div className="inventory-item__top">
                      <div>
                        <span className="item-order">#{index + 1}</span>
                        <strong>{item.name}</strong>
                        <p>
                          {item.category} / あと{daysLeft}日目安
                        </p>
                      </div>
                      <strong>{item.stock}%</strong>
                    </div>
                    <meter className="progress" aria-label={`残量 ${item.stock}%`} min={0} max={100} value={item.stock}>
                      <span style={{ width: `${item.stock}%` }} />
                    </meter>
                    <p>{item.note}</p>
                    <div className="inventory-actions">
                      <button type="button" onClick={() => changeStock(item.id, -10)}>
                        -10%
                      </button>
                      <button type="button" onClick={() => changeStock(item.id, 10)}>
                        +10%
                      </button>
                      <button type="button" onClick={() => toggleAuto(item.id)}>
                        {item.autoReplenish ? "自動補充ON" : "自動補充OFF"}
                      </button>
                      <button type="button" onClick={() => removeItem(item.id)} aria-label={`${item.name}を削除`}>
                        削除
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
            <form
              className="add-item-form"
              onSubmit={(event) => {
                event.preventDefault();
                addItem(new FormData(event.currentTarget));
                event.currentTarget.reset();
              }}
            >
              <h4>手動で在庫を追加</h4>
              <div className="form-grid">
                <label>
                  商品名
                  <input name="name" type="text" placeholder="例: おしりふき" required />
                </label>
                <label>
                  カテゴリ
                  <select name="category">
                    {categories.map((category) => (
                      <option key={category}>{category}</option>
                    ))}
                  </select>
                </label>
                <label>
                  残量 %
                  <input name="stock" type="number" min="5" max="100" defaultValue="50" />
                </label>
                <label>
                  1日あたり消費量
                  <input name="dailyUsage" type="number" min="1" max="30" defaultValue="5" />
                </label>
              </div>
              <button className="button button--primary button--full" type="submit">
                在庫を追加
              </button>
            </form>
          </div>
        </section>

        <section id="offers" className="section">
          <div className="section__heading">
            <p className="eyebrow">Price Radar</p>
            <h2>条件込みの実質価格で、安い順に並べる。</h2>
            <p>
              クーポン、ポイント還元、送料無料ラインを含めた実質価格で並べます。条件がある候補にはバナーを表示し、詳細条件を同じ画面で確認できます。
            </p>
          </div>

          <fieldset className="offer-toolbar">
            <legend className="visually-hidden">価格候補フィルタ</legend>
            {(Object.keys(filterLabels) as OfferFilter[]).map((filter) => (
              <button
                className={state.activeFilter === filter ? "chip is-active" : "chip"}
                type="button"
                key={filter}
                onClick={() =>
                  updateState((draft) => {
                    draft.activeFilter = filter;
                  })
                }
              >
                {filterLabels[filter]}
              </button>
            ))}
          </fieldset>

          <ProductSearchPanel
            inventory={state.inventory}
            query={productSearchQuery}
            janCode={janCode}
            result={productSearchResult}
            status={productSearchStatus}
            onQueryChange={setProductSearchQuery}
            onJanCodeChange={setJanCode}
            onSearch={() => searchMarketPrices()}
            onSearchJan={searchJanProduct}
            onSearchInventory={(item) => searchMarketPrices(item.name)}
          />

          <LivePriceScanner
            urls={livePriceUrls}
            results={livePriceResults}
            status={livePriceStatus}
            onUrlsChange={setLivePriceUrls}
            onScan={scanLivePrices}
          />

          <div className="offers">
            {offers.map((offer, index) => (
              <article className="offer-card" key={offer.id}>
                <span
                  className={
                    offer.conditions.length > 0
                      ? "offer-card__label offer-card__label--conditions"
                      : "offer-card__label offer-card__label--plain"
                  }
                >
                  {index + 1}位 {offer.conditions.length > 0 ? "条件あり" : "条件なし"}
                </span>
                <h3>{offer.title}</h3>
                <strong className="offer-card__price">{yenFormatter.format(offer.effectivePrice)}</strong>
                {offer.listPrice !== offer.effectivePrice ? (
                  <small>表示価格 {yenFormatter.format(offer.listPrice)} から条件適用</small>
                ) : null}
                <dl className="offer-details">
                  <div>
                    <dt>販売元</dt>
                    <dd>{offer.retailer}</dd>
                  </div>
                  <div>
                    <dt>単価</dt>
                    <dd>{offer.unitPrice}</dd>
                  </div>
                  <div>
                    <dt>送料</dt>
                    <dd>{offer.shipping}</dd>
                  </div>
                  <div>
                    <dt>還元</dt>
                    <dd>{offer.points}</dd>
                  </div>
                </dl>
                <p>{offer.reason}</p>
                <button className="link-button" type="button" onClick={(event) => openOfferLink(event, offer)}>
                  {offer.linkText}
                </button>
                {offer.conditions.length > 0 ? (
                  <a className="condition-link" href={`#conditions-${offer.id}`} onClick={() => setActiveOfferId(offer.id)}>
                    条件を見る
                  </a>
                ) : null}
              </article>
            ))}
          </div>

          <PriceComparisonPanel offer={activeOffer} onOutboundClick={openComparisonLink} />

          <section className="analytics-card">
            <div>
              <p className="eyebrow">MVP Metrics</p>
              <h2>クリック、承認、推定紹介収益を端末内で記録。</h2>
              <p>実決済は行いません。ユーザーが価格候補や補充キューを操作した結果だけをローカルに保存します。</p>
            </div>
            <dl className="metric-grid">
              <div>
                <dt>クリック</dt>
                <dd>{state.metrics.clicks}</dd>
              </div>
              <div>
                <dt>条件あり</dt>
                <dd>{state.metrics.conditionalClicks}</dd>
              </div>
              <div>
                <dt>承認</dt>
                <dd>{state.metrics.approvals}</dd>
              </div>
              <div>
                <dt>推定収益</dt>
                <dd>{yenFormatter.format(state.metrics.estimatedRevenue)}</dd>
              </div>
            </dl>
          </section>
        </section>

        <section id="replenishment" className="section section--split">
          <div>
            <p className="eyebrow">Replenishment Queue</p>
            <h2>切れる前の商品を、承認制の補充キューにまとめる。</h2>
            <p>通知、承認、EC送客までをMVP範囲にしています。価格がデモであることや条件の有無は通知文にも残します。</p>
            <button className="button button--primary" type="button" onClick={refreshPlan}>
              {planMessage}
            </button>
            <div className="notification-preview" aria-live="polite">
              <strong>{state.household.channel.toUpperCase()}通知プレビュー</strong>
              {pendingQueue[0] ? (
                <>
                  <p>
                    {pendingQueue[0].item.name}があと{pendingQueue[0].item.daysLeft}日で切れそうです。
                    {pendingQueue[0].offer.retailer}で実質{yenFormatter.format(pendingQueue[0].offer.effectivePrice)}
                    の候補があります。
                  </p>
                  <small>
                    {pendingQueue[0].offer.conditions.length > 0
                      ? "この価格には条件があります。購入前に条件を確認してください。"
                      : "条件なしの価格候補です。"}
                  </small>
                </>
              ) : (
                <p>14日以内に切れそうな商品はありません。次回の残量更新を待ちます。</p>
              )}
            </div>
          </div>
          <div className="queue-card">
            <div className="panel-header">
              <h3>次回の補充候補</h3>
              <span>承認制</span>
            </div>
            <div className="shopping-summary">
              <div>
                <span>候補</span>
                <strong>{queueSummary.itemCount}件</strong>
              </div>
              <div>
                <span>合計目安</span>
                <strong>{yenFormatter.format(queueSummary.totalEffectivePrice)}</strong>
              </div>
              <div>
                <span>条件あり</span>
                <strong>{queueSummary.conditionalCount}件</strong>
              </div>
              <button className="button button--ghost" type="button" onClick={copyShoppingList}>
                メモをコピー
              </button>
            </div>
            <p className="state-message" role="status">
              {queueMessage}
            </p>
            <div className="queue-list">
              {queue.length === 0 ? (
                <p className="empty-state">補充候補はありません。在庫を追加するか残量を下げると表示されます。</p>
              ) : null}
              {queue.map(({ item, offer, decision, autoReservable, estimatedRevenue }) => (
                <article className={`queue-item queue-item--${decision}`} key={item.id}>
                  <div>
                    <span className="notice-card__tag">あと{item.daysLeft}日</span>
                    <h3>{item.name}</h3>
                    <p>
                      {offer.title} / {offer.retailer} / 実質{yenFormatter.format(offer.effectivePrice)}
                    </p>
                    <small>
                      {offer.conditions.length > 0 ? "条件あり" : "条件なし"} / 推定送客収益 {yenFormatter.format(estimatedRevenue)}
                    </small>
                  </div>
                  <div className="queue-actions">
                    <button type="button" onClick={() => updateQueue(item.id, "approve", estimatedRevenue)}>
                      承認
                    </button>
                    <button type="button" onClick={() => updateQueue(item.id, "auto-reserve", estimatedRevenue)} disabled={!autoReservable}>
                      自動予約
                    </button>
                    <button type="button" onClick={() => updateQueue(item.id, "snooze")}>
                      3日後
                    </button>
                    <button type="button" onClick={() => updateQueue(item.id, "cancel")}>
                      今回は不要
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="household" className="section section--split section--tight">
          <div>
            <p className="eyebrow">Household Rules</p>
            <h2>世帯ごとの消費ペースと価格表示ルールを保存。</h2>
            <p>人数、ペット有無、通知先、条件付き価格の表示可否を端末内に保存し、補充タイミングと候補表示を調整します。</p>
          </div>
          <form
            className="settings-card"
            key={`household-${JSON.stringify(state.household)}`}
            onSubmit={(event) => {
              event.preventDefault();
              saveHousehold(new FormData(event.currentTarget));
            }}
          >
            <div className="form-grid">
              <label>
                大人
                <input name="adults" type="number" min="1" max="8" defaultValue={state.household.adults} />
              </label>
              <label>
                子ども
                <input name="children" type="number" min="0" max="8" defaultValue={state.household.children} />
              </label>
              <label>
                ペット
                <input name="pets" type="number" min="0" max="8" defaultValue={state.household.pets} />
              </label>
              <label>
                通知方法
                <select name="channel" defaultValue={state.household.channel}>
                  <option value="line">LINE</option>
                  <option value="email">メール</option>
                  <option value="webpush">Web Push</option>
                </select>
              </label>
            </div>
            <label className="checkbox-row">
              <input name="includeConditionalOffers" type="checkbox" defaultChecked={state.household.includeConditionalOffers} />
              クーポン・ポイント還元・送料無料ライン込みの条件付き価格も表示する
            </label>
            <label className="checkbox-row">
              <input name="deletePhoto" type="checkbox" defaultChecked={state.household.deletePhoto} />
              写真は解析後に保存せず削除する前提で扱う
            </label>
            <button className="button button--primary button--full" type="submit">
              世帯ルールを保存
            </button>
            <p className="state-message" role="status">
              {settingsMessage}
            </p>
          </form>
        </section>

        <section id="autopilot" className="section section--split">
          <div>
            <p className="eyebrow">Auto Purchase Roadmap</p>
            <h2>自動購入は、理由と条件が説明できる時だけ。</h2>
            <p>MVPでは実決済を行わず、自動購入予約のシミュレーションまでに留めます。</p>
            <div className="notification-preview" aria-live="polite">
              <strong>自動予約 {state.autopilot.enabled ? "有効" : "無効"}</strong>
              <p>
                許可済み商品 {allowedCount}件 / 今すぐ自動予約できる候補 {reservableCount}件。上限は
                {yenFormatter.format(state.autopilot.maxAmount)}、キャンセル猶予は{state.autopilot.cancelWindowHours}時間です。
              </p>
              <small>実購入は未実装です。将来は小売API、決済トークン、購入前通知、キャンセル導線を接続します。</small>
            </div>
          </div>
          <form
            className="settings-card"
            key={`autopilot-${JSON.stringify(state.autopilot)}`}
            onSubmit={(event) => {
              event.preventDefault();
              saveAutopilot(new FormData(event.currentTarget));
            }}
          >
            <div className="form-grid">
              <label>
                1回の購入上限
                <input name="maxAmount" type="number" min="500" max="50000" step="500" defaultValue={state.autopilot.maxAmount} />
              </label>
              <label>
                キャンセル猶予
                <select name="cancelWindowHours" defaultValue={state.autopilot.cancelWindowHours}>
                  <option value="6">6時間</option>
                  <option value="12">12時間</option>
                  <option value="24">24時間</option>
                  <option value="48">48時間</option>
                </select>
              </label>
              <label>
                ブランド変更
                <select name="brandPolicy" defaultValue={state.autopilot.brandPolicy}>
                  <option value="never">勝手に変更しない</option>
                  <option value="cheaper-confirm">安い場合も確認必須</option>
                  <option value="allow-same-spec">同容量・同等品のみ許可</option>
                </select>
              </label>
              <label>
                配送速度
                <select name="deliveryPolicy" defaultValue={state.autopilot.deliveryPolicy}>
                  <option value="standard">標準配送で安さ優先</option>
                  <option value="fast">切れそうなら速さ優先</option>
                </select>
              </label>
            </div>
            <label className="checkbox-row">
              <input name="enabled" type="checkbox" defaultChecked={state.autopilot.enabled} />
              自動購入予約シミュレーションを有効にする
            </label>
            <label className="checkbox-row">
              <input name="requireApprovalForConditional" type="checkbox" defaultChecked={state.autopilot.requireApprovalForConditional} />
              条件付き価格の商品は必ず購入前確認にする
            </label>
            <button className="button button--primary button--full" type="submit">
              自動予約ルールを保存
            </button>
            <p className="state-message" role="status">
              {autopilotMessage}
            </p>
          </form>
        </section>

        <section id="privacy" className="section privacy-card">
          <div>
            <p className="eyebrow">Privacy & Ops</p>
            <h2>写真と価格を扱うから、透明性を先に置く。</h2>
            <p>このMVPでは端末内保存のみです。実サービスでは解析後削除、同意管理、条件付き価格の取得ログを見える化します。</p>
          </div>
          <div className="privacy-actions">
            <button className="button button--ghost" type="button" onClick={exportState}>
              デモデータを書き出す
            </button>
            <button className="button button--ghost danger-button" type="button" onClick={resetState}>
              端末内データをリセット
            </button>
            <p className="state-message" role="status">
              {privacyMessage}
            </p>
          </div>
        </section>

        <PostMvpOpsPanel
          conditionAuditLog={conditionAuditLog}
          notificationDrafts={notificationDrafts}
          notificationJobSummary={notificationJobSummary}
          priceFetchPlan={priceFetchPlan}
          queueItemCount={queueSummary.itemCount}
          queueTotal={queueSummary.totalEffectivePrice}
          serverSyncPayload={serverSyncPayload}
        />
      </main>

      <footer className="footer">
        <p>Home Stack MVP - 家庭内在庫と実質価格比較のプロトタイプ</p>
      </footer>
    </>
  );
}

function ProductSearchPanel({
  inventory,
  query,
  janCode,
  result,
  status,
  onQueryChange,
  onJanCodeChange,
  onSearch,
  onSearchJan,
  onSearchInventory,
}: {
  inventory: InventoryItem[];
  query: string;
  janCode: string;
  result: ProductSearchResult | null;
  status: string;
  onQueryChange: (value: string) => void;
  onJanCodeChange: (value: string) => void;
  onSearch: () => void;
  onSearchJan: () => void;
  onSearchInventory: (item: InventoryItem) => void;
}) {
  const bestCandidate = result?.candidates[0];

  return (
    <section className="product-search-panel" aria-label="商品価格横断検索">
      <div className="product-search-copy">
        <p className="eyebrow">Price Search Lab</p>
        <h3>商品名から複数サイトを検索して価格候補を集める</h3>
        <p>APIキーがある場合は公式APIを優先し、未設定なら取得できる範囲で公開ページから候補を抽出します。</p>
      </div>

      <fieldset className="inventory-search-chips">
        <legend className="visually-hidden">在庫から検索</legend>
        {inventory.map((item) => (
          <button className="chip" type="button" key={item.id} onClick={() => onSearchInventory(item)}>
            {item.name}
          </button>
        ))}
      </fieldset>

      <label className="market-search-box">
        検索キーワード
        <div>
          <input type="search" value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="例: 猫砂 5L" />
          <button className="button button--primary" type="button" onClick={onSearch}>
            横断検索
          </button>
        </div>
      </label>

      <label className="market-search-box">
        JAN / Barcode
        <div>
          <input
            inputMode="numeric"
            value={janCode}
            onChange={(event) => onJanCodeChange(event.target.value)}
            placeholder="4900000000016"
          />
          <button className="button button--ghost" type="button" onClick={onSearchJan}>
            JAN Search
          </button>
        </div>
      </label>

      <p className="state-message" role="status">
        {status}
      </p>

      {result ? (
        <div className="market-results">
          <div className="market-summary">
            <div>
              <span>検索語</span>
              <strong>{result.normalizedQuery}</strong>
            </div>
            <div>
              <span>最安候補</span>
              <strong>{bestCandidate?.price ? yenFormatter.format(bestCandidate.price) : "未検出"}</strong>
            </div>
            <div>
              <span>検索元</span>
              <strong>
                {result.sources.filter((source) => source.ok).length}/{result.sources.length}
              </strong>
            </div>
          </div>

          <div className="source-strip">
            {result.sources.map((source) => (
              <span className={source.ok ? "source-pill is-ok" : "source-pill"} key={source.source}>
                {source.label}: {source.ok ? `${source.count}件` : (source.error ?? "失敗")}
              </span>
            ))}
          </div>

          <div className="market-candidates">
            {result.candidates.map((candidate) => (
              <article className="market-card" key={candidate.id}>
                <div>
                  <span className="source-tag">{candidate.sourceLabel}</span>
                  <strong>
                    {candidate.effectivePriceQuote?.effectivePrice
                      ? yenFormatter.format(candidate.effectivePriceQuote.effectivePrice)
                      : candidate.price
                        ? yenFormatter.format(candidate.price)
                        : "価格未検出"}
                  </strong>
                </div>
                <h4>{candidate.title}</h4>
                <p>
                  一致度 {candidate.matchScore}% / {candidate.confidence} / {candidate.shipping ?? "送料条件は要確認"}
                </p>
                {candidate.effectivePriceQuote?.conditionLabels.length ? (
                  <p>{candidate.effectivePriceQuote.conditionLabels.join(" / ")}</p>
                ) : null}
                <small>{candidate.evidence.join(" / ")}</small>
                <a href={candidate.url} target="_blank" rel="noreferrer">
                  商品ページを見る
                </a>
              </article>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function PriceComparisonPanel({
  offer,
  onOutboundClick,
}: {
  offer: Offer;
  onOutboundClick: (event: MouseEvent<HTMLElement>, offer: Offer, competitor: Offer["competitors"][number]) => void;
}) {
  const competitors = [...offer.competitors].sort((a, b) => a.effectivePrice - b.effectivePrice || a.listPrice - b.listPrice);
  const bestCompetitor = competitors[0];
  return (
    <section className="comparison-panel" aria-label={`${offer.title}の比較根拠`}>
      <div className="comparison-panel__header">
        <div>
          <p className="eyebrow">Comparison Proof</p>
          <h3>{offer.title} の価格比較</h3>
          <p>{offer.comparisonBasis.join(" / ")}</p>
        </div>
        <div className="price-orbit">
          <strong>{yenFormatter.format(bestCompetitor?.effectivePrice ?? offer.effectivePrice)}</strong>
          <span>最安実質価格</span>
        </div>
      </div>
      <div className="comparison-grid">
        {competitors.map((competitor, index) => (
          <article
            className={competitor.retailer === offer.retailer ? "comparison-card is-selected" : "comparison-card"}
            key={competitor.retailer}
          >
            <span>
              {index + 1}位 {competitor.retailer}
            </span>
            <strong>{yenFormatter.format(competitor.effectivePrice)}</strong>
            {competitor.listPrice !== competitor.effectivePrice ? (
              <small>表示価格 {yenFormatter.format(competitor.listPrice)}</small>
            ) : null}
            <small>
              {competitor.shipping} / {competitor.points}
            </small>
            {competitor.conditions.length > 0 ? (
              <a className="condition-banner" href={`#conditions-${offer.id}`}>
                条件あり
              </a>
            ) : (
              <span className="condition-banner condition-banner--plain">条件なし</span>
            )}
            <p>{competitor.note}</p>
            <button className="link-button" type="button" onClick={(event) => onOutboundClick(event, offer, competitor)}>
              このサイトで探す
            </button>
          </article>
        ))}
      </div>
      <div className="condition-details" id={`conditions-${offer.id}`}>
        <h4>価格条件の詳細</h4>
        {competitors.map((competitor) => (
          <details key={`${competitor.retailer}-conditions`} open={competitor.conditions.length > 0}>
            <summary>
              {competitor.retailer}: {competitor.conditions.length > 0 ? "条件あり" : "条件なし"}
            </summary>
            {competitor.conditions.length > 0 ? (
              <ul>
                {competitor.conditions.map((condition) => (
                  <li key={`${competitor.retailer}-${condition.detail}`}>
                    <strong>{condition.label}</strong>: {condition.detail}
                  </li>
                ))}
              </ul>
            ) : (
              <p>表示価格をそのまま実質価格として扱います。</p>
            )}
          </details>
        ))}
      </div>
    </section>
  );
}

function LivePriceScanner({
  urls,
  results,
  status,
  onUrlsChange,
  onScan,
}: {
  urls: string;
  results: LivePriceResult[];
  status: string;
  onUrlsChange: (value: string) => void;
  onScan: () => void;
}) {
  return (
    <section className="live-price-panel" aria-label="ライブ価格スキャン">
      <div>
        <p className="eyebrow">Live Scrape</p>
        <h3>商品URLから価格を抽出する</h3>
        <p>1行に1URLを貼ってください。サイトによっては規約、bot対策、ログイン、JavaScript描画により取得できない場合があります。</p>
      </div>
      <label className="url-scan-box">
        商品ページURL
        <textarea
          value={urls}
          onChange={(event) => onUrlsChange(event.target.value)}
          placeholder={"https://example.com/product/...\nhttps://example.com/item/..."}
          rows={4}
        />
      </label>
      <button className="button button--primary" type="button" onClick={onScan}>
        ライブ価格を取得
      </button>
      <p className="state-message" role="status">
        {status}
      </p>
      {results.length > 0 ? (
        <div className="live-price-results">
          {results.map((result) => (
            <article className={result.ok ? "live-price-card is-ok" : "live-price-card"} key={result.url}>
              <span>{result.source}</span>
              <strong>{result.price ? yenFormatter.format(result.price) : "取得不可"}</strong>
              <p>{result.title ?? result.url}</p>
              <small>
                {new Date(result.fetchedAt).toLocaleString("ja-JP")} / {result.error ?? result.url}
              </small>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function PostMvpOpsPanel({
  conditionAuditLog,
  notificationDrafts,
  notificationJobSummary,
  priceFetchPlan,
  queueItemCount,
  queueTotal,
  serverSyncPayload,
}: {
  conditionAuditLog: ConditionAuditLogEntry[];
  notificationDrafts: NotificationDraft[];
  notificationJobSummary: NotificationJobSummary;
  priceFetchPlan: PriceFetchPlanStep[];
  queueItemCount: number;
  queueTotal: number;
  serverSyncPayload: ServerSyncPayload;
}) {
  const auditPreview = conditionAuditLog.slice(0, 8);
  const latestDraft = notificationDrafts[0];
  const officialSourceCount = priceFetchPlan.filter((step) => step.extractionPriority[0] === "official-api").length;
  const directPageCount = priceFetchPlan.filter((step) => step.source === "direct-page").length;

  return (
    <section id="post-mvp" className="section post-mvp-panel">
      <div className="section__heading">
        <p className="eyebrow">Post MVP Ops</p>
        <h2>MVP後の接続準備を、静的サイト上でも確認する。</h2>
        <p>
          実EC価格取得、JAN入力、条件付き価格の監査、通知、アカウント/サーバー保存はGitHub Pagesでも設計状態を見える化します。
          実送信や実保存は、API接続後にこの画面の契約へ差し替えます。
        </p>
      </div>

      <div className="ops-grid">
        <section className="ops-panel" aria-label="実EC価格取得計画">
          <h3>実EC価格取得計画</h3>
          <dl className="ops-list">
            <div>
              <dt>取得候補</dt>
              <dd>{priceFetchPlan.length}件</dd>
            </div>
            <div>
              <dt>公式API優先</dt>
              <dd>{officialSourceCount}件</dd>
            </div>
            <div>
              <dt>直接ページ</dt>
              <dd>{directPageCount}件</dd>
            </div>
          </dl>
          <p>公式API、JSON-LD、meta、HTML text の順で価格・送料・条件を取り込み、実質価格順の比較に使います。</p>
        </section>

        <section className="ops-panel" aria-label="条件付き価格監査ログ">
          <h3>条件付き価格の監査ログ</h3>
          <div className="audit-table">
            {auditPreview.map((row) => (
              <article key={row.id}>
                <span>{row.retailer}</span>
                <strong>{yenFormatter.format(row.effectivePrice)}</strong>
                <small>{row.conditionCount > 0 ? `${row.conditionCount}条件` : "条件なし"}</small>
                <p>{row.conditionDetails.join(" / ") || row.rankingBasis}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="ops-panel" aria-label="通知接続準備">
          <h3>通知接続準備</h3>
          <dl className="ops-list">
            <div>
              <dt>通知候補</dt>
              <dd>
                {notificationDrafts.length}件 / queued {notificationJobSummary.queued}件
              </dd>
            </div>
            <div>
              <dt>通知金額</dt>
              <dd>{yenFormatter.format(queueTotal)}</dd>
            </div>
            <div>
              <dt>送信待ち</dt>
              <dd>
                blocked {notificationJobSummary.blocked}件 / queue {queueItemCount}件
              </dd>
            </div>
          </dl>
          <p>
            {latestDraft?.message ?? "次の実装では通知ジョブ、送信前プレビュー、失敗時リトライ、配信停止状態をサーバー側に保存します。"}
          </p>
        </section>

        <section className="ops-panel" aria-label="アカウントとサーバー保存準備">
          <h3>アカウント / サーバー保存</h3>
          <dl className="ops-list">
            <div>
              <dt>保存方式</dt>
              <dd>localStorageからREST同期へ移行</dd>
            </div>
            <div>
              <dt>同期単位</dt>
              <dd>
                inventory {serverSyncPayload.summary.inventoryCount} / audit {serverSyncPayload.summary.conditionalAuditCount}
              </dd>
            </div>
            <div>
              <dt>認証</dt>
              <dd>
                {serverSyncPayload.account.authMode} / {serverSyncPayload.schemaVersion}
              </dd>
            </div>
          </dl>
          <p>GitHub Pages版は静的フロントとして動作し、将来のAPI endpointへ同じ状態構造を送れるように保ちます。</p>
        </section>
      </div>
    </section>
  );
}

function clampNumber(value: FormDataEntryValue | null, min: number, max: number, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

async function copyText(text: string) {
  try {
    if (!navigator.clipboard?.writeText) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function openExternalUrl(url: string) {
  const opened = window.open(url, "_blank", "noopener,noreferrer");
  if (!opened) {
    window.location.href = url;
  }
}

function queueExternalOpen(url: string) {
  window.setTimeout(() => openExternalUrl(url), 100);
}
