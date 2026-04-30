import { useMemo, useState } from "react";
import type { OfferItem, ProductItem, ScoreGrade } from "../types";
import { loadFavorites, toggleFavorite } from "../utils/favorites";
import { ScoreBadge } from "./ScoreBadge";

type SortKey =
  | "score"
  | "title"
  | "current_price"
  | "lowest_new_price"
  | "used_price"
  | "rakuten_price"
  | "yahoo_price"
  | "bic_price"
  | "yodobashi_price"
  | "purchase_price"
  | "profit"
  | "profit_rate"
  | "monthly_profit"
  | "rank_current"
  | "monthly_sales"
  | "sales_30d"
  | "sales_90d"
  | "new_offer_count"
  | "fba_offer_count"
  | "price_avg_30d"
  | "price_max_all"
  | "price_min_all"
  | "premium_rate";

type SortDir = "asc" | "desc";

const SCORE_ORDER: Record<string, number> = { S: 0, A: 1, B: 2, C: 3, D: 4, "-": 5 };
const ALL_GRADES: (ScoreGrade | "-")[] = ["S", "A", "B", "C", "D", "-"];
const ALL_SIZES = ["小型", "標準", "大型"];

interface Props {
  items: ProductItem[];
  onPurchasePriceChange: (asin: string, code: string, value: number | null) => void;
  onExport: (filtered: ProductItem[]) => void;
}

// 表示/非表示を切り替え可能な列。alwaysVisible は常に表示。
type ColumnId =
  | "image"
  | "current_price"
  | "lowest_new_price"
  | "used_price"
  | "price_max_all"
  | "price_min_all"
  | "price_avg_30d"
  | "change_rate"
  | "premium_rate"
  | "rakuten"
  | "yahoo"
  | "bic"
  | "yodobashi"
  | "profit_rate"
  | "monthly_profit"
  | "rank_current"
  | "monthly_sales"
  | "sales_30d"
  | "sales_90d"
  | "new_offer_count"
  | "fba_offer_count"
  | "keepa_graph";

const COLUMN_GROUPS: { group: string; cols: { id: ColumnId; label: string }[] }[] = [
  {
    group: "商品情報",
    cols: [{ id: "image", label: "画像" }],
  },
  {
    group: "価格",
    cols: [
      { id: "current_price", label: "現在価格" },
      { id: "lowest_new_price", label: "新品最安" },
      { id: "used_price", label: "中古最安" },
    ],
  },
  {
    group: "価格履歴",
    cols: [
      { id: "price_max_all", label: "過去最高" },
      { id: "price_min_all", label: "過去最低" },
      { id: "price_avg_30d", label: "30日平均" },
      { id: "change_rate", label: "変動率" },
      { id: "premium_rate", label: "プレ値率" },
    ],
  },
  {
    group: "仕入れ候補",
    cols: [
      { id: "rakuten", label: "楽天" },
      { id: "yahoo", label: "Yahoo" },
      { id: "bic", label: "ビック" },
      { id: "yodobashi", label: "ヨドバシ" },
    ],
  },
  {
    group: "利益",
    cols: [
      { id: "profit_rate", label: "利益率" },
      { id: "monthly_profit", label: "月予測利益" },
    ],
  },
  {
    group: "販売実績",
    cols: [
      { id: "rank_current", label: "ランク" },
      { id: "monthly_sales", label: "月販売" },
      { id: "sales_30d", label: "30日販売" },
      { id: "sales_90d", label: "90日販売" },
    ],
  },
  {
    group: "競合",
    cols: [
      { id: "new_offer_count", label: "新品出品" },
      { id: "fba_offer_count", label: "FBA" },
    ],
  },
  {
    group: "リンク",
    cols: [{ id: "keepa_graph", label: "Keepaグラフ" }],
  },
];

const DEFAULT_VISIBLE: ColumnId[] = [
  "image",
  "current_price",
  "lowest_new_price",
  "premium_rate",
  "rakuten",
  "yahoo",
  "profit_rate",
  "monthly_profit",
  "rank_current",
  "monthly_sales",
  "new_offer_count",
  "keepa_graph",
];

const COLS_KEY = "sedori_visible_cols_v1";

function loadVisibleCols(): Set<ColumnId> {
  try {
    const raw = localStorage.getItem(COLS_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return new Set(arr as ColumnId[]);
    }
  } catch {
    // noop
  }
  return new Set(DEFAULT_VISIBLE);
}

function yen(v: number | null | undefined): string {
  if (v == null) return "-";
  return `¥${v.toLocaleString()}`;
}

function num(v: number | null | undefined): string {
  if (v == null) return "-";
  return v.toLocaleString();
}

function premiumRate(item: ProductItem): number | null {
  if (!item.list_price || item.list_price <= 0) return null;
  const cur = item.current_price ?? item.lowest_new_price;
  if (cur == null) return null;
  return Math.round(((cur - item.list_price) / item.list_price) * 1000) / 10;
}

