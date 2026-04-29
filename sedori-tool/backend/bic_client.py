"""ビックカメラ価格取得クライアント (ハイブリッド構成).

優先順位:
  1. 楽天市場 ビックカメラ公式店 (shopCode=biccamera)  -- 公式 API
  2. Yahoo!ショッピング ビックカメラ店 (seller_id=biccamera) -- 公式 API
  3. biccamera.com 直接スクレイピング (allow_scraping=True 時のみ)

スクレイピングは ToS / 安定性リスクがあるためデフォルト OFF。
"""
from __future__ import annotations

import asyncio
import logging
import re
from typing import Any, Optional

import httpx

from rakuten_client import RakutenClient
from yahoo_client import YahooClient

log = logging.getLogger(__name__)

RAKUTEN_BIC_SHOP = "biccamera"
YAHOO_BIC_SELLER = "biccamera"

SCRAPE_BASE = "https://www.biccamera.com"
SCRAPE_SEARCH_URL = "https://www.biccamera.com/bc/category/"
SCRAPE_SLEEP_SEC = 2.0
SCRAPE_TIMEOUT_SEC = 6.0
SCRAPE_FAIL_THRESHOLD = 3  # 連続失敗でセッション中スクレイプ停止
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Safari/537.36"
)

# HTML から最初の商品ブロックの価格 + URL を抽出する簡易パターン。
# 構造変更で壊れる可能性があるため、失敗時は None を返す防御的設計。
_PRICE_RE = re.compile(r'class="bcs_price[^"]*"[^>]*>\s*¥?([\d,]+)')
_LINK_RE = re.compile(r'href="(/bc/item/[^"]+)"')
_TITLE_RE = re.compile(r'class="bcs_title[^"]*"[^>]*>\s*<a[^>]*>([^<]+)</a>')


class BicCameraClient:
    def __init__(
        self,
        rakuten: Optional[RakutenClient] = None,
        yahoo: Optional[YahooClient] = None,
        allow_scraping: bool = False,
    ) -> None:
        self.rakuten = rakuten
        self.yahoo = yahoo
        self.allow_scraping = allow_scraping
        self._http: Optional[httpx.AsyncClient] = None
        # サーキットブレーカー: 連続失敗で以降のリクエストを止める
        self._consecutive_failures = 0
        self._circuit_open = False
        if allow_scraping:
            self._http = httpx.AsyncClient(
                timeout=SCRAPE_TIMEOUT_SEC,
                headers={"User-Agent": USER_AGENT, "Accept-Language": "ja"},
                follow_redirects=True,
            )

    async def close(self) -> None:
        if self._http:
            await self._http.aclose()
            self._http = None

    async def search(
        self, jan: Optional[str], title: Optional[str] = None
    ) -> Optional[dict[str, Any]]:
        if not jan and not title:
            return None

        # 1) 楽天 ビック公式店 (新品のみ、JAN 優先 → 商品名フォールバック)
        if self.rakuten:
            offers = await self.rakuten.search_multi(
                jan=jan, title=title, shop_code=RAKUTEN_BIC_SHOP, hits=5
            )
            new_offers = [o for o in offers if o.get("condition") == "new"]
            if new_offers:
                return {**new_offers[0], "source": "rakuten"}

        # 2) Yahoo ビック店 (新品のみ、JAN 優先 → 商品名フォールバック)
        if self.yahoo:
            offers = await self.yahoo.search_multi(
                jan=jan, query=title, seller_id=YAHOO_BIC_SELLER, hits=5
            )
            new_offers = [o for o in offers if o.get("condition") == "new"]
            if new_offers:
                return {**new_offers[0], "source": "yahoo"}

        # 3) biccamera.com スクレイピング (オプトイン、JAN 必須)
        if (
            self.allow_scraping
            and self._http
            and jan
            and not self._circuit_open
        ):
            scraped = await self._scrape(jan)
            if scraped:
                return {**scraped, "source": "biccamera"}

        return None

    def _record_failure(self) -> None:
        self._consecutive_failures += 1
        if self._consecutive_failures >= SCRAPE_FAIL_THRESHOLD:
            self._circuit_open = True
            log.warning(
                "biccamera: 連続 %d 回失敗。セッション中の本店スクレイプを停止します。",
                self._consecutive_failures,
            )

    def _record_success(self) -> None:
        self._consecutive_failures = 0

    async def _scrape(self, jan: str) -> Optional[dict[str, Any]]:
        try:
            resp = await self._http.get(  # type: ignore[union-attr]
                SCRAPE_SEARCH_URL,
                params={"q": jan},
            )
        except httpx.HTTPError as exc:
            log.warning(
                "biccamera scrape failed for %s: %s %r",
                jan,
                type(exc).__name__,
                str(exc) or "<empty>",
            )
            self._record_failure()
            return None
        await asyncio.sleep(SCRAPE_SLEEP_SEC)
        if resp.status_code != 200:
            log.warning(
                "biccamera scrape %s for %s (anti-bot block の可能性)",
                resp.status_code,
                jan,
            )
            self._record_failure()
            return None
        self._record_success()

        html = resp.text
        # 商品が無い場合 "該当する商品はありません" 等が表示される
        if "該当する商品はありません" in html or "見つかりませんでした" in html:
            return None

        link_m = _LINK_RE.search(html)
        price_m = _PRICE_RE.search(html)
        title_m = _TITLE_RE.search(html)
        if not link_m or not price_m:
            return None

        try:
            price = int(price_m.group(1).replace(",", ""))
        except ValueError:
            return None

        return {
            "price": price,
            "url": SCRAPE_BASE + link_m.group(1),
            "shop": "ビックカメラ.com",
            "title": title_m.group(1).strip() if title_m else None,
        }
