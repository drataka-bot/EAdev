"""ウォッチリストの定期チェック (15分ごと)."""
from __future__ import annotations

import asyncio
import logging
import os
from typing import Any, Optional

import watchlist
from discord_notify import send_alert
from keepa_client import KeepaClient, normalize_product

log = logging.getLogger("sedori.monitor")

DEFAULT_INTERVAL_SEC = int(os.getenv("WATCHLIST_INTERVAL_SEC", "900"))  # 15 分


def _amazon_url(asin: str) -> str:
    return f"https://www.amazon.co.jp/dp/{asin}"


def _evaluate_triggers(
    item: dict[str, Any], product: dict[str, Any]
) -> list[tuple[str, str]]:
    """発火条件を評価。(type, message) のリストを返す。"""
    fired: list[tuple[str, str]] = []

    in_stock = (product.get("new_offer_count") or 0) > 0 or product.get("amazon_in_stock")
    price = product.get("lowest_new_price")
    rank = product.get("rank_current")

    # 在庫復活
    if item.get("trigger_restock"):
        prev_stock = item.get("last_in_stock")
        # 初回 (prev_stock=None) はアラートしない
        if prev_stock == 0 and in_stock:
            fired.append(("restock", "在庫が復活しました"))

    # 価格条件
    threshold_price = item.get("trigger_price_below")
    if threshold_price and price is not None and price <= threshold_price:
        prev_price = item.get("last_price")
        # 既に閾値以下だったら再通知しない
        if prev_price is None or prev_price > threshold_price:
            fired.append(("price", f"価格が ¥{price:,} まで下がりました (閾値 ¥{threshold_price:,})"))

    # ランク条件 (上位ほど数値が小さい)
    threshold_rank = item.get("trigger_rank_below")
    if threshold_rank and rank is not None and rank <= threshold_rank:
        prev_rank = item.get("last_rank")
        if prev_rank is None or prev_rank > threshold_rank:
            fired.append(("rank", f"ランキング {rank:,} 位 (閾値 {threshold_rank:,} 位以内)"))

    return fired


async def check_once(api_key: str, webhook_url: Optional[str], domain: int = 5) -> int:
    """ウォッチリスト 1 巡。発火件数を返す。"""
    items = [i for i in watchlist.list_items() if i.get("enabled")]
    if not items:
        return 0

    asins = [i["asin"] for i in items]
    log.info("watchlist scan: %d ASIN(s)", len(asins))

    keepa = KeepaClient(
        api_key=api_key,
        domain=domain,
        offers=int(os.getenv("KEEPA_OFFERS", "0")),
        batch_size=int(os.getenv("KEEPA_BATCH_SIZE", "100")),
        batch_sleep_sec=float(os.getenv("KEEPA_BATCH_SLEEP_SEC", "1.2")),
    )

    asin_to_product: dict[str, dict[str, Any]] = {}
    try:
        async for batch_products, _ in keepa.fetch_products(asins):
            for p in batch_products:
                asin = p.get("asin")
                if asin:
                    asin_to_product[asin] = normalize_product(p)
    finally:
        await keepa.close()

    fired_total = 0
    for item in items:
        asin = item["asin"]
        product = asin_to_product.get(asin)
        if not product:
            continue

        fired = _evaluate_triggers(item, product)

        in_stock = bool(
            (product.get("new_offer_count") or 0) > 0 or product.get("amazon_in_stock")
        )
        price = product.get("lowest_new_price")
        rank = product.get("rank_current")
        title = product.get("title")
        image_url = product.get("image_url") or item.get("image_url")

        watchlist.update_check_state(
            asin,
            in_stock=in_stock,
            price=price,
            rank=rank,
            title=title,
            image_url=image_url,
        )

        for alert_type, msg in fired:
            payload = {
                "asin": asin,
                "title": title,
                "price": price,
                "rank": rank,
                "in_stock": in_stock,
            }
            watchlist.add_alert(asin, alert_type, msg, payload)
            fired_total += 1

            if webhook_url:
                fields = []
                if price is not None:
                    fields.append({"name": "価格", "value": f"¥{price:,}", "inline": True})
                if rank is not None:
                    fields.append({"name": "ランク", "value": f"{rank:,}", "inline": True})
                fields.append(
                    {"name": "在庫", "value": "あり" if in_stock else "なし", "inline": True}
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
    get_api_key: callable,  # type: ignore[valid-type]
    get_webhook: callable,  # type: ignore[valid-type]
    interval_sec: int = DEFAULT_INTERVAL_SEC,
    domain: int = 5,
) -> None:
    """常駐ループ。Keepa キーと Webhook URL は呼び出し時に解決。"""
    log.info("monitor loop start (interval=%ss)", interval_sec)
    # 起動直後に 1 回回さず、interval だけ待ってから 1 回目を実行
    while True:
        await asyncio.sleep(interval_sec)
        try:
            api_key = get_api_key()
            if not api_key:
                log.info("monitor: KEEPA_API_KEY 未設定。スキップ。")
                continue
            webhook = get_webhook()
            await check_once(api_key, webhook, domain=domain)
        except Exception as exc:  # noqa: BLE001
            log.exception("monitor loop error: %s", exc)
