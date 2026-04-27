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
  const [rakutenAppId, setRakutenAppId] = useState(initial.rakutenAppId);
  const [yahooClientId, setYahooClientId] = useState(initial.yahooClientId);
  const [enableScraping, setEnableScraping] = useState(initial.enableScraping);
  const [defaultPurchasePrice, setDefaultPurchasePrice] = useState<string>(
    initial.defaultPurchasePrice != null ? String(initial.defaultPurchasePrice) : ""
  );
  const [showSecrets, setShowSecrets] = useState(false);

  if (!open) return null;

  const handleSave = () => {
    const parsed =
      defaultPurchasePrice.trim() === "" ? null : Number(defaultPurchasePrice);
    onSave({
      apiKey: apiKey.trim(),
      rakutenAppId: rakutenAppId.trim(),
      yahooClientId: yahooClientId.trim(),
      enableScraping,
      defaultPurchasePrice:
        parsed != null && !Number.isNaN(parsed) && parsed >= 0 ? parsed : null,
    });
    onClose();
  };

  const inputType = showSecrets ? "text" : "password";

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center">
      <div className="bg-base-800 border border-base-500 rounded-lg w-[560px] p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
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

        <div className="flex justify-end mb-3">
          <button
            onClick={() => setShowSecrets((v) => !v)}
            className="px-3 py-1 bg-base-600 hover:bg-base-500 border border-base-400 rounded text-xs text-gray-200"
          >
            {showSecrets ? "キーを隠す" : "キーを表示"}
          </button>
        </div>

        <div className="space-y-4">
          <ApiKeyField
            label="Keepa API キー (Amazon データ)"
            value={apiKey}
            onChange={setApiKey}
            placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
            type={inputType}
            help="Amazon の販売価格・ランキング・出品者数を取得します。"
          />
          <ApiKeyField
            label="楽天 ApplicationId (楽天市場の最安取得)"
            value={rakutenAppId}
            onChange={setRakutenAppId}
            placeholder="20桁の Application ID"
            type={inputType}
            help="https://webservice.rakuten.co.jp/ で発行。未設定でもツールは動作しますが楽天価格は取得されません。"
          />
          <ApiKeyField
            label="Yahoo!ショッピング ClientID (Yahoo の最安取得)"
            value={yahooClientId}
            onChange={setYahooClientId}
            placeholder="Yahoo Developer ID"
            type={inputType}
            help="https://e.developer.yahoo.co.jp/ で発行。未設定でもツールは動作しますが Yahoo 価格は取得されません。"
          />

          <div className="border border-amber-500/40 bg-amber-500/5 rounded p-3">
            <label className="flex items-start gap-2 text-sm text-gray-200 cursor-pointer">
              <input
                type="checkbox"
                checked={enableScraping}
                onChange={(e) => setEnableScraping(e.target.checked)}
                className="accent-accent mt-0.5"
              />
              <div>
                <div className="font-bold text-amber-300">
                  ビック/ヨドバシ本店スクレイピングを有効化 (実験的)
                </div>
                <p className="text-xs text-gray-400 mt-1 leading-relaxed">
                  公式 API でヒットしない商品について、<code>biccamera.com</code> /{" "}
                  <code>yodobashi.com</code> を直接読み取って価格を補完します。
                  <br />
                  ⚠️ 利用規約や安定性のリスクがあります。自己責任で有効化してください。
                </p>
              </div>
            </label>
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
              placeholder="楽天/Yahoo 取得失敗時のフォールバック"
              className="w-full bg-base-900 border border-base-500 focus:border-accent rounded px-3 py-2 text-sm text-gray-100 outline-none"
            />
          </div>

          <div className="text-xs text-gray-500 border border-base-500 rounded p-3 leading-relaxed">
            キーは <code className="text-accent">localStorage</code> に保存されます。
            バックエンドの <code className="text-accent">.env</code> がある場合はそちらが優先されます。
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

function ApiKeyField({
  label,
  value,
  onChange,
  placeholder,
  type,
  help,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type: string;
  help?: string;
}) {
  return (
    <div>
      <label className="block text-sm text-gray-300 mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-base-900 border border-base-500 focus:border-accent rounded px-3 py-2 text-sm font-mono text-gray-100 outline-none"
      />
      {help && <p className="text-xs text-gray-500 mt-1">{help}</p>}
    </div>
  );
}
