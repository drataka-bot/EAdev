"""Discord Webhook 通知."""
from __future__ import annotations

import logging
from typing import Any, Optional

import httpx

log = logging.getLogger(__name__)


async def send_alert(
    webhook_url: str,
    *,
    title: str,
    description: str,
    url: Optional[str] = None,
    image_url: Optional[str] = None,
    fields: Optional[list[dict[str, Any]]] = None,
    color: int = 0x00BFFF,
) -> bool:
    if not webhook_url:
        return False
    embed: dict[str, Any] = {
        "title": title[:256],
        "description": description[:2000],
        "color": color,
    }
    if url:
        embed["url"] = url
    if image_url:
        embed["thumbnail"] = {"url": image_url}
    if fields:
        embed["fields"] = fields[:25]

    payload = {"embeds": [embed]}

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(webhook_url, json=payload)
        if resp.status_code >= 400:
            log.warning(
                "Discord webhook returned %s: %s", resp.status_code, resp.text[:200]
            )
            return False
        return True
    except httpx.HTTPError as exc:
        log.warning("Discord webhook failed: %s", exc)
        return False
