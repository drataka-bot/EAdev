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
    // ヘッダなしとみなして全行を最初の列として読む
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

  const codes = useMemo(() => parseTextInput(text), [text]);

  const handleFile = async (file: File) => {
    const content = await file.text();
    const parsed = parseCsv(content);
    if (parsed.length > 0) {
      setText((prev) => (prev ? prev + "\n" : "") + parsed.join("\n"));
    }
    if (fileRef.current) fileRef.current.value = "";
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

      <div className="flex items-center justify-between mt-3 gap-3">
        <div className="flex items-center gap-2">
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
    </div>
  );
}
