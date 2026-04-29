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
SLEEP_SEC = 1.5
TIMEOUT_SEC = 20.0


class RakutenClient:
    def __init__(self, app_id: str) -> None:
        self.app_id = app_id
        self._client = httpx.AsyncClient(timeout=TIMEOUT_SEC)
        # 1 req/秒制限を守るため、複数コルーチンからの同時呼び出しを直列化
        self._req_lock = asyncio.Lock()

    async def close(self) -> None:
        await self._client.aclose()

    async def search(
        self,
        keyword: Optional[str] = None,
        *,
        jan: Optional[str] = None,
        title: Optional[str] = None,
        shop_code: Optional[str] = None,
    ) -> Optional[dict[str, Any]]:
        """単一商品 (top 1) を返す互換 API。"""
        offers = await self.search_multi(
            keyword=keyword, jan=jan, title=title, shop_code=shop_code, hits=1
        )
        return offers[0] if offers else None

    async def search_multi(
        self,
        keyword: Optional[str] = None,
        *,
        jan: Optional[str] = None,
        title: Optional[str] = None,
        shop_code: Optional[str] = None,
        hits: int = 5,
    ) -> list[dict[str, Any]]:
        """価格昇順で最大 hits 件のショップ候補を返す。

        優先順位は jan > title > keyword。JAN で 0 件なら title で
        フォールバック検索する。
        """
        candidates: list[tuple[str, str]] = []
        if jan:
            candidates.append(("jan", jan))
        if title:
            candidates.append(("title", title))
        if not candidates and keyword:
            candidates.append(("keyword", keyword))
        if not candidates:
            return []

        for label, term in candidates:
            results = await self._search_once(term, shop_code=shop_code, hits=hits)
            if results:
                for r in results:
                    r["matched_by"] = label
                return results
        return []

    async def _search_once(
        self, keyword: str, shop_code: Optional[str], hits: int = 5
    ) -> list[dict[str, Any]]:
        params: dict[str, Any] = {
            "applicationId": self.app_id,
            "keyword": keyword,
            "hits": max(1, min(30, hits)),
            "sort": "+itemPrice",
            "availability": 1,
            "formatVersion": 2,
        }
        if shop_code:
            params["shopCode"] = shop_code

        # 楽天は 1 req/秒の制限。lock で同時呼び出しを直列化し、
        # リクエスト後の sleep で間隔を担保する。429 は 10 秒待って 1 回リトライ。
        async with self._req_lock:
            for attempt in range(2):
                try:
                    resp = await self._client.get(ENDPOINT, params=params)
                except httpx.HTTPError as exc:
                    log.warning("Rakuten search failed for %s: %s", keyword, exc)
                    await asyncio.sleep(SLEEP_SEC)
                    return []
                await asyncio.sleep(SLEEP_SEC)
                if resp.status_code == 429 and attempt == 0:
                    log.warning(
                        "Rakuten 429 for %s; sleeping 10s and retrying once.",
                        keyword[:60],
                    )
                    await asyncio.sleep(10.0)
                    continue
                break
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
            return []
        data = resp.json()
        items = data.get("Items") or []
        out: list[dict[str, Any]] = []
        for raw in items:
            if not isinstance(raw, dict):
                continue
            try:
                price = int(raw.get("itemPrice") or 0) or None
            except (TypeError, ValueError):
                price = None
            if price is None:
                continue
            shop = raw.get("shopName") or ""
            item_title = raw.get("itemName") or ""
            # 楽天 API には new/used フィールドが無いので、ショップ名・タイトルから推定
            blob = f"{shop} {item_title}"
            condition = "used" if any(k in blob for k in ("中古", "USED", "Used")) else "new"
            out.append(
                {
                    "price": price,
                    "url": raw.get("itemUrl"),
                    "shop": shop or None,
                    "title": item_title or None,
                    "condition": condition,
                }
            )
        return out

    async def search_many(self, keywords: list[str]) -> dict[str, Optional[dict[str, Any]]]:
        out: dict[str, Optional[dict[str, Any]]] = {}
        for kw in keywords:
            out[kw] = await self.search(kw)
            await asyncio.sleep(SLEEP_SEC)
        return out
