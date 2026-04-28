"""ウォッチリスト + アラート履歴の永続化 (SQLite).

依存追加なし (Python 標準 sqlite3) で軽量に運用する。
"""
from __future__ import annotations

import json
import os
import sqlite3
import time
from contextlib import contextmanager
from typing import Any, Iterator, Optional

DB_PATH = os.getenv("WATCHLIST_DB_PATH", "watchlist.db")


_SCHEMA = """
CREATE TABLE IF NOT EXISTS watchlist (
    asin TEXT PRIMARY KEY,
    title TEXT,
    image_url TEXT,
    note TEXT,
    trigger_restock INTEGER NOT NULL DEFAULT 1,
    trigger_price_below INTEGER,
    trigger_rank_below INTEGER,
    enabled INTEGER NOT NULL DEFAULT 1,
    added_at INTEGER NOT NULL,
    last_checked_at INTEGER,
    last_in_stock INTEGER,
    last_price INTEGER,
    last_rank INTEGER
);

CREATE TABLE IF NOT EXISTS alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    asin TEXT NOT NULL,
    type TEXT NOT NULL,
    message TEXT,
    payload_json TEXT,
    created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_alerts_asin ON alerts (asin);
CREATE INDEX IF NOT EXISTS idx_alerts_created ON alerts (created_at);
"""


@contextmanager
def _conn() -> Iterator[sqlite3.Connection]:
    c = sqlite3.connect(DB_PATH)
    c.row_factory = sqlite3.Row
    try:
        yield c
        c.commit()
    finally:
        c.close()


def init_db() -> None:
    with _conn() as c:
        c.executescript(_SCHEMA)


def now_ts() -> int:
    return int(time.time())


# ---------------------------------------------------------------------------
# Watchlist CRUD
# ---------------------------------------------------------------------------

def list_items() -> list[dict[str, Any]]:
    with _conn() as c:
        rows = c.execute("SELECT * FROM watchlist ORDER BY added_at DESC").fetchall()
    return [dict(r) for r in rows]


def get_item(asin: str) -> Optional[dict[str, Any]]:
    with _conn() as c:
        r = c.execute("SELECT * FROM watchlist WHERE asin = ?", (asin,)).fetchone()
    return dict(r) if r else None


def upsert_item(
    asin: str,
    *,
    title: Optional[str] = None,
    image_url: Optional[str] = None,
    note: Optional[str] = None,
    trigger_restock: bool = True,
    trigger_price_below: Optional[int] = None,
    trigger_rank_below: Optional[int] = None,
    enabled: bool = True,
) -> dict[str, Any]:
    existing = get_item(asin)
    with _conn() as c:
        if existing:
            c.execute(
                """
                UPDATE watchlist SET
                    title = COALESCE(?, title),
                    image_url = COALESCE(?, image_url),
                    note = ?,
                    trigger_restock = ?,
                    trigger_price_below = ?,
                    trigger_rank_below = ?,
                    enabled = ?
                WHERE asin = ?
                """,
                (
                    title,
                    image_url,
                    note,
                    1 if trigger_restock else 0,
                    trigger_price_below,
                    trigger_rank_below,
                    1 if enabled else 0,
                    asin,
                ),
            )
        else:
            c.execute(
                """
                INSERT INTO watchlist (
                    asin, title, image_url, note,
                    trigger_restock, trigger_price_below, trigger_rank_below,
                    enabled, added_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    asin,
                    title,
                    image_url,
                    note,
                    1 if trigger_restock else 0,
                    trigger_price_below,
                    trigger_rank_below,
                    1 if enabled else 0,
                    now_ts(),
                ),
            )
    return get_item(asin) or {}


def delete_item(asin: str) -> None:
    with _conn() as c:
        c.execute("DELETE FROM watchlist WHERE asin = ?", (asin,))
        c.execute("DELETE FROM alerts WHERE asin = ?", (asin,))


def update_check_state(
    asin: str,
    *,
    in_stock: bool,
    price: Optional[int],
    rank: Optional[int],
    title: Optional[str] = None,
    image_url: Optional[str] = None,
) -> None:
    with _conn() as c:
        c.execute(
            """
            UPDATE watchlist SET
                last_checked_at = ?,
                last_in_stock = ?,
                last_price = ?,
                last_rank = ?,
                title = COALESCE(?, title),
                image_url = COALESCE(?, image_url)
            WHERE asin = ?
            """,
            (
                now_ts(),
                1 if in_stock else 0,
                price,
                rank,
                title,
                image_url,
                asin,
            ),
        )


# ---------------------------------------------------------------------------
# Alerts
# ---------------------------------------------------------------------------

def add_alert(asin: str, alert_type: str, message: str, payload: dict[str, Any]) -> int:
    with _conn() as c:
        cur = c.execute(
            "INSERT INTO alerts (asin, type, message, payload_json, created_at) VALUES (?, ?, ?, ?, ?)",
            (asin, alert_type, message, json.dumps(payload, ensure_ascii=False), now_ts()),
        )
        return int(cur.lastrowid or 0)


def list_alerts(limit: int = 50) -> list[dict[str, Any]]:
    with _conn() as c:
        rows = c.execute(
            "SELECT * FROM alerts ORDER BY created_at DESC LIMIT ?", (limit,)
        ).fetchall()
    out: list[dict[str, Any]] = []
    for r in rows:
        d = dict(r)
        try:
            d["payload"] = json.loads(d.pop("payload_json") or "{}")
        except Exception:
            d["payload"] = {}
        out.append(d)
    return out
