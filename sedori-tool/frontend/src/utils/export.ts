import type { ProductItem } from "../types";

type ComputedKey = "premium_rate";
const HEADERS: { key: keyof ProductItem | "score" | ComputedKey; label: string }[] = [
  { key: "score", label: "スコア" },
  { key: "input_code", label: "入力コード" },
  { key: "asin", label: "ASIN" },
  { key: "jan", label: "JAN" },
  { key: "title", label: "商品名" },
  { key: "brand", label: "ブランド" },
  { key: "category", label: "カテゴリ" },
  { key: "image_url", label: "画像URL" },
  { key: "release_date", label: "発売日" },
  { key: "list_price", label: "定価" },
  { key: "variation_count", label: "バリエーション数" },
  { key: "size_category", label: "サイズ区分" },
  { key: "current_price", label: "現在価格(カート)" },
  { key: "amazon_price", label: "Amazon直売価格" },
  { key: "lowest_new_price", label: "新品最安値" },
  { key: "buy_box_price", label: "カート価格" },
  { key: "fba_price", label: "FBA価格" },
  { key: "fbm_price", label: "自己発送価格" },
  { key: "used_price", label: "中古最安値" },
  { key: "price_max_all", label: "過去最高価格" },
  { key: "price_min_all", label: "過去最低価格" },
  { key: "price_avg_30d", label: "30日平均価格" },
  { key: "price_avg_90d", label: "90日平均価格" },
  { key: "price_change_30d", label: "30日変動率(%)" },
  { key: "price_change_90d", label: "90日変動率(%)" },
  { key: "premium_rate", label: "プレ値率(%)" },
  { key: "rakuten_price", label: "楽天最安値" },
  { key: "rakuten_shop", label: "楽天ショップ" },
  { key: "rakuten_url", label: "楽天URL" },
  { key: "yahoo_price", label: "Yahoo最安値" },
  { key: "yahoo_shop", label: "Yahooショップ" },
  { key: "yahoo_url", label: "YahooURL" },
  { key: "bic_price", label: "ビック最安値" },
  { key: "bic_source", label: "ビック取得元" },
  { key: "bic_shop", label: "ビックショップ" },
  { key: "bic_url", label: "ビックURL" },
  { key: "yodobashi_price", label: "ヨドバシ最安値" },
  { key: "yodobashi_shop", label: "ヨドバシショップ" },
  { key: "yodobashi_url", label: "ヨドバシURL" },
  { key: "cheapest_source", label: "最安仕入れ先" },
  { key: "purchase_price", label: "仕入れ価格" },
  { key: "profit", label: "利益額" },
  { key: "profit_rate", label: "利益率(%)" },
  { key: "monthly_profit", label: "月間予測利益" },
  { key: "fba_fee", label: "FBA手数料" },
  { key: "rank_current", label: "ランキング" },
  { key: "rank_avg30", label: "30日平均ランキング" },
  { key: "rank_avg90", label: "90日平均ランキング" },
  { key: "monthly_sales", label: "月間推定販売数" },
  { key: "sales_30d", label: "30日販売数" },
  { key: "sales_90d", label: "90日販売数" },
  { key: "new_offer_count", label: "出品者数(新品)" },
  { key: "used_offer_count", label: "出品者数(中古)" },
  { key: "fba_offer_count", label: "FBA出品者数" },
  { key: "fbm_offer_count", label: "自己発送出品者数" },
  { key: "amazon_in_stock", label: "Amazon在庫" },
  { key: "buy_box_is_amazon", label: "Amazon本体" },
  { key: "amazon_url", label: "Amazon URL" },
  { key: "keepa_url", label: "Keepa URL" },
  { key: "error", label: "エラー" },
];

function csvEscape(val: unknown): string {
  if (val == null) return "";
  const s = String(val);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function timestamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    d.getFullYear().toString() +
    p(d.getMonth() + 1) +
    p(d.getDate()) +
    "_" +
    p(d.getHours()) +
    p(d.getMinutes()) +
    p(d.getSeconds())
  );
}

function computePremiumRate(item: ProductItem): number | null {
  if (!item.list_price || item.list_price <= 0) return null;
  const cur = item.current_price ?? item.lowest_new_price;
  if (cur == null) return null;
  return Math.round(((cur - item.list_price) / item.list_price) * 1000) / 10;
}

export function exportCsv(items: ProductItem[]): void {
  const lines = [HEADERS.map((h) => csvEscape(h.label)).join(",")];
  for (const item of items) {
    const row = HEADERS.map((h) => {
      if (h.key === "premium_rate") return csvEscape(computePremiumRate(item));
      return csvEscape((item as unknown as Record<string, unknown>)[h.key as string]);
    });
    lines.push(row.join(","));
  }
  const csv = "﻿" + lines.join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `sedori_result_${timestamp()}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
