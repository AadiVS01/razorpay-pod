export interface Product {
  id: string;
  name: string;
  description: string | null;
  price: number; // in paise (e.g., 65000 = ₹650)
  compare_price: number | null; // in paise
  images: string[];
  sizes: string[];
  colors?: string[];
  color_images?: Record<string, string[]>;
  category: string | null;
  stock: number;
  active: boolean;
  slug: string;
  qikink_sku?: string | null;
  created_at?: string;
}

export interface BundleOffer {
  addon_category: string;
  discount_pct: number;
  description: string;
  recommended_skus?: string[];
}

export interface AgentProductItem {
  id: string;
  sku: string;
  slug: string;
  name: string;
  description: string;
  category: string;
  price_inr: number;
  price_paise: number;
  compare_price_inr: number | null;
  discount_pct: number | null;
  sizes: string[];
  colors: string[];
  stock: number;
  in_stock: boolean;
  image_url: string;
  images: string[];
  image?: string;
  color_images?: Record<string, string[]>;
  ai_summary: string;
  bundle_offers: BundleOffer[];
  negotiable?: boolean;
  negotiation_policy?: {
    max_allowed_discount_pct: number;
    quote_endpoint: string;
  };
}

export interface ActiveBundle {
  id: string;
  name: string;
  discount_percent: number;
  product_ids?: string[];
  product_a_id?: string;
  product_b_id?: string;
  recommendation_reason?: string;
  active?: boolean;
}

export interface ActiveGrowthRule {
  id: string;
  name: string;
  type: string;
  description?: string;
  product_ids: string[];
  trigger_product_ids?: string[];
  reward_product_ids?: string[];
  discount_percent?: number;
  discount_amount_paise?: number;
  buy_quantity?: number;
  free_quantity?: number;
  quantity_tiers?: Array<{ min_quantity: number; discount_percent: number }>;
  min_cart_value_paise?: number;
  reorder_interval_days?: number;
  buyer_eligibility?: string;
  max_discount_paise?: number;
  margin_floor_percent?: number;
  max_redemptions_per_order?: number;
  stackable: boolean;
  active: boolean;
  recommendation_reason: string;
  created_at?: string;
}

export interface MerchantCapabilityManifest {
  manifest_type: "protocol-shaped merchant capability manifest";
  policy_version: string;
  agent_permissions: {
    can_discover_products?: boolean;
    can_recommend_bundles: boolean;
    can_recommend_growth_rules?: boolean;
    can_negotiate: boolean;
    can_apply_promotions?: boolean;
    can_offer_welcome_incentives?: boolean;
    can_offer_returning_incentives?: boolean;
    can_initiate_recovery?: boolean;
    can_suggest_reorders?: boolean;
    can_checkout: boolean;
  };
  mandate_required: boolean;
  max_autonomous_checkout_inr: number;
  max_autonomous_checkout_paise: number;
  max_discount_percent?: number;
  margin_floor_percent?: number;
  quote_expiry_seconds: number;
  promotion_stacking_allowed?: boolean;
  max_recommendations_per_interaction?: number;
  recovery_retry_limit?: number;
  active_bundles: ActiveBundle[];
  active_growth_rules?: ActiveGrowthRule[];
}

export interface AgentCatalogResponse {
  status: "success" | "error";
  version?: string;
  protocol_version?: string;
  policy_version?: string;
  generated_at?: string;
  timestamp?: string;
  store: {
    name: string;
    tagline?: string;
    currency: "INR";
    currency_symbol?: string;
    supported_payment_rails?: string[];
    merchant_id?: string;
    total_products?: number;
    contact?: {
      agent_support: string;
      gateway: string;
    };
  };
  merchant_capability_manifest: MerchantCapabilityManifest;
  active_growth_rules?: ActiveGrowthRule[];
  active_bundles?: ActiveBundle[];
  promotions?: ActiveGrowthRule[];
  filters_applied?: {
    category?: string;
    max_price_inr?: number;
    in_stock_only?: boolean;
    query?: string;
  };
  total_items?: number;
  products: AgentProductItem[];
  agent_instructions?: {
    order_endpoint: string;
    quote_endpoint: string;
    currency: string;
    max_recommended_single_cart_inr: number;
    notes: string;
  };
  autonomous_checkout?: {
    endpoint: string;
    method: string;
    required_headers: Record<string, string>;
    supported_protocols: string[];
    protocol_adapter_endpoint: string;
    parameters: Record<string, string>;
  };
}

export interface CatalogFilterParams {
  category?: string;
  in_stock?: boolean;
  max_price?: number;
  q?: string;
}
