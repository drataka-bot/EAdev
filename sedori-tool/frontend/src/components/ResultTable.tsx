import { useMemo, useState } from "react";
import type { ProductItem, ScoreGrade } from "../types";
import { ScoreBadge } from "./ScoreBadge";

type SortKey =
  | "score"
  | "title"
  | "amazon_price"
  | "lowest_new_price"
  | "used_price"
  | "rakuten_price"
  | "yahoo_price"
  | "purchase_price"
  | "profit"
  | "profit_rate"
  | "rank_current"
  | "monthly_sales"
  | "sales_30d"
  | "sales_90d"
  | "new_offer_count"
  | "fba_offer_count";

type SortDir = "asc" | "desc";

const SCORE_ORDER: Record<string, number> = { S: 0, A: 1, B: 2, C: 3, D: 4, "-": 5 };
const ALL_GRADES: (ScoreGrade | "-")[] = ["S", "A", "B", "C", "D", "-"];
const ALL_SIZES = ["小型", "標準", "大型"];

interface Props {
  items: ProductItem[];
  onPurchasePriceChange: (asin: string, code: string, value: number | null) => void;
  onExport: (filtered: ProductItem[]) => void;
}

function yen(v: number | null | undefined): string {
  if (v == null) return "-";
  return `¥${v.toLocaleString()}`;
}

function num(v: number | null | undefined): string {
  if (v == null) return "-";
  return v.toLocaleString();
}

function sortValue(item: ProductItem, key: SortKey): number | string {
  switch (key) {
    case "score":
      return SCORE_ORDER[item.score] ?? 99;
    case "title":
      return item.title ?? "";
    case "amazon_price":
      return item.amazon_price ?? Number.MAX_SAFE_INTEGER;
    case "lowest_new_price":
      return item.lowest_new_price ?? Number.MAX_SAFE_INTEGER;
    case "used_price":
      return item.used_price ?? Number.MAX_SAFE_INTEGER;
    case "rakuten_price":
      return item.rakuten_price ?? Number.MAX_SAFE_INTEGER;
    case "yahoo_price":
      return item.yahoo_price ?? Number.MAX_SAFE_INTEGER;
    case "purchase_price":
      return item.purchase_price ?? Number.MAX_SAFE_INTEGER;
    case "profit":
      return item.profit ?? Number.MIN_SAFE_INTEGER;
    case "profit_rate":
      return item.profit_rate ?? Number.MIN_SAFE_INTEGER;
    case "rank_current":
      return item.rank_current ?? Number.MAX_SAFE_INTEGER;
    case "monthly_sales":
      return item.monthly_sales;
    case "sales_30d":
      return item.sales_30d ?? -1;
    case "sales_90d":
      return item.sales_90d ?? -1;
    case "new_offer_count":
      return item.new_offer_count ?? Number.MAX_SAFE_INTEGER;
    case "fba_offer_count":
      return item.fba_offer_count ?? Number.MAX_SAFE_INTEGER;
    default:
      return 0;
  }
}

