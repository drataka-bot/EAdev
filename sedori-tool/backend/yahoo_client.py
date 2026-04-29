"""Yahoo!ショッピング 商品検索 API クライアント.

公式: https://shopping.yahooapis.jp/ShoppingWebService/V3/itemSearch
- jan_code パラメータで JAN 直接検索が可能
- 429 (URL レート制限) を受けたらクールダウン期間スキップする
"""
from __future__ import annotations

import asyncio
import logging
import time
from typing import Any, Optional

import httpx

log = logging.getLogger(__name__)

ENDPOINT = "https://shopping.yahooapis.jp/ShoppingWebService/V3/itemSearch"
SLEEP_SEC = 1.0
COOLDOWN_AFTER_429_SEC = 60.0
TIMEOUT_SEC = 20.0


class YahooClient:
    def __init__(self, client_id: str) -> None:
        self.client_id = client_id
        self._client = httpx.AsyncClient(timeout=TIMEOUT_SEC)
        # 429 を受けたら一定時間クールダウン
        self._cooldown_until: float = 0.0
        # 並行呼び出しを直列化 (汎用検索 + ビック店舗検索の競合を防ぐ)
        self._req_lock = asyncio.Lock()
        # UI 表示用カウンタ
        self.success_count: int = 0
        self.error_count: int = 0
        self.rate_limited_count: int = 0
        self.last_error: Optional[str] = None

    def reset_stats(self) -> None:
        self.success_count = 0
        self.error_count = 0
        self.rate_limited_count = 0
        self.last_error = None

    async def close(self) -> None:
        await self._client.aclose()

    def _in_cooldown(self) -> bool:
        return time.monotonic() < self._cooldown_until

    def _trigger_cooldown(self) -> None:
        self._cooldown_until = time.monotonic() + COOLDOWN_AFTER_429_SEC
        log.warning(
            "Yahoo: 429 を受信。%ss クールダウン後に処理を再開します。",
            int(COOLDOWN_AFTER_429_SEC),
        )

    async def _await_cooldown(self) -> None:
        """クールダウン中なら残り時間スリープして続行可能な状態にする。"""
        remaining = self._cooldown_until - time.monotonic()
        if remaining > 0:
            log.info("Yahoo: クールダウン中。あと %.0fs 待機します。", remaining)
            await asyncio.sleep(remaining + 0.5)
            self._cooldown_until = 0.0

    async def search(
        self,
        jan: Optional[str] = None,
        query: Optional[str] = None,
        seller_id: Optional[str] = None,
    ) -> Optional[dict[str, Any]]:
        """単一商品 (top 1) を返す互換 API。"""
        offers = await self.search_multi(
            jan=jan, query=query, seller_id=seller_id, hits=1
        )
        return offers[0] if offers else None

    async def search_multi(
        self,
        jan: Optional[str] = None,
        query: Optional[str] = None,
        seller_id: Optional[str] = None,
        hits: int = 5,
    ) -> list[dict[str, Any]]:
        """JAN を最優先、ヒット 0 件なら query でフォールバック。新品 + 中古を含む。"""
        await self._await_cooldown()
        if jan:
            results = await self._search_once(
                seller_id=seller_id, jan_code=jan, hits=hits
            )
            if results:
                for r in results:
                    r["matched_by"] = "jan"
                return results
            await self._await_cooldown()
        if query:
            results = await self._search_once(
                seller_id=seller_id, query=query, hits=hits
            )
            if results:
                for r in results:
                    r["matched_by"] = "title"
                return results
        return []

    async def _search_once(
        self,
        seller_id: Optional[str] = None,
        jan_code: Optional[str] = None,
        query: Optional[str] = None,
        hits: int = 5,
    ) -> list[dict[str, Any]]:
        params: dict[str, Any] = {
            "appid": self.client_id,
            "results": max(1, min(50, hits)),
            "sort": "+price",
            "in_stock": "true",
        }
        if jan_code:
            params["jan_code"] = jan_code
        elif query:
            params["query"] = query
        else:
            return []
        if seller_id:
            params["seller_id"] = seller_id

        async with self._req_lock:
            try:
                resp = await self._client.get(ENDPOINT, params=params)
            except httpx.HTTPError as exc:
                self.error_count += 1
                self.last_error = f"network: {type(exc).__name__}"
                log.warning(
                    "Yahoo search failed for %s: %s",
                    jan_code or query,
                    exc,
                )
                await asyncio.sleep(SLEEP_SEC)
                return []
            await asyncio.sleep(SLEEP_SEC)

        if resp.status_code == 429:
            self._trigger_cooldown()
            self.rate_limited_count += 1
            self.last_error = "429: レート制限超過"
            log.warning(
                "Yahoo 429 for %s: %s",
                jan_code or query,
                resp.text[:200],
            )
            return []

        if resp.status_code != 200:
            self.error_count += 1
            self.last_error = f"HTTP {resp.status_code}"
            log.warning(
                "Yahoo %s for %s: %s",
                resp.status_code,
                jan_code or query,
                resp.text[:300],
            )
            return []
        self.success_count += 1

        data = resp.json()
        hits_arr = data.get("hits") or []
        out: list[dict[str, Any]] = []
        for raw in hits_arr:
            if not isinstance(raw, dict):
                continue
            try:
                price = int(raw.get("price") or 0) or None
            except (TypeError, ValueError):
                price = None
            if price is None:
                continue
            seller = raw.get("seller") or {}
            # Yahoo Shopping API は condition フィールドを持つ ('new' / 'used')
            condition = raw.get("condition")
            if condition not in ("new", "used"):
                # 未指定時はデフォルトで新品扱い
                condition = "new"
            out.append(
                {
                    "price": price,
                    "url": raw.get("url"),
                    "shop": seller.get("name") if isinstance(seller, dict) else None,
                    "title": raw.get("name"),
                    "condition": condition,
                }
            )
        return out

    async def search_many_by_jan(
        self, jans: list[str]
    ) -> dict[str, Optional[dict[str, Any]]]:
        out: dict[str, Optional[dict[str, Any]]] = {}
        for jan in jans:
            out[jan] = await self.search(jan=jan)
            await asyncio.sleep(SLEEP_SEC)
        return out
