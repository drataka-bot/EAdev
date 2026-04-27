"""ヨドバシカメラ価格取得クライアント (スクレイピングのみ).

ヨドバシは楽天/Yahoo に出店していないため公式 API での代替手段がなく、
yodobashi.com を直接スクレイピングする。

リスク:
  - ToS / 利用規約上の懸念
  - HTML 構造変更による parser 破損
  - Cloudflare 等の anti-bot ブロック / IP BAN

allow_scraping=True を明示した場合のみ動作する opt-in 方式。
"""
from __future__ import annotations

import asyncio
import logging
import re
from typing import Any, Optional

import httpx

log = logging.getLogger(__name__)

BASE = "https://www.yodobashi.com"
SEARCH_URL = "https://www.yodobashi.com/?word={jan}"
SCRAPE_SLEEP_SEC = 2.0
SCRAPE_TIMEOUT_SEC = 20.0
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Safari/537.36"
)

# 検索結果ページ・商品ページ双方で出る価格パターン (例: ￥1,980 / ¥1,980)
_PRICE_RE = re.compile(r'[¥￥]\s*([\d,]+)\s*<')
# 商品リンク: /product/100000001003456789/ など
_PRODUCT_LINK_RE = re.compile(r'href="(/product/\d+/?)"')
# 商品タイトル: <h1 class="...">...</h1> の最初
_H1_RE = re.compile(r'<h1[^>]*>(.*?)</h1>', re.S)


class YodobashiClient:
    def __init__(self, allow_scraping: bool = False) -> None:
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

    async def search(self, jan: Optional[str]) -> Optional[dict[str, Any]]:
        if not self.allow_scraping or not self._http or not jan:
            return None
        try:
            resp = await self._http.get(SEARCH_URL.format(jan=jan))
        except httpx.HTTPError as exc:
            log.warning("yodobashi scrape failed for %s: %s", jan, exc)
            return None
        await asyncio.sleep(SCRAPE_SLEEP_SEC)
        if resp.status_code != 200:
            log.info("yodobashi scrape %s for %s", resp.status_code, jan)
            return None

        html = resp.text
        if "検索結果はありません" in html or "該当する商品が見つかりません" in html:
            return None

        # JAN 完全一致時はリダイレクトで商品ページ (/product/...) に飛ぶ
        final_url = str(resp.url)
        is_product_page = "/product/" in final_url

        price_m = _PRICE_RE.search(html)
        if not price_m:
            return None
        try:
            price = int(price_m.group(1).replace(",", ""))
        except ValueError:
            return None

        if is_product_page:
            url = final_url
            title_m = _H1_RE.search(html)
            title = (
                re.sub(r"<[^>]+>", "", title_m.group(1)).strip()
                if title_m
                else None
            )
        else:
            link_m = _PRODUCT_LINK_RE.search(html)
            url = (BASE + link_m.group(1)) if link_m else final_url
            title = None

        return {
            "price": price,
            "url": url,
            "shop": "ヨドバシ.com",
            "title": title,
        }
