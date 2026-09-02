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
  category: string;
  price_inr: number;
  price_paise: number;
  compare_price_inr: number | null;
  discount_pct: number | null;
  sizes: string[];
  colors: string[];
  stock: number;
  in_stock: boolean;
  images: string[];
  color_images?: Record<string, string[]>;
  ai_summary: string;
  bundle_offers: BundleOffer[];
  negotiable?: boolean;
  negotiation_policy?: {
    max_allowed_discount_pct: number;
    quote_endpoint: string;
  };
}

export interface MerchantCapabilityManifest {
  manifest_type: "protocol-shaped merchant capability manifest";
  policy_version: "v1.0";
  agent_permissions: {
    can_recommend_bundles: boolean;
    can_negotiate: boolean;
    can_checkout: boolean;
  };
  mandate_required: boolean;
  max_autonomous_checkout_inr: number;
  max_autonomous_checkout_paise: number;
  quote_expiry_seconds: number;
  active_bundles: {
    id: string;
    name: string;
    discount_percent: number;
    product_a_id: string;
    product_b_id: string;
  }[];
}

export interface AgentCatalogResponse {
  status: "success" | "error";
  protocol_version: "a2a-v1.0";
  store: {
    name: string;
    tagline: string;
    currency: "INR";
    supported_payment_rails: string[];
    merchant_id: string;
  };
  timestamp: string;
  merchant_capability_manifest: MerchantCapabilityManifest;
  filters_applied: {
    category?: string;
    max_price_inr?: number;
    in_stock_only?: boolean;
    query?: string;
  };
  total_items: number;
  products: AgentProductItem[];
  agent_instructions: {
    order_endpoint: string;
    quote_endpoint: string;
    currency: string;
    max_recommended_single_cart_inr: number;
    notes: string;
  };
}

export interface CatalogFilterParams {
  category?: string;
  in_stock?: boolean;
  max_price?: number;
  q?: string;
}
