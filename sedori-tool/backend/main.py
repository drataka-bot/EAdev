"""FastAPI エントリポイント。

Amazon (Keepa) / 楽天市場 / Yahoo!ショッピング を一括取得し、
仕入れ判断スコアを返す。
"""
from __future__ import annotations

import asyncio
import logging
import os
import re
from contextlib import asynccontextmanager
from typing import Any, Optional

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from bic_client import BicCameraClient
from keepa_client import KeepaClient, KeepaError, normalize_product
from rakuten_client import RakutenClient
from scoring import ScoreInput, calc_score
from yahoo_client import YahooClient
from yodobashi_client import YodobashiClient
import monitor
import watchlist

load_dotenv()

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("sedori")

KEEPA_API_KEY_ENV = os.getenv("KEEPA_API_KEY", "").strip()
KEEPA_DOMAIN = int(os.getenv("KEEPA_DOMAIN", "5"))
# トークン節約モード: offers=0 (デフォルト) で 1 ASIN あたり 1 トークンに抑える。
# offers=20 で詳細出品データ (FBA 出品者数の内訳など) を取得 (6 トークン/ASIN)。
KEEPA_OFFERS = int(os.getenv("KEEPA_OFFERS", "0"))
KEEPA_BATCH_SIZE = int(os.getenv("KEEPA_BATCH_SIZE", "100"))
KEEPA_BATCH_SLEEP_SEC = float(os.getenv("KEEPA_BATCH_SLEEP_SEC", "1.2"))
RAKUTEN_APP_ID_ENV = os.getenv("RAKUTEN_APP_ID", "").strip()
YAHOO_CLIENT_ID_ENV = os.getenv("YAHOO_CLIENT_ID", "").strip()
ENABLE_SCRAPING_ENV = os.getenv("ENABLE_SCRAPING", "").strip().lower() in (
    "1",
    "true",
    "yes",
)
DISCORD_WEBHOOK_ENV = os.getenv("DISCORD_WEBHOOK_URL", "").strip()
WATCHLIST_INTERVAL_SEC = int(os.getenv("WATCHLIST_INTERVAL_SEC", "900"))
# UI から設定された Webhook URL は in-memory で保持 (複数台運用は想定外)
_runtime_webhook: dict[str, str] = {}
CORS_ORIGINS = [
    o.strip()
    for o in os.getenv("BACKEND_CORS_ORIGINS", "http://localhost:5173").split(",")
    if o.strip()
]

ASIN_RE = re.compile(r"^[A-Z0-9]{10}$")
JAN_RE = re.compile(r"^\d{8}(\d{5})?$")  # 8 or 13 桁

def _resolve_webhook() -> str:
    return DISCORD_WEBHOOK_ENV or _runtime_webhook.get("url", "")


def _resolve_keepa_for_monitor() -> str:
    """監視ジョブ用の Keepa キー解決。.env か /api/watchlist/config で渡された値。"""
    env = _resolve(KEEPA_API_KEY_ENV, None)
    return env or _runtime_webhook.get("keepa", "")


@asynccontextmanager
async def lifespan(_app: FastAPI):  # type: ignore[no-untyped-def]
    watchlist.init_db()
    task = asyncio.create_task(
        monitor.run_loop(
            get_api_key=_resolve_keepa_for_monitor,
            get_webhook=_resolve_webhook,
            interval_sec=WATCHLIST_INTERVAL_SEC,
            domain=KEEPA_DOMAIN,
        )
    )
    log.info("watchlist monitor started (interval=%ss)", WATCHLIST_INTERVAL_SEC)
    try:
        yield
    finally:
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass


