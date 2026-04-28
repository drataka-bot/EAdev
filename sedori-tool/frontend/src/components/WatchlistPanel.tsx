import { useCallback, useEffect, useState } from "react";
import type { WatchAlert, WatchItem, WatchlistResponse } from "../types";

interface Props {
  webhookUrl: string;
  keepaApiKey: string;
}

function formatTime(ts: number | null): string {
  if (!ts) return "-";
  const d = new Date(ts * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function WatchlistPanel({ webhookUrl, keepaApiKey }: Props) {
  const [items, setItems] = useState<WatchItem[]>([]);
  const [alerts, setAlerts] = useState<WatchAlert[]>([]);
  const [intervalSec, setIntervalSec] = useState<number>(900);
  const [webhookOk, setWebhookOk] = useState(false);
  const [keepaOk, setKeepaOk] = useState(false);

  const [asin, setAsin] = useState("");
  const [note, setNote] = useState("");
  const [restockOn, setRestockOn] = useState(true);
  const [priceBelow, setPriceBelow] = useState("");
  const [rankBelow, setRankBelow] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const [w, a] = await Promise.all([
      fetch("/api/watchlist").then((r) => r.json() as Promise<WatchlistResponse>),
      fetch("/api/watchlist/alerts?limit=30").then((r) => r.json()),
    ]);
    setItems(w.items);
    setIntervalSec(w.interval_sec);
    setWebhookOk(w.webhook_configured);
    setKeepaOk(w.monitor_keepa_configured);
    setAlerts(a.alerts || []);
  }, []);

  // バックエンドへ Discord webhook URL / Keepa key を送る (UI 設定→監視ジョブへ)
  const pushConfig = useCallback(async () => {
    await fetch("/api/watchlist/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        discord_webhook_url: webhookUrl || null,
        keepa_api_key: keepaApiKey || null,
      }),
    });
  }, [webhookUrl, keepaApiKey]);

  useEffect(() => {
    pushConfig().then(reload);
  }, [pushConfig, reload]);

  const handleAdd = async () => {
    setMsg(null);
    const a = asin.trim().toUpperCase();
    if (!/^[A-Z0-9]{10}$/.test(a)) {
      setMsg("ASIN は 10 桁の英数字で指定してください");
      return;
    }
    setBusy(true);
    try {
      const resp = await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          asin: a,
          note: note.trim() || null,
          trigger_restock: restockOn,
          trigger_price_below: priceBelow ? Number(priceBelow) : null,
          trigger_rank_below: rankBelow ? Number(rankBelow) : null,
          enabled: true,
        }),
      });
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        throw new Error(body.detail || `HTTP ${resp.status}`);
      }
      setAsin("");
      setNote("");
      setPriceBelow("");
      setRankBelow("");
      await reload();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (a: string) => {
    if (!confirm(`${a} を削除しますか?`)) return;
    await fetch(`/api/watchlist/${a}`, { method: "DELETE" });
    await reload();
  };

  const handleCheckNow = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await pushConfig();
      const resp = await fetch("/api/watchlist/check", { method: "POST" });
      const body = await resp.json();
      if (!resp.ok) throw new Error(body.detail || `HTTP ${resp.status}`);
      setMsg(`チェック完了: ${body.fired} 件発火`);
      await reload();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* 状態 */}
      <div className="bg-base-700/60 border border-base-500 rounded-lg p-4">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="text-gray-400">監視間隔:</span>
          <span className="text-accent font-bold">
            {Math.round(intervalSec / 60)} 分
          </span>
          <Pill on={keepaOk} label={keepaOk ? "Keepa 設定済" : "Keepa キー未設定"} />
          <Pill
            on={webhookOk}
            label={webhookOk ? "Discord 設定済" : "Webhook URL 未設定"}
          />
          <span className="ml-auto text-gray-400">
            登録 <span className="text-accent font-bold">{items.length}</span> 件
          </span>
          <button
            onClick={handleCheckNow}
            disabled={busy || !keepaOk}
            className="px-3 py-1 bg-accent hover:bg-accent-dark disabled:opacity-50 text-black font-bold rounded text-sm"
          >
            今すぐチェック
          </button>
        </div>
        {!keepaOk && (
          <p className="text-xs text-amber-300 mt-2">
            ⚠️ 設定画面で Keepa API キーを保存し、このページを再表示してください。
          </p>
        )}
        {!webhookOk && (
          <p className="text-xs text-amber-300 mt-1">
            ⚠️ 設定画面で Discord Webhook URL を保存すると通知が届きます。
          </p>
        )}
      </div>

      {/* 登録フォーム */}
      <div className="bg-base-700/60 border border-base-500 rounded-lg p-4 space-y-3">
        <h3 className="text-lg font-bold">
          <span className="text-accent">▌</span> ASIN を監視に登録
        </h3>
        <div className="grid grid-cols-12 gap-3">
          <input
            type="text"
            value={asin}
            onChange={(e) => setAsin(e.target.value)}
            placeholder="ASIN (例: B0XXXXXXXX)"
            className="col-span-3 bg-base-900 border border-base-500 focus:border-accent rounded px-3 py-2 text-sm font-mono text-gray-100 outline-none"
          />
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="メモ (任意)"
            className="col-span-3 bg-base-900 border border-base-500 focus:border-accent rounded px-3 py-2 text-sm text-gray-100 outline-none"
          />
          <input
            type="number"
            value={priceBelow}
            onChange={(e) => setPriceBelow(e.target.value)}
            placeholder="価格 ¥ 以下で通知"
            className="col-span-2 bg-base-900 border border-base-500 focus:border-accent rounded px-3 py-2 text-sm text-gray-100 outline-none"
          />
          <input
            type="number"
            value={rankBelow}
            onChange={(e) => setRankBelow(e.target.value)}
            placeholder="ランク 以内で通知"
            className="col-span-2 bg-base-900 border border-base-500 focus:border-accent rounded px-3 py-2 text-sm text-gray-100 outline-none"
          />
          <label className="col-span-1 flex items-center gap-1 text-xs text-gray-300">
            <input
              type="checkbox"
              checked={restockOn}
              onChange={(e) => setRestockOn(e.target.checked)}
              className="accent-accent"
            />
            復活
          </label>
          <button
            onClick={handleAdd}
            disabled={busy}
            className="col-span-1 bg-accent hover:bg-accent-dark disabled:opacity-50 text-black font-bold rounded text-sm"
          >
            登録
          </button>
        </div>
        {msg && <p className="text-xs text-amber-300">{msg}</p>}
      </div>

      {/* リスト */}
      <div className="bg-base-700/60 border border-base-500 rounded-lg p-4">
        <h3 className="text-lg font-bold mb-3">
          <span className="text-accent">▌</span> ウォッチリスト
        </h3>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-xs text-gray-300 bg-base-800/70">
              <tr>
                <th className="px-3 py-2 text-left">ASIN</th>
                <th className="px-3 py-2 text-left">商品名 / メモ</th>
                <th className="px-3 py-2 text-center">条件</th>
                <th className="px-3 py-2 text-right">最終チェック</th>
                <th className="px-3 py-2 text-right">在庫</th>
                <th className="px-3 py-2 text-right">価格</th>
                <th className="px-3 py-2 text-right">ランク</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 && (
                <tr>
                  <td colSpan={8} className="text-center py-8 text-gray-500">
                    まだ登録されていません
                  </td>
                </tr>
              )}
              {items.map((it) => (
                <tr key={it.asin} className="border-t border-base-600">
                  <td className="px-3 py-2 font-mono text-xs">
                    <a
                      href={`https://www.amazon.co.jp/dp/${it.asin}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-accent hover:underline"
                    >
                      {it.asin}
                    </a>
                  </td>
                  <td className="px-3 py-2 max-w-[280px]">
                    <div className="truncate" title={it.title ?? ""}>
                      {it.title ?? "(未取得)"}
                    </div>
                    {it.note && (
                      <div className="text-xs text-gray-500 truncate">{it.note}</div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-center text-xs">
                    <div className="flex flex-wrap gap-1 justify-center">
                      {it.trigger_restock ? (
                        <span className="px-1.5 py-0.5 bg-accent/20 text-accent rounded">
                          復活
                        </span>
                      ) : null}
                      {it.trigger_price_below ? (
                        <span className="px-1.5 py-0.5 bg-green-500/20 text-green-400 rounded">
                          ¥≤{it.trigger_price_below.toLocaleString()}
                        </span>
                      ) : null}
                      {it.trigger_rank_below ? (
                        <span className="px-1.5 py-0.5 bg-amber-500/20 text-amber-300 rounded">
                          順位≤{it.trigger_rank_below.toLocaleString()}
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right text-xs text-gray-400">
                    {formatTime(it.last_checked_at)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {it.last_in_stock == null ? (
                      "-"
                    ) : it.last_in_stock ? (
                      <span className="text-green-400">あり</span>
                    ) : (
                      <span className="text-gray-500">なし</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right text-gray-200">
                    {it.last_price ? `¥${it.last_price.toLocaleString()}` : "-"}
                  </td>
                  <td className="px-3 py-2 text-right text-gray-200">
                    {it.last_rank ? it.last_rank.toLocaleString() : "-"}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      onClick={() => handleDelete(it.asin)}
                      className="text-xs text-red-400 hover:text-red-300"
                    >
                      削除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* アラート履歴 */}
      <div className="bg-base-700/60 border border-base-500 rounded-lg p-4">
        <h3 className="text-lg font-bold mb-3">
          <span className="text-accent">▌</span> 直近のアラート
        </h3>
        {alerts.length === 0 ? (
          <p className="text-sm text-gray-500">まだアラートはありません</p>
        ) : (
          <ul className="space-y-2">
            {alerts.map((a) => (
              <li
                key={a.id}
                className="flex items-center gap-3 text-sm border-b border-base-600 pb-2"
              >
                <span
                  className={`px-2 py-0.5 text-xs rounded font-bold ${
                    a.type === "restock"
                      ? "bg-accent/30 text-accent"
                      : a.type === "price"
                      ? "bg-green-500/30 text-green-400"
                      : "bg-amber-500/30 text-amber-300"
                  }`}
                >
                  {a.type}
                </span>
                <a
                  href={`https://www.amazon.co.jp/dp/${a.asin}`}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono text-xs text-accent hover:underline"
                >
                  {a.asin}
                </a>
                <span className="text-gray-300 flex-1">{a.message}</span>
                <span className="text-xs text-gray-500">
                  {formatTime(a.created_at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Pill({ on, label }: { on: boolean; label: string }) {
  return (
    <span
      className={`px-2 py-0.5 text-xs rounded border ${
        on
          ? "bg-accent/20 text-accent border-accent/40"
          : "bg-base-700 text-gray-500 border-base-500"
      }`}
    >
      {label}
    </span>
  );
}
