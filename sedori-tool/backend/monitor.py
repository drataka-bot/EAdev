"""ウォッチリストの定期チェック (15分ごと).

Amazon (Keepa) に加え、楽天・Yahoo!ショッピングの最安値も収集して
複数ソース横断でトリガを評価する。
"""
from __future__ import annotations

import asyncio
import logging
import os
from typing import Any, Callable, Optional

import watchlist
from discord_notify import send_alert
from keepa_client import KeepaClient, normalize_product
from rakuten_client import RakutenClient
from yahoo_client import YahooClient

log = logging.getLogger("sedori.monitor")

DEFAULT_INTERVAL_SEC = int(os.getenv("WATCHLIST_INTERVAL_SEC", "900"))  # 15 分


def _amazon_url(asin: str) -> str:
    return f"https://www.amazon.co.jp/dp/{asin}"


def _cheapest_across_sources(
    amazon_price: Optional[int],
    rakuten_price: Optional[int],
    yahoo_price: Optional[int],
) -> tuple[Optional[int], Optional[str]]:
    """3 ソースの最安値と源を返す。"""
    cands: list[tuple[str, int]] = []
    if amazon_price is not None:
        cands.append(("amazon", amazon_price))
    if rakuten_price is not None:
        cands.append(("rakuten", rakuten_price))
    if yahoo_price is not None:
        cands.append(("yahoo", yahoo_price))
    if not cands:
        return None, None
    src, p = min(cands, key=lambda x: x[1])
    return p, src


def _evaluate_triggers(
    item: dict[str, Any],
    *,
    amazon_in_stock: bool,
    cheapest_price: Optional[int],
    cheapest_source: Optional[str],
    rank: Optional[int],
) -> list[tuple[str, str]]:
    """発火条件を評価。(type, message) のリストを返す。"""
    fired: list[tuple[str, str]] = []

    # 在庫復活 (Amazon ベース)
    if item.get("trigger_restock"):
        prev_stock = item.get("last_in_stock")
        if prev_stock == 0 and amazon_in_stock:
            fired.append(("restock", "Amazon の在庫が復活しました"))

    # 価格条件: 全ソース最安が閾値以下
    threshold_price = item.get("trigger_price_below")
    if (
        threshold_price
        and cheapest_price is not None
        and cheapest_price <= threshold_price
    ):
        prev_price = item.get("last_price")
        if prev_price is None or prev_price > threshold_price:
            label = {
                "amazon": "Amazon",
                "rakuten": "楽天",
                "yahoo": "Yahoo",
            }.get(cheapest_source or "", cheapest_source or "?")
            fired.append(
                (
                    "price",
                    f"{label} で価格が ¥{cheapest_price:,} まで下がりました "
                    f"(閾値 ¥{threshold_price:,})",
                )
            )

    # ランク条件 (Amazon)
    threshold_rank = item.get("trigger_rank_below")
    if threshold_rank and rank is not None and rank <= threshold_rank:
        prev_rank = item.get("last_rank")
        if prev_rank is None or prev_rank > threshold_rank:
            fired.append(
                ("rank", f"ランキング {rank:,} 位 (閾値 {threshold_rank:,} 位以内)")
            )

    return fired