app = FastAPI(title="電脳せどりリサーチツール", version="1.2.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------
class ResearchRequest(BaseModel):
    codes: list[str] = Field(default_factory=list, description="ASIN / JAN の配列")
    api_key: Optional[str] = Field(default=None, description="Keepa API キー")
    rakuten_app_id: Optional[str] = Field(default=None, description="楽天 ApplicationId")
    yahoo_client_id: Optional[str] = Field(default=None, description="Yahoo ClientID")
    enable_scraping: Optional[bool] = Field(
        default=None, description="ビック/ヨドバシ本店スクレイピングを許可"
    )
    default_purchase_price: Optional[int] = None


class ProductItem(BaseModel):
    input_code: str
    asin: Optional[str]
    jan: Optional[str] = None
    title: Optional[str] = None
    brand: Optional[str] = None
    category: Optional[str] = None
    size_category: Optional[str] = None
    amazon_price: Optional[int] = None
    current_price: Optional[int] = None
    new_price: Optional[int] = None
    used_price: Optional[int] = None
    lowest_new_price: Optional[int] = None
    buy_box_price: Optional[int] = None
    fba_price: Optional[int] = None
    fbm_price: Optional[int] = None
    fba_fee: Optional[int] = None
    rank_current: Optional[int] = None
    rank_avg30: Optional[int] = None
    rank_avg90: Optional[int] = None
    monthly_sales: int = 0
    sales_30d: Optional[int] = None
    sales_90d: Optional[int] = None
    new_offer_count: Optional[int] = None
    used_offer_count: Optional[int] = None
    fba_offer_count: Optional[int] = None
    fbm_offer_count: Optional[int] = None
    amazon_in_stock: bool = False
    buy_box_is_amazon: bool = False
    amazon_url: Optional[str] = None
    keepa_url: Optional[str] = None
    keepa_graph_url: Optional[str] = None
    # 仕入れ候補 (top 1: 互換用)
    rakuten_price: Optional[int] = None
    rakuten_url: Optional[str] = None
    rakuten_shop: Optional[str] = None
    rakuten_condition: Optional[str] = None
    yahoo_price: Optional[int] = None
    yahoo_url: Optional[str] = None
    yahoo_shop: Optional[str] = None
    yahoo_condition: Optional[str] = None
    # 複数ショップ候補 (価格昇順 / 各最大 5 件)
    rakuten_offers: list[dict[str, Any]] = Field(default_factory=list)
    yahoo_offers: list[dict[str, Any]] = Field(default_factory=list)
    cheapest_source_price: Optional[int] = None
    cheapest_source: Optional[str] = None  # rakuten / yahoo / bic / yodobashi
    bic_price: Optional[int] = None
    bic_url: Optional[str] = None
    bic_shop: Optional[str] = None
    bic_source: Optional[str] = None  # rakuten / yahoo / biccamera
    yodobashi_price: Optional[int] = None
    yodobashi_url: Optional[str] = None
    yodobashi_shop: Optional[str] = None
    # スコア結果
    purchase_price: Optional[int] = None
    profit: Optional[int] = None
    profit_rate: Optional[float] = None
    score: str = "-"
    error: Optional[str] = None


class ResearchResponse(BaseModel):
    items: list[ProductItem]
    total: int
    succeeded: int
    failed: int
    sources: dict[str, bool]
    keepa_tokens_left: Optional[int] = None
    keepa_refill_in_ms: Optional[int] = None


class ScoreRequest(BaseModel):
    amazon_lowest_price: Optional[int] = None
    purchase_price: Optional[int] = None
    fba_fee: Optional[int] = None
    monthly_sales: Optional[int] = None
    seller_count: Optional[int] = None


class ScoreResponse(BaseModel):
    grade: str
    profit: Optional[int]
    profit_rate: Optional[float]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _classify(code: str) -> str:
    code = code.strip().upper()
    if ASIN_RE.match(code):
        return "asin"
    if JAN_RE.match(code):
        return "jan"
    return "invalid"


def _resolve(env_val: str, supplied: Optional[str]) -> str:
    """API キーを解決。優先順位は UI 入力 > .env。

    `.env.example` のプレースホルダ値 (your_*) は未設定扱い。
    """
    def _clean(v: Optional[str]) -> str:
        s = (v or "").strip()
        if not s or s.startswith("your_"):
            return ""
        return s

    return _clean(supplied) or _clean(env_val)


def _resolve_keepa_key(supplied: Optional[str]) -> str:
    key = _resolve(KEEPA_API_KEY_ENV, supplied)
    if not key:
        raise HTTPException(
            status_code=400,
            detail="Keepa API キーが設定されていません。.env か設定画面で指定してください。",
        )
    return key


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.get("/api/health")
async def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "keepa": bool(_resolve(KEEPA_API_KEY_ENV, None)),
        "rakuten": bool(_resolve(RAKUTEN_APP_ID_ENV, None)),
        "yahoo": bool(_resolve(YAHOO_CLIENT_ID_ENV, None)),
        "scraping": ENABLE_SCRAPING_ENV,
        "keepa_offers": KEEPA_OFFERS,
        "keepa_batch_size": KEEPA_BATCH_SIZE,
    }


