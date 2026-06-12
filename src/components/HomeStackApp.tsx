"use client";

import { useEffect, useMemo, useState } from "react";
import { categories, createDefaultState, detectedInventoryCandidates, normalizeState, STORAGE_KEY } from "@/lib/demo-state";
import { baseOffers } from "@/lib/offers";
import { buildReplenishmentQueue, calculateDaysLeft, getRecommendedOffers, getUrgency } from "@/lib/replenishment";
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
  lowest: "実質最安",
  sponsored: "広告/キャンペーン",
};

export function HomeStackApp() {
  const [state, setState] = useState<AppState>(() => createDefaultState());
  const [loaded, setLoaded] = useState(false);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [scanState, setScanState] = useState("順番固定");
  const [settingsMessage, setSettingsMessage] = useState("未保存");
  const [autopilotMessage, setAutopilotMessage] = useState("未保存");
  const [privacyMessage, setPrivacyMessage] = useState("操作待ち");
  const [planMessage, setPlanMessage] = useState("補充提案を更新");
  const [activeOfferId, setActiveOfferId] = useState(baseOffers[0]?.id ?? "");
  const [livePriceUrls, setLivePriceUrls] = useState("");
  const [livePriceResults, setLivePriceResults] = useState<LivePriceResult[]>([]);
  const [livePriceStatus, setLivePriceStatus] = useState("商品ページURLを貼ると、サーバー側でHTMLを取得して価格候補を探します。");
  const [productSearchQuery, setProductSearchQuery] = useState("");
  const [productSearchResult, setProductSearchResult] = useState<ProductSearchResult | null>(null);
  const [productSearchStatus, setProductSearchStatus] = useState("在庫名から複数ECサイトの価格候補を検索できます。");

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
  const pendingQueue = queue.filter((entry) => entry.decision === "pending");
  const activeOffer = offers.find((offer) => offer.id === activeOfferId) ?? offers[0] ?? baseOffers[0];
  const atRiskCount = state.inventory.filter((item) => calculateDaysLeft(item, state.household) <= 10).length;
  const allowedCount = state.inventory.filter((item) => item.autoReplenish).length;
  const reservableCount = queue.filter((entry) => entry.autoReservable).length;
  const savingsPotential = useMemo(
    () =>
      baseOffers
        .filter((offer) => offer.labelType === "sponsored")
        .reduce((total, offer) => {
          const normalOffer = baseOffers.find((candidate) => candidate.category === offer.category && candidate.labelType === "lowest");
          return total + Math.max(0, (normalOffer?.price ?? offer.price) - offer.price);
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
    setScanState(state.household.deletePhoto ? "解析後に削除" : "デモ解析");
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
        note: "手動登録。残量を変えてもカードの並び順は固定です。",
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
        allowSponsored: formData.has("allowSponsored"),
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
        requireApprovalForSponsored: formData.has("requireApprovalForSponsored"),
      };
    });
    setAutopilotMessage(formData.has("enabled") ? "自動購入予約ルールを保存しました" : "自動購入予約は無効です");
  }

  function refreshPlan() {
    updateState((draft) => {
      draft.inventory = draft.inventory.map((item) => ({ ...item, stock: Math.max(5, item.stock - Math.ceil(item.dailyUsage / 2)) }));
      draft.queueDecisions = {};
    });
    setPlanMessage("消費ペースを反映しました");
    window.setTimeout(() => setPlanMessage("補充提案を更新"), 1800);
  }

  function clickOffer(offer: Offer) {
    setActiveOfferId(offer.id);
    updateState((draft) => {
      draft.metrics.clicks += 1;
      if (offer.labelType === "sponsored") draft.metrics.sponsoredClicks += 1;
      draft.metrics.estimatedRevenue += Math.round(offer.price * offer.affiliateRate);
    });
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

    try {
      const response = await fetch("/api/price-scan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ urls }),
      });
      const payload = (await response.json()) as { ok: boolean; results?: LivePriceResult[]; error?: string };
      setLivePriceResults(payload.results ?? []);
      setLivePriceStatus(payload.ok ? "取得しました。抽出元と取得時刻を確認できます。" : (payload.error ?? "取得に失敗しました。"));
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

  function updateQueue(itemId: string, action: QueueDecision, estimatedRevenue = 0) {
    updateState((draft) => {
      draft.queueDecisions[itemId] = action;
      if (action === "approve" || action === "auto-reserve") {
        draft.metrics.approvals += 1;
        draft.metrics.clicks += 1;
        draft.metrics.estimatedRevenue += estimatedRevenue;
      }
      if (action === "auto-reserve") draft.metrics.autoReservations += 1;
      if (action === "snooze") {
        draft.inventory = draft.inventory.map((item) =>
          item.id === itemId ? { ...item, stock: Math.min(100, item.stock + item.dailyUsage * 3) } : item,
        );
      }
    });
  }

  async function exportState() {
    const data = JSON.stringify({ exportedAt: new Date().toISOString(), ...state }, null, 2);
    await navigator.clipboard?.writeText(data);
    setPrivacyMessage("デモデータをクリップボードへ書き出しました");
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
            価格レーダー
          </a>
          <a className="nav__link" href="#replenishment">
            補充キュー
          </a>
          <a className="nav__link" href="#autopilot">
            自動購入
          </a>
          <a className="nav__cta" href="#scan">
            試す
          </a>
        </nav>

        <section id="top" className="hero__grid">
          <div className="hero__copy">
            <p className="eyebrow">Home Stock Radar</p>
            <h1>家のストックが、次に買うものをそっと光らせる。</h1>
            <p className="hero__lead">
              残量、消費ペース、価格候補、広告提案の理由をひとつの画面で確認。今はデモ価格ですが、実運用ではEC
              APIや商品フィードで実価格を取得する設計です。
            </p>
            <div className="hero__actions">
              <a className="button button--primary" href="#scan">
                在庫を調整する
              </a>
              <a className="button button--ghost" href="#offers">
                価格の根拠を見る
              </a>
            </div>
            <dl className="radar-strip">
              <div>
                <dt>10日以内</dt>
                <dd>{atRiskCount}</dd>
              </div>
              <div>
                <dt>節約余地</dt>
                <dd>{yenFormatter.format(savingsPotential)}</dd>
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
              <p>通常最安と広告候補を分けて表示。広告候補へ勝手に切り替えることはありません。</p>
              <button className="mini-button" type="button">
                比較を見る
              </button>
            </article>
            <article className="notice-card notice-card--quiet">
              <span className="notice-card__tag">透明性</span>
              <h2>価格はデモ。実価格ではありません</h2>
              <p>本番では取得日時、送料、ポイント、クーポン、比較元をすべて保存します。</p>
            </article>
          </aside>
        </section>
      </header>

      <main>
        <section id="scan" className="section section--split">
          <div>
            <p className="eyebrow">Inventory Dock</p>
            <h2>検出された在庫候補</h2>
            <p>残量を変えてもカードの順番は入れ替わりません。視線が迷わないように、登録順を固定し、緊急度だけ色と日数で伝えます。</p>
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
                  1日消費 %
                  <input name="dailyUsage" type="number" min="1" max="30" defaultValue="5" />
                </label>
              </div>
              <button className="button button--ghost button--full" type="submit">
                在庫に追加
              </button>
            </form>
            <button className="button button--primary button--full" type="button" onClick={refreshPlan}>
              {planMessage}
            </button>
          </div>
        </section>

        <section id="offers" className="section">
          <div className="section__heading">
            <p className="eyebrow">Price Radar</p>
            <h2>「最安値」は今はデモ価格。本番では比較根拠ごと保存します。</h2>
            <p>
              現在の表示価格は実ECから取得したリアルタイム価格ではありません。ここでは、送料・ポイント・クーポン・広告ラベルをどう比較するかを検証しています。
            </p>
          </div>
          <div className="price-trust-panel">
            <div>
              <span className="trust-badge">Demo price</span>
              <h3>本物の最安にするために必要なもの</h3>
              <p>EC API、商品JAN、同容量換算、送料条件、ポイント還元、取得日時、広告フラグ。これらが揃うまでは「最安」と断言しません。</p>
            </div>
            <ul>
              <li>通常最安を広告より先に表示</li>
              <li>広告商品は必ずラベル表示</li>
              <li>自動購入では広告商品へ勝手に変更しない</li>
            </ul>
          </div>

          <ProductSearchPanel
            inventory={state.inventory}
            query={productSearchQuery}
            result={productSearchResult}
            status={productSearchStatus}
            onQueryChange={setProductSearchQuery}
            onSearch={() => searchMarketPrices()}
            onSearchInventory={(item) => searchMarketPrices(`${item.name} ${item.category} ${item.note}`)}
          />

          <LivePriceScanner
            urls={livePriceUrls}
            results={livePriceResults}
            status={livePriceStatus}
            onUrlsChange={setLivePriceUrls}
            onScan={scanLivePrices}
          />

          <fieldset className="offer-toolbar">
            <legend className="visually-hidden">提案フィルター</legend>
            {(["all", "lowest", "sponsored"] as OfferFilter[]).map((filter) => (
              <button
                className={`chip ${state.activeFilter === filter ? "is-active" : ""}`}
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

          <div className="offers">
            {offers.map((offer) => (
              <article className="offer-card" key={offer.id}>
                <span className={`offer-card__label offer-card__label--${offer.labelType}`}>{offer.label}</span>
                <h3>{offer.title}</h3>
                <div className="offer-card__price">{yenFormatter.format(offer.price)}</div>
                <small>{offer.comparedAt} / 実価格ではありません</small>
                <dl className="offer-details">
                  <div>
                    <dt>購入先</dt>
                    <dd>{offer.retailer}</dd>
                  </div>
                  <div>
                    <dt>単価</dt>
                    <dd>{offer.unitPrice}</dd>
                  </div>
                  <div>
                    <dt>送料/還元</dt>
                    <dd>
                      {offer.shipping}・{offer.points}
                    </dd>
                  </div>
                </dl>
                <p>{offer.detail}</p>
                <button className="link-button" type="button" onClick={() => clickOffer(offer)}>
                  {offer.linkText} →
                </button>
              </article>
            ))}
          </div>

          {activeOffer ? <PriceComparisonPanel offer={activeOffer} /> : null}
        </section>

        <section className="section analytics-card" aria-label="MVP検証KPI">
          <div>
            <p className="eyebrow">Mission Control</p>
            <h2>家計レーダーの反応を見る。</h2>
            <p>在庫数、購入クリック、広告クリック、推定送客収益に加えて、節約余地も見えるようにしました。</p>
          </div>
          <div className="metric-grid">
            <div>
              <strong>{state.inventory.length}</strong>
              <span>登録在庫</span>
            </div>
            <div>
              <strong>{state.metrics.clicks}</strong>
              <span>購入クリック</span>
            </div>
            <div>
              <strong>{state.metrics.sponsoredClicks}</strong>
              <span>広告クリック</span>
            </div>
            <div>
              <strong>{yenFormatter.format(savingsPotential)}</strong>
              <span>節約余地</span>
            </div>
          </div>
        </section>

        <section id="replenishment" className="section section--split">
          <div>
            <p className="eyebrow">Replenishment Queue</p>
            <h2>切れる前の商品を、承認前提の補充キューにまとめる。</h2>
            <p>通知、確認、EC送客までをMVP範囲にします。価格がデモであることは通知文にも残します。</p>
            <div className="notification-preview" aria-live="polite">
              <strong>{state.household.channel.toUpperCase()}通知プレビュー</strong>
              {pendingQueue[0] ? (
                <>
                  <p>
                    {pendingQueue[0].item.name}があと{pendingQueue[0].item.daysLeft}日で切れそうです。
                    {pendingQueue[0].offer.retailer}で{yenFormatter.format(pendingQueue[0].offer.price)}のデモ候補があります。
                  </p>
                  <small>本番では取得日時と比較元を添えて通知します。</small>
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
                      {offer.title} / {offer.retailer} / {yenFormatter.format(offer.price)}
                    </p>
                    <small>
                      {offer.points}・推定送客収益 {yenFormatter.format(estimatedRevenue)}
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
            <h2>世帯ごとの消費ペースと通知ルールを保存。</h2>
            <p>人数・ペット有無・通知先・広告許容度を端末内に保存し、補充タイミングと提案表示を調整します。</p>
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
              <input name="allowSponsored" type="checkbox" defaultChecked={state.household.allowSponsored} />
              最安より安く、差額が明確なスポンサー提案だけ表示する
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
            <h2>自動購入は、理由が説明できる時だけ。</h2>
            <p>MVPでは実決済を行わず、自動購入予約のシミュレーションまでに留めます。</p>
            <div className="notification-preview" aria-live="polite">
              <strong>自動購入予約: {state.autopilot.enabled ? "有効" : "無効"}</strong>
              <p>
                許可済み商品 {allowedCount}件 / 今すぐ自動予約できる候補 {reservableCount}件。1回の上限は
                {yenFormatter.format(state.autopilot.maxAmount)}、キャンセル猶予は{state.autopilot.cancelWindowHours}時間です。
              </p>
              <small>実決済は未実装です。将来は小売API、決済トークン、購入前通知、キャンセル導線を接続します。</small>
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
                  <option value="standard">標準配送で最安優先</option>
                  <option value="fast">切れそうなら速さ優先</option>
                </select>
              </label>
            </div>
            <label className="checkbox-row">
              <input name="enabled" type="checkbox" defaultChecked={state.autopilot.enabled} />
              自動購入予約のシミュレーションを有効にする
            </label>
            <label className="checkbox-row">
              <input name="requireApprovalForSponsored" type="checkbox" defaultChecked={state.autopilot.requireApprovalForSponsored} />
              広告/スポンサー商品は必ず購入前確認にする
            </label>
            <button className="button button--primary button--full" type="submit">
              自動購入ルールを保存
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
            <p>このデモでは端末内保存のみです。実サービスでは解析後削除、同意管理、広告セグメント、価格取得ログを見える化します。</p>
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
      </main>

      <footer className="footer">
        <p>Home Stack MVP - 家庭内在庫と価格透明性のリテールメディア</p>
      </footer>
    </>
  );
}

function ProductSearchPanel({
  inventory,
  query,
  result,
  status,
  onQueryChange,
  onSearch,
  onSearchInventory,
}: {
  inventory: InventoryItem[];
  query: string;
  result: ProductSearchResult | null;
  status: string;
  onQueryChange: (value: string) => void;
  onSearch: () => void;
  onSearchInventory: (item: InventoryItem) => void;
}) {
  const bestCandidate = result?.candidates[0];

  return (
    <section className="product-search-panel" aria-label="商品価格横断検索">
      <div className="product-search-copy">
        <p className="eyebrow">Price Search Lab</p>
        <h3>商品名から複数サイトを検索して価格候補を集める</h3>
        <p>
          バックエンドで検索結果ページまたは公式APIを取得し、商品名、価格、リンクを正規化します。
          APIキーが設定されているサイトは公式APIを優先し、未設定なら公開検索ページから候補抽出を試します。
        </p>
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
          <input type="search" value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="例: 猫砂 ライオン 5L" />
          <button className="button button--primary" type="button" onClick={onSearch}>
            横断検索
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
                  <strong>{candidate.price ? yenFormatter.format(candidate.price) : "価格未検出"}</strong>
                </div>
                <h4>{candidate.title}</h4>
                <p>
                  一致度 {candidate.matchScore}% / {candidate.confidence} / {candidate.shipping ?? "送料条件は要確認"}
                </p>
                <small>{candidate.evidence.join("・")}</small>
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

function PriceComparisonPanel({ offer }: { offer: Offer }) {
  const bestCompetitor = [...offer.competitors].sort((a, b) => a.price - b.price)[0];
  return (
    <section className="comparison-panel" aria-label={`${offer.title}の比較根拠`}>
      <div className="comparison-panel__header">
        <div>
          <p className="eyebrow">Comparison Proof</p>
          <h3>{offer.title} の比較根拠</h3>
          <p>{offer.comparisonBasis.join(" / ")}</p>
        </div>
        <div className="price-orbit">
          <strong>{yenFormatter.format(bestCompetitor?.price ?? offer.price)}</strong>
          <span>最安候補</span>
        </div>
      </div>
      <div className="comparison-grid">
        {offer.competitors.map((competitor) => (
          <article
            className={competitor.retailer === offer.retailer ? "comparison-card is-selected" : "comparison-card"}
            key={competitor.retailer}
          >
            <span>{competitor.retailer}</span>
            <strong>{yenFormatter.format(competitor.price)}</strong>
            <small>
              {competitor.shipping}・{competitor.points}
            </small>
            <p>{competitor.note}</p>
          </article>
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
        <h3>商品URLから本当に価格を取りに行く</h3>
        <p>
          1行に1URLを貼ってください。Next APIがHTMLを取得し、JSON-LD、metaタグ、本文中の価格らしい表記を順に探します。
          サイトによっては規約、bot対策、ログイン、JavaScript描画で取得できない場合があります。
        </p>
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

function clampNumber(value: FormDataEntryValue | null, min: number, max: number, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}
