import { useState } from "react";
import type { AppSettings } from "../types";

interface Props {
  open: boolean;
  initial: AppSettings;
  onClose: () => void;
  onSave: (s: AppSettings) => void;
}

export function Settings({ open, initial, onClose, onSave }: Props) {
  const [apiKey, setApiKey] = useState(initial.apiKey);
  const [defaultPurchasePrice, setDefaultPurchasePrice] = useState<string>(
    initial.defaultPurchasePrice != null ? String(initial.defaultPurchasePrice) : ""
  );
  const [showKey, setShowKey] = useState(false);

  if (!open) return null;

  const handleSave = () => {
    const parsed = defaultPurchasePrice.trim() === "" ? null : Number(defaultPurchasePrice);
    onSave({
      apiKey: apiKey.trim(),
      defaultPurchasePrice:
        parsed != null && !Number.isNaN(parsed) && parsed >= 0 ? parsed : null,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center">
      <div className="bg-base-800 border border-base-500 rounded-lg w-[480px] p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-gray-100">
            <span className="text-accent">▌</span> 設定
          </h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-200 text-xl leading-none"
          >
            ×
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm text-gray-300 mb-1">Keepa API キー</label>
            <div className="flex gap-2">
              <input
                type={showKey ? "text" : "password"}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                className="flex-1 bg-base-900 border border-base-500 focus:border-accent rounded px-3 py-2 text-sm font-mono text-gray-100 outline-none"
              />
              <button
                onClick={() => setShowKey((v) => !v)}
                className="px-3 py-2 bg-base-600 hover:bg-base-500 border border-base-400 rounded text-sm text-gray-200"
              >
                {showKey ? "隠す" : "表示"}
              </button>
            </div>
            <p className="text-xs text-gray-500 mt-1">
              localStorage に保存されます。バックエンドの .env が優先されます。
            </p>
          </div>

          <div>
            <label className="block text-sm text-gray-300 mb-1">
              デフォルト仕入れ価格（円）
            </label>
            <input
              type="number"
              min={0}
              value={defaultPurchasePrice}
              onChange={(e) => setDefaultPurchasePrice(e.target.value)}
              placeholder="例: 1000"
              className="w-full bg-base-900 border border-base-500 focus:border-accent rounded px-3 py-2 text-sm text-gray-100 outline-none"
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-base-600 hover:bg-base-500 border border-base-400 rounded text-sm text-gray-200"
          >
            キャンセル
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-2 bg-accent hover:bg-accent-dark text-black font-bold rounded text-sm"
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
}