@app.post("/api/score", response_model=ScoreResponse)
async def score(req: ScoreRequest) -> ScoreResponse:
    result = calc_score(
        ScoreInput(
            amazon_lowest_price=req.amazon_lowest_price,
            purchase_price=req.purchase_price,
            fba_fee=req.fba_fee,
            monthly_sales=req.monthly_sales,
            seller_count=req.seller_count,
        )
    )
    return ScoreResponse(grade=result.grade, profit=result.profit, profit_rate=result.profit_rate)


@app.post("/api/research", response_model=ResearchResponse)
async def research(req: ResearchRequest) -> ResearchResponse:
    if not req.codes:
        raise HTTPException(status_code=400, detail="codes は必須です。")

    keepa_key = _resolve_keepa_key(req.api_key)
    rakuten_id = _resolve(RAKUTEN_APP_ID_ENV, req.rakuten_app_id)
    yahoo_id = _resolve(YAHOO_CLIENT_ID_ENV, req.yahoo_client_id)
    enable_scraping = (
        req.enable_scraping if req.enable_scraping is not None else ENABLE_SCRAPING_ENV
    )
    log.info(
        "research start: codes=%d keepa=%s rakuten=%s yahoo=%s scraping=%s",
        len(req.codes),
        "set" if keepa_key else "MISSING",
        "set" if rakuten_id else "missing",
        "set" if yahoo_id else "missing",
        enable_scraping,
    )

    # 入力の正規化 + 重複排除
    seen: set[str] = set()
    unique: list[str] = []
    for raw in req.codes:
        if raw is None:
            continue
        c = raw.strip().upper()
        if c and c not in seen:
            seen.add(c)
            unique.append(c)

    asin_targets: list[str] = []
    jan_targets: list[str] = []
    for code in unique:
        kind = _classify(code)
        if kind == "asin":
            asin_targets.append(code)
        elif kind == "jan":
            jan_targets.append(code)

    # ----- Keepa: JAN -> ASIN, 商品取得 -----
    try:
        keepa = KeepaClient(
            api_key=keepa_key,
            domain=KEEPA_DOMAIN,
            offers=KEEPA_OFFERS,
            batch_size=KEEPA_BATCH_SIZE,
            batch_sleep_sec=KEEPA_BATCH_SLEEP_SEC,
        )
    except KeepaError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    input_to_asin: dict[str, Optional[str]] = {}
    asin_to_product: dict[str, dict] = {}
    try:
        if jan_targets:
            jan_map = await keepa.jans_to_asins(jan_targets)
            for jan, asin in jan_map.items():
                input_to_asin[jan] = asin
                if asin and asin not in seen:
                    asin_targets.append(asin)
                    seen.add(asin)
        for asin in list(asin_targets):
            input_to_asin.setdefault(asin, asin)

        async for batch_products, _processed in keepa.fetch_products(asin_targets):
            for p in batch_products:
                a = p.get("asin")
                if a:
                    asin_to_product[a] = normalize_product(p)
    finally:
        await keepa.close()

    # ----- 楽天 / Yahoo / ビック / ヨドバシ: 並行取得 -----
    rakuten_offers_map: dict[str, list[dict[str, Any]]] = {}
    yahoo_offers_map: dict[str, list[dict[str, Any]]] = {}
    bic_results: dict[str, Optional[dict[str, Any]]] = {}
    yodobashi_results: dict[str, Optional[dict[str, Any]]] = {}

    rakuten = RakutenClient(rakuten_id) if rakuten_id else None
    yahoo = YahooClient(yahoo_id) if yahoo_id else None
    # Bic 用にも同じインスタンスを共有 (Rakuten 1 req/sec 制限を守るため)
    bic = BicCameraClient(
        rakuten=rakuten,
        yahoo=yahoo,
        allow_scraping=enable_scraping,
    )
    yodobashi = YodobashiClient(allow_scraping=enable_scraping)

    try:
        async def run_rakuten() -> None:
            if not rakuten:
                return
            for asin, prod in asin_to_product.items():
                jan = prod.get("jan")
                title = prod.get("title")
                if not jan and not title:
                    continue
                rakuten_offers_map[asin] = await rakuten.search_multi(
                    jan=jan, title=title, hits=5
                )
                await asyncio.sleep(0)

        async def run_yahoo() -> None:
            if not yahoo:
                return
            for asin, prod in asin_to_product.items():
                jan = prod.get("jan")
                title = prod.get("title")
                yahoo_offers_map[asin] = await yahoo.search_multi(
                    jan=jan, query=title, hits=5
                )

        async def run_bic() -> None:
            for asin, prod in asin_to_product.items():
                bic_results[asin] = await bic.search(
                    jan=prod.get("jan"), title=prod.get("title")
                )

        async def run_yodobashi() -> None:
            if not enable_scraping:
                return
            for asin, prod in asin_to_product.items():
                yodobashi_results[asin] = await yodobashi.search(jan=prod.get("jan"))

        await asyncio.gather(run_rakuten(), run_yahoo(), run_bic(), run_yodobashi())
    finally:
        if rakuten:
            await rakuten.close()
        if yahoo:
            await yahoo.close()
        await bic.close()
        await yodobashi.close()

    # ----- 結果アセンブル + スコアリング -----
    items: list[ProductItem] = []
    succeeded = 0
    failed = 0

    for code in unique:
        asin = input_to_asin.get(code)
        if not asin:
            items.append(
                ProductItem(
                    input_code=code,
                    asin=None,
                    error="JAN から ASIN を解決できませんでした"
                    if _classify(code) == "jan"
                    else "不正なコード",
                )
            )
            failed += 1
            continue

        product = asin_to_product.get(asin)
        if not product:
            items.append(
                ProductItem(
                    input_code=code,
                    asin=asin,
                    error="Keepa から商品情報を取得できませんでした",
                )
            )
            failed += 1
            continue

        rakuten_offers = rakuten_offers_map.get(asin) or []
        yahoo_offers = yahoo_offers_map.get(asin) or []
        # 仕入れ用の単一値は新品のみから最安を採用 (中古は混ぜない)
        rk_new = next((o for o in rakuten_offers if o.get("condition") == "new"), None)
        yh_new = next((o for o in yahoo_offers if o.get("condition") == "new"), None)
        rk = rk_new or (rakuten_offers[0] if rakuten_offers else None)
        yh = yh_new or (yahoo_offers[0] if yahoo_offers else None)
        bc = bic_results.get(asin)
        yd = yodobashi_results.get(asin)

        rakuten_price = rk.get("price") if rk else None
        yahoo_price = yh.get("price") if yh else None
        bic_price = bc.get("price") if bc else None
        yodobashi_price = yd.get("price") if yd else None

        # 仕入れ価格: 4 ソースの最安を採用
        candidates = [
            ("rakuten", rakuten_price),
            ("yahoo", yahoo_price),
            ("bic", bic_price),
            ("yodobashi", yodobashi_price),
        ]
        valid = [(s, p) for s, p in candidates if p is not None]
        cheapest = None
        cheapest_source = None
        if valid:
            cheapest_source, cheapest = min(valid, key=lambda x: x[1])

        purchase_price = (
            cheapest if cheapest is not None else req.default_purchase_price
        )

        score_result = calc_score(
            ScoreInput(
                amazon_lowest_price=product.get("lowest_new_price"),
                purchase_price=purchase_price,
                fba_fee=product.get("fba_fee"),
                monthly_sales=product.get("monthly_sales"),
                seller_count=product.get("new_offer_count"),
            )
        )

        items.append(
            ProductItem(
                input_code=code,
                purchase_price=purchase_price,
                profit=score_result.profit,
                profit_rate=score_result.profit_rate,
                score=score_result.grade,
                rakuten_price=rakuten_price,
                rakuten_url=rk.get("url") if rk else None,
                rakuten_shop=rk.get("shop") if rk else None,
                rakuten_condition=rk.get("condition") if rk else None,
                rakuten_offers=rakuten_offers,
                yahoo_price=yahoo_price,
                yahoo_url=yh.get("url") if yh else None,
                yahoo_shop=yh.get("shop") if yh else None,
                yahoo_condition=yh.get("condition") if yh else None,
                yahoo_offers=yahoo_offers,
                bic_price=bic_price,
                bic_url=bc.get("url") if bc else None,
                bic_shop=bc.get("shop") if bc else None,
                bic_source=bc.get("source") if bc else None,
                yodobashi_price=yodobashi_price,
                yodobashi_url=yd.get("url") if yd else None,
                yodobashi_shop=yd.get("shop") if yd else None,
                cheapest_source_price=cheapest,
                cheapest_source=cheapest_source,
                **product,
            )
        )
        succeeded += 1

    return ResearchResponse(
        items=items,
        total=len(unique),
        succeeded=succeeded,
        failed=failed,
        sources={
            "keepa": True,
            "rakuten": bool(rakuten_id),
            "yahoo": bool(yahoo_id),
            "bic": True,  # 楽天/Yahoo経由なので常に有効化扱い
            "yodobashi": bool(enable_scraping),
            "scraping": bool(enable_scraping),
        },
        keepa_tokens_left=keepa.last_tokens_left,
        keepa_refill_in_ms=keepa.last_refill_in_ms,
    )


