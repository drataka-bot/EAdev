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

### 1. API キーの取得

| サービス             | 用途                              | 発行先                                                   |
| ---------------- | ------------------------------- | ----------------------------------------------------- |
| Keepa            | Amazon の販売価格・ランキング・出品者・FBA手数料   | https://keepa.com/#!api                               |
| 楽天市場 (Rakuten)   | 楽天市場の最安値・店舗・商品 URL              | https://webservice.rakuten.co.jp/                     |
| Yahoo!ショッピング     | Yahoo!ショッピングの最安値・店舗・商品 URL      | https://e.developer.yahoo.co.jp/dashboard/            |

**Keepa は必須**、楽天 / Yahoo は仕入れ先比較のために推奨です（未設定でもツールは動作します）。

### 2. `.env` を作成

```bash
cd sedori-tool
cp .env.example .env
# KEEPA_API_KEY / RAKUTEN_APP_ID / YAHOO_CLIENT_ID をそれぞれ設定
```

> UI の「設定」画面でも各キーを入力・保存（localStorage）できます。`.env` がある場合はバックエンド側のキーが優先されます。

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
設計思想を参考に、**Amazon / 楽天市場 / Yahoo!ショッピング / Keepa** を一括取得して
ASIN / JAN を起点とした **リサーチ → 選別 → 仕入れ先確定** を一気通貫で行えるよう構築しています。

| 機能                 | 内容                                                                |
| ------------------ | ----------------------------------------------------------------- |
| 一括入力               | テキストエリア貼り付け・CSV アップロード（`asin` / `jan` 列）                         |
| Amazon (Keepa)     | 商品名・価格・ランキング・FBA 手数料・出品者数・Buy Box・月間推定販売数                         |
| 楽天市場              | JAN (または商品名) で最安値・店舗名・商品 URL を自動取得                                |
| Yahoo!ショッピング       | `jan_code` で最安値・店舗名・商品 URL を自動取得                                  |
| ビックカメラ            | 楽天店 (`shopCode=biccamera`) → Yahoo店 (`seller_id=biccamera`) → 本店スクレイピングのフォールバック |
| ヨドバシカメラ           | yodobashi.com 直接スクレイピング (オプトイン)                                    |
| 最安仕入れ先判定          | 4 ソースの最安を **仕入れ価格に自動セット** + ★最安バッジ表示                              |
| JAN → ASIN         | Keepa `/query?type=product&term={JAN}&domain=5` で自動変換              |
| サイズ区分判定            | Keepa の梱包寸法/重量から FBA 区分 (小型 / 標準 / 大型) を推定                        |
| 多軸価格取得             | Amazon 現在価格・カート価格・FBA 価格・自己発送価格・中古最安値を個別表示                        |
| 出品者数               | 新品 / 中古 / FBA / 自己発送 を offers から集計                                 |
| 販売実績               | 月間推定 + 30日・90日の salesRankDrops を併記                                |
| スコアリング             | 利益率・月間推定販売数・出品者数から S〜D を自動判定                                     |
| 詳細フィルタ (ミリオンサーチ風)  | 最小利益率・最小月間販売数・最大新品/FBA 出品者数・Amazon 本体除外・サイズ区分・黒字のみ              |
| 結果テーブル             | ソート・フィルタ・仕入れ価格のインライン編集・利益の即時再計算                                   |
| 進捗表示               | 処理件数 / 全件数、処理速度 (件/分) のリアルタイム表示・ソースバッジ                            |
| CSV 出力             | Amazon / 楽天 / Yahoo の全価格・URL・店舗を `sedori_result_YYYYMMDD_HHMMSS.csv` に出力 |
| 設定画面               | 3 種 API キー・デフォルト仕入れ価格を localStorage に保存                            |

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

| メソッド | パス              | 内容                                                                 |
| ---- | --------------- | ------------------------------------------------------------------ |
| POST | `/api/research` | ASIN / JAN 配列を受け取り、Keepa + 楽天 + Yahoo から並行取得して返す                   |
| POST | `/api/score`    | 商品データと仕入れ価格からスコアを再計算                                              |
| GET  | `/api/health`   | ヘルスチェック (各ソースの設定状況を返す)                                              |

### レート制限対策

| ソース                     | バッチ          | リクエスト間 sleep |
| ----------------------- | ------------ | ------------ |
| Keepa /product          | 100 ASIN/req | 1.2 s        |
| Keepa /query            | 1 JAN/req    | 0.5 s        |
| 楽天 IchibaItem            | 1 検索/req     | 1.1 s        |
| Yahoo itemSearch        | 1 検索/req     | 0.3 s        |
| biccamera.com スクレイプ      | 1 検索/req     | 2.0 s        |
| yodobashi.com スクレイプ     | 1 検索/req     | 2.0 s        |

楽天 / Yahoo / ビック / ヨドバシ は `asyncio.gather` で並行実行され、Keepa の取得待ち時間を有効活用します。

### ビック / ヨドバシ取得ロジック

```
ビックカメラ:
  1) 楽天 shopCode=biccamera で検索
  2) ヒットしなければ Yahoo seller_id=biccamera で検索
  3) ヒットしなければ biccamera.com 検索ページをスクレイプ (要許可)

ヨドバシカメラ:
  yodobashi.com を JAN で検索 (要許可)
  ※ 楽天 / Yahoo に出店していないためスクレイプ一択
```

スクレイピングは UI の「設定」→ **ビック/ヨドバシ本店スクレイピングを有効化** を ON にした場合のみ動作します。
ToS や IP BAN リスクがあるため自己責任でお使いください。

---

## 注意

- 個人利用を前提としており、認証機構はありません。外部公開しないでください。
- Keepa API のトークン消費はサブスク契約に依存します。大量リサーチ前にトークン残量を確認してください。
