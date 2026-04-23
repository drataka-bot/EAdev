"""FastAPI エントリポイント。"""
from __future__ import annotations

import logging
import os
import re
from typing import Optional

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from keepa_client import KeepaClient, KeepaError, normalize_product
from scoring import ScoreInput, calc_score

load_dotenv()

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("sedori")

KEEPA_API_KEY_ENV = os.getenv("KEEPA_API_KEY", "").strip()
KEEPA_DOMAIN = int(os.getenv("KEEPA_DOMAIN", "5"))
CORS_ORIGINS = [
    o.strip()
    for o in os.getenv("BACKEND_CORS_ORIGINS", "http://localhost:5173").split(",")
    if o.strip()
]

ASIN_RE = re.compile(r"^[A-Z0-9]{10}$")
JAN_RE = re.compile(r"^\d{8}(\d{5})?$")  # 8 or 13 桁

app = FastAPI(title="電脳せどりリサーチツール", version="1.0.0")
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
    api_key: Optional[str] = Field(default=None, description="UI から渡す Keepa API キー")
    default_purchase_price: Optional[int] = None


class ProductItem(BaseModel):
    input_code: str
    asin: Optional[str]
    title: Optional[str] = None
    brand: Optional[str] = None
    category: Optional[str] = None
    amazon_price: Optional[int] = None
    new_price: Optional[int] = None
    used_price: Optional[int] = None
    lowest_new_price: Optional[int] = None
    buy_box_price: Optional[int] = None
    fba_fee: Optional[int] = None
    rank_current: Optional[int] = None
    rank_avg30: Optional[int] = None
    rank_avg90: Optional[int] = None
    monthly_sales: int = 0
    new_offer_count: Optional[int] = None
    used_offer_count: Optional[int] = None
    amazon_in_stock: bool = False
    buy_box_is_amazon: bool = False
    amazon_url: Optional[str] = None
    keepa_url: Optional[str] = None
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


def _resolve_api_key(supplied: Optional[str]) -> str:
    key = (KEEPA_API_KEY_ENV or (supplied or "")).strip()
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
async def health() -> dict[str, str]:
    return {"status": "ok"}


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

    api_key = _resolve_api_key(req.api_key)

    # 入力を正規化
    cleaned: list[str] = []
    for raw in req.codes:
        if raw is None:
            continue
        c = raw.strip().upper()
        if c:
            cleaned.append(c)

    # 重複排除（順序保持）
    seen: set[str] = set()
    unique: list[str] = []
    for c in cleaned:
        if c not in seen:
            seen.add(c)
            unique.append(c)

    asin_targets: list[str] = []
    jan_targets: list[str] = []
    invalid: list[str] = []
    for code in unique:
        kind = _classify(code)
        if kind == "asin":
            asin_targets.append(code)
        elif kind == "jan":
            jan_targets.append(code)
        else:
            invalid.append(code)

    try:
        client = KeepaClient(api_key=api_key, domain=KEEPA_DOMAIN)
    except KeepaError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    input_to_asin: dict[str, Optional[str]] = {}
    try:
        # JAN -> ASIN
        if jan_targets:
            jan_map = await client.jans_to_asins(jan_targets)
            for jan, asin in jan_map.items():
                input_to_asin[jan] = asin
                if asin and asin not in seen:
                    asin_targets.append(asin)
                    seen.add(asin)

        for asin in list(asin_targets):
            input_to_asin.setdefault(asin, asin)

        # ASIN 取得 (バッチ)
        asin_to_product: dict[str, dict] = {}
        async for batch_products, _processed in client.fetch_products(asin_targets):
            for p in batch_products:
                asin = p.get("asin")
                if asin:
                    asin_to_product[asin] = normalize_product(p)
    finally:
        await client.close()

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

        purchase_price = req.default_purchase_price
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
                **product,
            )
        )
        succeeded += 1

    return ResearchResponse(
        items=items, total=len(unique), succeeded=succeeded, failed=failed
    )