export function ResultTable({ items, onPurchasePriceChange, onExport }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("score");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [gradeFilter, setGradeFilter] = useState<Set<string>>(new Set());
  const [sizeFilter, setSizeFilter] = useState<Set<string>>(new Set());
  const [keyword, setKeyword] = useState("");
  const [minProfitRate, setMinProfitRate] = useState<string>("");
  const [minMonthly, setMinMonthly] = useState<string>("");
  const [maxNewOffers, setMaxNewOffers] = useState<string>("");
  const [maxFbaOffers, setMaxFbaOffers] = useState<string>("");
  const [excludeAmazon, setExcludeAmazon] = useState(false);
  const [profitableOnly, setProfitableOnly] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const toNumber = (v: string): number | null => {
    if (v.trim() === "") return null;
    const n = Number(v);
    return Number.isNaN(n) ? null : n;
  };

  const visible = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    const minPR = toNumber(minProfitRate);
    const minMon = toNumber(minMonthly);
    const maxNew = toNumber(maxNewOffers);
    const maxFba = toNumber(maxFbaOffers);

    let rows = items.filter((item) => {
      if (gradeFilter.size > 0 && !gradeFilter.has(item.score)) return false;
      if (sizeFilter.size > 0) {
        const sc = item.size_category ?? "";
        if (!sizeFilter.has(sc)) return false;
      }
      if (excludeAmazon && (item.amazon_in_stock || item.buy_box_is_amazon)) return false;
      if (profitableOnly && (item.profit == null || item.profit <= 0)) return false;
      if (minPR != null && (item.profit_rate == null || item.profit_rate < minPR))
        return false;
      if (minMon != null && item.monthly_sales < minMon) return false;
      if (
        maxNew != null &&
        item.new_offer_count != null &&
        item.new_offer_count > maxNew
      )
        return false;
      if (
        maxFba != null &&
        item.fba_offer_count != null &&
        item.fba_offer_count > maxFba
      )
        return false;
      if (kw) {
        const hay = [
          item.title,
          item.asin,
          item.input_code,
          item.brand,
          item.category,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!hay.includes(kw)) return false;
      }
      return true;
    });
    rows = rows.slice().sort((a, b) => {
      const av = sortValue(a, sortKey);
      const bv = sortValue(b, sortKey);
      if (typeof av === "number" && typeof bv === "number") {
        return sortDir === "asc" ? av - bv : bv - av;
      }
      return sortDir === "asc"
        ? String(av).localeCompare(String(bv))
        : String(bv).localeCompare(String(av));
    });
    return rows;
  }, [
    items,
    gradeFilter,
    sizeFilter,
    keyword,
    minProfitRate,
    minMonthly,
    maxNewOffers,
    maxFbaOffers,
    excludeAmazon,
    profitableOnly,
    sortKey,
    sortDir,
  ]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(
        key === "profit" ||
          key === "profit_rate" ||
          key === "monthly_sales" ||
          key === "sales_30d" ||
          key === "sales_90d"
          ? "desc"
          : "asc"
      );
    }
  };

  const sortArrow = (key: SortKey) =>
    sortKey === key ? (sortDir === "asc" ? " ▲" : " ▼") : "";

  const toggleInSet = (set: Set<string>, v: string) => {
    const next = new Set(set);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    return next;
  };

  const copyAsin = async (asin: string | null) => {
    if (!asin) return;
    try {
      await navigator.clipboard.writeText(asin);
    } catch {
      // noop
    }
  };

  const resetFilters = () => {
    setGradeFilter(new Set());
    setSizeFilter(new Set());
    setKeyword("");
    setMinProfitRate("");
    setMinMonthly("");
    setMaxNewOffers("");
    setMaxFbaOffers("");
    setExcludeAmazon(false);
    setProfitableOnly(false);
  };

  return (
    <div className="bg-base-700/60 border border-base-500 rounded-lg p-4">
      {/* --- フィルタバー --- */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm text-gray-400">スコア:</span>
          {ALL_GRADES.map((g) => {
            const active = gradeFilter.has(g);
            return (
              <button
                key={g}
                type="button"
                onClick={() => setGradeFilter((p) => toggleInSet(p, g))}
                className={`px-2 py-1 rounded text-xs font-bold border transition ${
                  active
                    ? "bg-accent text-black border-accent"
                    : "bg-base-700 text-gray-300 border-base-500 hover:border-accent"
                }`}
              >
                {g}
              </button>
            );
          })}
          <input
            type="text"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="キーワード検索"
            className="ml-2 bg-base-900 border border-base-500 focus:border-accent rounded px-3 py-1 text-sm text-gray-100 outline-none w-56"
          />
          <button
            type="button"
            onClick={() => setAdvancedOpen((v) => !v)}
            className="px-2 py-1 bg-base-600 hover:bg-base-500 border border-base-400 rounded text-xs text-gray-200"
          >
            {advancedOpen ? "詳細条件 ▲" : "詳細条件 ▼"}
          </button>
          <button
            type="button"
            onClick={resetFilters}
            className="px-2 py-1 bg-base-700 hover:bg-base-600 border border-base-500 rounded text-xs text-gray-400"
          >
            リセット
          </button>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-400">
            表示: <span className="text-accent font-bold">{visible.length}</span> /{" "}
            {items.length} 件
          </span>
          <button
            type="button"
            onClick={() => onExport(visible)}
            disabled={visible.length === 0}
            className="px-3 py-1 bg-base-600 hover:bg-base-500 disabled:opacity-50 border border-base-400 rounded text-sm text-gray-100"
          >
            CSV 出力
          </button>
        </div>
      </div>

      {/* --- 詳細条件 (ミリオンサーチ風) --- */}
      {advancedOpen && (
        <div className="bg-base-800/80 border border-base-500 rounded p-3 mb-4 grid grid-cols-4 gap-3 text-xs">
          <NumberField
            label="最小利益率 (%)"
            value={minProfitRate}
            onChange={setMinProfitRate}
            placeholder="例: 15"
          />
          <NumberField
            label="最小月間販売数"
            value={minMonthly}
            onChange={setMinMonthly}
            placeholder="例: 10"
          />
          <NumberField
            label="最大新品出品者数"
            value={maxNewOffers}
            onChange={setMaxNewOffers}
            placeholder="例: 10"
          />
          <NumberField
            label="最大 FBA 出品者数"
            value={maxFbaOffers}
            onChange={setMaxFbaOffers}
            placeholder="例: 5"
          />
          <div>
            <div className="text-gray-400 mb-1">サイズカテゴリ</div>
            <div className="flex gap-1 flex-wrap">
              {ALL_SIZES.map((s) => {
                const active = sizeFilter.has(s);
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setSizeFilter((p) => toggleInSet(p, s))}
                    className={`px-2 py-1 rounded border transition ${
                      active
                        ? "bg-accent text-black border-accent"
                        : "bg-base-700 text-gray-300 border-base-500 hover:border-accent"
                    }`}
                  >
                    {s}
                  </button>
                );
              })}
            </div>
          </div>
          <label className="flex items-center gap-2 text-gray-300 mt-5">
            <input
              type="checkbox"
              checked={excludeAmazon}
              onChange={(e) => setExcludeAmazon(e.target.checked)}
              className="accent-accent"
            />
            Amazon 本体出品を除外
          </label>
          <label className="flex items-center gap-2 text-gray-300 mt-5">
            <input
              type="checkbox"
              checked={profitableOnly}
              onChange={(e) => setProfitableOnly(e.target.checked)}
              className="accent-accent"
            />
            黒字のみ表示
          </label>
        </div>
      )}

      {/* --- テーブル --- */}
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="text-xs text-gray-300 bg-base-800/70 sticky top-0">
            <tr>
              <Th onClick={() => handleSort("score")} label={`スコア${sortArrow("score")}`} />
              <Th onClick={() => handleSort("title")} label={`商品名${sortArrow("title")}`} />
              <th className="px-3 py-2 text-left">ASIN</th>
              <th className="px-3 py-2 text-center">サイズ</th>
              <Th
                onClick={() => handleSort("amazon_price")}
                label={`現在価格${sortArrow("amazon_price")}`}
                align="right"
              />
              <Th
                onClick={() => handleSort("lowest_new_price")}
                label={`新品最安${sortArrow("lowest_new_price")}`}
                align="right"
              />
              <Th
                onClick={() => handleSort("used_price")}
                label={`中古最安${sortArrow("used_price")}`}
                align="right"
              />
              <Th
                onClick={() => handleSort("rakuten_price")}
                label={`楽天${sortArrow("rakuten_price")}`}
                align="right"
              />
              <Th
                onClick={() => handleSort("yahoo_price")}
                label={`Yahoo${sortArrow("yahoo_price")}`}
                align="right"
              />
              <Th
                onClick={() => handleSort("purchase_price")}
                label={`仕入れ${sortArrow("purchase_price")}`}
                align="right"
              />
              <Th
                onClick={() => handleSort("profit")}
                label={`利益${sortArrow("profit")}`}
                align="right"
              />
              <Th
                onClick={() => handleSort("profit_rate")}
                label={`利益率${sortArrow("profit_rate")}`}
                align="right"
              />
              <Th
                onClick={() => handleSort("rank_current")}
                label={`ランク${sortArrow("rank_current")}`}
                align="right"
              />
              <Th
                onClick={() => handleSort("monthly_sales")}
                label={`月販売${sortArrow("monthly_sales")}`}
                align="right"
              />
              <Th
                onClick={() => handleSort("sales_30d")}
                label={`30日${sortArrow("sales_30d")}`}
                align="right"
              />
              <Th
                onClick={() => handleSort("sales_90d")}
                label={`90日${sortArrow("sales_90d")}`}
                align="right"
              />
              <Th
                onClick={() => handleSort("new_offer_count")}
                label={`新品出品${sortArrow("new_offer_count")}`}
                align="right"
              />
              <Th
                onClick={() => handleSort("fba_offer_count")}
                label={`FBA${sortArrow("fba_offer_count")}`}
                align="right"
              />
              <th className="px-3 py-2 text-center">Amazon</th>
              <th className="px-3 py-2 text-center">Keepa</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr>
                <td colSpan={20} className="text-center py-10 text-gray-500">
                  データがありません
                </td>
              </tr>
            )}
            {visible.map((item) => (
              <tr
                key={`${item.input_code}-${item.asin ?? "x"}`}
                className="border-t border-base-600 hover:bg-base-700/40"
              >
                <td className="px-3 py-2">
                  <ScoreBadge grade={item.score} />
                </td>
                <td className="px-3 py-2 max-w-[280px]">
                  {item.title ? (
                    <a
                      href={item.amazon_url ?? "#"}
                      target="_blank"
                      rel="noreferrer"
                      className="text-accent hover:underline line-clamp-2"
                      title={item.title}
                    >
                      {item.title}
                    </a>
                  ) : (
                    <span className="text-gray-500">
                      {item.error ?? "（商品名なし）"}
                    </span>
                  )}
                  {item.brand && (
                    <div className="text-xs text-gray-500 mt-0.5">{item.brand}</div>
                  )}
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-1">
                    <span className="font-mono text-xs text-gray-300">
                      {item.asin ?? "-"}
                    </span>
                    {item.asin && (
                      <button
                        type="button"
                        onClick={() => copyAsin(item.asin)}
                        title="コピー"
                        className="text-gray-500 hover:text-accent text-xs px-1"
                      >
                        ⎘
                      </button>
                    )}
                  </div>
                </td>
                <td className="px-3 py-2 text-center">
                  {item.size_category ? (
                    <span className="text-xs px-2 py-0.5 rounded bg-base-600 text-gray-200">
                      {item.size_category}
                    </span>
                  ) : (
                    <span className="text-gray-600 text-xs">-</span>
                  )}
                </td>
                <td className="px-3 py-2 text-right text-gray-200">
                  {yen(item.amazon_price)}
                  {item.buy_box_is_amazon && (
                    <div className="text-[10px] text-amber-400">Amazon直売</div>
                  )}
                </td>
                <td className="px-3 py-2 text-right text-gray-200">
                  {yen(item.lowest_new_price)}
                  {item.fba_price != null && (
                    <div className="text-[10px] text-gray-500">
                      FBA: {yen(item.fba_price)}
                    </div>
                  )}
                </td>
                <td className="px-3 py-2 text-right text-gray-200">
                  {yen(item.used_price)}
                </td>
                <td className="px-3 py-2 text-right">
                  <SourceCell
                    price={item.rakuten_price}
                    url={item.rakuten_url}
                    shop={item.rakuten_shop}
                    cheapest={item.cheapest_source === "rakuten"}
                    color="text-red-400"
                  />
                </td>
                <td className="px-3 py-2 text-right">
                  <SourceCell
                    price={item.yahoo_price}
                    url={item.yahoo_url}
                    shop={item.yahoo_shop}
                    cheapest={item.cheapest_source === "yahoo"}
                    color="text-purple-400"
                  />
                </td>
                <td className="px-3 py-2 text-right">
                  <input
                    type="number"
                    min={0}
                    value={item.purchase_price ?? ""}
                    onChange={(e) => {
                      const v = e.target.value;
                      onPurchasePriceChange(
                        item.asin ?? item.input_code,
                        item.input_code,
                        v === "" ? null : Number(v)
                      );
                    }}
                    disabled={!item.asin}
                    className="w-24 bg-base-900 border border-base-500 focus:border-accent rounded px-2 py-1 text-right text-gray-100 outline-none disabled:opacity-40"
                  />
                </td>
                <td
                  className={`px-3 py-2 text-right font-bold ${
                    item.profit == null
                      ? "text-gray-500"
                      : item.profit < 0
                      ? "text-red-400"
                      : "text-green-400"
                  }`}
                >
                  {yen(item.profit)}
                </td>
                <td
                  className={`px-3 py-2 text-right ${
                    item.profit_rate == null
                      ? "text-gray-500"
                      : item.profit_rate < 0
                      ? "text-red-400"
                      : "text-gray-100"
                  }`}
                >
                  {item.profit_rate == null ? "-" : `${item.profit_rate.toFixed(1)}%`}
                </td>
                <td className="px-3 py-2 text-right text-gray-200">
                  {num(item.rank_current)}
                  {item.rank_avg90 != null && (
                    <div className="text-[10px] text-gray-500">
                      90日平: {num(item.rank_avg90)}
                    </div>
                  )}
                </td>
                <td className="px-3 py-2 text-right text-gray-200">
                  {num(item.monthly_sales)}
                </td>
                <td className="px-3 py-2 text-right text-gray-400">
                  {num(item.sales_30d)}
                </td>
                <td className="px-3 py-2 text-right text-gray-400">
                  {num(item.sales_90d)}
                </td>
                <td className="px-3 py-2 text-right text-gray-200">
                  {num(item.new_offer_count)}
                  <div className="text-[10px] text-gray-500">
                    中古 {num(item.used_offer_count)}
                  </div>
                </td>
                <td className="px-3 py-2 text-right text-gray-200">
                  {num(item.fba_offer_count)}
                  <div className="text-[10px] text-gray-500">
                    自己 {num(item.fbm_offer_count)}
                  </div>
                </td>
                <td className="px-3 py-2 text-center">
                  {item.amazon_url ? (
                    <a
                      href={item.amazon_url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-accent hover:underline text-xs"
                    >
                      開く
                    </a>
                  ) : (
                    "-"
                  )}
                </td>
                <td className="px-3 py-2 text-center">
                  {item.keepa_url ? (
                    <a
                      href={item.keepa_url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-accent hover:underline text-xs"
                    >
                      開く
                    </a>
                  ) : (
                    "-"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Th({
  onClick,
  label,
  align = "left",
}: {
  onClick: () => void;
  label: string;
  align?: "left" | "right";
}) {
  return (
    <th
      onClick={onClick}
      className={`px-3 py-2 cursor-pointer select-none hover:text-accent text-${align}`}
    >
      {label}
    </th>
  );
}

function SourceCell({
  price,
  url,
  shop,
  cheapest,
  color,
}: {
  price: number | null;
  url: string | null;
  shop: string | null;
  cheapest: boolean;
  color: string;
}) {
  if (price == null) return <span className="text-gray-600 text-xs">-</span>;
  return (
    <div className="text-right">
      {url ? (
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className={`hover:underline font-bold ${color}`}
        >
          ¥{price.toLocaleString()}
        </a>
      ) : (
        <span className={color}>¥{price.toLocaleString()}</span>
      )}
      {cheapest && (
        <div className="text-[10px] text-accent">最安★</div>
      )}
      {shop && (
        <div
          className="text-[10px] text-gray-500 truncate max-w-[120px]"
          title={shop}
        >
          {shop}
        </div>
      )}
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <div className="text-gray-400 mb-1">{label}</div>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-base-900 border border-base-500 focus:border-accent rounded px-2 py-1 text-gray-100 outline-none text-sm"
      />
    </div>
  );
}
