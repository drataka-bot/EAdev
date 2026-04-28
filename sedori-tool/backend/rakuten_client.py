"""楽天市場 商品検索 API クライアント.

公式: https://webservice.rakuten.co.jp/documentation/ichiba-item-search
- IchibaItem/Search/20170706
- レート制限: 概ね 1 req/sec を推奨
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any, Optional

import httpx

log = logging.getLogger(__name__)

ENDPOINT = "https://app.rakuten.co.jp/services/api/IchibaItem/Search/20170706"
SLEEP_SEC = 1.1
TIMEOUT_SEC = 20.0


class RakutenClient:
    def __init__(self, app_id: str) -> None:
        self.app_id = app_id
        self._client = httpx.AsyncClient(timeout=TIMEOUT_SEC)

    async def close(self) -> None:
        await self._client.aclose()

    async def search(
        self, keyword: str, shop_code: Optional[str] = None
    ) -> Optional[dict[str, Any]]:
        """keyword (JAN または商品名) で検索し、最安候補を返す。

        shop_code を指定すると特定店舗 (例: 'biccamera') のみが対象になる。
        """
        if not keyword:
            return None
        params: dict[str, Any] = {
            "applicationId": self.app_id,
            "keyword": keyword,
            "hits": 5,
            "sort": "+itemPrice",
            "availability": 1,
            "formatVersion": 2,
        }
        if shop_code:
            params["shopCode"] = shop_code
        try:
            resp = await self._client.get(ENDPOINT, params=params)
        except httpx.HTTPError as exc:
            log.warning("Rakuten search failed for %s: %s", keyword, exc)
            return None
        if resp.status_code != 200:
            body_short = resp.text[:300]
            if "applicationId" in body_short:
                log.error(
                    "Rakuten %s for %s: %s\n"
                    "  → 楽天 applicationId は 20桁の数字です。UUID 形式の値を入れていませんか?\n"
                    "    https://webservice.rakuten.co.jp/app/list で『アプリID/applicationId』を確認してください。",
                    resp.status_code,
                    keyword,
                    body_short,
                )
            else:
                log.warning(
                    "Rakuten %s for %s: %s",
                    resp.status_code,
                    keyword,
                    body_short,
                )
            return None
        data = resp.json()
        items = data.get("Items") or []
        if not items:
            return None
        # formatVersion=2 では Items は dict のリスト
        first = items[0]
        if not isinstance(first, dict):
            return None
        try:
            price = int(first.get("itemPrice") or 0) or None
        except (TypeError, ValueError):
            price = None
        return {
            "price": price,
            "url": first.get("itemUrl"),
            "shop": first.get("shopName"),
            "title": first.get("itemName"),
        }

    async def search_many(self, keywords: list[str]) -> dict[str, Optional[dict[str, Any]]]:
        out: dict[str, Optional[dict[str, Any]]] = {}
        for kw in keywords:
            out[kw] = await self.search(kw)
            await asyncio.sleep(SLEEP_SEC)
        return out
