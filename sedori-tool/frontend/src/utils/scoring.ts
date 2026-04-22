import type { ProductItem, ScoreGrade } from "../types";

const AMAZON_FEE_RATE = 0.1;

export interface LocalScore {
  grade: ScoreGrade;
  profit: number | null;
  profitRate: number | null;
}

export function calcScore(item: ProductItem, purchasePrice: number | null): LocalScore {
  const sell = item.lowest_new_price;
  const fba = item.fba_fee ?? 0;
  const monthly = item.monthly_sales ?? 0;
  const sellers = item.new_offer_count ?? 9999;

  if (sell == null || purchasePrice == null || purchasePrice <= 0) {
    return { grade: "-", profit: null, profitRate: null };
  }

  const amazonFee = Math.floor(sell * AMAZON_FEE_RATE);
  const profit = sell - purchasePrice - fba - amazonFee;
  const profitRate = (profit / purchasePrice) * 100;

  let grade: ScoreGrade = "D";
  if (profitRate >= 20 && monthly >= 30 && sellers <= 5) grade = "S";
  else if (profitRate >= 15 && monthly >= 20 && sellers <= 10) grade = "A";
  else if (profitRate >= 10 && monthly >= 10) grade = "B";
  else if (profitRate >= 5) grade = "C";
  else grade = "D";

  return { grade, profit, profitRate: Math.round(profitRate * 100) / 100 };
}