# ---------------------------------------------------------------------------
# Watchlist endpoints
# ---------------------------------------------------------------------------
class WatchlistItemIn(BaseModel):
    asin: str
    title: Optional[str] = None
    image_url: Optional[str] = None
    note: Optional[str] = None
    trigger_restock: bool = True
    trigger_price_below: Optional[int] = None
    trigger_rank_below: Optional[int] = None
    enabled: bool = True


class WatchlistConfigIn(BaseModel):
    discord_webhook_url: Optional[str] = None
    keepa_api_key: Optional[str] = None


@app.get("/api/watchlist")
async def watchlist_list() -> dict[str, Any]:
    return {
        "items": watchlist.list_items(),
        "interval_sec": WATCHLIST_INTERVAL_SEC,
        "webhook_configured": bool(_resolve_webhook()),
        "monitor_keepa_configured": bool(_resolve_keepa_for_monitor()),
    }


@app.post("/api/watchlist")
async def watchlist_upsert(req: WatchlistItemIn) -> dict[str, Any]:
    asin = req.asin.strip().upper()
    if not ASIN_RE.match(asin):
        raise HTTPException(status_code=400, detail="ASIN の形式が不正です")
    item = watchlist.upsert_item(
        asin,
        title=req.title,
        image_url=req.image_url,
        note=req.note,
        trigger_restock=req.trigger_restock,
        trigger_price_below=req.trigger_price_below,
        trigger_rank_below=req.trigger_rank_below,
        enabled=req.enabled,
    )
    return item


