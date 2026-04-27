"""Yahoo!ショッピング 商品検索 API クライアント.

公式: https://shopping.yahooapis.jp/ShoppingWebService/V3/itemSearch
- jan_code パラメータで JAN 直接検索が可能
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any, Optional

import httpx

log = logging.getLogger(__name__)

ENDPOINT = "https://shopping.yahooapis.jp/ShoppingWebService/V3/itemSearch"
SLEEP_SEC = 0.3
TIMEOUT_SEC = 20.0


class YahooClient:
    def __init__(self, client_id: str) -> None:
        self.client_id = client_id
        self._client = httpx.AsyncClient(timeout=TIMEOUT_SEC)

    async def close(self) -> None:
        await self._client.aclose()

    async def search(
        self,
        jan: Optional[str] = None,
        query: Optional[str] = None,
        seller_id: Optional[str] = None,
    ) -> Optional[dict[str, Any]]:
        params: dict[str, Any] = {
            "appid": self.client_id,
            "results": 5,
            "sort": "+price",
            "in_stock": "true",
        }
        if jan:
            params["jan_code"] = jan
        elif query:
            params["query"] = query
        else:
            return None
        if seller_id:
            params["seller_id"] = seller_id

        try:
            resp = await self._client.get(ENDPOINT, params=params)
        except httpx.HTTPError as exc:
            log.warning("Yahoo search failed for %s: %s", jan or query, exc)
            return None
        if resp.status_code != 200:
            log.info(
                "Yahoo %s for %s: %s",
                resp.status_code,
                jan or query,
                resp.text[:200],
            )
            return None
        data = resp.json()
        hits = data.get("hits") or []
        if not hits:
            return None
        first = hits[0]
        try:
            price = int(first.get("price") or 0) or None
        except (TypeError, ValueError):
            price = None
        seller = first.get("seller") or {}
        return {
            "price": price,
            "url": first.get("url"),
            "shop": seller.get("name") if isinstance(seller, dict) else None,
            "title": first.get("name"),
        }

    async def search_many_by_jan(
        self, jans: list[str]
    ) -> dict[str, Optional[dict[str, Any]]]:
        out: dict[str, Optional[dict[str, Any]]] = {}
        for jan in jans:
            out[jan] = await self.search(jan=jan)
            await asyncio.sleep(SLEEP_SEC)
        return out