async def _fetch_rakuten_yahoo(
    asin_to_product: dict[str, dict[str, Any]],
    rakuten: Optional[RakutenClient],
    yahoo: Optional[YahooClient],
) -> tuple[
    dict[str, Optional[dict[str, Any]]], dict[str, Optional[dict[str, Any]]]
]:
    rakuten_top: dict[str, Optional[dict[str, Any]]] = {}
    yahoo_top: dict[str, Optional[dict[str, Any]]] = {}

    async def run_rakuten() -> None:
        if not rakuten:
            return
        for asin, prod in asin_to_product.items():
            try:
                offers = await rakuten.search_multi(
                    jan=prod.get("jan"), title=prod.get("title"), hits=3
                )
                # 新品のみを採用 (中古は監視対象外)
                new_offers = [o for o in offers if o.get("condition") == "new"]
                rakuten_top[asin] = new_offers[0] if new_offers else None
            except Exception as exc:  # noqa: BLE001
                log.warning("monitor Rakuten failed for %s: %s", asin, exc)
                rakuten_top[asin] = None

    async def run_yahoo() -> None:
        if not yahoo:
            return
        for asin, prod in asin_to_product.items():
            try:
                offers = await yahoo.search_multi(
                    jan=prod.get("jan"), query=prod.get("title"), hits=3
                )
                new_offers = [o for o in offers if o.get("condition") == "new"]
                yahoo_top[asin] = new_offers[0] if new_offers else None
            except Exception as exc:  # noqa: BLE001
                log.warning("monitor Yahoo failed for %s: %s", asin, exc)
                yahoo_top[asin] = None

    await asyncio.gather(run_rakuten(), run_yahoo(), return_exceptions=True)
    return rakuten_top, yahoo_top