@app.delete("/api/watchlist/{asin}")
async def watchlist_delete(asin: str) -> dict[str, str]:
    asin = asin.strip().upper()
    watchlist.delete_item(asin)
    return {"status": "deleted", "asin": asin}


@app.get("/api/watchlist/alerts")
async def watchlist_alerts(limit: int = 50) -> dict[str, Any]:
    limit = max(1, min(500, limit))
    return {"alerts": watchlist.list_alerts(limit)}


@app.post("/api/watchlist/config")
async def watchlist_config(req: WatchlistConfigIn) -> dict[str, Any]:
    """UI から Discord Webhook URL / Keepa キー (監視用) を保存する。"""
    if req.discord_webhook_url is not None:
        _runtime_webhook["url"] = req.discord_webhook_url.strip()
    if req.keepa_api_key is not None:
        _runtime_webhook["keepa"] = req.keepa_api_key.strip()
    return {
        "webhook_configured": bool(_resolve_webhook()),
        "monitor_keepa_configured": bool(_resolve_keepa_for_monitor()),
    }


@app.post("/api/watchlist/check")
async def watchlist_check_now() -> dict[str, Any]:
    """手動でウォッチリストを 1 巡 (テスト用)."""
    api_key = _resolve_keepa_for_monitor()
    if not api_key:
        raise HTTPException(
            status_code=400,
            detail="監視用の Keepa API キーが設定されていません (/api/watchlist/config か .env で指定)",
        )
    fired = await monitor.check_once(api_key, _resolve_webhook(), domain=KEEPA_DOMAIN)
    return {"fired": fired}
