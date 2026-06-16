export function formatPriceEvidence(entry: string) {
  const basePriceJa = entry.match(/^本体価格 ([\d,]+)円$/);
  if (basePriceJa) return `本体価格: ${basePriceJa[1]}円`;

  const shippingFeeJa = entry.match(/^送料 ([\d,]+)円$/);
  if (shippingFeeJa) return `送料: ${shippingFeeJa[1]}円を実質価格に加算`;

  const pointValueJa = entry.match(/^ポイント控除 ([\d,]+)円$/);
  if (pointValueJa) return `ポイント: ${pointValueJa[1]}円相当を実質価格から控除`;

  const couponValueJa = entry.match(/^クーポン控除 ([\d,]+)円$/);
  if (couponValueJa) return `クーポン: ${couponValueJa[1]}円相当を実質価格から控除`;

  const shippingFee = entry.match(/^(?:official )?shipping fee(?: inferred| from [^:]+)?: ([\d,]+) JPY$/i);
  if (shippingFee) return `送料: ${shippingFee[1]}円を実質価格に加算`;

  if (/^official shipping: free$/i.test(entry)) return "送料: 公式APIで送料無料を確認";
  if (/shipping condition requires retailer confirmation/i.test(entry)) {
    return "送料条件: 送料無料ライン、別送料、地域条件を販売ページで確認";
  }
  if (/purchase condition requires retailer confirmation/i.test(entry)) {
    return "購入条件: 初回限定、定期購入、まとめ買い、セット条件を販売ページで確認";
  }
  if (/sponsored placement requires retailer confirmation/i.test(entry)) {
    return "広告掲載: PR/広告枠の表示候補です。価格と条件は販売ページで確認";
  }

  const pointValue = entry.match(/^(?:official )?point value(?: inferred| from [^:]+)?: ([\d,]+) JPY$/i);
  if (pointValue) return `ポイント: ${pointValue[1]}円相当を実質価格から控除`;
  if (/point condition requires retailer confirmation/i.test(entry)) {
    return "ポイント条件: エントリー、後日付与、付与上限、対象者条件を販売ページで確認";
  }

  const couponValue = entry.match(/^(?:official )?coupon value(?: inferred| from [^:]+)?: ([\d,]+) JPY$/i);
  if (couponValue) return `クーポン: ${couponValue[1]}円相当を実質価格から控除`;
  if (/coupon condition requires retailer confirmation/i.test(entry)) {
    return "クーポン条件: 初回限定、対象者、併用可否、利用条件を販売ページで確認";
  }

  const pointWindow = entry.match(/^point window: (.+)$/i);
  if (pointWindow) return `ポイント期間: ${pointWindow[1]}`;

  if (/official point window expired before fetch/i.test(entry)) {
    return "ポイント期間: 取得時点でキャンペーン期間が終了済み";
  }
  if (/official point window starts after fetch/i.test(entry)) {
    return "ポイント期間: 取得時点ではキャンペーン開始前";
  }

  const couponWindow = entry.match(/^coupon window: (.+)$/i);
  if (couponWindow) return `クーポン期間: ${couponWindow[1]}`;

  if (/official coupon window expired before fetch/i.test(entry)) {
    return "クーポン期間: 取得時点でキャンペーン期間が終了済み";
  }
  if (/official coupon window starts after fetch/i.test(entry)) {
    return "クーポン期間: 取得時点ではキャンペーン開始前";
  }

  if (entry === "price from Amazon a-offscreen") return "価格: Amazonの商品価格表示から取得";
  if (entry === "price from Amazon split whole/fraction") return "価格: Amazonの分割価格表示から取得";
  if (entry === "external marketplace search link") return "外部検索リンク: 販売サイトで価格条件を確認";

  return entry;
}
