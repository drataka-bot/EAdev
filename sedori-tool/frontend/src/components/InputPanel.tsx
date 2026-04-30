import { useMemo, useRef, useState } from "react";

interface Props {
  onSubmit: (codes: string[]) => void;
  loading: boolean;
  disabled?: boolean;
}

function parseTextInput(text: string): string[] {
  return text
    .split(/[\r\n,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseCsv(text: string): string[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length === 0) return [];
  const header = lines[0].split(",").map((h) => h.trim().toLowerCase().replace(/^"|"$/g, ""));
  const asinIdx = header.indexOf("asin");
  const janIdx = header.indexOf("jan");
  if (asinIdx === -1 && janIdx === -1) {
    return lines
      .flatMap((l) => l.split(",").map((c) => c.trim().replace(/^"|"$/g, "")))
      .filter(Boolean);
  }
  const codes: string[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
    const val = (asinIdx !== -1 && cols[asinIdx]) || (janIdx !== -1 && cols[janIdx]) || "";
    if (val) codes.push(val);
  }
  return codes;
}

export function InputPanel({ onSubmit, loading, disabled }: Props) {
  const [text, setText] = useState("");
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [discovering, setDiscovering] = useState(false);
  const [discoverMsg, setDiscoverMsg] = useState<string | null>(null);
  const [discoverLimit, setDiscoverLimit] = useState<number>(30);
  const [discoverMinDrops, setDiscoverMinDrops] = useState<number>(5);
  const [discoverPanelOpen, setDiscoverPanelOpen] = useState(false);

  const codes = useMemo(() => parseTextInput(text), [text]);

  const handleFile = async (file: File) => {
    const content = await file.text();
    const parsed = parseCsv(content);
    if (parsed.length > 0) {
      setText((prev) => (prev ? prev + "\n" : "") + parsed.join("\n"));
    }
    if (fileRef.current) fileRef.current.value = "";
  };

  const handleDiscover = async () => {
    const label = discoverLimit <= 0 ? "無制限 (最大 10,000 件)" : `最大 ${discoverLimit} 件`;
    const tokenHint =
      discoverLimit <= 0 || discoverLimit > 200
        ? "数百〜数千トークン消費する可能性あり"
        : "概算 50〜200 トークン";
    if (
      !confirm(
        `Keepa Product Finder で プレ値候補を ${label} 取得します。\n` +
          `${tokenHint}。よろしいですか?`
      )
    )
      return;
    setDiscovering(true);
    setDiscoverMsg(null);
    try {
      const resp = await fetch("/api/find-premium", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          max_results: discoverLimit,
          min_drops30: discoverMinDrops,
        }),
      });
      const body = await resp.json();
      if (!resp.ok) {
        throw new Error(body.detail || `HTTP ${resp.status}`);
      }
      const asins: string[] = body.asins ?? [];
      if (asins.length === 0) {
        setDiscoverMsg("候補が見つかりませんでした (条件を緩めて再実行してください)");
        return;
      }
      setText((prev) => (prev ? prev.trim() + "\n" : "") + asins.join("\n"));
      setDiscoverMsg(
        `${asins.length} 件の候補を入力欄に追加しました。トークン残: ${
          body.tokens_left ?? "?"
        }`
      );
    } catch (e) {
      setDiscoverMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setDiscovering(false);
    }
  };

  return (
    <div className="bg-base-700/60 border border-base-500 rounded-lg p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-bold text-gray-100">
          <span className="text-accent">▌</span> ASIN / JAN 入力
        </h2>
        <div className="text-sm text-gray-400">
          入力件数: <span className="text-accent font-bold">{codes.length}</span>
        </div>
      </div>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="改行区切りで ASIN または JAN を貼り付けてください&#10;例: B0XXXXXXXX&#10;4901234567890"
        spellCheck={false}
        className="w-full h-40 bg-base-900 border border-base-500 focus:border-accent rounded p-3 text-gray-100 font-mono text-sm resize-none outline-none"
      />

      <div className="flex items-center justify-between mt-3 gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="px-3 py-2 bg-base-600 hover:bg-base-500 border border-base-400 rounded text-sm text-gray-200"
          >
            CSV アップロード
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleFile(f);
            }}
          />
          <button
            type="button"
            onClick={() => setText("")}
            className="px-3 py-2 bg-base-600 hover:bg-base-500 border border-base-400 rounded text-sm text-gray-300"
          >
            クリア
          </button>
          <button
            type="button"
            onClick={() => setDiscoverPanelOpen((v) => !v)}
            className="px-3 py-2 bg-pink-500/20 hover:bg-pink-500/30 border border-pink-500/60 text-pink-300 rounded text-sm font-bold"
            title="Keepa Product Finder でプレ値候補を取得"
          >
            🔥 プレ値候補を発見 {discoverPanelOpen ? "▲" : "▼"}
          </button>
        </div>
        <button
          type="button"
          onClick={() => onSubmit(codes)}
          disabled={loading || disabled || codes.length === 0}
          className="px-5 py-2 bg-accent hover:bg-accent-dark disabled:bg-base-500 disabled:cursor-not-allowed text-black font-bold rounded"
        >
          {loading ? "リサーチ中..." : `リサーチ開始 (${codes.length}件)`}
        </button>
      </div>

      {discoverPanelOpen && (
        <div className="mt-3 border border-pink-500/40 bg-pink-500/5 rounded p-3 text-xs space-y-2">
          <div className="flex items-center gap-3 flex-wrap">
            <label className="flex items-center gap-1 text-gray-300">
              取得件数:
              <input
                type="number"
                min={0}
                value={discoverLimit}
                onChange={(e) =>
                  setDiscoverLimit(Math.max(0, Number(e.target.value) || 0))
                }
                className="w-24 bg-base-900 border border-base-500 rounded px-2 py-0.5 text-right"
              />
              <span className="text-[10px] text-gray-500">
                (0 = 無制限)
              </span>
            </label>
            <label className="flex items-center gap-1 text-gray-300">
              最小30日販売数:
              <input
                type="number"
                min={0}
                value={discoverMinDrops}
                onChange={(e) => setDiscoverMinDrops(Math.max(0, Number(e.target.value) || 0))}
                className="w-16 bg-base-900 border border-base-500 rounded px-2 py-0.5 text-right"
              />
            </label>
            <button
              type="button"
              onClick={handleDiscover}
              disabled={discovering}
              className="px-3 py-1 bg-pink-500 hover:bg-pink-400 disabled:opacity-50 text-black font-bold rounded"
            >
              {discovering ? "取得中..." : "Keepa から候補取得"}
            </button>
          </div>
          <p className="text-[11px] text-gray-400 leading-relaxed">
            条件: 定価あり + 30日販売数 ≥ {discoverMinDrops} + 新品在庫あり (¥500〜200,000)。
            取得後は通常通り「リサーチ開始」して、結果テーブルで「🔥 プレ値モード」を ON にすると
            実際に <code>現在価格 &gt; 定価</code> になっている商品だけに絞り込めます。
          </p>
          {discoverMsg && (
            <p className="text-amber-300">{discoverMsg}</p>
          )}
        </div>
      )}
    </div>
  );
}