function sortValue(item: ProductItem, key: SortKey): number | string {
  switch (key) {
    case "score":
      return SCORE_ORDER[item.score] ?? 99;
    case "title":
      return item.title ?? "";
    case "current_price":
      return item.current_price ?? Number.MAX_SAFE_INTEGER;
    case "lowest_new_price":
      return item.lowest_new_price ?? Number.MAX_SAFE_INTEGER;
    case "used_price":
      return item.used_price ?? Number.MAX_SAFE_INTEGER;
    case "rakuten_price":
      return item.rakuten_price ?? Number.MAX_SAFE_INTEGER;
    case "yahoo_price":
      return item.yahoo_price ?? Number.MAX_SAFE_INTEGER;
    case "bic_price":
      return item.bic_price ?? Number.MAX_SAFE_INTEGER;
    case "yodobashi_price":
      return item.yodobashi_price ?? Number.MAX_SAFE_INTEGER;
    case "purchase_price":
      return item.purchase_price ?? Number.MAX_SAFE_INTEGER;
    case "profit":
      return item.profit ?? Number.MIN_SAFE_INTEGER;
    case "profit_rate":
      return item.profit_rate ?? Number.MIN_SAFE_INTEGER;
    case "monthly_profit":
      return item.monthly_profit ?? Number.MIN_SAFE_INTEGER;
    case "price_avg_30d":
      return item.price_avg_30d ?? Number.MAX_SAFE_INTEGER;
    case "price_max_all":
      return item.price_max_all ?? Number.MAX_SAFE_INTEGER;
    case "price_min_all":
      return item.price_min_all ?? Number.MAX_SAFE_INTEGER;
    case "premium_rate":
      return premiumRate(item) ?? Number.MIN_SAFE_INTEGER;
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
  const [minProfit, setMinProfit] = useState<string>("");
  const [minMonthlyProfit, setMinMonthlyProfit] = useState<string>("");
  const [maxRank, setMaxRank] = useState<string>("");
  const [minSales30, setMinSales30] = useState<string>("");
  const [priceMin, setPriceMin] = useState<string>("");
  const [priceMax, setPriceMax] = useState<string>("");
  const [premiumOnly, setPremiumOnly] = useState(false);
  const [minPremiumPct, setMinPremiumPct] = useState<string>("10");
  const [excludeEbooks, setExcludeEbooks] = useState(false);
  const [ebooksOnly, setEbooksOnly] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [pageSize, setPageSize] = useState<number>(20);
  const [page, setPage] = useState<number>(1);
  const [favorites, setFavorites] = useState<Set<string>>(() => loadFavorites());
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkMsg, setBulkMsg] = useState<string | null>(null);
  const [visibleCols, setVisibleCols] = useState<Set<ColumnId>>(() => loadVisibleCols());
  const [columnsPanelOpen, setColumnsPanelOpen] = useState(false);

  const isCol = (id: ColumnId) => visibleCols.has(id);
  const groupColspan = (group: string): number => {
    const def = COLUMN_GROUPS.find((g) => g.group === group);
    if (!def) return 0;
    return def.cols.filter((c) => visibleCols.has(c.id)).length;
  };

  const persistCols = (next: Set<ColumnId>) => {
    setVisibleCols(next);
    try {
      localStorage.setItem(COLS_KEY, JSON.stringify([...next]));
    } catch {
      // noop
    }
  };
  const toggleCol = (id: ColumnId) => {
    const next = new Set(visibleCols);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    persistCols(next);
  };
  const showAllCols = () => {
    const all = new Set<ColumnId>();
    COLUMN_GROUPS.forEach((g) => g.cols.forEach((c) => all.add(c.id)));
    persistCols(all);
  };
  const showDefaultCols = () => persistCols(new Set(DEFAULT_VISIBLE));

  const handleToggleFavorite = (asin: string | null) => {
    if (!asin) return;
    setFavorites(toggleFavorite(asin));
  };

  const addAllToWatchlist = async () => {
    const targets = items.filter((it) => it.asin && favorites.has(it.asin));
    if (targets.length === 0) {
      setBulkMsg("お気に入りがありません");
      return;
    }
    if (!confirm(`お気に入り ${targets.length} 件をウォッチリストに登録しますか?`))
      return;
    setBulkBusy(true);
    setBulkMsg(null);
    let ok = 0;
    let ng = 0;
    for (const it of targets) {
      try {
        const resp = await fetch("/api/watchlist", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            asin: it.asin,
            title: it.title,
            image_url: it.image_url,
            trigger_restock: true,
            trigger_price_below: null,
            trigger_rank_below: null,
            enabled: true,
          }),
        });
        if (resp.ok) ok += 1;
        else ng += 1;
      } catch {
        ng += 1;
      }
    }
    setBulkBusy(false);
    setBulkMsg(`ウォッチリストへ登録: 成功 ${ok} 件 / 失敗 ${ng} 件`);
  };

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
    const minP = toNumber(minProfit);
    const minMP = toNumber(minMonthlyProfit);
    const maxR = toNumber(maxRank);
    const minS30 = toNumber(minSales30);
    const pMin = toNumber(priceMin);
    const pMax = toNumber(priceMax);

    let rows = items.filter((item) => {
      if (favoritesOnly && (!item.asin || !favorites.has(item.asin))) return false;
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
      if (minP != null && (item.profit == null || item.profit < minP)) return false;
      if (
        minMP != null &&
        (item.monthly_profit == null || item.monthly_profit < minMP)
      )
        return false;
      if (
        maxR != null &&
        (item.rank_current == null || item.rank_current > maxR)
      )
        return false;
      if (minS30 != null && (item.sales_30d == null || item.sales_30d < minS30))
        return false;
      const cur = item.current_price ?? item.lowest_new_price;
      if (pMin != null && (cur == null || cur < pMin)) return false;
      if (pMax != null && (cur == null || cur > pMax)) return false;
      if (premiumOnly) {
        const pr = premiumRate(item);
        const minPR2 = toNumber(minPremiumPct) ?? 0;
        if (pr == null || pr < minPR2) return false;
      }
      if (excludeEbooks && item.is_ebook) return false;
      if (ebooksOnly && !item.is_ebook) return false;
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
    minProfit,
    minMonthlyProfit,
    maxRank,
    minSales30,
    priceMin,
    priceMax,
    excludeAmazon,
    profitableOnly,
    premiumOnly,
    minPremiumPct,
    excludeEbooks,
    ebooksOnly,
    favoritesOnly,
    favorites,
    sortKey,
    sortDir,
  ]);

  // フィルタが変わったら 1 ページ目に戻す
  const filteredCount = visible.length;
  const totalPages = Math.max(1, Math.ceil(filteredCount / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageStart = (safePage - 1) * pageSize;
  const pageRows = visible.slice(pageStart, pageStart + pageSize);

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
    setMinProfit("");
    setMinMonthlyProfit("");
    setMaxRank("");
    setMinSales30("");
    setPriceMin("");
    setPriceMax("");
    setExcludeAmazon(false);
    setProfitableOnly(false);
    setPremiumOnly(false);
    setMinPremiumPct("10");
    setExcludeEbooks(false);
    setEbooksOnly(false);
  };

  // ----- フィルタプリセット (localStorage) -----
  type Preset = {
    name: string;
    grades: string[];
    sizes: string[];
    keyword: string;
    minProfitRate: string;
    minMonthly: string;
    maxNewOffers: string;
    maxFbaOffers: string;
    minProfit: string;
    minMonthlyProfit: string;
    maxRank: string;
    minSales30: string;
    priceMin: string;
    priceMax: string;
    excludeAmazon: boolean;
    profitableOnly: boolean;
  };
  const PRESET_KEY = "sedori_filter_presets_v1";
  const [presets, setPresets] = useState<Preset[]>(() => {
    try {
      const raw = localStorage.getItem(PRESET_KEY);
      return raw ? (JSON.parse(raw) as Preset[]) : [];
    } catch {
      return [];
    }
  });

  const persistPresets = (next: Preset[]) => {
    setPresets(next);
    try {
      localStorage.setItem(PRESET_KEY, JSON.stringify(next));
    } catch {
      // noop
    }
  };

  const savePreset = () => {
    const name = prompt("プリセット名を入力してください");
    if (!name || !name.trim()) return;
    const preset: Preset = {
      name: name.trim(),
      grades: [...gradeFilter],
      sizes: [...sizeFilter],
      keyword,
      minProfitRate,
      minMonthly,
      maxNewOffers,
      maxFbaOffers,
      minProfit,
      minMonthlyProfit,
      maxRank,
      minSales30,
      priceMin,
      priceMax,
      excludeAmazon,
      profitableOnly,
    };
    const next = [...presets.filter((p) => p.name !== preset.name), preset];
    persistPresets(next);
  };

  const loadPreset = (name: string) => {
    const p = presets.find((x) => x.name === name);
    if (!p) return;
    setGradeFilter(new Set(p.grades));
    setSizeFilter(new Set(p.sizes));
    setKeyword(p.keyword);
    setMinProfitRate(p.minProfitRate);
    setMinMonthly(p.minMonthly);
    setMaxNewOffers(p.maxNewOffers);
    setMaxFbaOffers(p.maxFbaOffers);
    setMinProfit(p.minProfit);
    setMinMonthlyProfit(p.minMonthlyProfit);
    setMaxRank(p.maxRank);
    setMinSales30(p.minSales30);
    setPriceMin(p.priceMin);
    setPriceMax(p.priceMax);
    setExcludeAmazon(p.excludeAmazon);
    setProfitableOnly(p.profitableOnly);
  };

  const deletePreset = (name: string) => {
    if (!confirm(`プリセット「${name}」を削除しますか?`)) return;
    persistPresets(presets.filter((p) => p.name !== name));
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
          <button
            type="button"
            onClick={() => setColumnsPanelOpen((v) => !v)}
            className="px-2 py-1 bg-base-700 hover:bg-base-600 border border-base-500 rounded text-xs text-gray-300"
          >
            列設定 {columnsPanelOpen ? "▲" : "▼"}
          </button>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-400">
            表示: <span className="text-accent font-bold">{filteredCount}</span> /{" "}
            {items.length} 件
          </span>
          <select
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value));
              setPage(1);
            }}
            className="bg-base-900 border border-base-500 rounded px-2 py-1 text-sm text-gray-100"
          >
            {[10, 20, 50, 100].map((n) => (
              <option key={n} value={n}>
                {n} 件/ページ
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setPremiumOnly((v) => !v)}
            className={`px-3 py-1 border rounded text-sm ${
              premiumOnly
                ? "bg-pink-500/20 text-pink-300 border-pink-500/60"
                : "bg-base-700 text-gray-300 border-base-500 hover:border-pink-500"
            }`}
            title="定価より高く売られている商品のみ"
          >
            🔥 プレ値モード{premiumOnly ? "(ON)" : ""}
          </button>
          {premiumOnly && (
            <span className="inline-flex items-center gap-1 text-xs text-gray-300">
              ≥
              <input
                type="number"
                value={minPremiumPct}
                onChange={(e) => setMinPremiumPct(e.target.value)}
                className="w-14 bg-base-900 border border-base-500 rounded px-2 py-0.5 text-right"
              />
              %
            </span>
          )}
          <button
            type="button"
            onClick={() => setFavoritesOnly((v) => !v)}
            className={`px-3 py-1 border rounded text-sm ${
              favoritesOnly
                ? "bg-yellow-500/20 text-yellow-300 border-yellow-500/60"
                : "bg-base-700 text-gray-300 border-base-500 hover:border-yellow-500"
            }`}
            title={`お気に入り ${favorites.size} 件`}
          >
            ★ お気に入り{favoritesOnly ? "のみ" : ""} ({favorites.size})
          </button>
          <button
            type="button"
            onClick={addAllToWatchlist}
            disabled={bulkBusy || favorites.size === 0}
            className="px-3 py-1 bg-base-600 hover:bg-base-500 disabled:opacity-50 border border-base-400 rounded text-sm text-gray-100"
          >
            {bulkBusy ? "登録中..." : "★を一括監視"}
          </button>
          <button
            type="button"
            onClick={() => onExport(visible)}
            disabled={filteredCount === 0}
            className="px-3 py-1 bg-base-600 hover:bg-base-500 disabled:opacity-50 border border-base-400 rounded text-sm text-gray-100"
          >
            CSV 出力
          </button>
        </div>
      </div>
      {bulkMsg && (
        <div className="text-xs text-amber-300 mb-2">{bulkMsg}</div>
      )}

      {/* --- 列設定 --- */}
      {columnsPanelOpen && (
        <div className="bg-base-800/80 border border-base-500 rounded p-3 mb-4 text-xs space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-gray-300 font-bold">表示する列</span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={showDefaultCols}
                className="px-2 py-0.5 bg-base-700 hover:bg-base-600 border border-base-500 rounded"
              >
                デフォルト
              </button>
              <button
                type="button"
                onClick={showAllCols}
                className="px-2 py-0.5 bg-base-700 hover:bg-base-600 border border-base-500 rounded"
              >
                全部表示
              </button>
            </div>
          </div>
          <div className="grid grid-cols-4 gap-3">
            {COLUMN_GROUPS.map((g) => (
              <div key={g.group}>
                <div className="text-gray-400 mb-1">{g.group}</div>
                <div className="space-y-0.5">
                  {g.cols.map((c) => (
                    <label
                      key={c.id}
                      className="flex items-center gap-1 text-gray-300 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={isCol(c.id)}
                        onChange={() => toggleCol(c.id)}
                        className="accent-accent"
                      />
                      {c.label}
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* --- 詳細条件 --- */}
      {advancedOpen && (
        <div className="bg-base-800/80 border border-base-500 rounded p-3 mb-4 space-y-3 text-xs">
          {/* プリセット行 */}
          <div className="flex items-center gap-2 flex-wrap pb-2 border-b border-base-600">
            <span className="text-gray-400">プリセット:</span>
            {presets.length === 0 ? (
              <span className="text-gray-600">未保存</span>
            ) : (
              presets.map((p) => (
                <span
                  key={p.name}
                  className="inline-flex items-center bg-base-700 border border-base-500 rounded overflow-hidden"
                >
                  <button
                    type="button"
                    onClick={() => loadPreset(p.name)}
                    className="px-2 py-0.5 hover:bg-base-600 text-gray-200"
                  >
                    {p.name}
                  </button>
                  <button
                    type="button"
                    onClick={() => deletePreset(p.name)}
                    className="px-1.5 py-0.5 hover:bg-red-700 text-gray-500 text-[10px]"
                    title="削除"
                  >
                    ×
                  </button>
                </span>
              ))
            )}
            <button
              type="button"
              onClick={savePreset}
              className="ml-auto px-2 py-1 bg-accent hover:bg-accent-dark text-black font-bold rounded"
            >
              現在の条件を保存
            </button>
          </div>

          <div className="grid grid-cols-4 gap-3">
          <NumberField
            label="最小利益率 (%)"
            value={minProfitRate}
            onChange={setMinProfitRate}
            placeholder="例: 15"
          />
          <NumberField
            label="最小利益額 (¥)"
            value={minProfit}
            onChange={setMinProfit}
            placeholder="例: 500"
          />
          <NumberField
            label="最小月間予測利益 (¥)"
            value={minMonthlyProfit}
            onChange={setMinMonthlyProfit}
            placeholder="例: 5000"
          />
          <NumberField
            label="最小月間販売数"
            value={minMonthly}
            onChange={setMinMonthly}
            placeholder="例: 10"
          />
          <NumberField
            label="最小30日販売数"
            value={minSales30}
            onChange={setMinSales30}
            placeholder="例: 5"
          />
          <NumberField
            label="最大ランキング (位以内)"
            value={maxRank}
            onChange={setMaxRank}
            placeholder="例: 30000"
          />
          <NumberField
            label="現在価格 ≥ (¥)"
            value={priceMin}
            onChange={setPriceMin}
            placeholder="例: 1000"
          />
          <NumberField
            label="現在価格 ≤ (¥)"
            value={priceMax}
            onChange={setPriceMax}
            placeholder="例: 30000"
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
          <label className="flex items-center gap-2 text-gray-300 mt-5">
            <input
              type="checkbox"
              checked={excludeEbooks}
              onChange={(e) => {
                setExcludeEbooks(e.target.checked);
                if (e.target.checked) setEbooksOnly(false);
              }}
              className="accent-accent"
            />
            電子書籍を除外
          </label>
          <label className="flex items-center gap-2 text-gray-300 mt-5">
            <input
              type="checkbox"
              checked={ebooksOnly}
              onChange={(e) => {
                setEbooksOnly(e.target.checked);
                if (e.target.checked) setExcludeEbooks(false);
              }}
              className="accent-accent"
            />
            電子書籍のみ
          </label>
          </div>
        </div>
      )}

      {/* --- テーブル --- */}
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="text-xs text-gray-300 bg-base-800/70 sticky top-0">
            <tr className="border-b border-base-600 text-[10px] uppercase tracking-wide text-gray-500">
              <th className="px-3 py-1" colSpan={1}>判定</th>
              <th className="px-3 py-1 text-left" colSpan={2 + groupColspan("商品情報")}>商品情報</th>
              {groupColspan("価格") > 0 && (
                <th className="px-3 py-1 text-right" colSpan={groupColspan("価格")}>価格</th>
              )}
              {groupColspan("価格履歴") > 0 && (
                <th className="px-3 py-1 text-right" colSpan={groupColspan("価格履歴")}>価格履歴</th>
              )}
              {groupColspan("仕入れ候補") > 0 && (
                <th className="px-3 py-1 text-right" colSpan={groupColspan("仕入れ候補")}>仕入れ候補</th>
              )}
              <th className="px-3 py-1 text-right" colSpan={1}>仕入</th>
              <th className="px-3 py-1 text-right" colSpan={1 + groupColspan("利益")}>利益</th>
              {groupColspan("販売実績") > 0 && (
                <th className="px-3 py-1 text-right" colSpan={groupColspan("販売実績")}>販売実績</th>
              )}
              {groupColspan("競合") > 0 && (
                <th className="px-3 py-1 text-right" colSpan={groupColspan("競合")}>競合</th>
              )}
              <th className="px-3 py-1 text-center" colSpan={1 + groupColspan("リンク")}>リンク</th>
            </tr>
            <tr>
              <Th onClick={() => handleSort("score")} label={`スコア${sortArrow("score")}`} />
              {isCol("image") && <th className="px-2 py-2 text-left">画像</th>}
              <Th onClick={() => handleSort("title")} label={`商品名${sortArrow("title")}`} />
              <th className="px-3 py-2 text-left">ASIN / サイズ</th>
              {isCol("current_price") && (
                <Th
                  onClick={() => handleSort("current_price")}
                  label={`現在価格${sortArrow("current_price")}`}
                  align="right"
                />
              )}
              {isCol("lowest_new_price") && (
                <Th
                  onClick={() => handleSort("lowest_new_price")}
                  label={`新品最安${sortArrow("lowest_new_price")}`}
                  align="right"
                />
              )}
              {isCol("used_price") && (
                <Th
                  onClick={() => handleSort("used_price")}
                  label={`中古最安${sortArrow("used_price")}`}
                  align="right"
                />
              )}
              {isCol("price_max_all") && (
                <Th
                  onClick={() => handleSort("price_max_all")}
                  label={`過去最高${sortArrow("price_max_all")}`}
                  align="right"
                />
              )}
              {isCol("price_min_all") && (
                <Th
                  onClick={() => handleSort("price_min_all")}
                  label={`過去最低${sortArrow("price_min_all")}`}
                  align="right"
                />
              )}
              {isCol("price_avg_30d") && (
                <Th
                  onClick={() => handleSort("price_avg_30d")}
                  label={`30日平均${sortArrow("price_avg_30d")}`}
                  align="right"
                />
              )}
              {isCol("change_rate") && (
                <th className="px-3 py-2 text-right">変動率</th>
              )}
              {isCol("premium_rate") && (
                <Th
                  onClick={() => handleSort("premium_rate")}
                  label={`プレ値率${sortArrow("premium_rate")}`}
                  align="right"
                />
              )}
              {isCol("rakuten") && (
                <Th
                  onClick={() => handleSort("rakuten_price")}
                  label={`楽天${sortArrow("rakuten_price")}`}
                  align="right"
                />
              )}
              {isCol("yahoo") && (
                <Th
                  onClick={() => handleSort("yahoo_price")}
                  label={`Yahoo${sortArrow("yahoo_price")}`}
                  align="right"
                />
              )}
              {isCol("bic") && (
                <Th
                  onClick={() => handleSort("bic_price")}
                  label={`ビック${sortArrow("bic_price")}`}
                  align="right"
                />
              )}
              {isCol("yodobashi") && (
                <Th
                  onClick={() => handleSort("yodobashi_price")}
                  label={`ヨドバシ${sortArrow("yodobashi_price")}`}
                  align="right"
                />
              )}
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
              {isCol("profit_rate") && (
                <Th
                  onClick={() => handleSort("profit_rate")}
                  label={`利益率${sortArrow("profit_rate")}`}
                  align="right"
                />
              )}
              {isCol("monthly_profit") && (
                <Th
                  onClick={() => handleSort("monthly_profit")}
                  label={`月予測利益${sortArrow("monthly_profit")}`}
                  align="right"
                />
              )}
              {isCol("rank_current") && (
                <Th
                  onClick={() => handleSort("rank_current")}
                  label={`ランク${sortArrow("rank_current")}`}
                  align="right"
                />
              )}
              {isCol("monthly_sales") && (
                <Th
                  onClick={() => handleSort("monthly_sales")}
                  label={`月販売${sortArrow("monthly_sales")}`}
                  align="right"
                />
              )}
              {isCol("sales_30d") && (
                <Th
                  onClick={() => handleSort("sales_30d")}
                  label={`30日${sortArrow("sales_30d")}`}
                  align="right"
                />
              )}
              {isCol("sales_90d") && (
                <Th
                  onClick={() => handleSort("sales_90d")}
                  label={`90日${sortArrow("sales_90d")}`}
                  align="right"
                />
              )}
              {isCol("new_offer_count") && (
                <Th
                  onClick={() => handleSort("new_offer_count")}
                  label={`新品出品${sortArrow("new_offer_count")}`}
                  align="right"
                />
              )}
              {isCol("fba_offer_count") && (
                <Th
                  onClick={() => handleSort("fba_offer_count")}
                  label={`FBA${sortArrow("fba_offer_count")}`}
                  align="right"
                />
              )}
              <th className="px-3 py-2 text-center">Amazon</th>
              {isCol("keepa_graph") && (
                <th className="px-3 py-2 text-center">Keepa</th>
              )}
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 && (
              <tr>
                <td
                  colSpan={6 + visibleCols.size}
                  className="text-center py-10 text-gray-500"
                >
                  データがありません
                </td>
              </tr>
            )}
            {pageRows.map((item) => (
              <tr
                key={`${item.input_code}-${item.asin ?? "x"}`}
                className="border-t border-base-600 hover:bg-base-700/40"
              >
                <td className="px-3 py-2">
                  <div className="flex flex-col items-center gap-1">
                    <ScoreBadge grade={item.score} />
                    <button
                      type="button"
                      onClick={() => handleToggleFavorite(item.asin)}
                      disabled={!item.asin}
                      title={
                        item.asin && favorites.has(item.asin)
                          ? "お気に入りから外す"
                          : "お気に入りに追加"
                      }
                      className={`text-base leading-none ${
                        item.asin && favorites.has(item.asin)
                          ? "text-yellow-400"
                          : "text-gray-600 hover:text-yellow-300"
                      }`}
                    >
                      {item.asin && favorites.has(item.asin) ? "★" : "☆"}
                    </button>
                  </div>
                </td>
                {isCol("image") && (
                  <td className="px-2 py-2">
                    {item.image_url ? (
                      <a
                        href={item.amazon_url ?? "#"}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <img
                          src={item.image_url}
                          alt=""
                          loading="lazy"
                          referrerPolicy="no-referrer"
                          onError={(e) => {
                            const img = e.currentTarget;
                            console.warn("image load failed:", img.src);
                            img.style.display = "none";
                            const sib = img.nextElementSibling as HTMLElement | null;
                            if (sib) sib.style.display = "block";
                          }}
                          className="w-12 h-12 object-contain border border-base-600 rounded bg-white/5"
                        />
                        <div
                          className="w-12 h-12 border border-red-500/50 rounded bg-red-500/10 text-[9px] text-red-300 flex items-center justify-center"
                          style={{ display: "none" }}
                          title={item.image_url ?? ""}
                        >
                          画像エラー
                        </div>
                      </a>
                    ) : (
                      <div className="w-12 h-12 border border-base-700 rounded bg-base-800 text-[9px] text-gray-600 flex items-center justify-center">
                        画像なし
                      </div>
                    )}
                  </td>
                )}
                <td className="px-3 py-2 max-w-[260px]">
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
                  {item.is_ebook && (
                    <span className="inline-block text-[9px] px-1 mt-0.5 rounded bg-cyan-500/30 text-cyan-200">
                      電子書籍
                    </span>
                  )}
                  {item.list_price != null && (
                    <div className="text-[10px] text-gray-500">
                      定価: {yen(item.list_price)}
                    </div>
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
                  {item.size_category && (
                    <div className="text-[10px] mt-0.5">
                      <span className="px-1.5 py-0.5 rounded bg-base-600 text-gray-200">
                        {item.size_category}
                      </span>
                    </div>
                  )}
                  {item.release_date && (
                    <div className="text-[10px] text-gray-500 mt-0.5">
                      発売: {item.release_date}
                    </div>
                  )}
                </td>
                {isCol("current_price") && (
                  <td className="px-3 py-2 text-right text-gray-200">
                    {yen(item.current_price)}
                    {item.buy_box_is_amazon ? (
                      <div className="text-[10px] text-amber-400">Amazon直売</div>
                    ) : item.amazon_price != null ? (
                      <div className="text-[10px] text-gray-500">
                        Amazon: {yen(item.amazon_price)}
                      </div>
                    ) : null}
                  </td>
                )}
                {isCol("lowest_new_price") && (
                  <td className="px-3 py-2 text-right text-gray-200">
                    {yen(item.lowest_new_price)}
                    {item.fba_price != null && (
                      <div className="text-[10px] text-gray-500">
                        FBA: {yen(item.fba_price)}
                      </div>
                    )}
                  </td>
                )}
                {isCol("used_price") && (
                  <td className="px-3 py-2 text-right text-gray-200">
                    {yen(item.used_price)}
                  </td>
                )}
                {isCol("price_max_all") && (
                  <td className="px-3 py-2 text-right text-gray-300">
                    {yen(item.price_max_all)}
                  </td>
                )}
                {isCol("price_min_all") && (
                  <td className="px-3 py-2 text-right text-gray-300">
                    {yen(item.price_min_all)}
                  </td>
                )}
                {isCol("price_avg_30d") && (
                  <td className="px-3 py-2 text-right text-gray-200">
                    {yen(item.price_avg_30d)}
                    {item.price_avg_90d != null && (
                      <div className="text-[10px] text-gray-500">
                        90日: {yen(item.price_avg_90d)}
                      </div>
                    )}
                  </td>
                )}
                {isCol("change_rate") && (
                  <td className="px-3 py-2 text-right">
                    <ChangeRate value={item.price_change_30d} suffix="30d" />
                    <ChangeRate value={item.price_change_90d} suffix="90d" />
                  </td>
                )}
                {isCol("premium_rate") && (
                  <td className="px-3 py-2 text-right">
                    <PremiumRateCell rate={premiumRate(item)} listPrice={item.list_price} />
                  </td>
                )}
                {isCol("rakuten") && (
                  <td className="px-3 py-2 text-right">
                    <OffersCell
                      offers={item.rakuten_offers}
                      cheapest={item.cheapest_source === "rakuten"}
                      color="text-red-400"
                      onSelect={(price) =>
                        onPurchasePriceChange(
                          item.asin ?? item.input_code,
                          item.input_code,
                          price
                        )
                      }
                    />
                  </td>
                )}
                {isCol("yahoo") && (
                  <td className="px-3 py-2 text-right">
                    <OffersCell
                      offers={item.yahoo_offers}
                      cheapest={item.cheapest_source === "yahoo"}
                      color="text-purple-400"
                      onSelect={(price) =>
                        onPurchasePriceChange(
                          item.asin ?? item.input_code,
                          item.input_code,
                          price
                        )
                      }
                    />
                  </td>
                )}
                {isCol("bic") && (
                  <td className="px-3 py-2 text-right">
                    <SourceCell
                      price={item.bic_price}
                      url={item.bic_url}
                      shop={item.bic_shop}
                      cheapest={item.cheapest_source === "bic"}
                      color="text-orange-400"
                      badge={
                        item.bic_source === "biccamera"
                          ? "本店"
                          : item.bic_source === "rakuten"
                          ? "楽天店"
                          : item.bic_source === "yahoo"
                          ? "Yahoo店"
                          : null
                      }
                    />
                  </td>
                )}
                {isCol("yodobashi") && (
                  <td className="px-3 py-2 text-right">
                    <SourceCell
                      price={item.yodobashi_price}
                      url={item.yodobashi_url}
                      shop={item.yodobashi_shop}
                      cheapest={item.cheapest_source === "yodobashi"}
                      color="text-yellow-300"
                    />
                  </td>
                )}
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
                {isCol("profit_rate") && (
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
                )}
                {isCol("monthly_profit") && (
                  <td
                    className={`px-3 py-2 text-right ${
                      item.monthly_profit == null
                        ? "text-gray-500"
                        : item.monthly_profit < 0
                        ? "text-red-400"
                        : "text-emerald-300"
                    }`}
                  >
                    {item.monthly_profit == null ? "-" : yen(item.monthly_profit)}
                    <div className="text-[10px] text-gray-500">/月</div>
                  </td>
                )}
                {isCol("rank_current") && (
                  <td className="px-3 py-2 text-right text-gray-200">
                    {num(item.rank_current)}
                    {item.rank_avg90 != null && (
                      <div className="text-[10px] text-gray-500">
                        90日平: {num(item.rank_avg90)}
                      </div>
                    )}
                  </td>
                )}
                {isCol("monthly_sales") && (
                  <td className="px-3 py-2 text-right text-gray-200">
                    {num(item.monthly_sales)}
                  </td>
                )}
                {isCol("sales_30d") && (
                  <td className="px-3 py-2 text-right text-gray-400">
                    {num(item.sales_30d)}
                  </td>
                )}
                {isCol("sales_90d") && (
                  <td className="px-3 py-2 text-right text-gray-400">
                    {num(item.sales_90d)}
                  </td>
                )}
                {isCol("new_offer_count") && (
                  <td className="px-3 py-2 text-right text-gray-200">
                    {num(item.new_offer_count)}
                    <div className="text-[10px] text-gray-500">
                      中古 {num(item.used_offer_count)}
                    </div>
                  </td>
                )}
                {isCol("fba_offer_count") && (
                  <td className="px-3 py-2 text-right text-gray-200">
                    {num(item.fba_offer_count)}
                    <div className="text-[10px] text-gray-500">
                      自己 {num(item.fbm_offer_count)}
                    </div>
                  </td>
                )}
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
                {isCol("keepa_graph") && (
                  <td className="px-3 py-2 text-center">
                    {item.asin ? (
                      <KeepaGraphCell
                        graphUrl={`https://graph.keepa.com/pricehistory.png?asin=${item.asin}&domain=5&amazon=1&new=1&used=1&salesrank=1&bb=1&width=600&height=200`}
                        keepaUrl={
                          item.keepa_url ??
                          `https://keepa.com/#!product/5-${item.asin}`
                        }
                      />
                    ) : (
                      "-"
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* --- ページング --- */}
      {filteredCount > 0 && (
        <div className="flex items-center justify-between mt-3 text-sm text-gray-300">
          <div>
            {pageStart + 1}〜{Math.min(pageStart + pageSize, filteredCount)} 件目 /{" "}
            {filteredCount} 件中
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setPage(1)}
              disabled={safePage <= 1}
              className="px-2 py-1 bg-base-700 hover:bg-base-600 disabled:opacity-40 border border-base-500 rounded text-xs"
            >
              «
            </button>
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={safePage <= 1}
              className="px-2 py-1 bg-base-700 hover:bg-base-600 disabled:opacity-40 border border-base-500 rounded text-xs"
            >
              ‹
            </button>
            <span className="px-3 text-gray-400">
              {safePage} / {totalPages}
            </span>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={safePage >= totalPages}
              className="px-2 py-1 bg-base-700 hover:bg-base-600 disabled:opacity-40 border border-base-500 rounded text-xs"
            >
              ›
            </button>
            <button
              type="button"
              onClick={() => setPage(totalPages)}
              disabled={safePage >= totalPages}
              className="px-2 py-1 bg-base-700 hover:bg-base-600 disabled:opacity-40 border border-base-500 rounded text-xs"
            >
              »
            </button>
          </div>
        </div>
      )}
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
  badge,
}: {
  price: number | null;
  url: string | null;
  shop: string | null;
  cheapest: boolean;
  color: string;
  badge?: string | null;
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
      {badge && (
        <div className="text-[10px] text-gray-400">{badge}</div>
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

function OffersCell({
  offers,
  cheapest,
  color,
  onSelect,
}: {
  offers: OfferItem[];
  cheapest: boolean;
  color: string;
  onSelect: (price: number) => void;
}) {
  const [open, setOpen] = useState(false);
  if (!offers || offers.length === 0) {
    return <span className="text-gray-600 text-xs">-</span>;
  }
  const top = offers[0];
  const others = offers.slice(1);
  return (
    <div className="text-right">
      <div className="flex items-center justify-end gap-1">
        {top.url ? (
          <a
            href={top.url}
            target="_blank"
            rel="noreferrer"
            className={`hover:underline font-bold ${color}`}
          >
            ¥{top.price.toLocaleString()}
          </a>
        ) : (
          <span className={color}>¥{top.price.toLocaleString()}</span>
        )}
        <ConditionBadge condition={top.condition} />
      </div>
      {cheapest && <div className="text-[10px] text-accent">最安★</div>}
      {top.shop && (
        <div
          className="text-[10px] text-gray-500 truncate max-w-[140px]"
          title={top.shop}
        >
          {top.shop}
        </div>
      )}
      {others.length > 0 && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="text-[10px] text-gray-400 hover:text-accent mt-0.5"
        >
          {open ? "▲ 閉じる" : `▼ 他 ${others.length} 店`}
        </button>
      )}
      {open && (
        <div className="mt-1 border border-base-500 rounded bg-base-900/95 p-1 space-y-1 text-left">
          {others.map((o, i) => (
            <div
              key={`${o.shop}-${i}`}
              className="flex items-center gap-1 text-[11px]"
            >
              <button
                type="button"
                onClick={() => onSelect(o.price)}
                className="px-1.5 py-0.5 bg-base-700 hover:bg-accent hover:text-black border border-base-500 rounded text-[10px]"
                title="この価格を仕入れ価格にセット"
              >
                選択
              </button>
              {o.url ? (
                <a
                  href={o.url}
                  target="_blank"
                  rel="noreferrer"
                  className={`hover:underline font-bold ${color}`}
                >
                  ¥{o.price.toLocaleString()}
                </a>
              ) : (
                <span className={color}>¥{o.price.toLocaleString()}</span>
              )}
              <ConditionBadge condition={o.condition} />
              {o.shop && (
                <span
                  className="text-gray-500 truncate max-w-[120px]"
                  title={o.shop}
                >
                  {o.shop}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PremiumRateCell({
  rate,
  listPrice,
}: {
  rate: number | null;
  listPrice: number | null;
}) {
  if (rate == null) {
    return (
      <div className="text-[11px] text-gray-600" title="定価未取得">
        定価不明
      </div>
    );
  }
  const isPremium = rate > 0;
  const cls = isPremium
    ? rate >= 50
      ? "text-pink-300 font-bold"
      : "text-pink-400"
    : "text-gray-400";
  return (
    <div className="text-right">
      <div className={`text-sm ${cls}`}>
        {isPremium ? "+" : ""}
        {rate.toFixed(1)}%
      </div>
      {listPrice != null && (
        <div className="text-[10px] text-gray-500">定価 ¥{listPrice.toLocaleString()}</div>
      )}
    </div>
  );
}

function ChangeRate({
  value,
  suffix,
}: {
  value: number | null;
  suffix: string;
}) {
  if (value == null) {
    return <div className="text-[11px] text-gray-600">-</div>;
  }
  const positive = value > 0;
  const negative = value < 0;
  const cls = positive
    ? "text-red-400"
    : negative
    ? "text-emerald-400"
    : "text-gray-300";
  const sign = positive ? "+" : "";
  return (
    <div className={`text-[11px] ${cls}`}>
      {sign}
      {value.toFixed(1)}%{" "}
      <span className="text-[9px] text-gray-500">{suffix}</span>
    </div>
  );
}

function ConditionBadge({ condition }: { condition: string | null }) {
  if (!condition) return null;
  const isUsed = condition === "used";
  return (
    <span
      className={`text-[9px] px-1 rounded ${
        isUsed
          ? "bg-amber-500/30 text-amber-200"
          : "bg-emerald-500/30 text-emerald-200"
      }`}
    >
      {isUsed ? "中古" : "新品"}
    </span>
  );
}

function KeepaGraphCell({
  graphUrl,
  keepaUrl,
}: {
  graphUrl: string;
  keepaUrl: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState(false);
  if (error) {
    return (
      <div
        className="text-[9px] text-red-300 px-2 py-1 border border-red-500/40 rounded"
        title="グラフ取得失敗 (Keepa キー未設定 / バックエンド未再起動の可能性)"
      >
        グラフエラー
        {keepaUrl && (
          <a
            href={keepaUrl}
            target="_blank"
            rel="noreferrer"
            className="block text-accent text-[9px] mt-0.5"
          >
            Keepa で開く
          </a>
        )}
      </div>
    );
  }
  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="block"
        title="クリックで価格履歴グラフを表示"
      >
        <img
          src={graphUrl}
          alt="Keepa price graph"
          loading="lazy"
          onError={(e) => {
            console.warn("Keepa graph load failed:", e.currentTarget.src);
            setError(true);
          }}
          className="w-24 h-auto border border-base-500 rounded hover:border-accent"
        />
      </button>
      {open && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-6"
             onClick={() => setOpen(false)}>
          <div
            className="bg-base-800 border border-base-500 rounded-lg p-4 max-w-[800px]"
            onClick={(e) => e.stopPropagation()}
          >
            <img src={graphUrl} alt="Keepa price graph" className="w-full" />
            <div className="text-right mt-3">
              {keepaUrl && (
                <a
                  href={keepaUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-accent hover:underline text-sm mr-3"
                >
                  Keepa で開く ↗
                </a>
              )}
              <button
                onClick={() => setOpen(false)}
                className="px-3 py-1 bg-base-600 hover:bg-base-500 rounded text-sm"
              >
                閉じる
              </button>
            </div>
          </div>
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
