import { useMemo, useState } from "react";
import type { ProductItem, ScoreGrade } from "../types";
import { ScoreBadge } from "./ScoreBadge";

type SortKey =
  | "score"
  | "title"
  | "amazon_price"
  | "lowest_new_price"
  | "purchase_price"
  | "profit"
  | "profit_rate"
  | "rank_current"
  | "monthly_sales"
  | "new_offer_count";

type SortDir = "asc" | "desc";

const SCORE_ORDER: Record<string, number> = { S: 0, A: 1, B: 2, C: 3, D: 4, "-": 5 };

const ALL_GRADES: (ScoreGrade | "-")[] = ["S", "A", "B", "C", "D", "-"];

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
    case "new_offer_count":
      return item.new_offer_count ?? Number.MAX_SAFE_INTEGER;
    default:
      return 0;
  }
}

export function ResultTable({ items, onPurchasePriceChange, onExport }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("score");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [gradeFilter, setGradeFilter] = useState<Set<string>>(new Set());
  const [keyword, setKeyword] = useState("");

  const visible = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    let rows = items.filter((item) => {
      if (gradeFilter.size > 0 && !gradeFilter.has(item.score)) return false;
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
      const as = String(av);
      const bs = String(bv);
      return sortDir === "asc" ? as.localeCompare(bs) : bs.localeCompare(as);
    });
    return rows;
  }, [items, gradeFilter, keyword, sortKey, sortDir]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "profit" || key === "profit_rate" ? "desc" : "asc");
    }
  };

  const sortArrow = (key: SortKey) =>
    sortKey === key ? (sortDir === "asc" ? " ▲" : " ▼") : "";

  const toggleGrade = (g: string) => {
    setGradeFilter((prev) => {
      const next = new Set(prev);
      if (next.has(g)) next.delete(g);
      else next.add(g);
      return next;
    });
  };

  const copyAsin = async (asin: string | null) => {
    if (!asin) return;
    try {
      await navigator.clipboard.writeText(asin);
    } catch {
      // noop
    }
  };

  return (
    <div className="bg-base-700/60 border border-base-500 rounded-lg p-4">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm text-gray-400">フィルタ:</span>
          {ALL_GRADES.map((g) => {
            const active = gradeFilter.has(g);
            return (
              <button
                key={g}
                type="button"
                onClick={() => toggleGrade(g)}
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
            placeholder="キーワード検索 (商品名/ASIN/ブランド)"
            className="ml-2 bg-base-900 border border-base-500 focus:border-accent rounded px-3 py-1 text-sm text-gray-100 outline-none w-64"
          />
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

      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="text-xs text-gray-300 bg-base-800/70 sticky top-0">
            <tr>
              <Th onClick={() => handleSort("score")} label={`スコア${sortArrow("score")}`} />
              <Th onClick={() => handleSort("title")} label={`商品名${sortArrow("title")}`} />
              <th className="px-3 py-2 text-left">ASIN</th>
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
                onClick={() => handleSort("purchase_price")}
                label={`仕入れ価格${sortArrow("purchase_price")}`}
                align="right"
              />
              <Th
                onClick={() => handleSort("profit")}
                label={`利益額${sortArrow("profit")}`}
                align="right"
              />
              <Th
                onClick={() => handleSort("profit_rate")}
                label={`利益率${sortArrow("profit_rate")}`}
                align="right"
              />
              <Th
                onClick={() => handleSort("rank_current")}
                label={`ランキング${sortArrow("rank_current")}`}
                align="right"
              />
              <Th
                onClick={() => handleSort("monthly_sales")}
                label={`月間販売数${sortArrow("monthly_sales")}`}
                align="right"
              />
              <Th
                onClick={() => handleSort("new_offer_count")}
                label={`出品者${sortArrow("new_offer_count")}`}
                align="right"
              />
              <th className="px-3 py-2 text-center">Amazon</th>
              <th className="px-3 py-2 text-center">Keepa</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr>
                <td colSpan={13} className="text-center py-10 text-gray-500">
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
                <td className="px-3 py-2 max-w-[320px]">
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
                <td className="px-3 py-2 text-right text-gray-200">
                  {yen(item.amazon_price)}
                </td>
                <td className="px-3 py-2 text-right text-gray-200">
                  {yen(item.lowest_new_price)}
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
                    <div className="text-xs text-gray-500">
                      90日平均: {num(item.rank_avg90)}
                    </div>
                  )}
                </td>
                <td className="px-3 py-2 text-right text-gray-200">
                  {num(item.monthly_sales)}
                </td>
                <td className="px-3 py-2 text-right text-gray-200">
                  {num(item.new_offer_count)} /{" "}
                  <span className="text-gray-500">{num(item.used_offer_count)}</span>
                  {item.buy_box_is_amazon && (
                    <div className="text-xs text-amber-400">Amazon直売</div>
                  )}
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
