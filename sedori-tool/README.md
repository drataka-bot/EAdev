# 電脳せどりリサーチツール

Keepa API を使って ASIN / JAN を一括リサーチし、仕入れ判断を自動化する個人用 Web アプリです。

## 構成

```
sedori-tool/
├── frontend/        React + TypeScript + Tailwind (Vite)
├── backend/         FastAPI (Keepa 連携・スコアリング)
└── .env.example     Keepa API キー設定サンプル
```

- フロントエンド: `http://localhost:5173`
- バックエンド: `http://localhost:8000`

---

## セットアップ

### 1. Keepa API キーの取得

[Keepa API](https://keepa.com/#!api) でサブスクリプション契約し、API キーを発行してください。

### 2. `.env` を作成

```bash
cd sedori-tool
cp .env.example .env
# KEEPA_API_KEY にキーを貼り付け
```

> UI の「設定」画面でも API キーを入力・保存（localStorage）できます。`.env` がある場合はバックエンド側のキーが優先されます。

### 3. バックエンド起動

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

### 4. フロントエンド起動

```bash
cd frontend
npm install
npm run dev
```

ブラウザで `http://localhost:5173` を開いてください。

---

## 主な機能

本ツールは、電脳せどり界隈で利用されている「雷神」(情報抽出) と「ミリオンサーチ」(利益商品選別) の
設計思想を参考に、ASIN/JAN を起点とした **リサーチ → 選別** を一気通貫で行えるよう構築しています。

| 機能                 | 内容                                                                |
| ------------------ | ----------------------------------------------------------------- |
| 一括入力               | テキストエリア貼り付け・CSV アップロード（`asin` / `jan` 列）                         |
| Keepa 連携           | 商品名・価格・ランキング・FBA 手数料・出品者数・Buy Box・月間推定販売数                         |
| JAN → ASIN         | `/query?type=product&term={JAN}&domain=5` で自動変換                    |
| サイズ区分判定            | Keepa の梱包寸法/重量から FBA 区分 (小型 / 標準 / 大型) を推定                        |
| 多軸価格取得             | Amazon 現在価格・カート価格・FBA 価格・自己発送価格・中古最安値を個別表示                        |
| 出品者数               | 新品 / 中古 / FBA / 自己発送 を offers から集計                                 |
| 販売実績               | 月間推定 + 30日・90日の salesRankDrops を併記                                |
| スコアリング             | 利益率・月間推定販売数・出品者数から S〜D を自動判定                                     |
| 詳細フィルタ (ミリオンサーチ風)  | 最小利益率・最小月間販売数・最大新品/FBA 出品者数・Amazon 本体除外・サイズ区分・黒字のみ              |
| 結果テーブル             | ソート・フィルタ・仕入れ価格のインライン編集・利益の即時再計算                                   |
| 進捗表示               | 処理件数 / 全件数、処理速度 (件/分) のリアルタイム表示                                   |
| CSV 出力             | 表示中データを `sedori_result_YYYYMMDD_HHMMSS.csv` で出力                   |
| 設定画面               | Keepa API キー・デフォルト仕入れ価格を localStorage に保存                          |

---

## スコアリング基準

```
利益額 = Amazon最安値 - 仕入れ価格 - FBA手数料 - Amazon手数料(10%)
利益率 = 利益額 / 仕入れ価格 × 100

S: 利益率 >= 20% AND 月間推定販売数 >= 30 AND 出品者数 <= 5
A: 利益率 >= 15% AND 月間推定販売数 >= 20 AND 出品者数 <= 10
B: 利益率 >= 10% AND 月間推定販売数 >= 10
C: 利益率 >= 5%
D: 利益率 < 5% または赤字
```

---

## API エンドポイント

| メソッド | パス              | 内容                                            |
| ---- | --------------- | --------------------------------------------- |
| POST | `/api/research` | ASIN / JAN 配列を受け取り、Keepa から商品データを取得して返す        |
| POST | `/api/score`    | 商品データと仕入れ価格からスコアを再計算                         |
| GET  | `/api/health`   | ヘルスチェック                                       |

Keepa API のレート制限対策として、最大 100 件ごとにバッチ分割し、リクエスト間に sleep を挟みます。

---

## 注意

- 個人利用を前提としており、認証機構はありません。外部公開しないでください。
- Keepa API のトークン消費はサブスク契約に依存します。大量リサーチ前にトークン残量を確認してください。