async def check_once(
    api_key: str,
    webhook_url: Optional[str],
    *,
    rakuten_id: Optional[str] = None,
    yahoo_id: Optional[str] = None,
    domain: int = 5,
) -> int:
    """ウォッチリスト 1 巡。発火件数を返す。"""
    items = [i for i in watchlist.list_items() if i.get("enabled")]
    if not items:
        return 0

    asins = [i["asin"] for i in items]
    log.info(
        "watchlist scan: %d ASIN(s) (rakuten=%s yahoo=%s)",
        len(asins),
        bool(rakuten_id),
        bool(yahoo_id),
    )

    keepa = KeepaClient(
        api_key=api_key,
        domain=domain,
        offers=int(os.getenv("KEEPA_OFFERS", "0")),
        batch_size=int(os.getenv("KEEPA_BATCH_SIZE", "100")),
        batch_sleep_sec=float(os.getenv("KEEPA_BATCH_SLEEP_SEC", "1.2")),
    )
    rakuten = RakutenClient(rakuten_id) if rakuten_id else None
    yahoo = YahooClient(yahoo_id) if yahoo_id else None

    asin_to_product: dict[str, dict[str, Any]] = {}
    try:
        try:
            async for batch_products, _ in keepa.fetch_products(asins):
                for p in batch_products:
                    a = p.get("asin")
                    if a:
                        asin_to_product[a] = normalize_product(p)
        except Exception as exc:  # noqa: BLE001
            log.warning("monitor Keepa fetch partial failure: %s", exc)

        rakuten_top, yahoo_top = await _fetch_rakuten_yahoo(
            asin_to_product, rakuten, yahoo
        )
    finally:
        await keepa.close()
        if rakuten:
            await rakuten.close()
        if yahoo:
            await yahoo.close()

    fired_total = 0
    for item in items:
        asin = item["asin"]
        product = asin_to_product.get(asin)
        if not product:
            continue

        amazon_price = product.get("current_price") or product.get("lowest_new_price")
        amazon_in_stock = bool(
            (product.get("new_offer_count") or 0) > 0
            or product.get("amazon_in_stock")
        )
        rank = product.get("rank_current")
        title = product.get("title")
        image_url = product.get("image_url") or item.get("image_url")

        rk = rakuten_top.get(asin)
        yh = yahoo_top.get(asin)
        rakuten_price = rk.get("price") if rk else None
        yahoo_price = yh.get("price") if yh else None

        cheapest_price, cheapest_source = _cheapest_across_sources(
            amazon_price, rakuten_price, yahoo_price
        )

        fired = _evaluate_triggers(
            item,
            amazon_in_stock=amazon_in_stock,
            cheapest_price=cheapest_price,
            cheapest_source=cheapest_source,
            rank=rank,
        )

        # 状態更新: 価格は全ソース最安、在庫は Amazon
        watchlist.update_check_state(
            asin,
            in_stock=amazon_in_stock,
            price=cheapest_price,
            rank=rank,
            title=title,
            image_url=image_url,
        )

        for alert_type, msg in fired:
            payload = {
                "asin": asin,
                "title": title,
                "amazon_price": amazon_price,
                "amazon_in_stock": amazon_in_stock,
                "rakuten_price": rakuten_price,
                "rakuten_url": rk.get("url") if rk else None,
                "rakuten_shop": rk.get("shop") if rk else None,
                "yahoo_price": yahoo_price,
                "yahoo_url": yh.get("url") if yh else None,
                "yahoo_shop": yh.get("shop") if yh else None,
                "cheapest_price": cheapest_price,
                "cheapest_source": cheapest_source,
                "rank": rank,
            }
            watchlist.add_alert(asin, alert_type, msg, payload)
            fired_total += 1

            if webhook_url:
                fields: list[dict[str, Any]] = []
                if amazon_price is not None:
                    fields.append(
                        {
                            "name": f"Amazon{' ★' if cheapest_source == 'amazon' else ''}",
                            "value": f"¥{amazon_price:,}",
                            "inline": True,
                        }
                    )
                if rakuten_price is not None:
                    rk_url = rk.get("url") if rk else None
                    val = (
                        f"[¥{rakuten_price:,}]({rk_url})" if rk_url else f"¥{rakuten_price:,}"
                    )
                    fields.append(
                        {
                            "name": f"楽天{' ★' if cheapest_source == 'rakuten' else ''}",
                            "value": val,
                            "inline": True,
                        }
                    )
                if yahoo_price is not None:
                    yh_url = yh.get("url") if yh else None
                    val = (
                        f"[¥{yahoo_price:,}]({yh_url})" if yh_url else f"¥{yahoo_price:,}"
                    )
                    fields.append(
                        {
                            "name": f"Yahoo{' ★' if cheapest_source == 'yahoo' else ''}",
                            "value": val,
                            "inline": True,
                        }
                    )
                if rank is not None:
                    fields.append(
                        {"name": "ランク", "value": f"{rank:,}", "inline": True}
                    )
                fields.append(
                    {
                        "name": "Amazon在庫",
                        "value": "あり" if amazon_in_stock else "なし",
                        "inline": True,
                    }
                )
                color = {
                    "restock": 0x00BFFF,
                    "price": 0x10B981,
                    "rank": 0xF59E0B,
                }.get(alert_type, 0x9CA3AF)
                await send_alert(
                    webhook_url,
                    title=f"[{alert_type.upper()}] {title or asin}",
                    description=msg,
                    url=_amazon_url(asin),
                    image_url=image_url,
                    fields=fields,
                    color=color,
                )

    log.info("watchlist scan done: %d alert(s)", fired_total)
    return fired_total


async def run_loop(
    get_api_key: Callable[[], str],
    get_webhook: Callable[[], str],
    get_rakuten_id: Optional[Callable[[], str]] = None,
    get_yahoo_id: Optional[Callable[[], str]] = None,
    interval_sec: int = DEFAULT_INTERVAL_SEC,
    domain: int = 5,
) -> None:
    """常駐ループ。各設定値は呼び出し時に解決。"""
    log.info("monitor loop start (interval=%ss)", interval_sec)
    while True:
        await asyncio.sleep(interval_sec)
        try:
            api_key = get_api_key()
            if not api_key:
                log.info("monitor: KEEPA_API_KEY 未設定。スキップ。")
                continue
            await check_once(
                api_key,
                get_webhook(),
                rakuten_id=get_rakuten_id() if get_rakuten_id else None,
                yahoo_id=get_yahoo_id() if get_yahoo_id else None,
                domain=domain,
            )
        except Exception as exc:  # noqa: BLE001
            log.exception("monitor loop error: %s", exc)
