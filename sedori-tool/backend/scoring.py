"""仕入れ判断スコアリングロジック。

利益額 = Amazon最安値 - 仕入れ価格 - FBA手数料 - Amazon手数料(10%)
利益率 = 利益額 / 仕入れ価格 × 100
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional


AMAZON_FEE_RATE = 0.10


@dataclass
class ScoreInput:
    amazon_lowest_price: Optional[int]
    purchase_price: Optional[int]
    fba_fee: Optional[int]
    monthly_sales: Optional[int]
    seller_count: Optional[int]


@dataclass
class ScoreResult:
    grade: str
    profit: Optional[int]
    profit_rate: Optional[float]


def calc_score(data: ScoreInput) -> ScoreResult:
    sell_price = data.amazon_lowest_price
    purchase = data.purchase_price
    fba = data.fba_fee or 0

    if not sell_price or not purchase or purchase <= 0:
        return ScoreResult(grade="-", profit=None, profit_rate=None)

    amazon_fee = int(sell_price * AMAZON_FEE_RATE)
    profit = sell_price - purchase - fba - amazon_fee
    profit_rate = (profit / purchase) * 100

    monthly = data.monthly_sales or 0
    sellers = data.seller_count if data.seller_count is not None else 9999

    grade = "D"
    if profit_rate >= 20 and monthly >= 30 and sellers <= 5:
        grade = "S"
    elif profit_rate >= 15 and monthly >= 20 and sellers <= 10:
        grade = "A"
    elif profit_rate >= 10 and monthly >= 10:
        grade = "B"
    elif profit_rate >= 5:
        grade = "C"
    else:
        grade = "D"

    return ScoreResult(grade=grade, profit=profit, profit_rate=round(profit_rate, 2))
