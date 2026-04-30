"""楽天市場 商品検索 API クライアント.

公式: https://webservice.rakuten.co.jp/documentation/ichiba-item-search
- IchibaItem/Search/20170706
- レート制限: 概ね 1 req/sec を推奨
"""
from __future__ import annotations

import asyncio
import logging
import re
import time
from typing import Any, Optional

import httpx

# 複数個セット / まとめ買い検出
MULTIPACK_RE = re.compile(
    r"(\d+\s*[個本枚袋箱冊台缶杯]\s*セット|"
    r"\d+\s*(?:P|pack|PACK|パック)\b|"
    r"まとめ買い|まとめ売り|セット販売|セット商品|"
    r"[xX×]\s*\d+\s*(?:個|本|セット)|"
    r"\d+\s*(?:個|本)\s*入り\s*セット|"
    r"\d+\s*(?:個|本)\s*まとめ)"
)


def is_multipack(text: str) -> bool:
    if not text:
        return False
    return bool(MULTIPACK_RE.search(text))

log = logging.getLogger(__name__)

ENDPOINT = "https://app.rakuten.co.jp/services/api/IchibaItem/Search/20170706"
SLEEP_SEC = 1.5
COOLDOWN_AFTER_429_SEC = 60.0
TIMEOUT_SEC = 20.0


class RakutenClient:
    def __init__(self, app_id: str) -> None:
        self.app_id = app_id
        self._client = httpx.AsyncClient(timeout=TIMEOUT_SEC)
        # 1 req/秒制限を守るため、複数コルーチンからの同時呼び出しを直列化
        self._req_lock = asyncio.Lock()
        # 直近のリクエスト時刻 (monotonic)。再利用クライアントで連続実行時の
        # 間隔を担保する。
        self._last_request_at: float = 0.0
        # 429 を受けた後のクールダウン期限
        self._cooldown_until: float = 0.0
        # 状態カウンタ (UI 表示用、reset_stats() でリセット可)
        self.success_count: int = 0
        self.error_count: int = 0
        self.rate_limited_count: int = 0
        self.last_error: Optional[str] = None

    async def close(self) -> None:
        await self._client.aclose()

    def reset_stats(self) -> None:
        self.success_count = 0
        self.error_count = 0
        self.rate_limited_count = 0
        self.last_error = None

    def _in_cooldown(self) -> bool:
        return time.monotonic() < self._cooldown_until

    async def _await_cooldown(self) -> None:
        remaining = self._cooldown_until - time.monotonic()
        if remaining > 0:
            log.info("Rakuten: クールダウン中。あと %.0fs 待機します。", remaining)
            await asyncio.sleep(remaining + 0.5)
            self._cooldown_until = 0.0

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

        # 楽天 1 req/秒制限を守る:
        # - lock で同時呼び出しを直列化
        # - クールダウン中なら満了まで待ってから送信
        # - 直近リクエストから SLEEP_SEC 経っていない場合は差分だけ待つ
        # - 429 を受けたら COOLDOWN_AFTER_429_SEC のクールダウンを設定
        async with self._req_lock:
            await self._await_cooldown()
            gap = time.monotonic() - self._last_request_at
            if gap < SLEEP_SEC:
                await asyncio.sleep(SLEEP_SEC - gap)
            try:
                resp = await self._client.get(ENDPOINT, params=params)
            except httpx.HTTPError as exc:
                log.warning("Rakuten search failed for %s: %s", keyword[:60], exc)
                self._last_request_at = time.monotonic()
                self.error_count += 1
                self.last_error = f"network: {type(exc).__name__}"
                return []
            self._last_request_at = time.monotonic()
            if resp.status_code == 429:
                self._cooldown_until = time.monotonic() + COOLDOWN_AFTER_429_SEC
                self.rate_limited_count += 1
                self.last_error = "429: レート制限超過"
                log.warning(
                    "Rakuten 429 for %s; cooldown %.0fs.",
                    keyword[:60],
                    COOLDOWN_AFTER_429_SEC,
                )
                return []
        if resp.status_code != 200:
            body_short = resp.text[:300]
            if "applicationId" in body_short:
                self.last_error = "applicationId が無効 (UUID を入れていませんか?)"
                log.error(
                    "Rakuten %s for %s: %s\n"
                    "  → 楽天 applicationId は 20桁の数字です。UUID 形式の値を入れていませんか?\n"
                    "    https://webservice.rakuten.co.jp/app/list で『アプリID/applicationId』を確認してください。",
                    resp.status_code,
                    keyword,
                    body_short,
                )
            else:
                self.last_error = f"HTTP {resp.status_code}"
                log.warning(
                    "Rakuten %s for %s: %s",
                    resp.status_code,
                    keyword,
                    body_short,
                )
            self.error_count += 1
            return []
        self.success_count += 1
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
            # 在庫チェック (レスポンス側): availability=0 は販売停止
            if raw.get("availability") == 0:
                continue
            shop = raw.get("shopName") or ""
            item_title = raw.get("itemName") or ""
            blob = f"{shop} {item_title}"
            # 在庫切れキーワードを除外
            if any(
                k in blob
                for k in (
                    "在庫切れ",
                    "在庫なし",
                    "売り切れ",
                    "売切れ",
                    "完売",
                    "販売終了",
                    "品切れ",
                    "入荷待ち",
                    "再入荷待ち",
                    "受注停止",
                    "販売停止",
                )
            ):
                continue
            # 複数個セット / まとめ買い商品を除外 (単品 ASIN との比較を歪めるため)
            if is_multipack(item_title):
                continue
            # 楽天 API には new/used フィールドが無いので、ショップ名・タイトルから推定
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
