export type ScoreGrade = "S" | "A" | "B" | "C" | "D" | "-";

export type SizeCategory = "小型" | "標準" | "大型";

export interface ProductItem {
  input_code: string;
  asin: string | null;
  jan: string | null;
  title: string | null;
  brand: string | null;
  category: string | null;
  size_category: SizeCategory | string | null;
  amazon_price: number | null;
  new_price: number | null;
  used_price: number | null;
  lowest_new_price: number | null;
  buy_box_price: number | null;
  fba_price: number | null;
  fbm_price: number | null;
  fba_fee: number | null;
  rank_current: number | null;
  rank_avg30: number | null;
  rank_avg90: number | null;
  monthly_sales: number;
  sales_30d: number | null;
  sales_90d: number | null;
  new_offer_count: number | null;
  used_offer_count: number | null;
  fba_offer_count: number | null;
  fbm_offer_count: number | null;
  amazon_in_stock: boolean;
  buy_box_is_amazon: boolean;
  amazon_url: string | null;
  keepa_url: string | null;
  rakuten_price: number | null;
  rakuten_url: string | null;
  rakuten_shop: string | null;
  yahoo_price: number | null;
  yahoo_url: string | null;
  yahoo_shop: string | null;
  bic_price: number | null;
  bic_url: string | null;
  bic_shop: string | null;
  bic_source: "rakuten" | "yahoo" | "biccamera" | null;
  yodobashi_price: number | null;
  yodobashi_url: string | null;
  yodobashi_shop: string | null;
  cheapest_source_price: number | null;
  cheapest_source: "rakuten" | "yahoo" | "bic" | "yodobashi" | null;
  purchase_price: number | null;
  profit: number | null;
  profit_rate: number | null;
  score: ScoreGrade | string;
  error: string | null;
}

export interface ResearchResponse {
  items: ProductItem[];
  total: number;
  succeeded: number;
  failed: number;
  sources: {
    keepa: boolean;
    rakuten: boolean;
    yahoo: boolean;
    bic: boolean;
    yodobashi: boolean;
    scraping: boolean;
  };
}

export interface AppSettings {
  apiKey: string;
  rakutenAppId: string;
  yahooClientId: string;
  enableScraping: boolean;
  defaultPurchasePrice: number | null;
}

export interface AdvancedFilter {
  grades: Set<string>;
  keyword: string;
  minProfitRate: number | null;
  minMonthlySales: number | null;
  maxNewOfferCount: number | null;
  maxFbaOfferCount: number | null;
  excludeAmazon: boolean;
  sizeCategories: Set<string>;
  profitableOnly: boolean;
}
