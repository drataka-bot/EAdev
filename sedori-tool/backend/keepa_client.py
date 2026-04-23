"""Keepa API クライアント.

Amazon.co.jp (domain=5) から商品データを取得する。
- ASIN バッチ取得 (最大100件/リクエスト)
- JAN → ASIN 変換
- レート制限対策の sleep
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any, AsyncIterator, Optional

import httpx

log = logging.getLogger(__name__)

KEEPA_BASE_URL = "https://api.keepa.com"
DEFAULT_DOMAIN = 5  # Amazon.co.jp
BATCH_SIZE = 100
BATCH_SLEEP_SEC = 1.2
REQUEST_TIMEOUT_SEC = 60.0

# Keepa CSV インデックス (一部)
CSV_AMAZON = 0
CSV_NEW = 1
CSV_USED = 2
CSV_SALES_RANK = 3
CSV_NEW_FBA = 10
CSV_BUY_BOX = 18


class KeepaError(Exception):
    pass


class KeepaClient:
    def __init__(self, api_key: str, domain: int = DEFAULT_DOMAIN) -> None:
        if not api_key:
            raise KeepaError("KEEPA_API_KEY が設定されていません。")
        self.api_key = api_key
        self.domain = domain
        self._client = httpx.AsyncClient(timeout=REQUEST_TIMEOUT_SEC)

    async def close(self) -> None:
        await self._client.aclose()

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
        if resp.status_code != 200:
            log.warning("Keepa /query returned %s: %s", resp.status_code, resp.text[:200])
            return None
        data = resp.json()
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
        for i in range(0, len(asins), BATCH_SIZE):
            batch = asins[i : i + BATCH_SIZE]
            params = {
                "key": self.api_key,
                "domain": self.domain,
                "asin": ",".join(batch),
                "stats": 90,
                "history": 1,
                "offers": 20,
            }
            try:
                resp = await self._client.get(
                    f"{KEEPA_BASE_URL}/product", params=params
                )
            except httpx.HTTPError as exc:
                log.warning("Keepa /product request failed: %s", exc)
                processed += len(batch)
                yield [], processed
                await asyncio.sleep(BATCH_SLEEP_SEC)
                continue

            if resp.status_code != 200:
                log.warning(
                    "Keepa /product returned %s: %s",
                    resp.status_code,
                    resp.text[:200],
                )
                processed += len(batch)
                yield [], processed
                await asyncio.sleep(BATCH_SLEEP_SEC)
                continue

            data = resp.json()
            products = data.get("products") or []
            processed += len(batch)
            yield products, processed
            if i + BATCH_SIZE < len(asins):
                await asyncio.sleep(BATCH_SLEEP_SEC)


# ----------------------------------------------------------------------
# Normalizer
# ----------------------------------------------------------------------

def _price(val: Any) -> Optional[int]:
    """Keepa の価格値は yen*100 で格納されるため 100 で割る。-1 は無効値。"""
    if val is None:
        return None
    try:
        n = int(val)
    except (TypeError, ValueError):
        return None
    if n < 0:
        return None
    return n // 100


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


def normalize_product(product: dict[str, Any]) -> dict[str, Any]:
    """Keepa のレスポンスを UI 用にフラットな辞書へ変換。"""
    stats = product.get("stats") or {}

    amazon_price = _price(_stat_at(stats, "current", CSV_AMAZON))
    new_price = _price(_stat_at(stats, "current", CSV_NEW))
    used_price = _price(_stat_at(stats, "current", CSV_USED))
    buy_box_price = _price(_stat_at(stats, "current", CSV_BUY_BOX))

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

    buy_box_is_amazon = bool(stats.get("buyBoxIsAmazon"))
    amazon_in_stock = amazon_price is not None

    asin = product.get("asin")
    return {
        "asin": asin,
        "title": product.get("title"),
        "brand": product.get("brand"),
        "category": _category_name(product),
        "amazon_price": amazon_price,
        "new_price": new_price,
        "used_price": used_price,
        "lowest_new_price": lowest_new,
        "buy_box_price": buy_box_price,
        "fba_fee": fba_fee,
        "rank_current": _rank(rank_current),
        "rank_avg30": _rank(rank_avg30),
        "rank_avg90": _rank(rank_avg90),
        "monthly_sales": int(monthly_sold) if monthly_sold else 0,
        "new_offer_count": new_offer_count,
        "used_offer_count": used_offer_count,
        "amazon_in_stock": amazon_in_stock,
        "buy_box_is_amazon": buy_box_is_amazon,
        "amazon_url": f"https://www.amazon.co.jp/dp/{asin}" if asin else None,
        "keepa_url": f"https://keepa.com/#!product/5-{asin}" if asin else None,
    }
