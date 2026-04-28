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
SCRAPE_TIMEOUT_SEC = 15.0
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

        # 1) 楽天 ビック公式店 (JAN 優先 → 商品名フォールバック)
        if self.rakuten:
            r = await self.rakuten.search(
                jan=jan, title=title, shop_code=RAKUTEN_BIC_SHOP
            )
            if r and r.get("price"):
                return {**r, "source": "rakuten"}

        # 2) Yahoo ビック店 (JAN 優先 → 商品名フォールバック)
        if self.yahoo:
            y = await self.yahoo.search(
                jan=jan, query=title, seller_id=YAHOO_BIC_SELLER
            )
            if y and y.get("price"):
                return {**y, "source": "yahoo"}

        # 3) biccamera.com スクレイピング (オプトイン、JAN 必須)
        if self.allow_scraping and self._http and jan:
            scraped = await self._scrape(jan)
            if scraped:
                return {**scraped, "source": "biccamera"}

        return None

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
            return None
        await asyncio.sleep(SCRAPE_SLEEP_SEC)
        if resp.status_code != 200:
            log.warning(
                "biccamera scrape %s for %s (anti-bot block の可能性)",
                resp.status_code,
                jan,
            )
            return None

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
