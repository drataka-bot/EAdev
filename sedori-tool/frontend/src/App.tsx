import { useCallback, useEffect, useRef, useState } from "react";
import { InputPanel } from "./components/InputPanel";
import { ProgressBar } from "./components/ProgressBar";
import { ResultTable } from "./components/ResultTable";
import { Settings } from "./components/Settings";
import type { AppSettings, ProductItem, ResearchResponse, ScoreGrade } from "./types";
import { exportCsv } from "./utils/export";
import { calcScore } from "./utils/scoring";
import { loadSettings, saveSettings } from "./utils/settings";

interface Progress {
  current: number;
  total: number;
  startedAt: number | null;
  speed: number;
  active: boolean;
}

const INITIAL_PROGRESS: Progress = {
  current: 0,
  total: 0,
  startedAt: null,
  speed: 0,
  active: false,
};

function App() {
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [items, setItems] = useState<ProductItem[]>([]);
  const [progress, setProgress] = useState<Progress>(INITIAL_PROGRESS);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const tickerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (tickerRef.current) window.clearInterval(tickerRef.current);
    };
  }, []);

  const startProgress = useCallback((total: number) => {
    const startedAt = Date.now();
    setProgress({ current: 0, total, startedAt, speed: 0, active: true });
    if (tickerRef.current) window.clearInterval(tickerRef.current);
    // シミュレーション: バックエンドはバッチで処理するので、
    // 時間ベースで progress を伸ばしつつ、完了後に total に合わせる。
    tickerRef.current = window.setInterval(() => {
      setProgress((p) => {
        if (!p.active || !p.startedAt) return p;
        const elapsedMin = (Date.now() - p.startedAt) / 60000;
        // ざっくり 60 件/分で推移（単なる体感用表示）
        const estimated = Math.min(p.total - 1, Math.floor(elapsedMin * 60));
        const current = Math.max(p.current, estimated);
        const speed = elapsedMin > 0 ? current / elapsedMin : 0;
        return { ...p, current, speed };
      });
    }, 500);
  }, []);

  const stopProgress = useCallback((total: number) => {
    if (tickerRef.current) window.clearInterval(tickerRef.current);
    tickerRef.current = null;
    setProgress((p) => {
      const startedAt = p.startedAt ?? Date.now();
      const elapsedMin = Math.max(0.001, (Date.now() - startedAt) / 60000);
      return {
        ...p,
        current: total,
        total,
        speed: total / elapsedMin,
        active: false,
      };
    });
  }, []);

  const [sources, setSources] = useState<{
    keepa: boolean;
    rakuten: boolean;
    yahoo: boolean;
  } | null>(null);

  const handleSubmit = useCallback(
    async (codes: string[]) => {
      if (codes.length === 0) return;
      setError(null);
      setLoading(true);
      startProgress(codes.length);
      try {
        const resp = await fetch("/api/research", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            codes,
            api_key: settings.apiKey || undefined,
            rakuten_app_id: settings.rakutenAppId || undefined,
            yahoo_client_id: settings.yahooClientId || undefined,
            default_purchase_price: settings.defaultPurchasePrice,
          }),
        });
        if (!resp.ok) {
          const body = await resp.json().catch(() => ({}));
          throw new Error(body.detail || `HTTP ${resp.status}`);
        }
        const data = (await resp.json()) as ResearchResponse;
        setItems(data.items);
        setSources(data.sources);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        stopProgress(codes.length);
        setLoading(false);
      }
    },
    [
      settings.apiKey,
      settings.rakutenAppId,
      settings.yahooClientId,
      settings.defaultPurchasePrice,
      startProgress,
      stopProgress,
    ]
  );

  const handlePurchasePriceChange = useCallback(
    (key: string, _code: string, value: number | null) => {
      setItems((prev) =>
        prev.map((item) => {
          if ((item.asin ?? item.input_code) !== key) return item;
          const updated = { ...item, purchase_price: value };
          const { grade, profit, profitRate } = calcScore(updated, value);
          return {
            ...updated,
            profit,
            profit_rate: profitRate,
            score: grade as ScoreGrade,
          };
        })
      );
    },
    []
  );

  const handleSaveSettings = (next: AppSettings) => {
    saveSettings(next);
    setSettings(next);
  };

  const summary = {
    total: items.length,
    s: items.filter((i) => i.score === "S").length,
    a: items.filter((i) => i.score === "A").length,
    profit: items.filter((i) => i.profit != null && (i.profit ?? 0) > 0).length,
  };

  return (
    <div className="min-h-screen">
      <header className="border-b border-base-600 bg-base-900/80 backdrop-blur sticky top-0 z-40">
        <div className="max-w-[1600px] mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="text-2xl font-bold tracking-wider">
              <span className="text-accent">SEDORI</span>
              <span className="text-gray-300">/RESEARCH</span>
            </div>
            <span className="text-xs text-gray-500 border border-base-500 rounded px-2 py-0.5">
              Keepa API
            </span>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <SourceBadges
              sources={
                sources ?? {
                  keepa: !!settings.apiKey,
                  rakuten: !!settings.rakutenAppId,
                  yahoo: !!settings.yahooClientId,
                }
              }
            />
            <div className="text-gray-400">
              件数 <span className="text-accent font-bold">{summary.total}</span> ·
              <span className="ml-2">S</span>
              <span className="text-accent font-bold ml-1">{summary.s}</span> ·
              <span className="ml-2">A</span>
              <span className="text-accent font-bold ml-1">{summary.a}</span> ·
              <span className="ml-2">黒字</span>
              <span className="text-green-400 font-bold ml-1">{summary.profit}</span>
            </div>
            <button
              onClick={() => setSettingsOpen(true)}
              className="px-3 py-1.5 bg-base-600 hover:bg-base-500 border border-base-400 rounded text-sm text-gray-100"
            >
              設定
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-[1600px] mx-auto px-6 py-6 space-y-5">
        <InputPanel onSubmit={handleSubmit} loading={loading} />

        <ProgressBar
          current={progress.current}
          total={progress.total}
          speed={progress.speed}
          active={progress.active}
        />

        {error && (
          <div className="bg-red-900/40 border border-red-500/50 rounded p-3 text-red-200 text-sm">
            エラー: {error}
          </div>
        )}

        <ResultTable
          items={items}
          onPurchasePriceChange={handlePurchasePriceChange}
          onExport={exportCsv}
        />
      </main>

      <Settings
        open={settingsOpen}
        initial={settings}
        onClose={() => setSettingsOpen(false)}
        onSave={handleSaveSettings}
      />
    </div>
  );
}

function SourceBadges({
  sources,
}: {
  sources: { keepa: boolean; rakuten: boolean; yahoo: boolean };
}) {
  const items = [
    { label: "Amazon/Keepa", on: sources.keepa, color: "bg-amber-500" },
    { label: "楽天", on: sources.rakuten, color: "bg-red-500" },
    { label: "Yahoo", on: sources.yahoo, color: "bg-purple-500" },
  ];
  return (
    <div className="flex items-center gap-1">
      {items.map((it) => (
        <span
          key={it.label}
          className={`px-2 py-0.5 text-[11px] rounded border ${
            it.on
              ? `${it.color} text-black border-transparent`
              : "bg-base-700 text-gray-500 border-base-500"
          }`}
          title={it.on ? "取得有効" : "API キー未設定"}
        >
          {it.label}
        </span>
      ))}
    </div>
  );
}

export default App;
