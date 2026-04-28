"""Keepa API クライアント.

Amazon.co.jp (domain=5) から商品データを取得する。
- ASIN バッチ取得 (最大100件/リクエスト)
- JAN → ASIN 変換
- レート制限対策 (節約モード + 自動 throttle)

トークン消費量 (1 ASIN あたり、概算):
  - offers なし: 1 トークン
  - offers=20  : 6 トークン
  Basic プラン (5/分) 想定では offers なしを強く推奨。
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any, AsyncIterator, Optional

import httpx

log = logging.getLogger(__name__)

KEEPA_BASE_URL = "https://api.keepa.com"
DEFAULT_DOMAIN = 5  # Amazon.co.jp
DEFAULT_BATCH_SIZE = 100
DEFAULT_BATCH_SLEEP_SEC = 1.2
REQUEST_TIMEOUT_SEC = 60.0

# Keepa CSV インデックス (一部)
CSV_AMAZON = 0
CSV_NEW = 1
CSV_USED = 2
CSV_SALES_RANK = 3
CSV_NEW_FBA = 10
CSV_NEW_FBM_SHIPPING = 11
CSV_BUY_BOX = 18


class KeepaError(Exception):
    pass


class KeepaClient:
    def __init__(
        self,
        api_key: str,
        domain: int = DEFAULT_DOMAIN,
        offers: int = 0,
        batch_size: int = DEFAULT_BATCH_SIZE,
        batch_sleep_sec: float = DEFAULT_BATCH_SLEEP_SEC,
    ) -> None:
        if not api_key:
            raise KeepaError("KEEPA_API_KEY が設定されていません。")
        self.api_key = api_key
        self.domain = domain
        # 0 にすると offers パラメータ送らず大幅にトークン節約 (1/6)
        self.offers = max(0, int(offers))
        self.batch_size = max(1, int(batch_size))
        self.batch_sleep_sec = max(0.0, float(batch_sleep_sec))
        self._client = httpx.AsyncClient(timeout=REQUEST_TIMEOUT_SEC)
        # 直近の Keepa からの返答にあるトークン情報 (UI 表示用)
        self.last_tokens_left: Optional[int] = None
        self.last_refill_in_ms: Optional[int] = None

    async def close(self) -> None:
        await self._client.aclose()

    @property
    def cost_per_asin(self) -> int:
        """1 ASIN あたりのおおよそのトークンコスト (offers の有無で変動)。"""
        return 6 if self.offers > 0 else 1

    def _track_tokens(self, data: dict[str, Any]) -> None:
        try:
            tl = data.get("tokensLeft")
            if isinstance(tl, (int, float)):
                self.last_tokens_left = int(tl)
            ri = data.get("refillIn")
            if isinstance(ri, (int, float)):
                self.last_refill_in_ms = int(ri)
        except Exception:
            pass

    async def _wait_for_tokens(self, needed: int) -> None:
        """残トークンが必要量を下回りそうなら refill 完了まで sleep。"""
        if self.last_tokens_left is None:
            return
        if self.last_tokens_left >= needed:
            return
        wait_ms = self.last_refill_in_ms or 60_000
        wait_sec = max(1.0, wait_ms / 1000.0 + 1.0)
        log.warning(
            "Keepa tokens low (%s, need %s). Sleeping %.1fs for refill.",
            self.last_tokens_left,
            needed,
            wait_sec,
        )
        await asyncio.sleep(wait_sec)
        # refill 後はクライアント側でトークン量が分からないので一旦 None に戻す
        self.last_tokens_left = None
        self.last_refill_in_ms = None

    # ------------------------------------------------------------------
    # JAN -> ASIN  (/query?type=product&term={JAN}&domain=5)
    # ------------------------------------------------------------------
    async def jan_to_asin(self, jan: str) -> Optional[str]:
        params = {
            "key": self.api_key,
            "domain": self.domain,
            "type": "product",
            "term": jan,
        }
        try:
            resp = await self._client.get(f"{KEEPA_BASE_URL}/query", params=params)
        except httpx.HTTPError as exc:
            log.warning("Keepa /query request failed: %s", exc)
            return None
        try:
            data = resp.json()
            self._track_tokens(data)
        except Exception:
            data = {}
        if resp.status_code != 200:
            log.warning("Keepa /query returned %s: %s", resp.status_code, resp.text[:200])
            return None
        asins = data.get("asinList") or data.get("asins") or []
        if isinstance(asins, list) and asins:
            return asins[0]
        products = data.get("products") or []
        if products:
            return products[0].get("asin")
        return None

    async def jans_to_asins(self, jans: list[str]) -> dict[str, Optional[str]]:
        out: dict[str, Optional[str]] = {}
        for jan in jans:
            await self._wait_for_tokens(needed=1)
            out[jan] = await self.jan_to_asin(jan)
            await asyncio.sleep(0.5)
        return out

    # ------------------------------------------------------------------
    # Product
    # ------------------------------------------------------------------
    async def fetch_products(
        self, asins: list[str]
    ) -> AsyncIterator[tuple[list[dict[str, Any]], int]]:
        """ASIN をバッチに分けて取得し、(products, processed_count) を yield。"""
        processed = 0
        for i in range(0, len(asins), self.batch_size):
            batch = asins[i : i + self.batch_size]
            await self._wait_for_tokens(needed=len(batch) * self.cost_per_asin)

            params: dict[str, Any] = {
                "key": self.api_key,
                "domain": self.domain,
                "asin": ",".join(batch),
                "stats": 90,
                "history": 1,
            }
            if self.offers > 0:
                params["offers"] = self.offers

            products = await self._fetch_with_retry(params)
            processed += len(batch)
            yield products, processed
            if i + self.batch_size < len(asins):
                await asyncio.sleep(self.batch_sleep_sec)

    async def _fetch_with_retry(self, params: dict[str, Any]) -> list[dict[str, Any]]:
        """最大 1 回 429 リトライしつつ /product を叩く。"""
        for attempt in range(2):
            try:
                resp = await self._client.get(
                    f"{KEEPA_BASE_URL}/product", params=params
                )
            except httpx.HTTPError as exc:
                log.warning("Keepa /product request failed: %s", exc)
                return []

            try:
                data = resp.json()
                self._track_tokens(data)
            except Exception:
                data = {}

            if resp.status_code == 200:
                return data.get("products") or []

            if resp.status_code == 429 and attempt == 0:
                wait_ms = data.get("refillIn") or 60_000
                wait_sec = max(1.0, wait_ms / 1000.0 + 1.0)
                log.warning(
                    "Keepa 429 (tokensLeft=%s). Sleeping %.1fs and retrying once.",
                    data.get("tokensLeft"),
                    wait_sec,
                )
                await asyncio.sleep(wait_sec)
                continue

            log.warning(
                "Keepa /product returned %s: %s", resp.status_code, resp.text[:200]
            )
            return []
        return []


# ----------------------------------------------------------------------
# Normalizer
# ----------------------------------------------------------------------

def _price(val: Any) -> Optional[int]:
    """Keepa の価格値を円に正規化する。

    Amazon.co.jp (domain=5) は **円単位の整数** で返るため、そのまま返す。
    -1 は無効値。
    """
    if val is None:
        return None
    try:
        n = int(val)
    except (TypeError, ValueError):
        return None
    if n < 0:
        return None
    return n


def _stat_at(stats: dict[str, Any], key: str, idx: int) -> Any:
    arr = stats.get(key)
    if not isinstance(arr, list) or idx >= len(arr):
        return None
    return arr[idx]


def _category_name(product: dict[str, Any]) -> Optional[str]:
    tree = product.get("categoryTree")
    if isinstance(tree, list) and tree:
        last = tree[-1]
        if isinstance(last, dict):
            return last.get("name")
    return product.get("productGroup")


def _size_category(product: dict[str, Any]) -> Optional[str]:
    """Keepa の packageLength/Width/Height(mm)・packageWeight(g) から FBA サイズ区分を推定。

    Amazon.co.jp FBA サイズ規定 (概算):
      小型: 長辺 25cm 以下 & 3辺 35x30x3.3cm 以下 & 重量 250g 以下
      標準: 長辺 45cm 以下 & 3辺合計 170cm 以下 & 重量 9kg 以下
      大型: それ以外
    """
    def _mm(key: str) -> Optional[int]:
        v = product.get(key)
        try:
            return int(v) if v is not None and int(v) > 0 else None
        except (TypeError, ValueError):
            return None

    length = _mm("packageLength")
    width = _mm("packageWidth")
    height = _mm("packageHeight")
    weight_g = _mm("packageWeight")

    if not (length and width and height):
        return None

    dims = sorted([length, width, height], reverse=True)
    longest_cm = dims[0] / 10.0
    sum_cm = sum(dims) / 10.0

    if longest_cm <= 25 and (weight_g is None or weight_g <= 1000):
        return "小型"
    if longest_cm <= 45 and sum_cm <= 170 and (weight_g is None or weight_g <= 9000):
        return "標準"
    return "大型"


def _count_offers(product: dict[str, Any]) -> tuple[Optional[int], Optional[int]]:
    """FBA 出品者数 / 自己発送出品者数 を offers 配列から算出。"""
    offers = product.get("offers")
    if not isinstance(offers, list) or not offers:
        return None, None
    fba = 0
    fbm = 0
    for o in offers:
        if not isinstance(o, dict):
            continue
        # condition: 1=new (NEW), 2-5=used
        condition = o.get("condition", 1)
        if condition != 1:
            continue
        if o.get("isFBA"):
            fba += 1
        else:
            fbm += 1
    return fba, fbm


def normalize_product(product: dict[str, Any]) -> dict[str, Any]:
    """Keepa のレスポンスを UI 用にフラットな辞書へ変換。"""
    stats = product.get("stats") or {}

    amazon_price = _price(_stat_at(stats, "current", CSV_AMAZON))
    new_price = _price(_stat_at(stats, "current", CSV_NEW))
    used_price = _price(_stat_at(stats, "current", CSV_USED))
    buy_box_price = _price(_stat_at(stats, "current", CSV_BUY_BOX))
    fba_price = _price(_stat_at(stats, "current", CSV_NEW_FBA))
    fbm_price = _price(_stat_at(stats, "current", CSV_NEW_FBM_SHIPPING))

    # Amazon ページで実際に表示される価格 (購入時に決まる価格):
    # Buy Box > Amazon 直売 > 新品最安 の優先順位で決定。
    current_price_candidates = [
        p for p in [buy_box_price, amazon_price, new_price] if p is not None
    ]
    current_price = current_price_candidates[0] if current_price_candidates else None

    # 最安値候補: Amazon or NEW
    candidates = [p for p in [amazon_price, new_price, buy_box_price] if p is not None]
    lowest_new = min(candidates) if candidates else None

    rank_current = _stat_at(stats, "current", CSV_SALES_RANK)
    rank_avg30 = _stat_at(stats, "avg30", CSV_SALES_RANK)
    rank_avg90 = _stat_at(stats, "avg90", CSV_SALES_RANK)

    def _rank(v: Any) -> Optional[int]:
        if v is None:
            return None
        try:
            n = int(v)
        except (TypeError, ValueError):
            return None
        return n if n > 0 else None

    fba_fees = product.get("fbaFees") or {}
    fba_fee = _price(fba_fees.get("pickAndPackFee"))

    # 月間推定販売数: Keepa の monthlySold があればそれを使い、なければ salesRankDrops30
    monthly_sold = product.get("monthlySold")
    if monthly_sold is None or monthly_sold < 0:
        monthly_sold = stats.get("salesRankDrops30")
    if monthly_sold is None or monthly_sold < 0:
        drops90 = stats.get("salesRankDrops90")
        monthly_sold = int(drops90 / 3) if isinstance(drops90, (int, float)) and drops90 > 0 else 0

    new_offer_count = product.get("newOfferCount")
    used_offer_count = product.get("usedOfferCount")
    # 補完
    if new_offer_count is None:
        new_offer_count = stats.get("offerCountNew")
    if used_offer_count is None:
        used_offer_count = stats.get("offerCountUsed")

    fba_offer_count, fbm_offer_count = _count_offers(product)

    buy_box_is_amazon = bool(stats.get("buyBoxIsAmazon"))
    amazon_in_stock = amazon_price is not None

    # 30日 / 90日 販売数推定 (salesRankDrops)
    def _sales(key: str) -> Optional[int]:
        v = stats.get(key)
        try:
            n = int(v) if v is not None else None
        except (TypeError, ValueError):
            return None
        return n if n is not None and n >= 0 else None

    sales_30d = _sales("salesRankDrops30")
    sales_90d = _sales("salesRankDrops90")

    # JAN/EAN を抽出 (楽天/Yahoo 検索用)。eanList が無い商品もあるので
    # upcList / gtinList もフォールバックで見る。
    jan: Optional[str] = None
    for field in ("eanList", "upcList", "gtinList"):
        codes = product.get(field)
        if not isinstance(codes, list):
            continue
        for code in codes:
            s = str(code).strip()
            if s.isdigit() and len(s) in (8, 13):
                jan = s
                break
        if jan:
            break

    asin = product.get("asin")
    keepa_graph_url = (
        f"https://graph.keepa.com/pricehistory.png?asin={asin}&domain=5&width=600&height=200"
        if asin
        else None
    )
    return {
        "asin": asin,
        "jan": jan,
        "title": product.get("title"),
        "brand": product.get("brand"),
        "category": _category_name(product),
        "size_category": _size_category(product),
        "amazon_price": amazon_price,
        "current_price": current_price,
        "new_price": new_price,
        "used_price": used_price,
        "lowest_new_price": lowest_new,
        "buy_box_price": buy_box_price,
        "fba_price": fba_price,
        "fbm_price": fbm_price,
        "fba_fee": fba_fee,
        "rank_current": _rank(rank_current),
        "rank_avg30": _rank(rank_avg30),
        "rank_avg90": _rank(rank_avg90),
        "monthly_sales": int(monthly_sold) if monthly_sold else 0,
        "sales_30d": sales_30d,
        "sales_90d": sales_90d,
        "new_offer_count": new_offer_count,
        "used_offer_count": used_offer_count,
        "fba_offer_count": fba_offer_count,
        "fbm_offer_count": fbm_offer_count,
        "amazon_in_stock": amazon_in_stock,
        "buy_box_is_amazon": buy_box_is_amazon,
        "amazon_url": f"https://www.amazon.co.jp/dp/{asin}" if asin else None,
        "keepa_url": f"https://keepa.com/#!product/5-{asin}" if asin else None,
        "keepa_graph_url": keepa_graph_url,
    }
